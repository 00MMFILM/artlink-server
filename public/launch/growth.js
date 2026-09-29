/* Progressive enhancement: no microphone, upload, AI request or third-party scripts. */
(() => {
  const data = JSON.parse(document.getElementById('scene-data').textContent);
  const params = new URLSearchParams(location.search);
  // Only a short campaign label is propagated. Never forward arbitrary query strings.
  const candidate = params.get('s');
  const source = /^[a-z0-9_-]{1,24}$/.test(candidate || '') ? candidate : `landing_${data.lang}`;
  document.querySelectorAll('[data-store]').forEach(link => {
    const query = new URLSearchParams({ platform: link.dataset.store, s: `${source}_${link.dataset.source}` });
    link.href = `/app?${query}`;
  });
  document.querySelectorAll('[data-language-link]').forEach(link => {
    const url = new URL(link.href);
    url.searchParams.set('s', source);
    link.href = url.pathname + url.search + url.hash;
  });
  const reader = document.getElementById('scene-reader');
  const output = document.getElementById('line-output');
  const reflection = document.getElementById('reflection');
  const next = document.getElementById('next-line');
  const practice = document.getElementById('practice-link');
  let index = 0, revealed = false;
  function updatePractice() {
    const focus = document.querySelector('input[name="focus"]:checked').value;
    const content = `${data.contextLabel}: ${data.situation}\n${data.roleLabel}\n\n${data.lines.map(([role,line]) => `${role}: ${line}`).join('\n')}\n\n${data.focusLabel}: ${focus}`;
    practice.href = `/practice?${new URLSearchParams({field:'acting', source:'landing', title:data.handoffTitle, content})}`;
  }
  function render() {
    const [role, line] = data.lines[index];
    const hidden = role === 'A' && !revealed;
    const count = document.createElement('p'); count.className = 'counter'; count.textContent = `${data.count} ${index + 1} / ${data.lines.length} · ${role}`;
    const spoken = document.createElement('p'); spoken.className = `spoken-line${hidden ? ' hint' : ''}`; spoken.textContent = hidden ? data.yourTurn : line;
    output.replaceChildren(count, spoken);
    next.textContent = hidden ? data.reveal : index === data.lines.length - 1 ? data.finish : `${data.next} →`;
  }
  next.hidden = false;
  next.addEventListener('click', () => {
    if (data.lines[index][0] === 'A' && !revealed) { revealed = true; render(); return; }
    if (index === data.lines.length - 1) {
      reader.hidden = true; reflection.hidden = false; updatePractice(); document.getElementById('focus-heading').focus(); return;
    }
    index += 1; revealed = false; render();
  });
  document.querySelectorAll('input[name="focus"]').forEach(input => input.addEventListener('change', updatePractice));
  document.getElementById('restart').addEventListener('click', () => {
    index = 0; revealed = false; reflection.hidden = true; reader.hidden = false; render(); next.focus();
  });
  render();
})();
