# -*- coding: utf-8 -*-
"""
给行业分析工作台注入「作品集演示模式」：
  1) 首屏说明卡 —— 让面试官知道这是什么、怎么试
  2) 演示模式 —— 不填 API Key 也能看到完整输出质量（预置示例，明确标注）
  3) 保留真实调用能力 —— 自带 Key 可实际运行
源：G:\\industry-analysis-workbench\\index.html
目标：G:\\dsh\\行业分析工作台-演示版\\index.html
"""
import io, os, sys

SRC = r'G:\industry-analysis-workbench\index.html'
DST_DIR = r'G:\dsh\行业分析工作台-演示版'
DST = os.path.join(DST_DIR, 'index.html')

html = io.open(SRC, encoding='utf-8').read()
orig_len = len(html)

# ---------------- 1. CSS 注入 ----------------
CSS = u'''
    /* ===== 作品集演示模式样式 ===== */
    .intro-card {
        background: var(--bg-card);
        border-radius: 12px;
        padding: 28px;
        margin-bottom: 24px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        border-left: 4px solid var(--accent);
    }
    .intro-card h1 { font-size: 22px; margin-bottom: 6px; }
    .intro-card .sub { color: var(--text-secondary); font-size: 14px; margin-bottom: 20px; }
    .intro-card .grid {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
        gap: 14px;
        margin-bottom: 20px;
    }
    .intro-card .cell {
        background: var(--bg-primary);
        border-radius: 8px;
        padding: 14px;
    }
    .intro-card .cell .k { font-size: 12px; color: var(--text-secondary); margin-bottom: 6px; }
    .intro-card .cell .v { font-size: 14px; line-height: 1.6; }
    .intro-actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .intro-actions button {
        padding: 10px 22px;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 500;
        background: var(--accent);
        color: #fff;
    }
    .intro-actions button.ghost {
        background: transparent;
        color: var(--text-primary);
        border: 1px solid var(--border);
    }
    .intro-note {
        margin-top: 16px;
        font-size: 12px;
        color: var(--text-secondary);
        line-height: 1.7;
        border-top: 1px dashed var(--border);
        padding-top: 14px;
    }
    .demo-flag {
        display: inline-block;
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 999px;
        background: #ff922b;
        color: #fff;
        margin-left: 8px;
        vertical-align: middle;
    }
'''

anchor_css = u'    .modal {'
assert html.count(anchor_css) == 1, 'CSS 锚点不唯一'
html = html.replace(anchor_css, CSS + anchor_css, 1)

# ---------------- 2. HTML 注入：顶栏加演示按钮 ----------------
anchor_btn = u'<button id="settings-btn" class="secondary">⚙ 设置</button>'
assert html.count(anchor_btn) == 1, '顶栏锚点不唯一'
html = html.replace(
    anchor_btn,
    anchor_btn + u'\n        <button id="demo-btn" class="secondary">▶ 看演示</button>',
    1
)

