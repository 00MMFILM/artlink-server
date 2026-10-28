/* Work is sent only after the visible form is confirmed. No artwork analytics. */
(async () => {
  'use strict';

  const $ = id => document.getElementById(id),
    C = window.ArtlinkReview;
  const query = new URLSearchParams(location.search),
    fragment = new URLSearchParams(location.hash.slice(1));
  let en = query.get('lang') === 'en',
    roomId = C.uuid(fragment.get('room')) ? fragment.get('room') : null,
    key = C.token(fragment.get('key')) ? fragment.get('key') : null;
  let client = null,
    session = null,
    data = null,
    versionId = null,
    point = {
      kind: 'general'
    },
    busy = false,
    generation = 0,
    authUser = null,
    loadCount = 0;
  let commentFilter = 'all';
  const pending = {};
  let mediaObject = null;
  const say = (a, b) => en ? b : a;
  const status = s => {
    $('status').textContent = s;
  };
  function hasDraft() {
    return !!($('comment').value || $('writing').value || $('file').files.length || $('review-request').value || $('change-note').value);
  }
  const set = (id, ko, english) => {
    $(id).textContent = say(ko, english);
  };
  document.documentElement.lang = en ? 'en' : 'ko';
  if (en) {
    $('terms-label').replaceChildren(document.createTextNode('For account creation, I agree to the '));
    const terms = document.createElement('a');
    terms.href = '/support/#terms';
    terms.target = '_blank';
    terms.rel = 'noopener noreferrer';
    terms.textContent = 'Terms';
    const privacy = terms.cloneNode();
    privacy.href = '/privacy/';
    privacy.textContent = 'Privacy Policy';
    $('terms-label').append(terms, document.createTextNode(' and '), privacy);
  }
  set('heading', '혼자 만든 작품에, 다른 시선을.', 'A fresh perspective on your work.');
  set('description', '사진, 소리, 움직임, 문장. 의견이 필요한 곳에 코멘트를 받아보세요.', 'Images, sounds, movement, words. Invite feedback exactly where you need it.');
  const translations = {
    eyebrow: ['작품 피드백룸', 'ARTWORK REVIEW ROOM'],
    'auth-title': ['코멘트와 작품 저장은 로그인 후', 'Sign in to comment or share your work'],
    'auth-description': ['초대받은 작품은 설치 없이 확인할 수 있어요.', 'View invited work without installing an app.'],
    'password-label': ['비밀번호', 'Password'],
    login: ['로그인', 'Sign in'],
    signup: ['계정 만들기', 'Create account'],
    'auth-help': ['기존 아트링크 이메일 계정을 사용할 수 있어요.', 'Use your existing ArtLink email account.'],
    logout: ['로그아웃', 'Sign out'],
    'mine-title': ['내 작품', 'My work'],
    refresh: ['새로고침', 'Refresh'],
    'comments-title': ['작품에 남기는 의견', 'Feedback on this work'],
    'name-label': ['표시할 이름', 'Display name'],
    'comment-label': ['구체적으로 어떤 부분인가요?', 'What specifically could change?'],
    'reset-anchor': ['전체 코멘트', 'Whole work'],
    'send-comment': ['코멘트 남기기', 'Post comment'],
    invite: ['초대 링크 만들기', 'Create invitation'],
    revoke: ['초대 종료', 'End invitation'],
    delete: ['작품 삭제', 'Delete room'],
    'invite-label': ['초대 링크', 'Invitation link'],
    'copy-link': ['링크 복사', 'Copy link'],
    'open-app': ['앱에서 열기', 'Open in app'],
    'create-title': ['당신의 작품도 보여주세요.', 'Bring your work into the conversation.'],
    'field-label': ['분야', 'Art form'],
    'title-label': ['작품 제목', 'Title'],
    'file-label': ['사진·음원·영상 · 최대 25MB', 'Image, audio or video · up to 25 MB'],
    'clear-file': ['파일 선택 해제', 'Clear file'],
    'writing-label': ['또는 글 작품 붙여넣기', 'Or paste your writing'],
    privacy: ['처음에는 나만 볼 수 있어요. 초대 링크를 만들면 링크를 받은 사람에게 작품과 코멘트가 공개됩니다. AI 분석은 자동 실행되지 않아요.', 'Private until you create an invitation. Anyone with that link can view the work and comments. AI analysis does not run automatically.'],
    'consent-label': ['선택한 작품을 위 범위로 저장하는 데 동의합니다.', 'I agree to store this work with the access described above.'],
    publish: ['작품 저장', 'Save work'],
    'new-work': ['내 작품으로 새 피드백룸 만들기', 'Start a room for my own work'],
    'time-label': ['구간 (초)', 'Range (seconds)'],
    'set-time': ['이 구간 선택', 'Select range']
  };
  for (const [id, pair] of Object.entries(translations)) set(id, ...pair);
  $('language').textContent = en ? '한국어' : 'English';
  $('language').onclick = () => {
    if (hasDraft() && !confirm(say('언어를 바꾸면 작성 중인 내용이 사라져요. 이동할까요?', 'Changing language discards your draft. Continue?'))) return;
    query.set('lang', en ? 'ko' : 'en');
    location.search = query.toString();
  };
  for (const f of C.fields) {
    const o = document.createElement('option');
    o.value = f;
    o.textContent = C.labels[f][en ? 1 : 0];
    $('field').append(o);
  }
  if (C.fields.includes(query.get('field'))) $('field').value = query.get('field');
  set('review-request-label', '어떤 의견이 필요한가요? · 선택 · 400자', 'What feedback would help? · optional · 400 characters');
  set('prompt-help', '질문 예시를 고른 뒤 자유롭게 고쳐도 돼요. 작품을 보는 사람에게 함께 전달됩니다.', 'Choose and edit a prompt. Reviewers will see it alongside this version.');
  set('feedback-scope', '현재 선택한 버전의 의견입니다. 다른 버전의 미반영 수는 위에 표시돼요.', 'Feedback on the selected version. Other versions show their open counts above.');
  $('comment-filters').setAttribute('aria-label', say('의견 상태로 보기', 'Filter feedback by status'));
  function renderBriefForm() {
    const field = data?.room.field || $('field').value;
    $('review-prompts').replaceChildren();
    for (const prompt of C.reviewPrompts[field] || []) $('review-prompts').append(button(prompt.label[en ? 1 : 0], async () => {
      const question = prompt.question[en ? 1 : 0];
      if ($('review-request').value.trim() && $('review-request').value !== question && !confirm(say('작성한 질문을 이 예시로 바꿀까요?', 'Replace your question with this example?'))) return;
      $('review-request').value = question;
      $('consent').checked = false;
    }));
    const revision = !!data?.versions.length;
    $('change-note-label').textContent = revision ? say('이번에 바꾼 점 · 선택 · 600자', 'What changed · optional · 600 characters') : say('작품 설명·작업 의도 · 선택 · 600자', 'Context and intention · optional · 600 characters');
    $('review-request').placeholder = say('어떤 부분을 특히 봐주면 좋을까요?', 'What would you like the reviewer to focus on?');
    $('change-note').placeholder = revision ? say('어떤 의견을 어떻게 반영했나요?', 'Which feedback did you act on, and how?') : say('작업 의도나 미완성인 부분을 알려주세요.', 'Share your intention or what is still in progress.');
  }
  function error(e) {
    const codes = {
      LOGIN_REQUIRED: ['로그인 후 이용할 수 있어요.', 'Please sign in.'],
      ACCESS_DENIED: ['초대가 종료됐거나 접근 권한이 없어요.', 'The invitation ended or access is unavailable.'],
      NOT_FOUND: ['작품을 찾을 수 없어요.', 'This work is unavailable.'],
      INVALID_MEDIA: ['지원하는 사진·음원·영상 중 25MB 이하 파일을 선택해주세요.', 'Choose a supported image, audio or video up to 25 MB.'],
      UPLOAD_INCOMPLETE: ['업로드를 마치지 못했어요. 같은 파일로 다시 시도해주세요.', 'Upload incomplete. Retry with the same file.'],
      UPLOAD_MISMATCH: ['업로드된 파일 정보가 일치하지 않아요. 파일을 다시 선택해주세요.', 'The uploaded file does not match. Select the file again.'],
      INVALID_ANCHOR: ['코멘트 위치와 시간 범위를 확인해주세요.', 'Check the comment location and time range.'],
      INVALID_BRIEF: ['질문은 400자, 작품 설명·수정 기록은 600자 이내로 적어주세요.', 'Keep the question within 400 characters and the context or revision note within 600.'],
      STORAGE_LIMIT: ['작품 저장 한도 250MB에 도달했어요.', 'Your 250 MB review storage is full.'],
      ACCOUNT_CHANGED: ['계정이 바뀌어 작업을 중단했어요.', 'Your account changed.'],
      UNAVAILABLE: ['작품 피드백룸에 연결하지 못했어요. 잠시 후 다시 시도해주세요.', 'Review rooms are unavailable. Please try again later.']
    };
    return say(...(codes[e.message] || ['처리하지 못했어요. 입력 내용을 유지한 채 다시 시도해주세요.', 'Unable to finish. Your draft is preserved; please retry.']));
  }
  async function api(action, p = {}) {
    const before = generation;
    const current = await client?.auth.getSession();
    const access = current?.data.session?.access_token;
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 25000);
    try {
      const r = await fetch('/api/review-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(access ? {
            Authorization: 'Bearer ' + access
          } : {})
        },
        body: JSON.stringify({
          roomId,
          key,
          ...p,
          action
        }),
        signal: abort.signal
      });
      const result = await r.json();
      if (before !== generation) throw Error('ACCOUNT_CHANGED');
      if (!r.ok) throw Error(result.error || 'UNAVAILABLE');
      return result;
    } finally {
      clearTimeout(timer);
    }
  }
  async function run(fn) {
    if (busy) return;
    busy = true;
    status('');
    const controls = [...document.querySelectorAll('button,input,textarea,select')].map(el => [el, el.disabled]);
    for (const [el] of controls) el.disabled = true;
    try {
      await fn();
    } catch (e) {
      status(error(e));
    } finally {
      busy = false;
      for (const [el, disabled] of controls) el.disabled = disabled;
      $('writing').disabled = !!$('file').files.length;
    }
  }
  const node = (tag, text, cls) => {
    const e = document.createElement(tag);
    if (text !== undefined) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };
  function button(label, fn) {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = () => run(fn);
    return b;
  }
  renderBriefForm();
  function idFor(kind, value) {
    const stamp = JSON.stringify(value);
    if (pending[kind]?.stamp !== stamp) pending[kind] = {
      stamp,
      id: crypto.randomUUID()
    };
    return pending[kind].id;
  }
  function selectAnchor(a) {
    point = a;
    $('anchor-label').textContent = describe(a);
    for (const p of $('media').querySelectorAll('.paragraph')) p.classList.toggle('selected', a.kind === 'paragraph' && Number(p.dataset.index) === a.index);
    $('media').querySelector('.pin')?.remove();
    if (a.kind === 'point') {
      const pin = node('span', '', 'pin');
      pin.style.left = `${a.x * 100}%`;
      pin.style.top = `${a.y * 100}%`;
      $('media').append(pin);
    }
  }
  function describe(a) {
    return a.kind === 'time' ? `${a.start.toFixed(2)}–${a.end.toFixed(2)}s` : a.kind === 'paragraph' ? say('문단 ', 'Paragraph ') + (a.index + 1) : a.kind === 'point' ? `${Math.round(a.x * 100)}%, ${Math.round(a.y * 100)}%` : say('작품 전체', 'Whole work');
  }
  function updateAuth() {
    const logged = !!session;
    $('auth').hidden = logged;
    $('account').hidden = !logged;
    $('account-name').textContent = logged ? say('로그인됨', 'Signed in') : '';
    $('comment-form').hidden = !logged;
    $('comment-login').textContent = logged ? '' : say('위에서 로그인하면 코멘트를 남길 수 있어요.', 'Sign in above to leave a comment.');
    $('create').hidden = !logged || !!roomId && !data?.owner;
    $('new-work').hidden = !roomId;
    $('mine').hidden = !logged || !!roomId;
  }
  function cleanMedia() {
    $('media').querySelectorAll('audio,video').forEach(v => {
      v.pause();
      v.removeAttribute('src');
      v.load();
    });
    $('media').replaceChildren();
    if (mediaObject) {
      URL.revokeObjectURL(mediaObject);
      mediaObject = null;
    }
  }
  async function showVersion(id) {
    const round = loadCount;
    const v = data?.versions.find(v => v.id === id);
    if (!v) return;
    const selected = id === versionId ? point : {
      kind: 'general'
    };
    versionId = id;
    $('version-brief').hidden = !(v.review_request || v.change_note);
    $('saved-request-block').hidden = !v.review_request;
    $('saved-note-block').hidden = !v.change_note;
    set('saved-request-label', '작가가 묻는 것', 'The creator’s question');
    $('saved-request').textContent = v.review_request || '';
    $('saved-note-label').textContent = data.versions[0]?.id === id ? say('작품 설명·작업 의도', 'Context and intention') : say('이번에 바꾼 점', 'What changed');
    $('saved-note').textContent = v.change_note || '';
    cleanMedia();
    $('time-controls').hidden = !['audio', 'video'].includes(v.kind);
    $('point-help').textContent = v.kind === 'image' ? say('그림을 눌러 코멘트 위치를 정하세요.', 'Click the image to anchor a comment.') : v.kind === 'text' ? say('문단을 눌러 코멘트 위치를 정하세요.', 'Select a paragraph to anchor a comment.') : say('재생을 멈추거나 구간을 입력해 코멘트를 남기세요.', 'Pause playback or select a range to anchor a comment.');
    if (v.kind === 'text') {
      v.body.split(/\n\s*\n/).forEach((p, i) => {
        const b = button(`${i + 1}  ${p}`, async () => selectAnchor({
          kind: 'paragraph',
          index: i
        }));
        b.className = 'paragraph';
        b.dataset.index = i;
        $('media').append(b);
      });
    } else {
      const r = await api('media', {
        versionId: id
      });
      if (round !== loadCount || versionId !== id) return;
      const e = node(v.kind === 'image' ? 'img' : v.kind);
      if (v.kind === 'image') {
        e.alt = data.room.title;
        e.onclick = event => {
          const rect = e.getBoundingClientRect();
          selectAnchor({
            kind: 'point',
            x: (event.clientX - rect.left) / rect.width,
            y: (event.clientY - rect.top) / rect.height
          });
        };
      } else {
        e.controls = true;
        e.preload = 'metadata';
        e.onpause = () => {
          const t = Math.min(e.currentTime, 7200);
          $('start').value = t.toFixed(2);
          $('end').value = t.toFixed(2);
          selectAnchor({
            kind: 'time',
            start: t,
            end: t
          });
        };
      }
      e.src = r.url;
      e.onerror = () => status(say('재생하지 못했어요. 새로고침 후 다시 시도해주세요.', 'Playback failed. Refresh and try again.'));
      $('media').append(e);
    }
    selectAnchor(C.anchor(selected, v.kind, v.body));
    $('versions').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.id === id));
    renderComments();
  }
  function renderComments() {
    $('comments').replaceChildren();
    const all = data.comments.filter(c => c.version_id === versionId),
      open = all.filter(c => !c.resolved).length;
    for (const [filter, label, count] of [['all', say('전체', 'All'), all.length], ['open', say('미반영', 'Open'), open], ['resolved', say('반영함', 'Resolved'), all.length - open]]) {
      const control = $('filter-' + filter);
      control.textContent = `${label} ${count}`;
      control.setAttribute('aria-pressed', commentFilter === filter);
    }
    const items = all.filter(c => commentFilter === 'all' || (commentFilter === 'open' ? !c.resolved : c.resolved));
    if (!items.length) $('comments').append(node('p', commentFilter === 'open' ? say('이 버전에 미반영 의견이 없어요.', 'No open feedback on this version.') : commentFilter === 'resolved' ? say('아직 반영한 의견이 없어요.', 'No resolved feedback yet.') : say('첫 의견을 남겨주세요.', 'Be the first to leave feedback.'), 'muted'));
    for (const c of items) {
      const card = node('article', undefined, 'comment');
      card.append(node('strong', c.author_name), node('small', c.resolved ? say(' · 반영함', ' · Resolved') : ''));
      card.append(button(describe(c.anchor), async () => {
        selectAnchor(c.anchor);
        if (c.anchor.kind === 'time') {
          const e = $('media').querySelector('audio,video');
          if (e) e.currentTime = c.anchor.start;
        }
      }), node('p', c.body));
      if (data.owner) card.append(button(c.resolved ? say('다시 열기', 'Reopen') : say('반영 완료', 'Mark resolved'), async () => {
        await api('resolve', {
          commentId: c.id,
          resolved: !c.resolved
        });
        await load();
      }));
      if (c.can_delete) card.append(button(say('코멘트 삭제', 'Delete comment'), async () => {
        if (confirm(say('이 코멘트를 삭제할까요?', 'Delete this comment?'))) {
          await api('remove_comment', {
            commentId: c.id
          });
          await load();
        }
      }));
      $('comments').append(card);
    }
  }
  async function load() {
    const round = ++loadCount;
    $('invitation').hidden = true;
    cleanMedia();
    data = null;
    $('room').hidden = true;
    updateAuth();
    renderBriefForm();
    if (!roomId) {
      $('privacy').textContent = say(...translations.privacy);
      $('create-title').textContent = say(...translations['create-title']);
      if (session) {
        const rooms = await api('list');
        if (round !== loadCount) return;
        $('room-list').replaceChildren();
        for (const r of rooms) {
          const item = node('article', undefined, 'comment');
          item.append(button(`${C.labels[r.field][en ? 1 : 0]} · ${r.title}${r.author_name ? ' · ' + r.author_name : ''}`, async () => {
            if (!discard()) return;
            roomId = r.id;
            key = null;
            setHash();
            await load();
          }));
          if (r.owner) item.append(button(r.deleting ? say('삭제 다시 시도', 'Retry deletion') : say('이 작품 삭제', 'Delete this work'), async () => {
            if (!confirm(say(`“${r.title}”의 모든 버전과 코멘트를 삭제할까요?`, `Delete all versions and comments in “${r.title}”?`))) return;
            await api('delete', {
              roomId: r.id,
              key: null
            });
            await load();
          }));
          $('room-list').append(item);
        }
        $('new-room-fields').hidden = false;
        $('title').required = true;
      }
      return;
    }
    const result = await api('read');
    if (round !== loadCount) return;
    data = result;
    renderBriefForm();
    $('room').hidden = false;
    $('room-title').textContent = data.room.title;
    $('room-field').textContent = C.labels[data.room.field][en ? 1 : 0];
    $('field').value = data.room.field;
    $('access').textContent = data.room.assignment_id ? say('제출자와 현재 모임 운영자만 보는 과제 작품', 'Private assignment: submitter and current group owner') : say('작성자가 초대한 사람들과 나누는 작품', 'Shared with people invited by the author');
    $('owner-actions').hidden = !data.owner;
    $('invite').hidden = !!data.room.assignment_id;
    $('revoke').hidden = !!data.room.assignment_id;
    $('versions').replaceChildren();
    $('room-progress').textContent = `${say('작품 전체 미반영 의견', 'Open feedback across all versions')} ${data.comments.filter(c => !c.resolved).length}`;
    for (const [i, v] of data.versions.entries()) {
      const open = data.comments.filter(c => c.version_id === v.id && !c.resolved).length;
      const b = button(`${say('버전 ', 'Version ')}${i + 1} · ${say('미반영', 'Open')} ${open}`, async () => {
        if (v.id === versionId) return;
        if ($('comment').value && !confirm(say('작성 중인 코멘트를 두고 버전을 바꿀까요?', 'Switch versions and discard your comment?'))) return;
        $('comment').value = '';
        await showVersion(v.id);
      });
      b.dataset.id = v.id;
      $('versions').append(b);
    }
    $('new-room-fields').hidden = true;
    $('title').required = false;
    $('create-title').textContent = say('수정한 작품 올리기', 'Add a revision');
    $('privacy').textContent = data.room.assignment_id ? say('제출자와 현재 모임 운영자에게만 공유합니다. AI 분석은 자동 실행되지 않아요.', 'Shared only with the submitter and current group owner. AI does not run automatically.') : say('이 방의 초대 링크를 받은 사람은 새 버전도 볼 수 있어요. AI 분석은 자동 실행되지 않아요.', 'People with this room’s invitation can see new versions too. AI does not run automatically.');
    $('open-app').href = `artlink://review-room?room=${roomId}${key ? '&key=' + key : ''}`;
    updateAuth();
    const v = data.versions.find(v => v.id === versionId) || data.versions.at(-1);
    if (v) await showVersion(v.id);
  }
  function setHash() {
    history.replaceState(null, '', location.pathname + location.search + (roomId ? `#room=${roomId}${key ? '&key=' + key : ''}` : ''));
  }
  function discard() {
    if (hasDraft() && !confirm(say('작성 중인 내용을 버리고 이동할까요?', 'Discard your unsent draft and continue?'))) return false;
    clearDrafts();
    return true;
  }
  function clearDrafts() {
    $('comment').value = '';
    $('writing').value = '';
    $('review-request').value = '';
    $('change-note').value = '';
    $('file').value = '';
    $('writing').disabled = false;
    $('consent').checked = false;
    for (const k of Object.keys(pending)) delete pending[k];
  }
  $('refresh').onclick = () => run(load);
  for (const filter of ['all', 'open', 'resolved']) $('filter-' + filter).onclick = () => {
    if (busy || !data) return;
    commentFilter = filter;
    renderComments();
  };
  $('field').onchange = () => {
    renderBriefForm();
    $('consent').checked = false;
  };
  for (const id of ['review-request', 'change-note']) $(id).oninput = () => {
    $('consent').checked = false;
  };
  $('reset-anchor').onclick = () => selectAnchor({
    kind: 'general'
  });
  $('set-time').onclick = () => run(async () => {
    const v = data.versions.find(v => v.id === versionId);
    const a = C.anchor({
      kind: 'time',
      start: Number($('start').value),
      end: Number($('end').value)
    }, v.kind);
    const el = $('media').querySelector('video,audio');
    if (el && Number.isFinite(el.duration) && a.end > el.duration) throw Error('INVALID_ANCHOR');
    selectAnchor(a);
  });
  $('comment-form').onsubmit = e => {
    e.preventDefault();
    run(async () => {
      const v = data.versions.find(v => v.id === versionId),
        anchor = C.anchor(point, v.kind, v.body);
      const p = {
        versionId,
        authorName: $('name').value.trim(),
        body: $('comment').value.trim(),
        anchor
      };
      await api('comment', {
        ...p,
        clientId: idFor('comment', p)
      });
      $('comment').value = '';
      await load();
    });
  };
  $('work-form').onsubmit = e => {
    e.preventDefault();
    run(async () => {
      if (!$('consent').checked) return;
      if ($('comment').value && !confirm(say('수정본을 열면 작성 중인 코멘트는 사라져요. 저장할까요?', 'Open the new revision and discard your unsent comment?'))) return;
      const before = generation;
      const file = $('file').files[0],
        body = $('writing').value;
      const p = {
        ...(file ? C.media(file.type, file.size) : {
          kind: 'text',
          body
        }),
        ...C.reviewBrief($('review-request').value, $('change-note').value)
      };
      if (!file && !body.trim()) throw Error('INVALID_INPUT');
      let target = roomId;
      if (!target) {
        const r = {
          title: $('title').value.trim(),
          field: $('field').value,
          consent: true
        };
        const created = await api('create', {
          ...r,
          clientId: idFor('room', r)
        });
        target = created.id;
      }
      const reservation = await api('reserve', {
        roomId: target,
        ...p,
        clientId: idFor('version', {
          target,
          ...p,
          name: file?.name,
          modified: file?.lastModified
        })
      });
      if (!reservation.ready) {
        const upload = new URL(reservation.uploadUrl);
        if (upload.origin !== new URL(client.supabaseUrl).origin || !upload.pathname.startsWith('/storage/v1/object/upload/sign/review-media/')) throw Error('UNAVAILABLE');
        try {
          await fetch(upload, {
            method: 'PUT',
            headers: {
              'Content-Type': file.type
            },
            body: file,
            signal: AbortSignal.timeout(120000)
          });
        } catch {/* Finalize may recover a lost upload response. */}
        if (before !== generation) throw Error('ACCOUNT_CHANGED');
        await api('finalize', {
          roomId: target,
          versionId: reservation.id
        });
      }
      roomId = target;
      versionId = reservation.id;
      point = {
        kind: 'general'
      };
      $('comment').value = '';
      $('review-request').value = '';
      $('change-note').value = '';
      setHash();
      $('writing').value = '';
      $('file').value = '';
      $('writing').disabled = false;
      $('consent').checked = false;
      for (const k of Object.keys(pending)) delete pending[k];
      await load();
      status(say('작품을 저장했어요.', 'Work saved.'));
    });
  };
  $('file').onchange = () => {
    $('consent').checked = false;
    $('writing').disabled = !!$('file').files.length;
  };
  $('writing').oninput = () => {
    $('consent').checked = false;
  };
  $('clear-file').onclick = () => {
    $('file').value = '';
    $('writing').disabled = false;
    $('consent').checked = false;
  };
  $('invite').onclick = () => run(async () => {
    if (!confirm(say('링크를 받은 사람에게 작품과 코멘트를 공개할까요? 이전 링크는 종료됩니다.', 'Allow anyone with the link to see the work and comments? Previous links will end.'))) return;
    const r = await api('link', {
      consent: true
    });
    key = r.key;
    setHash();
    $('invite-url').value = C.invitation(location.origin, roomId, key, en ? 'en' : 'ko');
    $('invitation').hidden = false;
  });
  $('copy-link').onclick = () => run(async () => {
    try {
      await navigator.clipboard.writeText($('invite-url').value);
      status(say('링크를 복사했어요.', 'Link copied.'));
    } catch {
      $('invite-url').select();
      status(say('선택된 링크를 복사해주세요.', 'Copy the selected link.'));
    }
  });
  $('revoke').onclick = () => run(async () => {
    await api('revoke');
    key = null;
    setHash();
    $('invitation').hidden = true;
    status(say('초대를 종료했어요. 이미 열린 미디어 주소는 최대 60초간 유효합니다.', 'Invitation ended. Previously issued media URLs expire within 60 seconds.'));
  });
  $('delete').onclick = () => run(async () => {
    if (!confirm(say('이 작품의 모든 버전과 코멘트를 삭제할까요?', 'Delete all versions and comments in this room?'))) return;
    await api('delete');
    clearDrafts();
    roomId = null;
    key = null;
    versionId = null;
    setHash();
    await load();
  });
  $('new-work').onclick = () => run(async () => {
    if (!discard()) return;
    roomId = null;
    key = null;
    versionId = null;
    setHash();
    await load();
    $('create').hidden = !session;
    $('create-title').textContent = say('당신의 작품도 보여주세요.', 'Bring your work into the conversation.');
    if (!session) $('auth').scrollIntoView({
      behavior: 'smooth'
    });
  });
  try {
    const r = await fetch('/api/review-room');
    if (!r.ok) throw Error('UNAVAILABLE');
    const config = await r.json();
    client = window.supabase.createClient(config.url, config.anonKey, {
      auth: {
        flowType: 'pkce',
        persistSession: true,
        storage: sessionStorage,
        detectSessionInUrl: true
      }
    });
    if (roomId) sessionStorage.setItem('artlink-review-return', JSON.stringify({
      roomId,
      key,
      lang: en ? 'en' : 'ko'
    }));
    const initial = await client.auth.getSession();
    session = initial.data.session;
    authUser = session?.user.id || null;
    if (!roomId && session) {
      try {
        const back = JSON.parse(sessionStorage.getItem('artlink-review-return'));
        if (C.uuid(back?.roomId)) {
          roomId = back.roomId;
          key = C.token(back.key) ? back.key : null;
          setHash();
        }
      } catch {}
    }
    client.auth.onAuthStateChange((_event, next) => {
      if (authUser !== (next?.user.id || null)) {
        generation++;
        loadCount++;
        cleanMedia();
        data = null;
        $('room').hidden = true;
        $('room-list').replaceChildren();
        $('comment').value = '';
        $('name').value = '';
        $('file').value = '';
        $('writing').value = '';
        $('review-request').value = '';
        $('change-note').value = '';
        $('writing').disabled = false;
        $('title').value = '';
        $('consent').checked = false;
        $('invitation').hidden = true;
        for (const k of Object.keys(pending)) delete pending[k];
      }
      authUser = next?.user.id || null;
      session = next;
      updateAuth();
    });
    $('login-form').onsubmit = e => {
      e.preventDefault();
      run(async () => {
        const r = await client.auth.signInWithPassword({
          email: $('email').value,
          password: $('password').value
        });
        $('password').value = '';
        if (r.error) {
          status(say('이메일과 비밀번호를 확인해주세요.', 'Check your email and password.'));
          return;
        }
        session = r.data.session;
        updateAuth();
        await load();
      });
    };
    $('signup').onclick = () => run(async () => {
      if (!$('login-form').reportValidity()) return;
      if (!$('terms-consent').checked) {
        status(say('계정 생성 전에 이용약관과 개인정보처리방침을 확인하고 동의해주세요.', 'Review and accept the Terms and Privacy Policy before creating an account.'));
        return;
      }
      const r = await client.auth.signUp({
        email: $('email').value,
        password: $('password').value,
        options: {
          emailRedirectTo: location.origin + '/review/'
        }
      });
      $('password').value = '';
      if (r.error) {
        status(say('가입하지 못했어요. 이메일과 비밀번호를 확인해주세요.', 'Unable to sign up. Check your email and password.'));
        return;
      }
      if (r.data.session) {
        session = r.data.session;
        await load();
      } else status(say('확인 메일을 보냈어요. 이메일을 확인한 뒤 로그인해주세요.', 'Check your confirmation email, then sign in.'));
    });
    $('logout').onclick = () => run(async () => {
      if (!discard()) return;
      await client.auth.signOut({
        scope: 'local'
      });
      session = null;
      updateAuth();
      await load();
    });
    updateAuth();
    await load();
  } catch (e) {
    status(error(e));
    if (!client) {
      for (const b of $('auth').querySelectorAll('button')) b.disabled = true;
    }
  }
  window.addEventListener('pagehide', () => {
    generation++;
    cleanMedia();
  });
  window.addEventListener('beforeunload', e => {
    if (hasDraft()) {
      e.preventDefault();
      e.returnValue = '';
    }
  });
})();
