/* 资讯抓取层：政策文件、宏观数据、采购公告、财经快讯、舆情热度
 * 每个源独立失败、独立超时，一个挂了不影响其它源。
 * 抓的都是各站点公开的列表页与公开接口，20 分钟内存缓存，不做高频轮询。
 * 站点改版随时可能让某个源失效——所以 UI 会显示每个源的状态，并提供手动粘贴兜底。
 *
 * 实测（2026-09）：行业研究版的微博/抖音/36氪/B 站源与本场景无关；
 * gov.cn 政策搜索接口实际返回空 data，不可用，已弃用。
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const TIMEOUT = 12000;
const CACHE_TTL = 20 * 60 * 1000;
const PER_SOURCE = 20;

async function get(url, { headers = {}, method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    body,
    headers: { 'User-Agent': UA, 'Accept-Language': 'zh-CN,zh;q=0.9', ...headers },
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res;
}

const json = async (url, opts) => (await get(url, opts)).json();
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

/* 相对链接转绝对；转不出来就留空（总比给出一个坏链接好） */
const abs = (base, href) => {
  try { return new URL(href, base).href; } catch { return ''; }
};

/* 列表页噪声：导航、页脚、语言切换这类不是内容的锚点 */
const NOISE = /^(更多|更多>>|下一页|上一页|首页|返回|网站地图|联系我们|English Version|English|简体|繁体|登录|注册|无障碍)/;

/* 通用列表解析：抽标题锚点，按标题去重，长度和噪声都过滤 */
function anchors(html, { base, min = 12, max = 90, keep = null } = {}) {
  const out = [];
  const seen = new Set();
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{2,240}?)<\/a>/gi;

  let m;
  while ((m = re.exec(html))) {
    const title = clean(m[2].replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' '));
    if (!title || title.length < min || title.length > max) continue;
    if (NOISE.test(title) || seen.has(title)) continue;
    const url = abs(base, m[1]);
    if (keep && !keep(title, url)) continue;
    seen.add(title);
    out.push({ title, url, heat: null });
  }
  return out;
}

export const SOURCES = [
  {
    key: 'ndrc',
    label: '发改委·政策通知',
    kind: '政策',
    async fetch() {
      const base = 'https://www.ndrc.gov.cn/xxgk/zcfb/tz/';
      const html = await (await get(`${base}index.html`)).text();
      // 只留通知正文，去掉同一页里的解读与答记者问
      return anchors(html, { base, keep: (t, u) => u.includes('/tz/') });
    },
  },
  {
    key: 'mof',
    label: '财政部·政策发布',
    kind: '政策',
    async fetch() {
      const base = 'https://www.mof.gov.cn/zhengwuxinxi/zhengcefabu/';
      const html = await (await get(base)).text();
      return anchors(html, { base, keep: (t, u) => /mof\.gov\.cn/.test(u) });
    },
  },
  {
    key: 'pbc',
    label: '央行·政策与数据',
    kind: '政策',
    async fetch() {
      const base = 'http://www.pbc.gov.cn/goutongjiaoliu/113456/113469/';
      const html = await (await get(`${base}index.html`)).text();
      return anchors(html, { base, keep: (t, u) => u.includes('/113469/') });
    },
  },
  {
    key: 'stats',
    label: '国家统计局·最新发布',
    kind: '宏观数据',
    async fetch() {
      const base = 'https://www.stats.gov.cn/sj/zxfb/';
      const html = await (await get(base)).text();
      return anchors(html, { base, keep: (t, u) => u.includes('/zxfb/') });
    },
  },
  {
    key: 'ccgp',
    label: '中国政府采购网·要闻',
    kind: '采购招投标',
    async fetch() {
      const base = 'http://www.ccgp.gov.cn/';
      const html = await (await get(base)).text();
      return anchors(html, { base, keep: (t, u) => u.includes('/news/') });
    },
  },
  {
    key: 'sina',
    label: '新浪财经·7x24',
    kind: '财经快讯',
    async fetch() {
      const data = await json('https://zhibo.sina.com.cn/api/zhibo/feed?page=1&page_size=20&zhibo_id=152&tag_id=0');
      const list = data?.result?.data?.feed?.list || [];
      return list.map((it) => {
        const raw = clean(it.rich_text);
        const m = raw.match(/^【(.+?)】([\s\S]*)$/);   // 快讯正文就是「【标题】正文」
        const tag = clean((it.tags || []).map((t) => t.name).join('/'));
        return {
          title: clean(m ? m[1] : raw).slice(0, 90),
          url: '',
          heat: null,
          summary: clean(m ? m[2] : '').slice(0, 200) || undefined,
          tag: tag || '新浪财经',
        };
      });
    },
  },
  {
    key: 'eastmoney',
    label: '东方财富·快讯',
    kind: '财经快讯',
    async fetch() {
      const data = await json('https://np-listapi.eastmoney.com/comm/web/getNewsByColumns'
        + '?client=web&biz=web_news_col&column=350&order=1&needInteractData=0&page_index=1&page_size=20&req_trace=1');
      return (data?.data?.list || []).map((it) => ({
        title: clean(it.title || it.summary).slice(0, 90),
        url: it.url || it.uniqueUrl || '',
        heat: null,
        summary: clean(it.summary).slice(0, 200) || undefined,
        tag: clean(it.mediaName) || '东方财富',
      }));
    },
  },
  {
    key: 'toutiao',
    label: '今日头条·热榜',
    kind: '舆情热度',
    async fetch() {
      const data = await json('https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc');
      return (data?.data || []).map((it) => ({
        title: clean(it.Title),
        url: it.Url || '',
        heat: Number(it.HotValue) || null,
        tag: clean(it.Label),
      }));
    },
  },
];

