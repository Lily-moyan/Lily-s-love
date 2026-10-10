/* 营销页的脚本只做两件事：渐入、把 CTA 的来源带过去。
   这页没有任何需要拉数据的东西——价格放在首页，这里刻意不放，
   多一个价格表就多一个在决定"免费开始"之前先犹豫的理由。 */

(() => {
  const targets = document.querySelectorAll('.pm-o, .pm-steps li, .pm-vs-c, .pm-faq details, .pm-end > .pm-in');
  if (!targets.length || typeof IntersectionObserver !== 'function') return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  document.documentElement.classList.add('js-anim');
  targets.forEach((n) => n.classList.add('pm-rv'));

  const io = new IntersectionObserver((es) => {
    es.forEach((e, i) => {
      if (!e.isIntersecting) return;
      setTimeout(() => e.target.classList.add('in'), i * 55);
      io.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  targets.forEach((n) => io.observe(n));

  // 兜底：只补"已经在视口里却没亮"的，无差别点亮会把动效提前用掉
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

/* 投放来源透传。营销页多半挂在广告/朋友圈链接上，
   带上 utm 才知道哪条渠道真的带来了注册。 */
(() => {
  const q = new URLSearchParams(location.search);
  const keep = ['utm_source', 'utm_medium', 'utm_campaign', 'from'];
  const carry = keep.filter((k) => q.get(k)).map((k) => `${k}=${encodeURIComponent(q.get(k))}`);
  if (!carry.length) return;
  document.querySelectorAll('a[href^="/app"]').forEach((a) => {
    a.href += (a.href.includes('?') ? '&' : '?') + carry.join('&');
  });
})();
