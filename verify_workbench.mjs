// 用 Node + vm 桩件验证行业分析工作台（index.html）的协议解析与流式拼装逻辑
// 目的：在没有浏览器的情况下，真跑一遍代码，验证 openai / anthropic 两种协议的 SSE 解析
// 用法：node verify_workbench.mjs
import fs from 'fs';
import vm from 'vm';

const html = fs.readFileSync('G:/industry-analysis-workbench/index.html', 'utf8');
const js = html.slice(html.indexOf('<script>') + 8, html.indexOf('</script>'));

// ---------- 合成 SSE 流 ----------
const openaiChunks = [
    'data: {"choices":[{"delta":{"content":"你好"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"，这是"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"测试"}}]}\n\n',
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":7}}\n\n',
    'data: [DONE]\n\n'
];
const anthropicChunks = [
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":13}}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"行业"}}\n\n',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"分析"}}\n\n',
    'data: {"type":"message_delta","usage":{"output_tokens":9}}\n\n'
];

let CHUNKS = openaiChunks;
let lastRequest = null;

function makeRes() {
    const enc = new TextEncoder();
    let i = 0;
    return {
        ok: true, status: 200,
        body: {
            getReader: () => ({
                read: async () => (i >= CHUNKS.length)
                    ? { done: true, value: undefined }
                    : { done: false, value: enc.encode(CHUNKS[i++]) }
            })
        }
    };
}

// ---------- DOM 桩 ----------
const store = {};
function makeEl(id) {
    return {
        id, value: '', placeholder: '', checked: false, disabled: false,
        textContent: '', innerHTML: '', style: {},
        classList: { add() {}, remove() {} },
        addEventListener() {}, appendChild() {}, remove() {}, focus() {},
        scrollIntoView() {},
        querySelector: () => makeEl('q')
    };
}
const ctx = {
    document: {
        getElementById: (id) => (store[id] || (store[id] = makeEl(id))),
        createElement: () => makeEl('new'),
        querySelector: () => makeEl('q')
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    alert: (m) => { throw new Error('意外 alert: ' + m); },
    confirm: () => true,
    fetch: async (url, opts) => {
        lastRequest = { url, opts, body: JSON.parse(opts.body) };
        return makeRes();
    },
    console, setTimeout, clearTimeout,
    TextDecoder, TextEncoder, AbortController,
    Blob: class { constructor() {} },
    URL: { createObjectURL: () => '', revokeObjectURL() {} },
    Date, JSON, Math, Object, Array, String, Number, RegExp, Error, Promise, TypeError
};
vm.createContext(ctx);
vm.runInContext(js, ctx);

// ---------- 运行助手 ----------
async function run(protocol, model, base, chunks) {
    CHUNKS = chunks;
    lastRequest = null;
    vm.runInContext(`
        state.protocol = ${JSON.stringify(protocol)};
        state.model = ${JSON.stringify(model)};
        state.apiBase = ${JSON.stringify(base)};
        state.apiKey = 'sk-test-key';
        state.inputTokens = 0; state.outputTokens = 0;
        globalThis.__streamed = '';
        globalThis.__full = null;
    `, ctx);
    await vm.runInContext(`
        callClaude([{role:'user',content:'hi'}],
            (t) => { globalThis.__streamed += t; },
            (f) => { globalThis.__full = f; })
    `, ctx);
    return { streamed: ctx.__streamed, full: ctx.__full };
}

function check(label, cond, detail) {
    console.log((cond ? '  ✅ ' : '  ❌ ') + label + (detail ? '  ' + detail : ''));
    return cond;
}

let pass = true;
// 注意：脚本里 state 是顶层 const，在 vm 中不会成为上下文对象的属性，
// 只能通过 runInContext 表达式读取。
const S = (expr) => vm.runInContext('state.' + expr, ctx);

console.log('=== A. OpenAI 兼容协议（DeepSeek）===');
const a = await run('openai', 'deepseek-chat', 'https://api.deepseek.com', openaiChunks);
pass &= check('URL 正确', lastRequest.url === 'https://api.deepseek.com/v1/chat/completions', lastRequest.url);
pass &= check('认证为 Bearer', lastRequest.opts.headers['Authorization'] === 'Bearer sk-test-key');
pass &= check('system 注入为首条 message',
    lastRequest.body.messages[0].role === 'system' && lastRequest.body.messages[0].content.includes('证据分级'));
pass &= check('body 无 system 顶层字段', lastRequest.body.system === undefined);
pass &= check('文本拼装正确', a.full === '你好，这是测试', JSON.stringify(a.full));
pass &= check('流式回调累积正确', a.streamed === '你好，这是测试');
pass &= check('usage 解析正确', S('inputTokens') === 11 && S('outputTokens') === 7,
    `in=${S('inputTokens')} out=${S('outputTokens')}`);

console.log('');
console.log('=== B. Anthropic Messages 协议 ===');
const b = await run('anthropic', 'claude-sonnet-5', 'https://api.anthropic.com', anthropicChunks);
pass &= check('URL 正确', lastRequest.url === 'https://api.anthropic.com/v1/messages', lastRequest.url);
pass &= check('带浏览器直连头',
    lastRequest.opts.headers['anthropic-dangerous-direct-browser-access'] === 'true');
pass &= check('官方域名用 x-api-key',
    lastRequest.opts.headers['x-api-key'] === 'sk-test-key' && !lastRequest.opts.headers['Authorization']);
pass &= check('system 为顶层字段', typeof lastRequest.body.system === 'string' && lastRequest.body.system.includes('证据分级'));
pass &= check('messages 不含 system 角色', lastRequest.body.messages.every(m => m.role !== 'system'));
pass &= check('文本拼装正确', b.full === '行业分析', JSON.stringify(b.full));
pass &= check('usage 解析正确', S('inputTokens') === 13 && S('outputTokens') === 9,
    `in=${S('inputTokens')} out=${S('outputTokens')}`);

console.log('');
console.log('=== C. 第三方中转（非 anthropic 域名 → 自动切 Bearer）===');
const c = await run('anthropic', 'claude-sonnet-5', 'https://relay.example.com', anthropicChunks);
pass &= check('自动切换到 Bearer',
    lastRequest.opts.headers['Authorization'] === 'Bearer sk-test-key' && !lastRequest.opts.headers['x-api-key']);

console.log('');
console.log('=== D. 代理模式（应带 x-upstream-base 且打到代理地址）===');
vm.runInContext(`state.proxy = 'http://localhost:8787';`, ctx);
const d = await run('openai', 'deepseek-chat', 'https://api.deepseek.com', openaiChunks);
pass &= check('请求发往代理', lastRequest.url === 'http://localhost:8787/v1/chat/completions', lastRequest.url);
pass &= check('携带 x-upstream-base',
    lastRequest.opts.headers['x-upstream-base'] === 'https://api.deepseek.com');
vm.runInContext(`state.proxy = '';`, ctx);

console.log('');
console.log('=== E. 空响应应报错而不是静默成功 ===');
CHUNKS = ['data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n'];
vm.runInContext(`
    state.protocol='openai'; state.model='deepseek-chat';
    state.apiBase='https://api.deepseek.com'; state.apiKey='sk-test-key';
`, ctx);
let threw = null;
try {
    await vm.runInContext(`callClaude([{role:'user',content:'hi'}], ()=>{}, ()=>{})`, ctx);
} catch (e) { threw = e.message; }
pass &= check('空内容抛错', !!threw && threw.includes('空内容'), threw || '');

console.log('');
console.log(pass ? '★★★★★ 全部通过' : '❌ 存在失败项');
process.exit(pass ? 0 : 1);
