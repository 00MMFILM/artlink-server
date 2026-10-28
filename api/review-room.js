const {
  createClient
} = require('@supabase/supabase-js');
const crypto = require('node:crypto');
const contract = require('../public/review/contract');
const BUCKET = 'review-media';
const hash = s => crypto.createHash('sha256').update(s).digest('hex');
const actions = new Set(['list', 'create', 'read', 'reserve', 'finalize', 'media', 'comment', 'resolve', 'remove_comment', 'link', 'revoke', 'delete']);
function makeHandler({
  env = process.env,
  client,
  random = () => crypto.randomBytes(24).toString('hex')
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (s, v) => res.status(s).json(v);
    if (req.method === 'GET' && env.CRON_SECRET && req.headers.authorization === 'Bearer ' + env.CRON_SECRET) {
      try {
        const db = client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
          auth: {
            persistSession: false
          }
        });
        const {
          data: rows,
          error
        } = await db.from('artlink_review_cleanup').select('path').lte('after_at', new Date().toISOString()).limit(100);
        if (error) throw error;
        const paths = (rows || []).map(r => r.path);
        if (paths.length) {
          const removed = await db.storage.from(BUCKET).remove(paths);
          if (removed.error) throw removed.error;
          const clear = await db.from('artlink_review_cleanup').delete().in('path', paths);
          if (clear.error) throw clear.error;
        }
        return send(200, {
          removed: paths.length
        });
      } catch {
        return send(503, {
          error: 'UNAVAILABLE'
        });
      }
    }
    if (req.method === 'GET') {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return send(503, {
        error: 'UNAVAILABLE'
      });
      return send(200, {
        url: env.SUPABASE_URL,
        anonKey: env.SUPABASE_ANON_KEY
      });
    }
    if (req.method !== 'POST') return send(405, {
      error: 'METHOD_NOT_ALLOWED'
    });
    if (!client && (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY)) return send(503, {
      error: 'UNAVAILABLE'
    });
    const origin = req.headers.origin;
    if (origin && !['https://art-link.kr', 'https://www.art-link.kr', `https://${env.VERCEL_URL}`, ...(env.NODE_ENV === 'test' ? ['http://localhost'] : [])].includes(origin)) return send(403, {
      error: 'ORIGIN_DENIED'
    });
    let b;
    try {
      b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (!b || Buffer.byteLength(JSON.stringify(b)) > 90000) throw Error();
    } catch {
      return send(400, {
        error: 'INVALID_INPUT'
      });
    }
    if (!actions.has(b.action) || !['list', 'create'].includes(b.action) && !contract.uuid(b.roomId)) return send(400, {
      error: 'INVALID_INPUT'
    });
    const db = client || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    });
    let user = null;
    try {
      if (req.headers.authorization) {
        const match = req.headers.authorization.match(/^Bearer (\S+)$/);
        if (!match) return send(401, {
          error: 'LOGIN_REQUIRED'
        });
        const r = await db.auth.getUser(match[1]);
        if (r.error || !r.data?.user || r.data.user.is_anonymous) return send(401, {
          error: 'LOGIN_REQUIRED'
        });
        user = r.data.user;
      }
      if (!user && !['read', 'media'].includes(b.action)) return send(401, {
        error: 'LOGIN_REQUIRED'
      });
      const linkHash = contract.token(b.key) ? hash(b.key) : null;
      const rpc = async (action, payload = {}) => {
        const {
          data,
          error
        } = await db.rpc('artlink_review_action', {
          p_user: user?.id || null,
          p_action: action,
          p_room: b.roomId || null,
          p_payload: {
            ...payload,
            linkHash
          }
        });
        if (error) throw Error(error.message);
        return data;
      };
      const storage = db.storage.from(BUCKET);
      let data;
      switch (b.action) {
        case 'list':
          data = await rpc('list', {
            assignmentId: b.assignmentId
          });
          break;
        case 'create':
          data = await rpc('create', {
            clientId: b.clientId,
            title: b.title,
            field: b.field,
            assignmentId: b.assignmentId,
            consent: b.consent
          });
          break;
        case 'read':
          data = await rpc('read');
          break;
        case 'reserve':
          {
            const m = b.kind === 'text' ? {
              kind: 'text',
              body: b.body,
              bytes: 0
            } : contract.media(b.mime, b.bytes);
            const v = await rpc('reserve', {
              ...m,
              ...contract.reviewBrief(b.reviewRequest, b.changeNote),
              clientId: b.clientId
            });
            if (v.ready || v.kind === 'text') {
              const {
                object_path,
                ...safe
              } = v;
              data = safe;
              break;
            }
            const {
              data: signed,
              error
            } = await storage.createSignedUploadUrl(v.object_path, {
              upsert: false
            });
            if (error) throw Error('UPLOAD_UNAVAILABLE');
            data = {
              id: v.id,
              ready: false,
              uploadUrl: signed.signedUrl
            };
            break;
          }
        case 'finalize':
          {
            const v = await rpc('pending', {
              versionId: b.versionId
            });
            if (!v.ready) {
              const {
                data: info,
                error
              } = await storage.info(v.object_path);
              if (error) throw Error('UPLOAD_INCOMPLETE');
              if (info.size !== v.bytes || info.contentType !== v.mime) throw Error('UPLOAD_MISMATCH');
            }
            data = await rpc('finalize', {
              versionId: b.versionId
            });
            break;
          }
        case 'media':
          {
            const v = await rpc('media', {
              versionId: b.versionId
            });
            const {
              data: signed,
              error
            } = await storage.createSignedUrl(v.path, 60);
            if (error) throw Error('MEDIA_UNAVAILABLE');
            data = {
              url: signed.signedUrl,
              expiresIn: 60
            };
            break;
          }
        case 'comment':
          {
            const room = await rpc('read');
            const version = room.versions.find(v => v.id === b.versionId);
            if (!version) throw Error('NOT_FOUND');
            data = await rpc('comment', {
              versionId: version.id,
              clientId: b.clientId,
              authorName: b.authorName,
              body: b.body,
              anchor: contract.anchor(b.anchor, version.kind, version.body)
            });
            break;
          }
        case 'resolve':
          if (typeof b.resolved !== 'boolean') throw Error('INVALID_INPUT');
          data = await rpc('resolve', {
            commentId: b.commentId,
            resolved: b.resolved
          });
          break;
        case 'remove_comment':
          data = await rpc('remove_comment', {
            commentId: b.commentId
          });
          break;
        case 'link':
          {
            if (b.consent !== true) throw Error('CONSENT_REQUIRED');
            const key = random();
            await rpc('link', {
              newHash: hash(key)
            });
            data = {
              key
            };
            break;
          }
        case 'revoke':
          data = await rpc('link', {
            newHash: null
          });
          break;
        case 'delete':
          {
            await rpc('begin_delete');
            const paths = await rpc('paths');
            if (paths.length) {
              const {
                error
              } = await storage.remove(paths);
              if (error) throw Error('DELETE_INCOMPLETE');
            }
            data = await rpc('delete');
            break;
          }
      }
      return send(200, data);
    } catch (e) {
      const message = e.message || '';
      const errors = ['INVALID_INPUT', 'INVALID_BRIEF', 'INVALID_MEDIA', 'INVALID_ANCHOR', 'LOGIN_REQUIRED', 'ACCESS_DENIED', 'OWNER_REQUIRED', 'NOT_FOUND', 'PRIVATE_ASSIGNMENT', 'ASSIGNMENT_CLOSED_OR_FIELD', 'ROOM_LIMIT', 'VERSION_LIMIT', 'COMMENT_LIMIT', 'STORAGE_LIMIT', 'RATE_LIMIT', 'CONSENT_REQUIRED', 'UPLOAD_INCOMPLETE', 'UPLOAD_MISMATCH', 'UPLOAD_UNAVAILABLE', 'MEDIA_UNAVAILABLE', 'DELETE_INCOMPLETE'];
      const code = errors.find(c => message === c) || 'UNAVAILABLE';
      return send(code === 'LOGIN_REQUIRED' ? 401 : ['ACCESS_DENIED', 'OWNER_REQUIRED', 'PRIVATE_ASSIGNMENT'].includes(code) ? 403 : code === 'NOT_FOUND' ? 404 : code.endsWith('LIMIT') ? 429 : ['UNAVAILABLE', 'UPLOAD_UNAVAILABLE', 'MEDIA_UNAVAILABLE', 'DELETE_INCOMPLETE'].includes(code) ? 503 : 400, {
        error: code
      });
    }
  };
}
module.exports = makeHandler();
module.exports.makeHandler = makeHandler;