/* ------------------------------------------------------------------ *
 * 不适合作为分析素材的资讯：代码层面直接过滤掉，不指望模型自觉
 * 提示词里也写了同样的红线，但实测模型会为了凑数越线，所以这里是硬闸门
 * ------------------------------------------------------------------ */

/* 政策/宏观/采购类标题里出现「违法」「处罚」是正常的（政策本身就在讲这些），
 * 只对这类源跳过「犯罪司法」与「点名争议」两条规则，其余规则照常生效。 */
const LENIENT_KINDS = new Set(['政策', '宏观数据', '采购招投标']);

export const RISK_RULES = [
  { key: 'casualty', label: '伤亡灾难',
    re: /(死|亡故|身亡|遇难|殒命|丧生|失联|失踪|坠(机|楼|亡|海)|跳楼|轻生|自杀|地震|台风|暴雨|洪水|山洪|泥石流|山火|火灾|爆炸|坍塌|车祸|事故|遇险|抢救|病危|重伤|殉职|去世|逝世|讣告|哀悼)/ },
  { key: 'crime', label: '犯罪司法', skipLenient: true,
    re: /(判处|判刑|获刑|无期|死缓|逮捕|被捕|落网|刑拘|拘留|嫌疑|涉嫌|诈骗|性侵|猥亵|强奸|家暴|虐待|涉毒|贩毒|受贿|贪污|落马|双开|通缉|案发|命案|凶手|遇害|黑产|卖淫|嫖|代孕)/ },
  { key: 'conflict', label: '战争政治冲突',
    re: /(轰炸|空袭|开战|战争|导弹|停火|交火|政变|示威|抗议游行|冲突升级|军事打击|难民)/ },
  { key: 'health', label: '疫病健康危机',
    re: /(疫情|确诊|感染者|病例|中毒|致癌|猝死|艾滋|传染)/ },
  { key: 'dispute', label: '点名到个人的争议', skipLenient: true,
    re: /(道歉|开撕|互撕|怒斥|痛斥|怒怼|喊话|叫板|回怼|封杀|塌房|翻车|再曝|被曝|出轨)/ },
  { key: 'gossip', label: '娱乐明星私事',
    re: /(恋情|分手|离婚|领证|绯闻|官宣|复合|怀孕|生子|产子|亲密照|同框|开房|情人)/ },
];

export function riskOf(title, kind = '') {
  const t = String(title || '');
  const lenient = LENIENT_KINDS.has(kind);
  for (const rule of RISK_RULES) {
    if (lenient && rule.skipLenient) continue;
    if (rule.re.test(t)) return rule;
  }
  return null;
}

/* 交给模型之前先筛一遍；返回留下的和被挡掉的 */
export function screenItems(items) {
  const kept = [];
  const blocked = [];
  for (const it of items) {
    const risk = riskOf(it.title, it.kind || it.sourceKind || '');
    if (risk) blocked.push({ ...it, risk: risk.label, riskKey: risk.key });
    else kept.push(it);
  }
  return { kept, blocked };
}