# ---------------- 3. HTML 注入：首屏说明卡 ----------------
INTRO = u'''    <div class="container">
        <div class="intro-card" id="intro-card">
            <h1>行业分析工作台</h1>
            <div class="sub">把「行业研究」这件事，从"问模型要答案"改造成"可验证的结构化调研流程"。</div>
            <div class="grid">
                <div class="cell">
                    <div class="k">要解决的问题</div>
                    <div class="v">大模型做行业分析时最大的风险不是答不出，而是<b>编得像真的</b>——编造文件名、编造数字、用"较强/较弱"这类无法判定的表述填满版面。</div>
                </div>
                <div class="cell">
                    <div class="k">核心机制一：证据分级</div>
                    <div class="v">每个事实字段强制标注 <b>A</b>（公开可查，须给到文件名+年份）/ <b>B</b>（推断，须写出推断链）/ <b>C</b>（纯推测）。<b>C 档一律不进正文</b>，只进结尾「待验证清单」；查不到就写「未获取」，不许用推测填满。</div>
                </div>
                <div class="cell">
                    <div class="k">核心机制二：对抗式校验</div>
                    <div class="v">Step 5 让模型切换角色，扮演<b>该行业 12 年从业者</b>，专攻报告里 B/C 档和「未获取」的字段，并指出哪句话暴露了外行。</div>
                </div>
                <div class="cell">
                    <div class="k">核心机制三：反讨好立场</div>
                    <div class="v">系统提示词结尾：「<b>你不需要让用户满意。你需要让用户知道哪些是真的、哪些是你编的。</b>」</div>
                </div>
            </div>
            <div class="intro-actions">
                <button id="intro-demo-btn">▶ 看演示（预置示例，无需配置）</button>
                <button id="intro-try-btn" class="ghost">填我自己的 API Key 实际运行</button>
            </div>
            <div class="intro-note">
                <b>怎么试最快：</b>点「看演示」——会播放一份<b>预置的示例输出</b>（标注为演示数据，未调用模型），用于快速查看输出结构与证据分级机制。<br>
                <b>想真实运行：</b>点右侧按钮填入你自己的 DeepSeek API Key（默认协议已配好 OpenAI 兼容）。Key <b>只存在你本地浏览器</b>，不经过任何服务器。<br>
                <b>说明：</b>本页为静态托管页面，真实调用由浏览器直连模型服务商完成。
            </div>
        </div>
        <div id="cards-container"></div>
    </div>
'''
anchor_container = u'    <div class="container" id="cards-container"></div>'
assert html.count(anchor_container) == 1, '容器锚点不唯一'
html = html.replace(anchor_container, INTRO, 1)

