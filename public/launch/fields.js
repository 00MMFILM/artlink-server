(() => {
  const link = document.getElementById('field-handoff');
  if (!link) return;
  const original = new URL(link.getAttribute('href'), location.origin);
  const content = original.searchParams.get('content') || '';
  const update = () => {
    const goal = document.querySelector('input[name="focus"]:checked');
    const next = new URL(original.href);
    if (goal) next.searchParams.set('content', content + '\n' + (document.documentElement.lang === 'ko' ? '이번에 확인할 점: ' : 'Focus for this practice: ') + goal.value);
    link.href = next.pathname + next.search;
  };
  document.querySelectorAll('input[name="focus"]').forEach(input => input.addEventListener('change',update));
  update();
})();
