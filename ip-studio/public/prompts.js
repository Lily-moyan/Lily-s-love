/* 提示词说明书。纯读，无状态——数据全从 /api/prompt-docs 来。 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* 说明文字里用 **强调** 标一句话里的关键词——读者是产品经理，扫读时需要落点 */
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/`(.+?)`/g, '<code>$1</code>');

const MODE_HINT = {
  结构化输出: '用 JSON Schema 约束返回结构，字段缺失或越界在代码里兜',
  流式输出: '边生成边推给前端，长等待变成可读的过程',
  纯文本: '返回一段文字，直接用',
};

(async () => {
  let data;
  try {
    const res = await fetch('/api/prompt-docs');
    data = await res.json();
  } catch {
    $('list').innerHTML = '<p class="pd">读不到说明数据，确认服务在跑。</p>';
    return;
  }

  const { stages, principle, assembly, prompts } = data;

  $('principle').innerHTML = `<h2>${esc(principle.title)}</h2><p>${md(principle.body)}</p>`;

  // user 消息怎么拼——比任何单条提示词都更能解释这个产品
  if (assembly) {
    $('assembly').innerHTML = `
      <h2>${esc(assembly.title)}</h2>
      <p>${md(assembly.intro)}</p>
      <ol class="asm">${assembly.blocks.map((b) => `
        <li><b>${esc(b.name)}</b><i>${esc(b.from)}</i><span>${md(b.note)}</span></li>`).join('')}</ol>`;
  }

  $('nav').innerHTML = stages.map((st) => {
    const items = prompts.filter((p) => p.stage === st.key);
    if (!items.length) return '';
    return `<div class="grp"><b>${esc(st.label)}　${esc(st.blurb)}</b>
      ${items.map((p) => `<a href="#p-${esc(p.key)}" class="${p.hidden ? 'off' : ''}">${esc(p.name)}</a>`).join('')}</div>`;
  }).join('');

  // 按阶段排，同阶段内保持定义顺序——读下来就是产品的实际流程
  const ordered = stages.flatMap((st) => prompts.filter((p) => p.stage === st.key));

  $('list').innerHTML = ordered.map((p) => {
    const stage = stages.find((s) => s.key === p.stage);
    const acts = p.extra ? Object.entries(p.extra).map(([group, list]) => `
      <h4>${esc(group)}</h4>
      <div class="acts">${list.map((a) => `
        <div class="act"><b>${esc(a.label)}</b><span>${esc(a.instruction)}</span></div>`).join('')}</div>`).join('') : '';

    return `
    <article class="pd" id="p-${esc(p.key)}">
      <header>
        <h3>${esc(p.name)}</h3>
        <span class="tag">${esc(stage?.label || p.stage)}</span>
        <span class="tag" title="${esc(MODE_HINT[p.mode] || '')}">${esc(p.mode)}</span>
        ${p.ab ? '<span class="tag ab" title="管理后台可以挂变体做 A/B">A/B</span>' : ''}
        ${p.hidden ? '<span class="tag off" title="入口已从界面撤掉，代码还在">已隐藏</span>' : ''}
      </header>
      <p class="where">出现在：${esc(p.where)}</p>

      <h4>产品定位</h4>
      <p class="positioning">${md(p.positioning)}</p>

      <h4>价值</h4>
      <ul>${p.value.map((v) => `<li>${md(v)}</li>`).join('')}</ul>

      <h4>功能逻辑</h4>
      <ul>${p.logic.map((v) => `<li>${md(v)}</li>`).join('')}</ul>

      ${p.guards?.length ? `<h4>代码兜底（提示词之外的那一层）</h4>
        <ul class="guards">${p.guards.map((v) => `<li>${md(v)}</li>`).join('')}</ul>` : ''}

      ${acts}

      <details>
        <summary>实际发给模型的 system 提示词（${p.system.length} 字）</summary>
        <pre>${esc(p.system)}</pre>
      </details>
      ${p.schema ? `<details>
        <summary>输出结构约束（JSON Schema）</summary>
        <pre>${esc(JSON.stringify(p.schema, null, 2))}</pre>
      </details>` : ''}
    </article>`;
  }).join('');

  // 滚到哪一条，左边就高亮哪一条
  const links = [...document.querySelectorAll('.docs-nav a')];
  const spy = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
    }
  }, { rootMargin: '-90px 0px -70% 0px' });
  document.querySelectorAll('.pd').forEach((n) => spy.observe(n));
})();