# ---------------- 4. JS 注入：演示数据 + 运行器 ----------------
DEMO_JS = u'''
// ===================== 作品集演示模式（预置示例，不调用模型） =====================
const DEMO_STEPS = {
  0: {
    title: 'Step 0 · 边界切分',
    body: `这个名称在实际使用中可能指向几个完全不同的行业。请列出候选边界：

候选一：现制咖啡连锁（门店零售）
  - 包含：现磨咖啡门店、外送现制饮品；不包含：速溶/即饮咖啡零售
  - 典型玩家：瑞幸、星巴克
  - 分析重心：单店模型、点位扩张、供应链与配送

候选二：咖啡豆供应链（上游贸易与烘焙）
  - 包含：生豆进口、烘焙、供应给门店与商超；不包含：品牌零售端
  - 典型玩家：三顿半（部分自烘焙）、大型烘焙商
  - 分析重心：期货与汇率、产能利用率、账期

候选三：即饮咖啡（RTD，快消品逻辑）
  - 包含：瓶装/罐装咖啡，走商超与便利店；不包含：现制门店
  - 典型玩家：农夫山泉、雀巢
  - 分析重心：渠道铺货、货架争夺、经销商体系

三个候选的产业链结构差异明显（门店运营 / 大宗贸易 / 快消分销），切分有效。
请选择其一。`
  },
  1: {
    title: 'Step 1 · 结构层（产业链分层表）',
    body: `层级 | 这一环干什么 | 代表公司 | 它靠什么赚钱 | 收入确认时点 | evidence

上游种植 | 咖啡豆种植与初加工 | 产地合作社 | 按量（生豆吨价，赚差价） | 发货时 | B（未获取具体合作社财报）
生豆贸易 | 进口、仓储、分级 | 贸易商 | 赚差价 + 赚账期 | 发货时 | B
烘焙加工 | 烘焙、拼配、包装 | 自建烘焙厂/第三方 | 按件（代工费）或自用降本 | 发货时 | B
品牌与门店运营 | 选址、开店、出品、营销 | 瑞幸、星巴克 | 按件（杯）+ 抽佣（联营） | 回款时（先收后付） | A（瑞幸 2022Q2 财报：直营 4968 家、联营 2227 家）
配送履约 | 外卖履约、自有配送 | 第三方平台 + 自建 | 抽佣 / 按单 | 验收时 | B

【这条链的特殊之处】
与标准餐饮链相比：**门店这一环的收入确认是"先收后付"**，用户在 App 下单即付款，而门店对上游是账期采购——这条链最特殊的地方是**品牌方同时握有正现金流和上游账期**，形成类金融的现金池。

【我可能画错的地方】
1. 上中下游的边界我按"是否自有产能"划分，但头部品牌大多混合，严格分层可能失真
2. 把配送履约单列一层——在部分品牌里它是成本中心而非独立环节
3. evidence 多为 B 档，缺少可引用的一手文件`
  },
  2: {
    title: 'Step 2 · 三条流转链',
    body: `【钱流】从用户支付的 100 元开始
用户 → 品牌方（App 收款） | 平台抽佣约 15-20% | 账期即时（预付） | 品牌方不垫钱 | B
品牌方 → 门店（联营） | 毛利分配，联营方约分得 50% 左右毛利 | 月结 | 联营方先垫人力租金 | B
品牌方 → 生豆贸易商 | 采购成本，约 10-15% 营收 | 账期 30-90 天 | 品牌方占账期优势 | B
品牌方 → 烘焙/自建工厂 | 内部结算 | — | 自有产能不产生外部账期 | C
品牌方 → 外卖平台 | 配送与佣金 | 按单结算 | — | B

账期关键：**用户预付、上游账期**——品牌方在两端同时占优，这是现金流的真实来源。

【货流/服务交付流】
咖啡豆（产地）→ 贸易商仓储 → 烘焙厂 → 中心仓 → 门店 → 用户
控制权：品牌方掌握从烘焙到门店的全程控制权
损耗责任：生鲜豆由贸易商承担运输损耗，门店端损耗由门店承担
时间：产地到门店通常数周至数月（证据：未获取具体批次周期）

【用户流】
获客渠道：App 首单补贴、写字楼/商场自然流量、企微社群、裂变券
决策者 / 付钱者 / 使用者：**三者同为一人**（与 toB 供应链采购明显不同——这是 C 端生意）
复购触发：日常提神需求 + 券包有效期驱动

【三条链的错位】
错位一：**联营门店承担人力与租金（垫资），但收入和用户数据握在品牌方手里**——成本在联营方，资产在品牌方。
错位二：**外卖平台碰单不碰货**，掌握流量与用户触达，但不承担出品质量责任。`
  },
  3: {
    title: 'Step 3 · 议价能力',
    body: `1. 供应商议价
   问：换掉最大的生豆供应商需要多久？
   → 未获取。可替代供应商数量：未获取。需重新认证吗：未获取。
   （此项只能给 C 档，故不进正文结论）

2. 客户议价
   问：客户从这一品牌切换到竞品，要付出什么代价？
   → **基本无代价**。券包余额可放弃、口味无迁移成本、App 可并存。
   结论：**单店面对 C 端客户的议价权为零**。品牌力只影响"选择概率"，不影响"切换成本"。

3. 替代品威胁
   问：上一次被另一种形态吃掉是什么时候？
   → 即饮咖啡与现制咖啡长期并存而非替代；现制咖啡自身也在被茶饮（新式茶饮）争夺同一消费场景与点位。
   （具体份额变化数字：未获取）

4. 新进入者
   挡住新人的是：**规模成本 + 渠道关系**（点名，不全选）
   → 一个有钱有人的新玩家，从零到能接单：核心约束是**优质点位已被抢占**，而非资金或技术。
   （具体月数：未获取）

5. 同业竞争
   现有玩家分层：按**价格带**（9.9 元 / 20-30 元 / 35 元以上）与**点位类型**（写字楼 vs 商场）错开。
   最近三年价格战次数：未获取；发起方：未获取。

【综合结论】
利润最终沉淀在**具备规模与自有供应链的品牌方**这一环。论证：客户议价权为零（第 2 问）→ 品牌端对 C 端有定价权；新进入者最大障碍是点位（第 4 问）→ 先发者的点位即壁垒；供应商端数据缺失，此项不参与论证（第 1 问为 C 档）。

【最脆弱的一环】
**外卖履约环节**的议价权最易被削弱。触发条件：平台佣金上调或自建配送成本上升。
标注：C 档——这是我的推测，依据是平台-商家关系中平台通常掌握流量分配权。`
  },
  4: {
    title: 'Step 4 · 约束 / 节奏 / 异常',
    body: `本步骤不输出结论，只输出「我猜是这样 + 怎么验证 + 该问谁」。

【约束｜这个行业不能做的事】
假设 | 如果成立会导致什么 | 怎么验证 | 该问谁
食品经营许可与属地监管差异 | 跨城扩张时每个城市的证照与检查口径不同，直接影响开店周期 | 查目标城市的食品经营许可办理时长 | 已开店城市的门店运营负责人
鲜奶/生豆的效期约束 | 配送半径被压缩，中心仓布局成为硬约束 | 问供应链负责人单批次效期与配送半径 | 供应链负责人
点位租约的排他条款 | 商场/写字楼可能禁止同类品牌入驻，先到者锁定优质点位 | 调取已签租约的排他条款 | 拓展（选址）负责人
（外行不会想到的一条）**门店用电增容** | 高峰期多台咖啡机同时运行，老楼电力容量不足会限制单店产能上限 | 问工程/营建负责人单店电力报装 | 营建负责人

【节奏｜这个行业按什么周期运转】
旺淡季 | 夏季冰饮与冬季热饮的产品结构差异明显，影响备货与人力排班 | 对比同一门店 12 个月杯量曲线 | 区域运营负责人
预算审批窗口 | 商场招商通常有固定档期，错过则需等下一轮 | 问拓展负责人招商节奏 | 拓展负责人
（外行最典型的失败）**在错误的时点开店**——赶在淡季开业，首月数据差会被误判为"点位不行"，从而错误关店

【异常｜看到什么意味着出事了】
1. 如果**单店杯量下滑但同商圈竞品杯量上升**同时发生，在你们行业里通常意味着什么？
2. 如果**外卖占比持续上升而堂食占比下降**同时发生，通常意味着什么？
3. 如果**券包核销率上升但客单价下降**同时发生，通常意味着什么？
4. 如果**原材料成本下降但毛利率没改善**同时发生，通常意味着什么？
5. 如果**新店首月数据好、第三个月转差**同时发生，通常意味着什么？
6. 如果**同一商圈内本品牌两家店互相分流**同时发生，通常意味着什么？
7. 如果**店员工时增加但出品杯数未增加**同时发生，通常意味着什么？
8. 如果**租金占比被动上升**同时发生，通常意味着什么？

【你还不知道的 10 件事】
1. 单店真实的盈亏平衡杯量是多少（按城市等级分层）
2. 联营模式下，联营方的实际回本周期分布
3. 外卖平台的实际综合抽佣率（含配送与营销）
4. 生豆采购的实际账期与锁价机制
5. 优质点位的排他条款覆盖率
6. 单店人力成本的峰谷差异有多大
7. 新品从研发到全国上架的实际周期
8. 关店决策的触发指标是什么、由谁决定
9. 门店损耗率的行业区间
10. 同一商圈内多店分流的容忍阈值`
  },
  5: {
    title: 'Step 5 · 从业者拷问（示例节选）',
    body: `【说明】以下是该步骤的角色扮演输出示例。它的行为规则被硬性约束为：不许说"很好的问题/你说得对/思路清晰"；只攻击 B、C 档字段与「未获取」栏；一次不超过 3 句。

从业者：你报告里写"单店面对 C 端客户议价权为零"——这句是你自己推的，还是有门店数据？
我先问个更前面的：你这三条链的钱流里，联营那部分毛利分配你标的是 B 档、写了个"约 50%"，这个数你从哪来的？
还有，你说新进入者最大障碍是"点位已被抢占"——那你怎么解释过去三年还有新品牌开出来了？

----------

【诊断（跳出角色）】

**哪几栏看起来填满了、其实是空的**
- Step 1 的「收入确认时点」整列几乎全是 B 档推断，没有一手依据
- Step 3 第 1 问「供应商议价」整栏是「未获取」——这意味着报告里关于"利润沉淀在品牌方"的论证，实际只由 2 个答案支撑，不是 5 个

**哪几处暴露了外行**
- 原句："约 50% 左右毛利" → 内行会说具体口径（是门店端毛利还是品牌端毛利？含不含配送？）
- 原句："优质点位已被抢占" → 内行会区分"租约排他"和"物理位置稀缺"，两者约束力完全不同
- 原句用"较强/较弱"的地方已按规则清除，但**仍用"约""通常"这类模糊量词替代了数字**——这是把不可判定表述换了个马甲

**如果只能再补 3 块知识**
1. 单店模型的真实分层数据（不同城市等级、不同点位类型的盈亏平衡杯量）
2. 联营模式的实际权利与义务划分（谁承担什么成本、数据归谁）
3. 外卖平台的实际抽佣结构（佣金 + 配送 + 营销的分项）`
  }
};

let demoRunning = false;

function demoDelay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function runDemo() {
    if (demoRunning) return;
    demoRunning = true;
    const introCard = document.getElementById('intro-card');

    // 清理旧内容
    document.getElementById('cards-container').innerHTML = '';
    const oldBanner = document.getElementById('demo-banner');
    if (oldBanner) oldBanner.remove();

    // 顶部演示标注
    const banner = document.createElement('div');
    banner.id = 'demo-banner';
    banner.className = 'card';
    banner.style.borderLeft = '4px solid #ff922b';
    banner.innerHTML = '<div class="card-title">演示模式<span class="demo-flag">预置示例 · 未调用模型</span></div>'
        + '<div class="card-content">以下内容是<b>预先准备好的示例输出</b>，用于展示产品的输出结构与证据分级机制，'
        + '不是实时生成结果。<br>真实使用请点「⚙ 设置」填入你自己的 API Key（默认已配 OpenAI 兼容协议）。'
        + '<br><br>示例主题：<b>咖啡连锁</b>（在 Step 0 选择"候选一：现制咖啡连锁"后的完整流程）</div>';
    document.getElementById('cards-container').appendChild(banner);
    banner.scrollIntoView({ behavior: 'smooth', block: 'start' });

    await demoDelay(700);

    for (let step = 0; step <= 5; step++) {
        const data = DEMO_STEPS[step];
        if (!data) continue;
        addCard(data.title, step);
        updateCardStatus(step, 'generating', '生成中...');
        await demoDelay(220);

        // 模拟逐字输出
        const contentEl = document.getElementById('content-' + step);
        const text = data.body;
        const chunk = 18;
        for (let i = 0; i < text.length; i += chunk) {
            contentEl.textContent += text.slice(i, i + chunk);
            await demoDelay(12);
        }
        updateCardStatus(step, 'completed', '完成（演示数据）');
        document.getElementById(step === 5 ? 'content-5' : 'status-' + step)
            .scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        await demoDelay(500);
    }

    // 演示结束提示
    const tail = document.createElement('div');
    tail.className = 'card';
    tail.style.borderLeft = '4px solid #5c7cfa';
    tail.innerHTML = '<div class="card-title">演示结束</div>'
        + '<div class="card-content">以上为预置示例。要真实运行：点「⚙ 设置」填 API Key → 关闭本页内容 → '
        + '在顶部输入行业名 → 开始分析。<br><br>'
        + '值得注意的三个设计点：<b>①</b> C 档内容被强制挡在正文外，只进「待验证清单」；'
        + '<b>②</b> 报告结尾必须列出「你还不知道的 10 件事」，不允许用推测把版面填满；'
        + '<b>③</b> Step 5 的角色被硬约束为不许恭维，只攻击低置信字段。</div>';
    document.getElementById('cards-container').appendChild(tail);
    tail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    demoRunning = false;
}
'''

