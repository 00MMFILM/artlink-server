const {
    test
  } = require('node:test'),
  assert = require('node:assert/strict'),
  fs = require('node:fs');
const {
  JSDOM
} = require('../app/node_modules/jsdom');
const C = require('./public/review/contract');
const id = '00000000-0000-4000-8000-000000000001',
  vid = '00000000-0000-4000-8000-000000000002';
const html = fs.readFileSync('public/review/index.html', 'utf8'),
  code = fs.readFileSync('public/review/room.js', 'utf8');
const tick = () => new Promise(r => setTimeout(r, 10));
async function fixture({
  logged = false,
  lang = 'ko',
  fail = false,
  field = 'literature',
  handle
} = {}) {
  const dom = new JSDOM(html, {
      url: `https://art-link.kr/review/?lang=${lang}#room=${id}&key=${'a'.repeat(48)}`,
      runScripts: 'outside-only'
    }),
    w = dom.window,
    requests = [];
  const room = {
    room: {
      id,
      title: 'A <script>title</script>',
      field,
      assignment_id: null
    },
    owner: logged,
    versions: [{
      id: vid,
      kind: 'text',
      body: 'First paragraph\n\nSecond paragraph'
    }],
    comments: []
  };
  let session = logged ? {
      user: {
        id
      },
      access_token: 'fixture'
    } : null,
    onAuth;
  const auth = {
    getSession: async () => ({
      data: {
        session
      }
    }),
    onAuthStateChange: fn => {
      onAuth = fn;
    },
    signInWithPassword: async () => {
      session = {
        user: {
          id
        },
        access_token: 'fixture'
      };
      onAuth('SIGNED_IN', session);
      return {
        data: {
          session
        }
      };
    },
    signOut: async () => {
      session = null;
      onAuth('SIGNED_OUT', null);
    },
    signUp: async () => ({
      data: {
        session: null
      }
    })
  };
  w.crypto.randomUUID = require('node:crypto').randomUUID;
  w.ArtlinkReview = C;
  w.supabase = {
    createClient: () => ({
      auth,
      supabaseUrl: 'https://example.supabase.co'
    })
  };
  w.AbortController = AbortController;
  w.AbortSignal = AbortSignal;
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.URL.revokeObjectURL = () => {};
  w.fetch = async (url, options) => {
    if (!options) {
      return {
        ok: !fail,
        json: async () => ({
          url: 'https://example.supabase.co',
          anonKey: 'public'
        })
      };
    }
    if (options.method === 'PUT') return {
      ok: true,
      status: 200
    };
    const b = JSON.parse(options.body);
    requests.push(b);
    const override = await handle?.(b, room);
    if (override) return override;
    if (b.action === 'read') return {
      ok: true,
      json: async () => ({
        ...room,
        owner: !!session
      })
    };
    if (b.action === 'list') return {
      ok: true,
      json: async () => []
    };
    if (b.action === 'comment') {
      room.comments.push({
        id: 'comment',
        author_name: b.authorName,
        body: b.body,
        version_id: b.versionId,
        anchor: b.anchor
      });
      return {
        ok: true,
        json: async () => ({})
      };
    }
    if (b.action === 'link') return {
      ok: true,
      json: async () => ({
        key: 'b'.repeat(48)
      })
    };
    if (b.action === 'revoke') return {
      ok: true,
      json: async () => ({})
    };
    return {
      ok: false,
      json: async () => ({
        error: 'UNAVAILABLE'
      })
    };
  };
  w.eval(code);
  await tick();
  await tick();
  return {
    dom,
    w,
    requests,
    room,
    $: s => w.document.getElementById(s),
    close: () => w.close()
  };
}
test('invite visitor sees work without an account; cannot write a comment', async () => {
  const f = await fixture();
  assert.equal(f.$('room').hidden, false);
  assert.equal(f.$('comment-form').hidden, true);
  assert.equal(f.$('auth').hidden, false);
  assert.equal(f.$('media').children.length, 2);
  f.close();
});
test('work titles render as text, never executable markup', async () => {
  const f = await fixture();
  assert.equal(f.$('room-title').querySelector('script'), null);
  assert.equal(f.$('room-title').textContent, 'A <script>title</script>');
  f.close();
});
test('paragraph selection becomes a version-specific comment anchor', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('media').children[1].click();
  await tick();
  f.$('name').value = 'Writer';
  f.$('comment').value = 'Please keep this line.';
  f.$('comment-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  await tick();
  const request = f.requests.find(r => r.action === 'comment');
  assert.equal(request.versionId, vid);
  assert.deepEqual(request.anchor, {
    kind: 'paragraph',
    index: 1
  });
  assert.equal(f.$('comment').value, '');
  assert(f.$('comments').textContent.includes('Please keep this line.'));
  f.close();
});
test('signing out clears the private draft and owner controls', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('comment').value = 'Private unsent text';
  f.$('logout').click();
  await tick();
  await tick();
  assert.equal(f.$('comment').value, '');
  assert.equal(f.$('owner-actions').hidden, true);
  assert.equal(f.$('comment-form').hidden, true);
  f.close();
});
test('English visitor receives English instructions and same field', async () => {
  const f = await fixture({
    lang: 'en'
  });
  assert.equal(f.w.document.documentElement.lang, 'en');
  assert.equal(f.$('room-field').textContent, 'Literature');
  assert.equal(f.$('send-comment').textContent, 'Post comment');
  f.close();
});
test('invitation requires confirmation and keeps secret in fragment', async () => {
  const f = await fixture({
    logged: true
  });
  f.w.confirm = () => false;
  f.$('invite').click();
  await tick();
  assert(!f.requests.some(r => r.action === 'link'));
  f.w.confirm = () => true;
  f.$('invite').click();
  await tick();
  assert(f.$('invite-url').value.includes('#room='));
  assert(f.$('invite-url').value.includes('b'.repeat(48)));
  assert.equal(f.$('invitation').hidden, false);
  f.close();
});
test('ending invitation clears displayed link', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('invite').click();
  await tick();
  f.$('revoke').click();
  await tick();
  assert.equal(f.$('invitation').hidden, true);
  assert(!f.w.location.hash.includes('key='));
  f.close();
});
test('unavailable configuration has a visible error and disables login', async () => {
  const f = await fixture({
    fail: true
  });
  assert(f.$('status').textContent.includes('연결하지 못'));
  assert.equal(f.$('login').disabled, true);
  f.close();
});
test('refresh keeps the location of an unsent paragraph comment', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('media').children[1].click();
  await tick();
  f.$('name').value = 'Writer';
  f.$('comment').value = 'On the second paragraph';
  f.$('refresh').click();
  await tick();
  f.$('comment-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  assert.deepEqual(f.requests.find(r => r.action === 'comment').anchor, {
    kind: 'paragraph',
    index: 1
  });
  f.close();
});
test('selecting the current version does not erase the unsent comment', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('comment').value = 'Still writing';
  f.$('versions').firstChild.click();
  await tick();
  assert.equal(f.$('comment').value, 'Still writing');
  f.close();
});
test('saved revision is selected and opens with a fresh comment location', async () => {
  const next = '00000000-0000-4000-8000-000000000003';
  const f = await fixture({
    logged: true,
    handle: (b, room) => {
      if (b.action === 'reserve') {
        room.versions.push({
          id: next,
          kind: 'text',
          body: b.body
        });
        return {
          ok: true,
          json: async () => ({
            id: next,
            ready: true
          })
        };
      }
    }
  });
  f.$('media').children[1].click();
  await tick();
  f.$('writing').value = 'New revision';
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  await tick();
  assert(f.$('media').textContent.includes('New revision'));
  assert.equal(f.$('versions').lastChild.getAttribute('aria-pressed'), 'true');
  assert.equal(f.$('anchor-label').textContent, '작품 전체');
  f.close();
});
test('pending save locks editable inputs and a failed save preserves the draft', async () => {
  let release;
  const waiting = new Promise(resolve => {
    release = resolve;
  });
  const f = await fixture({
    logged: true,
    handle: b => b.action === 'reserve' ? waiting : null
  });
  f.$('writing').value = 'Do not lose this';
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  assert.equal(f.$('writing').disabled, true);
  assert.equal(f.$('file').disabled, true);
  release({
    ok: false,
    json: async () => ({
      error: 'UNAVAILABLE'
    })
  });
  await tick();
  assert.equal(f.$('writing').disabled, false);
  assert.equal(f.$('writing').value, 'Do not lose this');
  f.close();
});
test('a deletion interrupted by storage failure can be retried from My work', async () => {
  const f = await fixture({
    logged: true,
    handle: b => {
      if (b.action === 'list') return {
        ok: true,
        json: async () => [{
          id,
          title: 'Deleting work',
          field: 'literature',
          owner: true,
          deleting: true
        }]
      };
      if (b.action === 'delete') return {
        ok: true,
        json: async () => ({
          removed: true
        })
      };
    }
  });
  f.$('new-work').click();
  await tick();
  f.$('writing').value = 'A different draft';
  const retry = [...f.$('room-list').querySelectorAll('button')].find(b => b.textContent === '삭제 다시 시도');
  assert(retry);
  f.w.confirm = () => false;
  retry.click();
  await tick();
  assert(!f.requests.some(r => r.action === 'delete'));
  f.w.confirm = () => true;
  retry.click();
  await tick();
  assert.equal(f.requests.find(r => r.action === 'delete').roomId, id);
  assert.equal(f.$('writing').value, 'A different draft');
  f.close();
});
test('a finalize server outage is not mislabeled as a bad file and preserves the selected upload', async () => {
  const f = await fixture({
    logged: true,
    handle: b => {
      if (b.action === 'reserve') return {
        ok: true,
        json: async () => ({
          id: vid,
          ready: false,
          uploadUrl: 'https://example.supabase.co/storage/v1/object/upload/sign/review-media/a'
        })
      };
      if (b.action === 'finalize') return {
        ok: false,
        json: async () => ({
          error: 'UNAVAILABLE'
        })
      };
    }
  });
  const file = new f.w.File(['content'], 'work.png', {
    type: 'image/png'
  });
  Object.defineProperty(f.$('file'), 'files', {
    value: [file]
  });
  f.$('file').dispatchEvent(new f.w.Event('change'));
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  await tick();
  assert(f.$('status').textContent.includes('연결하지 못'));
  assert.equal(f.$('file').files[0], file);
  assert.equal(f.$('writing').disabled, true);
  f.close();
});
for (const field of C.fields) test(`${field} web room offers editable field-specific questions`, async () => {
  const f = await fixture({
    logged: true,
    field
  });
  assert.equal(f.$('review-prompts').children.length, 3);
  assert.equal(f.$('review-prompts').firstChild.textContent, C.reviewPrompts[field][0].label[0]);
  f.$('consent').checked = true;
  f.$('review-prompts').firstChild.click();
  await tick();
  assert.equal(f.$('review-request').value, C.reviewPrompts[field][0].question[0]);
  assert.equal(f.$('consent').checked, false);
  f.$('review-request').value = 'My own question';
  f.w.confirm = () => false;
  f.$('review-prompts').lastChild.click();
  await tick();
  assert.equal(f.$('review-request').value, 'My own question');
  f.close();
});
test('English questions and revision labels are localized', async () => {
  const f = await fixture({
    logged: true,
    lang: 'en',
    field: 'dance'
  });
  f.$('review-prompts').firstChild.click();
  await tick();
  assert.equal(f.$('review-request').value, C.reviewPrompts.dance[0].question[1]);
  assert(f.$('change-note-label').textContent.startsWith('What changed'));
  assert.equal(f.$('filter-open').textContent, 'Open 0');
  f.close();
});
test('a saved version shows its question and revision note safely, without overwriting older context', async () => {
  const next = '00000000-0000-4000-8000-000000000003';
  const f = await fixture({
    logged: true,
    handle: (b, room) => {
      if (b.action === 'reserve') {
        room.versions.push({
          id: next,
          kind: 'text',
          body: b.body,
          review_request: b.reviewRequest,
          change_note: b.changeNote
        });
        return {
          ok: true,
          json: async () => ({
            id: next,
            ready: true
          })
        };
      }
    }
  });
  f.$('writing').value = 'A revised scene';
  f.$('review-request').value = ' Is the ending <script>clear</script>? ';
  f.$('change-note').value = ' Shortened the last beat. ';
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  await tick();
  const req = f.requests.find(r => r.action === 'reserve');
  assert.equal(req.changeNote, 'Shortened the last beat.');
  assert.equal(f.$('saved-request').textContent, 'Is the ending <script>clear</script>?');
  assert.equal(f.$('saved-request').querySelector('script'), null);
  assert.equal(f.$('saved-note-label').textContent, '이번에 바꾼 점');
  assert.equal(f.$('review-request').value, '');
  f.$('versions').firstChild.click();
  await tick();
  assert.equal(f.$('version-brief').hidden, true);
  f.$('versions').lastChild.click();
  await tick();
  assert.equal(f.$('saved-note').textContent, 'Shortened the last beat.');
  f.close();
});
test('brief-only drafts survive cancelled navigation and failed save, then clear at logout', async () => {
  const f = await fixture({
    logged: true
  });
  f.$('review-request').value = 'Private question';
  f.$('change-note').value = 'Private intention';
  f.w.confirm = () => false;
  f.$('new-work').click();
  await tick();
  assert(f.w.location.hash.includes(id));
  assert.equal(f.$('review-request').value, 'Private question');
  f.$('writing').value = 'Work';
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  assert.equal(f.$('review-request').value, 'Private question');
  assert.equal(f.$('change-note').value, 'Private intention');
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  const retries = f.requests.filter(r => r.action === 'reserve');
  assert.equal(retries[0].clientId, retries[1].clientId);
  f.$('change-note').value = 'Revised intention';
  f.$('change-note').dispatchEvent(new f.w.Event('input'));
  assert.equal(f.$('consent').checked, false);
  f.$('consent').checked = true;
  f.$('work-form').dispatchEvent(new f.w.Event('submit', {
    cancelable: true
  }));
  await tick();
  assert.notEqual(f.requests.filter(r => r.action === 'reserve')[2].clientId, retries[0].clientId);
  f.w.confirm = () => true;
  f.$('logout').click();
  await tick();
  await tick();
  assert.equal(f.$('review-request').value, '');
  assert.equal(f.$('change-note').value, '');
  f.close();
});
test('filters show only the chosen version and keep older open counts visible', async () => {
  const next = '00000000-0000-4000-8000-000000000003';
  const f = await fixture({
    logged: true,
    handle: (b, room) => {
      if (b.action === 'resolve') {
        room.comments.find(c => c.id === b.commentId).resolved = b.resolved;
        return {
          ok: true,
          json: async () => ({
            updated: true
          })
        };
      }
    }
  });
  f.room.versions.push({
    id: next,
    kind: 'text',
    body: 'Later version'
  });
  f.room.comments.push({
    id: 'c1',
    version_id: vid,
    body: 'Old open',
    author_name: 'A',
    resolved: false,
    anchor: {
      kind: 'general'
    }
  }, {
    id: 'c2',
    version_id: next,
    body: 'Current open',
    author_name: 'B',
    resolved: false,
    anchor: {
      kind: 'general'
    }
  }, {
    id: 'c3',
    version_id: next,
    body: 'Current resolved',
    author_name: 'C',
    resolved: true,
    anchor: {
      kind: 'general'
    }
  });
  f.$('refresh').click();
  await tick();
  f.$('versions').lastChild.click();
  await tick();
  f.$('filter-open').click();
  assert(f.$('comments').textContent.includes('Current open'));
  assert(!f.$('comments').textContent.includes('Current resolved'));
  assert(!f.$('comments').textContent.includes('Old open'));
  assert(f.$('versions').firstChild.textContent.includes('미반영 1'));
  [...f.$('comments').querySelectorAll('button')].find(b => b.textContent === '반영 완료').click();
  await tick();
  await tick();
  assert.equal(f.$('filter-open').textContent, '미반영 0');
  assert(f.$('comments').textContent.includes('미반영 의견이 없어요'));
  assert(f.$('room-progress').textContent.endsWith('1'));
  f.$('filter-resolved').click();
  assert(f.$('comments').textContent.includes('Current resolved'));
  f.close();
});
