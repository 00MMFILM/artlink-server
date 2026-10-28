// Local synthetic UI fixture only. It never talks to production or an AI API.
const http = require('node:http'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto');
const root = path.resolve(__dirname, '../public'),
  port = 18871,
  origin = `http://127.0.0.1:${port}`,
  uid = '00000000-0000-4000-8000-000000000001',
  rid = '00000000-0000-4000-8000-000000000002',
  vid = '00000000-0000-4000-8000-000000000003';
const user = {
  id: uid,
  email: 'review-fixture@example.invalid',
  aud: 'authenticated',
  role: 'authenticated',
  is_anonymous: false
};
const jwt = [{
  alg: 'HS256',
  typ: 'JWT'
}, {
  sub: uid,
  exp: Math.floor(Date.now() / 1000) + 3600,
  role: 'authenticated'
}, 'fixture'].map(x => Buffer.from(typeof x === 'string' ? x : JSON.stringify(x)).toString('base64url')).join('.');
const room = {
  room: {
    id: rid,
    title: '돌아오는 길 — 첫 장면',
    field: 'literature',
    assignment_id: null
  },
  owner: false,
  versions: [{
    id: vid,
    kind: 'text',
    review_request: '화자가 집에 돌아가기를 망설이는 이유가 궁금해지나요? 정보가 부족한 부분을 짚어주세요.',
    change_note: '짧은 소설의 도입부입니다. 대사 없이 사물과 행동으로 망설임을 전하려고 했어요.',
    body: '막차가 떠난 뒤에도 나는 정류장에 남아 있었다.\n\n주머니 속 열쇠를 꺼냈다. 돌아갈 집은 있는데, 돌아가고 싶은지는 아직 몰랐다.',
    created_at: new Date().toISOString()
  }],
  comments: [{
    id: crypto.randomUUID(),
    version_id: vid,
    author_name: '검토 예시',
    body: '두 번째 문단의 망설임이 잘 보여요. 열쇠를 쥔 손의 행동을 한 번 더 보여주면 어떨까요?',
    anchor: {
      kind: 'paragraph',
      index: 1
    },
    resolved: false,
    can_delete: false
  }]
};
const send = (res, status, data) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin
  });
  res.end(JSON.stringify(data));
};
http.createServer(async (req, res) => {
  const url = new URL(req.url, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    return res.end();
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {}
  if (url.pathname === '/api/review-room') {
    if (req.method === 'GET') return send(res, 200, {
      url: origin,
      anonKey: 'local-ui-fixture'
    });
    if (body.action === 'read') return send(res, 200, {
      ...room,
      owner: !!req.headers.authorization
    });
    if (body.action === 'list') return send(res, 200, [room.room]);
    if (body.action === 'comment') {
      room.comments.push({
        id: crypto.randomUUID(),
        version_id: vid,
        author_name: body.authorName,
        body: body.body,
        anchor: body.anchor,
        can_delete: true,
        resolved: false
      });
      return send(res, 200, {});
    }
    if (body.action === 'resolve') {
      const c = room.comments.find(c => c.id === body.commentId);
      if (c) c.resolved = body.resolved;
      return send(res, 200, {});
    }
    if (body.action === 'link') return send(res, 200, {
      key: 'a'.repeat(48)
    });
    if (body.action === 'revoke') return send(res, 200, {});
    return send(res, 503, {
      error: 'UNAVAILABLE'
    });
  }
  if (url.pathname === '/auth/v1/token') return send(res, 200, {
    access_token: jwt,
    refresh_token: 'local-fixture-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user
  });
  if (url.pathname === '/auth/v1/user') return send(res, 200, user);
  if (url.pathname === '/auth/v1/logout') return send(res, 200, {});
  let file = path.resolve(root, '.' + url.pathname);
  if (!file.startsWith(root + path.sep)) return send(res, 403, {});
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) return send(res, 404, {});
  res.setHeader('Content-Type', {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8'
  }[path.extname(file)] || 'text/plain');
  let source = fs.readFileSync(file);
  if (file.endsWith('/review/index.html')) source = Buffer.from(source.toString().replace('<main id="workspace">', '<main id="workspace"><p style="background:#fff1bc;padding:12px">로컬 화면 검증 · 예시 작품 · 운영 데이터 아님</p>'));
  res.end(source);
}).listen(port, '127.0.0.1', () => console.log(`${origin}/review/#room=${rid}&key=${'a'.repeat(48)}`));