let cache = null;

/* 抓全部源：每个源独立成败，全挂了才算失败 */
export async function fetchBoards({ force = false } = {}) {
  if (!force && cache && Date.now() - cache.at < CACHE_TTL) return { ...cache, cached: true };

  const results = await Promise.all(SOURCES.map(async (src) => {
    try {
      const items = (await src.fetch())
        .filter((it) => it.title)
        .slice(0, PER_SOURCE)
        .map((it, i) => ({ ...it, rank: i + 1, source: src.key, platform: src.label, kind: src.kind }));
      if (!items.length) throw new Error('返回为空');
      return { key: src.key, label: src.label, kind: src.kind, ok: true, count: items.length, items };
    } catch (err) {
      return {
        key: src.key, label: src.label, kind: src.kind, ok: false, count: 0, items: [],
        error: err?.name === 'TimeoutError' ? '超时' : String(err?.message || err).slice(0, 80),
      };
    }
  }));

  const boards = {
    at: Date.now(),
    sources: results.map(({ items, ...rest }) => rest),
    items: results.flatMap((r) => r.items),
  };
  if (!boards.items.length) {
    const why = boards.sources.map((s) => `${s.label}：${s.error}`).join('；');
    throw new Error(`所有资讯源都没抓到内容（${why}）`);
  }
  cache = boards;
  return { ...boards, cached: false };
}

/* 手动兜底：用户自己粘一份清单，一行一条 */
export function parseManual(text) {
  return String(text || '')
    .split('\n')
    .map((line) => clean(line).replace(/^\d+[.、)\s]+/, ''))
    .filter((t) => t.length >= 4 && t.length <= 120)
    .slice(0, 60)
    .map((title, i) => ({
      title, url: '', heat: null, rank: i + 1,
      source: 'manual', platform: '手动粘贴', kind: '自定义',
    }));
}

/* ------------------------------------------------------------------ *
 * 原文概要
 * 现实是：政策站点与财经门户大多有反爬或要 JS，正文经常抓不到。
 * 所以这里分三种来源，如实标注，绝不用模型脑补的"背景"冒充概要：
 *   board   接口自带的摘要（新浪 7x24、东方财富快讯有）
 *   article 真抓到了原文正文，再交给模型压成概要
 *   none    只有标题——界面上直说，让用户自己点原文看
 * ------------------------------------------------------------------ */

const SEARCH_PAGE = /(^https?:\/\/(s\.weibo\.com|www\.baidu\.com\/s|www\.douyin\.com\/search|sousuo\.www\.gov\.cn))/;
const MIN_ARTICLE = 220;
const MAX_FETCH = 3;

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* 抓到的是不是真正文——反爬页、验证页都很短且有特征词 */
function looksLikeArticle(text) {
  if (text.length < MIN_ARTICLE) return false;
  return !/(安全检测|安全验证|网络不给力|需要允许该网站执行|请开启 ?JavaScript|访问验证|滑动验证)/.test(text.slice(0, 400));
}

export async function fetchArticle(url) {
  if (!url || SEARCH_PAGE.test(url)) return null;
  try {
    const res = await get(url, { headers: { Accept: 'text/html' } });
    const text = extractText(await res.text());
    return looksLikeArticle(text) ? text.slice(0, 6000) : null;
  } catch {
    return null;
  }
}

/* 给命中的几条资讯补概要；summarize 由调用方注入（避免这层依赖 llm.js） */
export async function enrichSummaries(items, summarize) {
  let budget = MAX_FETCH;

  return Promise.all(items.map(async (it) => {
    const own = String(it.summary || '').trim();
    if (own.length >= 40) {
      return { ...it, summary: own.slice(0, 400), summarySource: 'board' };
    }
    if (budget <= 0) return { ...it, summary: '', summarySource: 'none' };
    budget -= 1;

    const body = await fetchArticle(it.url);
    if (!body) return { ...it, summary: '', summarySource: 'none' };
    try {
      const digest = (await summarize(it.title, body) || '').trim();
      return digest
        ? { ...it, summary: digest.slice(0, 400), summarySource: 'article' }
        : { ...it, summary: '', summarySource: 'none' };
    } catch {
      return { ...it, summary: '', summarySource: 'none' };
    }
  }));
}
