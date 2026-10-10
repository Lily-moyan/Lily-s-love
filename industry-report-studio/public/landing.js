/* 落地页只有一件动态的事：价格从服务端取。
   写死在 HTML 里迟早和后台对不上——那种不一致比不显示价格更伤信任。 */
(async () => {
  const box = document.getElementById('lpPrice');
  if (!box) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  try {
    const d = await (await fetch('/api/pricing')).json();
    box.innerHTML = [...d.plans, ...d.packs].map((p) => `
      <div class="lp-plan ${p.key === 'pro' ? 'hot' : ''}">
        <h4>${esc(p.label)}</h4>
        <div class="p">${p.price ? `${p.price}<em> 元${p.pack ? '' : '/月'}</em>` : `0<em> 元/月</em>`}</div>
        <div class="c">${p.credits.toLocaleString()} 点</div>
        <p class="n">${esc(p.note || '')}</p>
        <a class="btn ${p.key === 'pro' ? 'primary' : 'ghost'} small" href="/app?signup=1">${
  p.price ? '开始使用' : '免费开始'}</a>
      </div>`).join('');
  } catch {
    box.innerHTML = '<p class="lp-note">价格暂时取不到，稍后再看。</p>';
  }
})();

/* 滚动渐入。只给内容块，首屏不加——首屏该立刻就在那儿。
   幅度压得很小，落地页上大开大合的动效只会让人觉得虚。 */
(() => {
  const targets = document.querySelectorAll('.lp-feat, .lp-cases > div, .lp-plan, .lp-cols > div, .lp-end');
  if (!targets.length) return;
  if (typeof IntersectionObserver !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  // 先挂 .js-anim 才生效，见 landing.css：脚本没跑到这儿，内容照常显示
  document.documentElement.classList.add('js-anim');
  targets.forEach((n) => n.classList.add('reveal'));

  const show = (n, delay = 0) => setTimeout(() => n.classList.add('in'), delay);
  const io = new IntersectionObserver((es) => {
    es.forEach((e, i) => {
      if (!e.isIntersecting) return;
      show(e.target, i * 60); // 同屏的错开一点，一起蹦出来显得廉价
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((n) => io.observe(n));

  // 兜底：补上"已经在视口里却没亮"的。
  // 不能无差别全点亮——那样滚下去时动效已经用掉了，等于白做。
  const sweep = () => {
    let left = 0;
    targets.forEach((n) => {
      if (n.classList.contains('in')) return;
      if (n.getBoundingClientRect().top < innerHeight) n.classList.add('in');
      else left++;
    });
    if (!left) removeEventListener('scroll', sweep);
  };
  addEventListener('scroll', sweep, { passive: true });
  setTimeout(sweep, 1500);
})();
