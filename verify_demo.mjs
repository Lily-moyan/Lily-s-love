// 验证「演示模式」真能跑完：加载演示版 HTML，桩掉 DOM 与定时器，跑 runDemo() 并检查产物
import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync('G:/dsh/行业分析工作台-演示版/index.html', 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));

// ---------- DOM 桩（这次要记录真实产物） ----------
const created = [];          // 所有 appendChild 到容器的元素
const store = {};

function makeEl(tag) {
    const el = {
        tagName: tag || 'div',
        id: '', className: '', innerHTML: '', textContent: '', value: '',
        style: {}, children: [], _q: {},
        classList: { add() {}, remove() {} },
        addEventListener() {}, remove() {}, focus() {}, scrollIntoView() {},
        // 按选择器缓存，否则 addCard 里设置的标题会丢（每次返回新元素）
        querySelector(sel) {
            if (!this._q[sel]) this._q[sel] = makeEl('div');
            return this._q[sel];
        },
        appendChild(child) { this.children.push(child); return child; }
    };
    return el;
}

const container = makeEl('div');

// PWA 代码在顶层会访问 navigator / location / window，桩必须提供，
// 否则会 ReferenceError（这是桩的缺口，不是页面缺陷）。
const fakeNavigator = { userAgent: 'node-test', standalone: false };
const fakeLocation = { protocol: 'file:', search: '' };
const fakeWindow = {
    addEventListener() {},
    matchMedia: () => ({ matches: false }),
    navigator: fakeNavigator,
    location: fakeLocation
};

const ctx = {
    document: {
        getElementById(id) {
            if (id === 'cards-container') return container;
            if (!store[id]) store[id] = makeEl('div');
            return store[id];
        },
        createElement: (tag) => makeEl(tag),
        querySelector: () => makeEl('div')
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    alert: (m) => { throw new Error('意外 alert: ' + m); },
    confirm: () => true,
    fetch: async () => { throw new Error('演示模式不应发起网络请求'); },
    navigator: fakeNavigator,
    location: fakeLocation,
    window: fakeWindow,
    console, TextDecoder, TextEncoder, AbortController,
    Blob: class {}, URL: { createObjectURL: () => '', revokeObjectURL() {} },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Promise, TypeError,
    // 把定时器变成立即执行，否则测试要等几十秒
    setTimeout: (fn) => { fn(); return 0; }
};
vm.createContext(ctx);
vm.runInContext(js, ctx);

// ---------- 跑演示 ----------
let pass = true;
const check = (label, cond, detail) => {
    console.log((cond ? '  ✅ ' : '  ❌ ') + label + (detail ? '  ' + detail : ''));
    if (!cond) pass = false;
};

console.log('=== 演示模式功能测试 ===');
await vm.runInContext('runDemo()', ctx);

const cards = container.children;
check('卡片已生成', cards.length >= 7, `共 ${cards.length} 个`);

// 演示内容有两条写入路径：
//   ① 横幅/结束卡 → 走 innerHTML（容器子节点）
//   ② Step 正文 → 走 getElementById('content-N').textContent（store 里的元素）
// 所以两边都要收集，否则会误判为"没内容"。
const parts = [];
for (const c of cards) {
    parts.push(c.innerHTML || '', c.textContent || '');
    for (const sel of Object.keys(c._q || {})) parts.push(c._q[sel].textContent || '');
}
for (const k of Object.keys(store)) parts.push(store[k].innerHTML || '', store[k].textContent || '');
const allText = parts.join('\n');

const expect = [
    ['演示标注横幅', '预置示例'],
    ['Step 0 边界切分', '候选一'],
    ['Step 1 结构层', '产业链分层'],
    ['Step 2 三条流转链', '钱流'],
    ['Step 3 议价能力', '议价'],
    ['Step 4 约束节奏异常', '你还不知道的 10 件事'],
    ['Step 5 从业者拷问', '从业者'],
    ['结束提示', '演示结束']
];
for (const [name, kw] of expect) {
    check(name, allText.includes(kw), allText.includes(kw) ? '' : `未找到关键词「${kw}」`);
}

// 关键机制是否在演示内容里露出来
check('证据分级 A/B/C 可见', /A（|B 档|C 档|evidence/.test(allText));
check('「未获取」未被推测填满', allText.includes('未获取'));
check('对抗式校验内容存在', allText.includes('暴露'));

console.log('');
console.log(pass ? '★★★★★ 演示模式全部通过' : '❌ 存在失败项');
process.exit(pass ? 0 : 1);
