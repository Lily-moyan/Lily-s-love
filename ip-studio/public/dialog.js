/* 应用内浮层，替掉浏览器的 confirm / prompt。
 *
 * 换掉的理由不只是好看：原生弹窗顶着 "localhost:5177 显示" 的标题，
 * 样式不受控、在有些浏览器里会被"阻止此页面再弹出对话框"永久禁掉，
 * 而且它是同步阻塞的，弹着的时候页面上别的东西全停了。
 *
 * 接口刻意做成 await 的，调用处基本原样：
 *   if (!await ask.confirm({ title: '删掉？' })) return;
 *   const v = await ask.form({ fields: [...] });   // 取消返回 null
 *
 * 两个页面（主应用和管理后台）共用这一份，所以自己建 DOM，不依赖任何 HTML。
 */
window.ask = (() => {
  let host = null;
  let onKey = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function close(result, resolve) {
    if (onKey) document.removeEventListener('keydown', onKey, true);
    onKey = null;
    host?.remove();
    host = null;
    resolve(result);
  }

  function open({ title, body, fields, ok, cancel, danger }, resolve) {
    // 同一时刻只允许一个——两个叠在一起，键盘事件归谁就说不清了
    if (host) host.remove();

    host = document.createElement('div');
    host.className = 'ask-mask';
    host.innerHTML = `
      <div class="ask" role="dialog" aria-modal="true">
        ${title ? `<h3>${esc(title)}</h3>` : ''}
        ${body ? `<p class="ask-body">${esc(body).replace(/\n/g, '<br>')}</p>` : ''}
        ${(fields || []).map((f) => `
          <label class="ask-field">${esc(f.label || '')}
            ${f.multiline
    ? `<textarea data-k="${esc(f.key)}" rows="${f.rows || 3}"
                 placeholder="${esc(f.placeholder || '')}">${esc(f.value || '')}</textarea>`
    : `<input data-k="${esc(f.key)}" type="${esc(f.type || 'text')}"
                 value="${esc(f.value ?? '')}" placeholder="${esc(f.placeholder || '')}">`}
          </label>`).join('')}
        <div class="ask-foot">
          <button type="button" class="btn ghost small" data-no>${esc(cancel || '取消')}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'} small" data-yes>${esc(ok || '确定')}</button>
        </div>
      </div>`;
    document.body.appendChild(host);

    const read = () => Object.fromEntries(
      [...host.querySelectorAll('[data-k]')].map((n) => [n.dataset.k, n.value.trim()]),
    );
    const yes = () => {
      if (!fields) return close(true, resolve);
      const v = read();
      // 必填项空着就别让人以为提交成功了——标红，不关窗
      const miss = (fields || []).find((f) => f.required && !v[f.key]);
      if (miss) {
        const n = host.querySelector(`[data-k="${miss.key}"]`);
        n.classList.add('bad');
        n.focus();
        return undefined;
      }
      return close(v, resolve);
    };
    const no = () => close(fields ? null : false, resolve);

    host.querySelector('[data-yes]').addEventListener('click', yes);
    host.querySelector('[data-no]').addEventListener('click', no);
    host.addEventListener('mousedown', (e) => { if (e.target === host) no(); });

    onKey = (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); no(); return; }
      // 多行输入里回车是换行，不该提交
      if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') { e.preventDefault(); yes(); }
    };
    document.addEventListener('keydown', onKey, true);

    // 有输入框就聚焦第一个，否则聚焦主按钮——纯确认时回车能直接过
    (host.querySelector('[data-k]') || host.querySelector('[data-yes]')).focus();
    host.querySelector('[data-k]')?.select?.();
  }

  const api = {
    confirm: (opts) => new Promise((r) => open({ ...opts, fields: null }, r)),
    form: (opts) => new Promise((r) => open({ ...opts, fields: opts.fields || [] }, r)),
  };
  return api;
})();