anchor_js = u'// ===================== 事件绑定 ====================='
assert html.count(anchor_js) == 1, 'JS 锚点不唯一'
html = html.replace(anchor_js, DEMO_JS + u'\n' + anchor_js, 1)

# ---------------- 5. 事件绑定 ----------------
anchor_bind = u"document.getElementById('protocol-input').addEventListener('change', applyProtocolPlaceholders);"
assert html.count(anchor_bind) == 1, '绑定锚点不唯一'
html = html.replace(
    anchor_bind,
    anchor_bind + u'''
document.getElementById('demo-btn').addEventListener('click', runDemo);
document.getElementById('intro-demo-btn').addEventListener('click', runDemo);
document.getElementById('intro-try-btn').addEventListener('click', openSettings);
document.getElementById('start-btn').addEventListener('click', function () {
    const ic = document.getElementById('intro-card');
    if (ic) ic.style.display = 'none';
});''',
    1
)

# ---------------- 写出 ----------------
if not os.path.isdir(DST_DIR):
    os.makedirs(DST_DIR)
io.open(DST, 'w', encoding='utf-8').write(html)

print('源文件字符数 :', orig_len)
print('输出字符数   :', len(html))
print('新增字符数   :', len(html) - orig_len)
print('输出路径     :', DST)
