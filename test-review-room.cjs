const {
    test
  } = require('node:test'),
  assert = require('node:assert/strict');
const {
  makeHandler
} = require('./api/review-room');
const C = require('./public/review/contract');
const id = '00000000-0000-4000-8000-000000000001',
  version = '00000000-0000-4000-8000-000000000002',
  key = 'a'.repeat(48);
function fixture(overrides = {}) {
  const calls = [];
  const client = {
    auth: {
      getUser: async token => token === 'valid' ? {
        data: {
          user: {
            id,
            is_anonymous: false
          }
        }
      } : {
        error: Error('bad')
      }
    },
    rpc: async (name, p) => {
      calls.push(p);
      if (p.p_action === 'read') return {
        data: {
          versions: [{
            id: version,
            kind: 'text',
            body: 'one\n\ntwo'
          }]
        }
      };
      return {
        data: {
          ok: true
        }
      };
    },
    storage: {
      from: () => ({})
    },
    ...overrides
  };
  return {
    calls,
    handler: makeHandler({
      client,
      env: {
        NODE_ENV: 'test'
      }
    })
  };
}
async function send(f, body, auth = 'valid', origin) {
  let status, bodyOut;
  await f.handler({
    method: 'POST',
    headers: {
      ...(auth ? {
        authorization: 'Bearer ' + auth
      } : {}),
      ...(origin ? {
        origin
      } : {})
    },
    body
  }, {
    setHeader() {},
    status(s) {
      status = s;
      return this;
    },
    json(b) {
      bodyOut = b;
      return this;
    }
  });
  return {
    status,
    body: bodyOut
  };
}
test('six fields and only bounded supported media', () => {
  assert.equal(C.fields.length, 6);
  assert.equal(C.media('audio/mpeg', 1024).kind, 'audio');
  for (const mime of ['text/html', 'image/svg+xml', 'application/pdf']) assert.throws(() => C.media(mime, 1));
  assert.throws(() => C.media('video/mp4', C.maxBytes + 1));
  assert.throws(() => C.media('image/png', 0));
});
test('anchors reject wrong media, out-of-range points and paragraph indices', () => {
  assert.deepEqual(C.anchor({
    kind: 'time',
    start: 1,
    end: 2
  }, 'audio'), {
    kind: 'time',
    start: 1,
    end: 2
  });
  for (const a of [{
    kind: 'point',
    x: 2,
    y: 0
  }, {
    kind: 'point',
    x: NaN,
    y: 0
  }]) assert.throws(() => C.anchor(a, 'image'));
  assert.throws(() => C.anchor({
    kind: 'time',
    start: 2,
    end: 1
  }, 'video'));
  assert.throws(() => C.anchor({
    kind: 'time',
    start: 0,
    end: 1
  }, 'text'));
  assert.throws(() => C.anchor({
    kind: 'paragraph',
    index: 2
  }, 'text', 'one\n\ntwo'));
});
test('invitation secrets stay in the fragment', () => {
  const url = new URL(C.invitation('https://art-link.kr', id, key, 'en'));
  assert(!url.search.includes(key));
  assert(url.hash.includes(key));
  assert.throws(() => C.invitation('x', id, 'bad'));
});
test('anonymous mutations rejected before database', async () => {
  for (const action of ['create', 'reserve', 'comment', 'link', 'delete']) {
    const f = fixture(),
      r = await send(f, {
        action,
        roomId: id
      }, null);
    assert.equal(r.status, 401);
    assert.equal(f.calls.length, 0);
  }
});
test('invalid bearer never falls back to link access', async () => {
  const f = fixture();
  assert.equal((await send(f, {
    action: 'read',
    roomId: id,
    key
  }, 'expired')).status, 401);
  assert.equal(f.calls.length, 0);
});
test('anonymous read passes only the hash of a valid key', async () => {
  const f = fixture();
  const r = await send(f, {
    action: 'read',
    roomId: id,
    key,
    p_user: id,
    userId: id
  }, null);
  assert.equal(r.status, 200);
  assert.equal(f.calls[0].p_user, null);
  assert.equal(f.calls[0].p_payload.linkHash.length, 64);
  assert(!JSON.stringify(f.calls).includes(key));
});
test('identity comes from validated JWT, not body', async () => {
  const f = fixture();
  await send(f, {
    action: 'create',
    userId: 'forged',
    p_user: 'forged',
    owner_id: 'forged',
    title: 'Work',
    field: 'music',
    consent: true,
    clientId: id
  });
  assert.equal(f.calls[0].p_user, id);
  assert(!JSON.stringify(f.calls).includes('forged'));
});
test('cross-origin calls blocked', async () => {
  const f = fixture();
  assert.equal((await send(f, {
    action: 'read',
    roomId: id,
    key
  }, null, 'https://evil.example')).status, 403);
  assert.equal(f.calls.length, 0);
});
test('arbitrary RPC actions cannot be called', async () => {
  for (const action of ['pending', 'paths', 'begin_delete', 'sql']) assert.equal((await send(fixture(), {
    action,
    roomId: id
  })).status, 400);
});
test('oversized requests rejected', async () => {
  assert.equal((await send(fixture(), {
    action: 'create',
    title: 'x'.repeat(90001)
  })).status, 400);
});
test('comment anchor checked against the stored version', async () => {
  const f = fixture();
  const r = await send(f, {
    action: 'comment',
    roomId: id,
    versionId: version,
    anchor: {
      kind: 'time',
      start: 1,
      end: 2
    }
  });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'INVALID_ANCHOR');
  assert.equal(f.calls.length, 1);
});
test('unknown version cannot receive comments', async () => {
  const f = fixture();
  assert.equal((await send(f, {
    action: 'comment',
    roomId: id,
    versionId: id
  })).status, 404);
});
test('share link requires explicit consent', async () => {
  const f = fixture();
  assert.equal((await send(f, {
    action: 'link',
    roomId: id
  })).status, 400);
  assert.equal(f.calls.length, 0);
});
test('group invitation denial propagates and returns no token', async () => {
  const f = fixture({
    rpc: async () => ({
      error: {
        message: 'PRIVATE_ASSIGNMENT'
      }
    })
  });
  const r = await send(f, {
    action: 'link',
    roomId: id,
    consent: true
  });
  assert.equal(r.status, 403);
  assert(!r.body.key);
});
test('deletion stops writes before removing objects and rows', async () => {
  const sequence = [];
  const f = fixture({
    rpc: async (_n, p) => {
      sequence.push(p.p_action);
      return {
        data: p.p_action === 'paths' ? ['a/b/c'] : {}
      };
    },
    storage: {
      from: () => ({
        remove: async paths => {
          sequence.push('storage');
          assert.deepEqual(paths, ['a/b/c']);
          return {};
        }
      })
    }
  });
  assert.equal((await send(f, {
    action: 'delete',
    roomId: id
  })).status, 200);
  assert.deepEqual(sequence, ['begin_delete', 'paths', 'storage', 'delete']);
});
test('storage failure keeps deleting room for safe retry', async () => {
  const sequence = [];
  const f = fixture({
    rpc: async (_n, p) => {
      sequence.push(p.p_action);
      return {
        data: p.p_action === 'paths' ? ['a/b/c'] : {}
      };
    },
    storage: {
      from: () => ({
        remove: async () => ({
          error: Error('offline')
        })
      })
    }
  });
  assert.equal((await send(f, {
    action: 'delete',
    roomId: id
  })).status, 503);
  assert(!sequence.includes('delete'));
});
test('finalize refuses wrong actual size or MIME', async () => {
  for (const info of [{
    size: 2,
    contentType: 'image/png'
  }, {
    size: 1,
    contentType: 'text/html'
  }]) {
    const f = fixture({
      rpc: async (_n, p) => ({
        data: {
          id: version,
          room_id: id,
          object_path: 'x',
          ready: false,
          bytes: 1,
          mime: 'image/png'
        }
      }),
      storage: {
        from: () => ({
          info: async () => ({
            data: info
          })
        })
      }
    });
    const r = await send(f, {
      action: 'finalize',
      roomId: id,
      versionId: version
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'UPLOAD_MISMATCH');
  }
});
test('private media links expire in 60 seconds', async () => {
  const f = fixture({
    rpc: async () => ({
      data: {
        path: 'private/path'
      }
    }),
    storage: {
      from: () => ({
        createSignedUrl: async (path, ttl) => {
          assert.equal(path, 'private/path');
          assert.equal(ttl, 60);
          return {
            data: {
              signedUrl: 'https://test/media'
            }
          };
        }
      })
    }
  });
  assert.equal((await send(f, {
    action: 'media',
    roomId: id,
    versionId: version
  }, null)).body.expiresIn, 60);
});
test('internal database errors never leak to callers', async () => {
  const r = await send(fixture({
    rpc: async () => ({
      error: {
        message: 'service_secret_failure'
      }
    })
  }), {
    action: 'read',
    roomId: id
  });
  assert.deepEqual(r, {
    status: 503,
    body: {
      error: 'UNAVAILABLE'
    }
  });
});
test('every art field has original KO/EN prompts within the question limit', () => {
  assert.deepEqual(Object.keys(C.reviewPrompts), C.fields);
  for (const field of C.fields) {
    assert.equal(C.reviewPrompts[field].length, 3);
    for (const p of C.reviewPrompts[field]) {
      assert.equal(p.label.length, 2);
      assert.equal(p.question.length, 2);
      for (const q of p.question) assert(q.length > 0 && q.length <= 400);
    }
  }
});
test('version brief defaults work for old clients; input must be bounded strings', () => {
  assert.deepEqual(C.reviewBrief(), {
    reviewRequest: '',
    changeNote: ''
  });
  assert.deepEqual(C.reviewBrief(' question ', ' note '), {
    reviewRequest: 'question',
    changeNote: 'note'
  });
  for (const args of [[42, ''], [{
    text: 'x'
  }, ''], ['x'.repeat(401), ''], ['', 'x'.repeat(601)]]) assert.throws(() => C.reviewBrief(...args), /INVALID_BRIEF/);
});
test('reserve persists the question and context only through the owner-authorized RPC', async () => {
  const f = fixture({
    rpc: async (_name, p) => {
      f.calls.push(p);
      return {
        data: {
          id: version,
          ready: true,
          review_request: p.p_payload.reviewRequest,
          change_note: p.p_payload.changeNote
        }
      };
    }
  });
  const r = await send(f, {
    action: 'reserve',
    roomId: id,
    clientId: version,
    kind: 'text',
    body: 'Work',
    reviewRequest: ' Question ',
    changeNote: ' Revision ',
    owner_id: 'forged'
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.review_request, 'Question');
  assert.equal(r.body.change_note, 'Revision');
  assert.equal(f.calls[0].p_user, id);
  assert(!JSON.stringify(f.calls).includes('forged'));
});
test('invalid brief is rejected before reserving storage or calling the database', async () => {
  for (const brief of [{
    reviewRequest: 'x'.repeat(401)
  }, {
    changeNote: 'x'.repeat(601)
  }, {
    reviewRequest: []
  }]) {
    const f = fixture();
    const r = await send(f, {
      action: 'reserve',
      roomId: id,
      clientId: version,
      mime: 'image/png',
      bytes: 1024,
      ...brief
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'INVALID_BRIEF');
    assert.equal(f.calls.length, 0);
  }
});
