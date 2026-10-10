/* 报告体裁/风格预设与提示词构造 —— 系统的“产品知识”都集中在这里 */

export const PLATFORMS = {
  industry: {
    label: '行业研究报告',
    length: 3000,
    spec: `行业研究报告。开篇一段「核心判断」——把最重要的结论先说完，再展开依据；
正文分 3-6 节，每节一个小标题，节内**先给结论再给论证**，不要写成资料汇编；
每个关键判断都要给支撑依据（数据、政策条款、案例），并写明数据的**口径、时间与来源**；
必须有一节讲**风险与不确定性**，给出判断成立的条件和可能证伪的信号；
结尾可以给建议，但要写清责任方、时间与判断标准；必要时给出「参考来源」清单。
不写第一人称抒情，不用 emoji，不用「你知道吗」式钩子，也不要出现没有出处的「据报道」。`,
  },
  competitive: {
    label: '竞争分析简报',
    length: 1200,
    spec: `竞争分析简报。开头一句话给竞争格局的判断；正文分节讲玩家分层（头部/腰部/新进入）、
关键竞争维度（价格、渠道、技术、生态、客户关系）、份额与声量的区别，以及最近发生的格局变化与驱动因素；
每个结论后面紧跟依据；用对照表组织可比信息；篇幅紧凑，不铺陈行业背景。`,
  },
  policy: {
    label: '政策解读',
    length: 1500,
    spec: `政策解读。开头点明政策名称、发文机关、发文字号与发布时间，并给出一句核心影响判断；
正文分节：关键条款要点 → 与上一版或相关政策的差异 → 对目标主体的具体影响（业务、资质、成本、时间表）→
执行口径上的不确定之处。引用条款要准确，区分**已生效**与**征求意见稿**，不做超出文本的推断。`,
  },
  invest: {
    label: '投资/立项备忘录',
    length: 2000,
    spec: `投资或立项备忘录。结构：结论与建议 → 市场与规模（含测算口径与假设）→ 竞争与壁垒 →
单位经济性或关键指标 → 主要风险与敏感性 → 还需要验证的问题。
所有数字必须给出**测算口径、假设与来源**；没有依据的要标注为「假设」，不能写成事实；
结论要写明成立条件与反例。`,
  },
  market: {
    label: '市场进入评估',
    length: 1800,
    spec: `市场进入评估。回答「该不该进、怎么进、什么时候进」：
市场规模与增速（口径+来源）→ 客户与需求结构 → 竞争与替代方案 → 准入与合规门槛（牌照、资质、数据）→
进入路径与资源需求 → 关键假设与验证方式。全文区分事实、推算与假设，逐条标明。`,
  },
  briefing: {
    label: '高层汇报摘要',
    length: 800,
    spec: `高层汇报摘要。一页纸：开头 3-5 句给出结论与建议；
正文用「结论 / 依据 / 影响 / 建议动作」四段式，每段 2-4 句，能直接念出来；
只保留决策需要的数字，每个数字标口径与时间；最后列出需要决策的问题与备选方案。
不写背景铺垫，不重复过程，不堆术语。`,
  },
};

export const TONES = {
  客观中立: '不预设立场，正反证据都给，判断留有余地，避免情绪化措辞。',
  结论先行: '开门见山给结论与建议，再补依据；每节第一句就是判断句。',
  数据严谨: '判断尽量落到可核查的数据上，标明口径、时间与来源；没有数据的地方直说是估算。',
  风险审慎: '优先提示不利情形与失效条件，宁可把话说得保守，也不夸大机会。',
  业务导向: '面向决策与落地，多讲影响、成本、时间与可执行动作，少讲学术框架。',
  高层摘要: '极简、去术语、结论与建议优先，一段话能讲完的不写两段。',
};

export const DEFAULT_PLATFORM = 'industry';
export const DEFAULT_TONE = '客观中立';

export const platformSpec = (key) => (PLATFORMS[key] || PLATFORMS[DEFAULT_PLATFORM]);
export const toneSpec = (key) => TONES[key] || TONES[DEFAULT_TONE];

/* 三个方向的 JSON 结构 —— Anthropic 走 output_config.format，其它渠道走提示词约束 */
export const TOPICS_SCHEMA = {
  type: 'object',
  properties: {
    topics: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          label: {
            type: 'string',
            description: '给这个分析角度定性的短标签，2-6 个字，如「市场规模」「竞争格局」「技术路线」「政策环境」「商业模式」「风险」。'
              + '三个角度的标签必须互不相同，且要能一眼看出差异在哪个维度上',
          },
          title: { type: 'string', description: '可直接使用的报告标题或小节标题，符合体裁规范' },
          angle: { type: 'string', description: '这个分析角度的切入方式，一句话说清和另外两个的区别。要具体到"它回答什么、另外两个不回答什么"' },
          hook: { type: 'string', description: '开篇的核心判断，一到两句，先给结论再展开' },
          outline: {
            type: 'array', minItems: 3, maxItems: 5,
            items: { type: 'string' },
            description: '3-5 条论证链，每条一个能支撑结论的要点，必要时附口径或来源',
          },
          audience_fit: { type: 'string', description: '这份角度最适合谁看（决策者/投资人/产品/合规）、为什么' },
        },
        required: ['label', 'title', 'angle', 'hook', 'outline', 'audience_fit'],
        additionalProperties: false,
      },
    },
  },
  required: ['topics'],
  additionalProperties: false,
};

export const GENDERS = ['券商研究所', '咨询公司', '产业方/企业战略', '投资机构', '独立研究', '高校/协会'];

/* 研究视角块：这份分析站在什么位置上做，决定判断口径与措辞分寸 */
const creatorBlock = (a) => {
  if (!a) return null;
  const years = String(a.creator_age || '').trim();
  const lines = [
    years ? `从业年限：${/^\d+$/.test(years) ? `${years} 年` : years}` : null,
    a.creator_gender ? `机构类型：${a.creator_gender}` : null,
    a.creator_industry ? `关注行业：${a.creator_industry}` : null,
    a.creator_role ? `研究岗位与职责：${a.creator_role}` : null,
    a.creator_traits ? `分析风格偏好：${a.creator_traits}` : null,
  ].filter(Boolean);
  if (!lines.length) return null;

  return `—— 研究视角（这份分析站在谁的位置上）——
${lines.join('\n')}

判断口径、指标选择与措辞分寸要符合这个视角：不同机构类型对数据的依赖程度、对风险的表述方式并不一样；
举例和类比优先取自关注行业里的真实场景，行文的严谨程度贴合分析风格偏好。
不要点名罗列这些设定，让它自然体现在选材、依据强度和结论的分寸里；
也不要给出与这个视角明显不符的判断（比如产业方视角却通篇投资口吻）。`;
};

/* 研究对象设定块：所有分析都以它为语境前提 */
const personaBlock = (a) => {
  if (!a) return null;
  const lines = [
    `主体名称：${a.name}`,
    a.content_focus ? `研究范围（主要研究什么）：${a.content_focus}` : null,
    a.audience ? `报告读者：${a.audience}` : null,
    a.problem ? `要回答的核心问题：${a.problem}` : null,
    a.notes ? `其它要求与口径禁忌：${a.notes}` : null,
  ].filter(Boolean);
  return `—— 研究对象设定 ——\n${lines.join('\n')}\n\n本次分析必须落在这个主体的研究范围之内：面向它声明的报告读者、回答它要回答的核心问题、遵守它写明的口径与禁忌；不要写成任何主体都能套用的通用报告。`;
};

const brief = (d, persona, samples) => {
  const p = platformSpec(d.platform);
  const account = personaBlock(persona);
  const creator = creatorBlock(persona);
  const style = styleBlock(persona, samples);
  const section = sectionBlock(d.section, d.inputs);
  const hot = hotspotRefBlock(d.hotspot);
  const head = [account, creator, style, section].filter(Boolean);
  return [
    head.join('\n\n') || null,
    hot ? `\n${hot}` : null,
    head.length || hot ? '\n—— 研究简报 ——' : null,
    `议题：${d.subject}`,
    `报告体裁：${p.label}`,
    `行文风格：${d.tone} —— ${toneSpec(d.tone)}`,
    // 和报告读者一字不差时不再重复一遍；不同才说明是本篇的收窄
    d.audience && d.audience !== persona?.audience
      ? `本篇聚焦读者：${d.audience}`
      : (persona?.audience ? null : '报告读者：由你根据议题判断'),
    d.keywords ? `必须覆盖的关键信息点：${d.keywords}` : null,
    `目标篇幅：约 ${d.length} 字`,
    `\n体裁规范：\n${p.spec}`,
  ].filter((x) => x != null).join('\n');
};

export const TOPICS_SYSTEM =
`你是一位行业研究主管，擅长把一个宽泛议题拆成几个真正不同的分析角度。
要求：
1. 三个角度必须在「分析维度」上互相错开——比如市场规模 / 竞争格局 / 技术路线 / 政策环境 / 商业模式 / 风险与不确定性，
   不要只是换标题措辞，也不要三个都在讲同一个维度。
   **label 就是这个维度的名字**，2-6 字，三个必须互不相同。
   **angle 要说清"它回答什么、另外两个不回答什么"**——读者是靠这一句来挑的，写成套话等于三个角度没区别。
2. 标题写成可以直接用作报告标题或小节标题的样子，不要出现「角度一」这类元描述。
3. 开篇的核心判断必须具体：给方向、量级、条件或对比，禁止「值得关注」「前景广阔」这类套话。
   **没有可核查依据时，写成待验证的假设，不要写成已然成立的事实。**
4. 论证链每条都要能落成一段实质论证，并尽量带上口径、时间或来源；不要写空泛的小标题。
5. 若给出了研究对象设定，三个角度都必须服务于它的研究范围和要回答的核心问题——差异体现在分析维度上，而不是跑到范围之外去。
6. 若指定了章节，三个角度都必须是这个章节该有的样子——「风险与不确定性」就不该写成市场规模的乐观推算。
7. 全部使用简体中文，术语用中文表述并首次出现时给英文或缩写。`;

export const topicsUser = (d, persona, samples) =>
`请基于下面这份研究简报，给出 3 个差异化的分析角度。

${brief(d, persona, samples)}`;

export const CONTENT_SYSTEM =
`你是一位资深行业分析师，为指定体裁产出可以直接交付的研究报告。
要求：
1. **结论先行**。每节第一句就是判断句，先给结论，再给依据；不要写成资料汇编或背景综述。
2. 严格遵守体裁规范与行文风格。结构清晰、层级分明，不铺垫、不抒情、不用 emoji，也不写「你知道吗」这类钩子。
3. **数据必须有口径**：每个具体数字都要说明时间范围、统计范围与来源；是估算、推算还是原始数据要写清楚。
   拿不到依据的地方，用区间、方向或定性表述（如「约」「量级在」），**绝不编造具体数字、机构名、条款号或他人引语**。
   不确定的推断要显式标注为「假设」并说明验证方式。
4. 每个主要判断都要给出**成立条件**；报告里必须出现反例或证伪信号，也要承认信息的缺口。
5. 若给出了研究对象设定，全文的立场、口径、术语密度和判断分寸都要贴合它的报告读者与核心问题，并遵守写明的禁忌。
   若给出了研究视角，判断口径与措辞分寸要符合这个视角。
6. 不要出现「作为一个 AI」「以下是」这类元话语，不要写解释性前言，直接从报告正文开始。
7. 输出 Markdown：第一行是 # 标题，正文用 ## 分节；表格用 Markdown 表格；需要图示时给出图表说明而不是画图。
8. 全部使用简体中文，术语用中文表述，首次出现时可附英文或缩写。`;

export const contentUser = (d, topic, persona, samples, materials = []) =>
`按下面选定的分析角度写出完整报告。

${brief(d, persona, samples)}
${materialsBlock(materials) ? `\n${materialsBlock(materials)}\n` : ''}

—— 选定的分析角度 ——
标题：${topic.title}
切入方式：${topic.angle}
核心判断：${topic.hook}
适合谁看：${topic.audience_fit || ''}
论证链：
${(topic.outline || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}

请沿用这个角度和论证链展开，可以在骨架基础上补充依据、数据口径和过渡，但不要改变核心判断。`;

/* ==================================================================
 * 行文学习：用户确认后喂进来的报告 → 蒸馏成行文档案 → 回灌到后续撰写
 * ================================================================== */

export const DIGEST_SYSTEM =
`你是一位研究报告的风格分析师。给你同一个主体（或同一位作者）的几篇报告，你要总结出**可复制的写法**，
让另一个人照着写也能保持一致。要求：
1. 只写观察得到的、可执行的特征，不要评价好坏，不要复述报告内容。
2. 覆盖这几方面：结论出现的位置与句式、分节习惯与标题写法、论证如何展开、
   数据与来源的引用方式、限定语与不确定性表述的用法、术语密度、表格与图表的使用习惯、
   明显回避的表达（如绝对化措辞）。
3. 每条一行，用「- 」开头，具体到可以照做（例：「- 每节第一句是判断句，随后两句给依据」
   优于「- 结论先行」）。总共 8-14 条。
4. 若某方面样本里看不出稳定规律，就不要写，不要硬凑。
5. 全部使用简体中文，直接输出条目，不要标题和前言。`;

export const digestUser = (samples) =>
`以下是同一个主体的 ${samples.length} 篇报告，请总结其写作习惯。

${samples.map((s, i) => `===== 样本 ${i + 1}${s.title ? `：${s.title}` : ''} =====\n${s.content}`).join('\n\n')}`;

/* 注入撰写提示词的语气块：档案为主，附少量片段做语感锚点 */
const styleBlock = (persona, samples = []) => {
  const digest = String(persona?.style_digest || '').trim();
  if (!digest) return null;

  const excerpts = samples.slice(0, 2)
    .map((s, i) => `${i + 1}. ${s.content.slice(0, 220).replace(/\n+/g, ' ')}……`)
    .join('\n');

  return `—— 这个主体的行文档案（从确认过的历史报告里学到的）——
${digest}
${excerpts ? `\n历史片段（只模仿写法与口径，不要复用其中的结论、数据和例子）：\n${excerpts}` : ''}
写作时优先服从这份行文档案：它比通用的行文风格更能代表这个主体真实的写法。`;
};

/* ==================================================================
 * 编辑器里的 AI：划词改写 与 / 唤起续写
 * ================================================================== */

export const ASSIST_ACTIONS = {
  expand:       { label: '扩写论证',     mode: 'replace', instruction: '把选中这段的论证展开：补上依据、机制、适用条件或推导过程，长度约为原来的 2 倍。不要注水式重复，也不要改变原有判断。' },
  professional: { label: '更严谨',       mode: 'replace', instruction: '把选中这段改得更严谨：术语准确，补上限定条件与口径，去掉绝对化措辞和空泛形容词。长度不要明显增加。' },
  casual:       { label: '更通俗',       mode: 'replace', instruction: '把选中这段改写给非专业读者：拆开长句，术语先给一句白话解释，必要时打一个贴切的比方。判断和数字一个都不能丢，长度不要明显增加。' },
  shorten:      { label: '压缩成要点',   mode: 'replace', instruction: '把选中这段压缩到原来的四到六成，只保留判断和关键依据，可以改成短句或分点。不要丢掉口径与限定条件。' },
  example:      { label: '补个佐证',     mode: 'append',  instruction: '为选中这段补一条能支撑它的佐证：案例、数据或政策条款，并说明来源与口径。只输出这条佐证本身（一到两段），不要重复原文。**没有可核查的出处的，就如实写成待验证的假设，绝对不要编造数字、机构名或他人引语。**' },
  simplify:     { label: '更好懂',       mode: 'replace', instruction: '把选中这段写得更易懂：拆开长句，把抽象概念换成具体说法，必要时打一个贴切的比方。信息与口径不能丢，长度可以略增。' },
};

export const COMPOSE_ACTIONS = {
  continue: { label: '续写这一段', instruction: '顺着光标前面的内容往下写一到两段，自然衔接，继续给出依据或展开论证，不要重复已有内容。' },
  heading:  { label: '加个小标题', instruction: '为光标后面的内容写一个小标题。只输出标题本身（含 Markdown 的 ## 前缀），用判断句或名词短语，不要写正文。' },
  ending:   { label: '写个结论',   instruction: '为这份报告写一段结论：收束核心判断，写清成立条件、需要进一步验证的问题，以及下一步建议动作（谁、何时、判断标准）。' },
  opening:  { label: '写个摘要',   instruction: '为这份报告写一段摘要：三到五行，先给核心判断与建议，再给最关键的两三条依据，并标明数据的口径与时间。' },
};

export const ASSIST_SYSTEM =
`你是这位研究者的报告助手，在他的编辑器里就地改写或续写。铁律：
1. **只输出正文本身**——不要解释、不要前言后语、不要加引号或代码块标记。
2. 你的输出会**逐字替换掉选中的那一段**，所以边界必须严格对齐：
   - 绝不能把上文或下文里已经存在的内容（尤其是小标题）抄进输出；
   - 选区是半句话就还它半句话，选区是一段就还它一段——**输出的粒度和体量跟着选区走**；
   - 不要顺手改写选区之外的内容，哪怕你觉得那里写得不好。
3. 输出要和上下文严丝合缝：承接上文的口径、术语和论证线索，不与下文重复。
4. **事实层不许动**：原文里的数字、时间、机构名、条款、案例一个都不能改、不能编。
   要补充依据时，只补可核查的；没有出处的就写成待验证的假设。
5. 保持这个主体一贯的写法；给了行文档案就优先服从它。
6. 除非另有要求，输出 Markdown 正文片段，使用简体中文。`;

const contextBlock = (d, persona, samples) => [
  personaBlock(persona),
  creatorBlock(persona),
  styleBlock(persona, samples),
  `—— 这份报告 ——\n议题：${d.subject}\n报告体裁：${platformSpec(d.platform).label}\n行文风格：${d.tone}${d.title ? `\n标题：${d.title}` : ''}`,
  `体裁规范：\n${platformSpec(d.platform).spec}`,
].filter(Boolean).join('\n\n');

/* 划词改写 */
export const assistUser = (d, persona, samples, { instruction, selection, before, after }) =>
`${contextBlock(d, persona, samples)}

—— 选中的这段 ——
${selection}

—— 它上文的结尾 ——
${before || '（这段就在文章开头）'}

—— 它下文的开头 ——
${after || '（这段就在文章结尾）'}

—— 你要做的 ——
${instruction}
${selection.length < 40 ? `\n注意：选区只有 ${selection.length} 个字，是一个片段而不是完整段落。输出也必须是同一量级的片段，不要扩展成整段或整节。` : ''}`;

/* / 唤起的就地续写 */
export const composeUser = (d, persona, samples, { instruction, before, after }) =>
`${contextBlock(d, persona, samples)}

—— 光标前面已经写好的内容 ——
${before || '（光标在文章最开头）'}

—— 光标后面已有的内容 ——
${after || '（光标在文章最末尾）'}

—— 你要做的 ——
${instruction}`;

/* ==================================================================
 * 议题推荐：进入研究简报时默认给三条这个号还没写过的议题
 * ================================================================== */

export const SUBJECTS_SCHEMA = {
  type: 'object',
  properties: {
    ideas: {
      type: 'array', minItems: 3, maxItems: 3,
      items: {
        type: 'object',
        properties: {
          subject: { type: 'string', description: '一句话的研究议题，就是「这份报告写什么」，15-30 字，不是标题' },
          reason: { type: 'string', description: '一句话说明为什么现在适合做这个议题，20 字以内' },
        },
        required: ['subject', 'reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['ideas'],
  additionalProperties: false,
};

export const SUBJECTS_SYSTEM =
`你是这个研究主体的议题策划。给你主体的研究范围、读者和它已经做过的报告，你要提出三条**还没做过的新议题**。
要求：
1. 「议题」是「这份报告研究什么」的范围，不是标题——别写成带钩子的标题党句子，也别写成空泛的大词（如「聊聊趋势」）。
2. 三条必须落在研究范围之内：面向它声明的读者、回应它要回答的核心问题；同时三条之间在**研究主题**上要明显错开，
   不要是同一件事的三种说法（分析维度的差异是下一步的事，这里要的是三个不同的题目）。
3. **严格避开已做过的清单**：不只是字面不同，实质主题重合的也不行；换个说法重提旧事就换一个。
4. 优先挑**现在真的有决策价值**的议题：有政策变化、有数据可查、有事件触发，比泛泛的行业综述好。
5. 每条配一句话理由，说清"为什么是现在"，别写"值得关注"这类套话。
6. 全部使用简体中文。`;

export const subjectsUser = (persona, used = []) => {
  const head = [personaBlock(persona), creatorBlock(persona)].filter(Boolean).join('\n\n');
  const history = used.length
    ? used.map((u, i) => `${i + 1}. ${u.subject}${u.title && u.title !== u.subject ? `（报告标题：${u.title}）` : ''}`).join('\n')
    : '（这个主体还没有做过任何报告）';

  return `${head}

—— 已经做过的议题（务必避开）——
${history}

请给出 3 条还没做过的新议题。`;
};

/* ==================================================================
 * 资讯比对：把榜单和研究对象定位放一起，挑出真能蹭的
 * ================================================================== */

export const HOTSPOT_SCHEMA = {
  type: 'object',
  properties: {
    matches: {
      type: 'array', minItems: 0, maxItems: 5,
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: '榜单列表里的编号，必须原样引用' },
          source_title: { type: 'string', description: '该条资讯的原标题，逐字照抄' },
          angle: { type: 'string', description: '这条资讯对本主体的意义：它改变了什么、影响到谁，一到两句说清，必须基于标题/摘要字面给出的信息' },
          subject: { type: 'string', description: '议题建议：一句可以直接开做的研究议题，15-30 字' },
          strength: { type: 'string', enum: ['强', '中', '弱'], description: '影响强度' },
          caution: { type: 'string', description: '引用时需要注意的口径或分寸（原文没给细节、只是征求意见稿等）；没有就留空字符串' },
        },
        required: ['index', 'source_title', 'angle', 'subject', 'strength', 'caution'],
        additionalProperties: false,
      },
    },
    note: { type: 'string', description: '一句话总体判断，比如这一批里没有对本主体有实质影响的内容' },
  },
  required: ['matches', 'note'],
  additionalProperties: false,
};

export const HOTSPOT_SYSTEM =
`你是这个研究主体的情报分析员。给你一批政策与行业资讯和这个主体的研究范围，你要挑出**真正值得跟进**的资讯。

判断标准：
1. **宁缺毋滥**。只挑对本主体有实质影响的：改变了规则、改变了供需、影响了成本或准入、暴露了竞争动作或资本动向。
   **只有「强」和「中」的会被采用，标成「弱」的会被系统直接丢掉**——不要用弱关联的条目凑数。
   一条都没有就返回空列表，并在 note 里说清为什么没有——这是完全可以接受的答案。
2. 有独特分析价值的优先：能落到主体的行业、业务或客户上，别人做不出这个判断的。
3. 「这条资讯对本主体的意义」要具体：资讯里的哪个变化 × 主体关心的哪件事 = 一个新的判断。
   不要写「可以结合这条政策谈谈看法」这种等于没说的话。
4. 「议题建议」是可以直接开做的研究议题，不是标题，也不是资讯原标题的复述。

**红线（必须遵守）**：
- 涉及伤亡、灾难、事故、犯罪、疾病爆发、个人不幸、政治敏感的内容，**一律不作为分析素材，直接跳过**。
- **点名到具体个人的争议**——一律跳过，哪怕背后的公共议题和主体有关。
- 娱乐八卦、明星私事、网络骂战，一律跳过。
- 如果某条资讯可以引用、但容易踩到合规或口径问题（未公开信息、未证实传闻、只是征求意见稿），
  就在 caution 里写清分寸；没有就留空字符串。

资讯在给你之前，已经由系统过滤掉了伤亡、灾难、犯罪、战争、点名争议、明星私生活这几类；
但过滤是关键词规则，难免有漏网的——**你看到明显属于这几类的，仍然要自己跳过**。

**你只看得到标题**（有的带一句摘要），看不到原文。所以：
- 「意义」只能建立在标题/摘要**字面给出的信息**上，不要补充你以为的背景、条款、数据或时间表——你并不知道。
- 如果一条资讯光看标题判断不了它到底在说什么，就不要选它。

index 必须是列表里的真实编号，source_title 必须逐字照抄，不要改写。全部使用简体中文。`;

export const hotspotUser = (persona, items) => {
  const head = [personaBlock(persona), creatorBlock(persona)].filter(Boolean).join('\n\n');
  const list = items
    .map((it, i) => `${i + 1}. [${it.platform}] ${it.title}${it.summary ? `　—　${it.summary.slice(0, 60)}` : ''}`)
    .join('\n');

  return `${head}

—— 当前政策与行业资讯 ——
${list}

请从中挑出对本主体真正有意义的资讯，最多 5 条，宁可少也不要硬凑。`;
};

/* ==================================================================
 * 报告检查：模型自己回头看一遍错字和通顺性
 * ================================================================== */

export const REVIEW_DIMENSIONS = ['主体适配', '体裁规范', '数据与口径', '来源可核查', '结论与证据', '合规风险'];

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: {
      type: 'string', enum: ['ok', 'minor', 'bad'],
      description: '语言层面：ok=可以直接用；minor=有个别毛病，改掉就行；bad=大面积语无伦次，建议重新生成',
    },
    summary: { type: 'string', description: '一句话总体判断，把语言和风险两方面都带上' },
    issues: {
      type: 'array', minItems: 0, maxItems: 20,
      description: '语言错误，每条都要能逐字替换',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: '有问题的原文片段，逐字照抄，必须能在原文里一字不差地找到；只截出问题所在的最小片段' },
          type: { type: 'string', enum: ['错字', '语句不通', '重复啰嗦', '前后矛盾', '标点格式', '术语不一致'], description: '问题类型' },
          fix: { type: 'string', description: '改好之后的片段，直接替换 quote 用' },
          why: { type: 'string', description: '一句话说明问题在哪，20 字以内' },
        },
        required: ['quote', 'type', 'fix', 'why'],
        additionalProperties: false,
      },
    },
    flags: {
      type: 'array', minItems: 0, maxItems: 12,
      description: '口径与风险层面的提示，不做自动替换，交给作者判断',
      items: {
        type: 'object',
        properties: {
          dimension: {
            type: 'string',
            enum: ['主体适配', '体裁规范', '数据与口径', '来源可核查', '结论与证据', '合规风险'],
          },
          level: { type: 'string', enum: ['高', '中', '低'], description: '高=不改可能出事；中=建议改；低=提一句' },
          quote: { type: 'string', description: '触发这条的原文片段，逐字照抄；整篇性的问题留空字符串' },
          what: { type: 'string', description: '问题是什么，一到两句说清' },
          suggestion: { type: 'string', description: '具体怎么改，一句话' },
        },
        required: ['dimension', 'level', 'quote', 'what', 'suggestion'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'summary', 'issues', 'flags'],
  additionalProperties: false,
};

export const REVIEW_SYSTEM =
`你是一位研究报告的终审编辑，同时负责事实与口径的把关。一份报告交到你手上，你要分两层过一遍。

════ 第一层：语言与一致性（写进 issues）════
只挑客观错误：
1. **错字**——别字、同音字用错、多字漏字。
2. **语句不通**——成分残缺、搭配不当、语序混乱、读起来不知所云。
3. **重复啰嗦**——同一个意思连着说两遍、车轱辘话。
4. **前后矛盾**——同一篇里互相打架的说法，包括数字前后不一致、小节结论与总判断相反。
5. **标点格式**——中英文标点混用、括号引号不成对、Markdown 标记写坏、表格错列。
6. **术语不一致**——同一个概念前后用了不同叫法，或缩写首次出现没给全称。

quote 必须从原文**逐字照抄**（含标点），且只截**最小片段**；原文里找不到的 quote 等于无效。
fix 只修错，不做任何风格或观点改动。整篇大面积语无伦次时 verdict 给 bad，并在 summary 里直说建议重新生成。

════ 第二层：口径与风险（写进 flags）════
按这六个维度查，每条给出 level：高=不改可能出事，中=建议改，低=提一句。

**主体适配**——对照上面给的研究对象设定、研究视角和（如果有）所属章节：这篇是不是这个主体该出的？
  跑出研究范围、面向的不是声明的读者、没有回答核心问题、违反写明的口径禁忌，
  或者章节要求写风险却写成了机会——才报。

**体裁规范**——对照给出的体裁规范：结论有没有先行、有没有分节、篇幅是否明显不合、
  是否混进了行业研究腔（钩子句、emoji、第一人称抒情、标题党）。

**数据与口径**——具体数字有没有交代时间范围、统计范围与来源；把预测当成已发生的事实来写；
  单位或口径前后混用（收入/出货量、含税/不含税）；用精确到小数的数字包装粗略估算。

**来源可核查**——具体数字、比例、机构名、条款号、研究结论、他人引语，被当成事实写出来但没有可核查的出处的。
  「据报道」「有数据显示」「研究表明」「业内普遍认为」后面跟着无从查证的内容，都算。
  这类只指出来让作者去核实，不要替他判断真假。

**结论与证据**——结论明显强于给出的证据；样本、时间窗口或地域范围不足以支撑这么强的判断；
  缺少成立条件或反例；把相关性说成因果；用个别案例推出整体趋势。

**合规风险**——中国商业环境里最常踩的这几条：
  · 涉密与未公开信息：内幕信息、未公告的重大事项、客户未公开数据、个人信息
  · 点名贬损具体企业或个人（商誉）、泄露他人隐私
  · 广告法与反不正当竞争：绝对化用语（第一、唯一、最佳、国家级）、贬低竞争对手
  · 投资类：收益承诺、荐股、「稳赚」「保本」
  · 把未经证实的负面信息当事实陈述（可能构成侵权）
  · 政策解读超出原文，或把征求意见稿写成已生效

════ 绝对不要报的 ════
- 谨慎的限定语、区间表述、「假设」「待验证」这类标注——这是研究报告的正常写法，不是毛病。
- 必要的术语、缩写、图表与数据罗列。
- 观点保守、结论不讨喜——那是判断，不是问题。
- 你个人觉得"可以写得更好"的地方。详略、结构偏好、要不要加框架都不归你管。
- 为了显得认真而硬凑。两层都没问题就返回两个空列表，那是好结果。

quote 在 flags 里同样要逐字照抄；整篇性的问题（比如篇幅明显不合体裁）quote 留空字符串。
全部使用简体中文。`;

export const reviewUser = (draft, text, persona, samples = []) => {
  const context = [
    personaBlock(persona),
    creatorBlock(persona),
    styleBlock(persona, samples),
    sectionBlock(draft.section, draft.inputs),
    hotspotRefBlock(draft.hotspot),
    `—— 体裁规范（${platformSpec(draft.platform).label}）——\n${platformSpec(draft.platform).spec}\n目标篇幅：约 ${draft.length} 字`,
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 待审报告 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

请按两层过一遍：语言与一致性问题写进 issues，口径与风险写进 flags。`;
};

/* 把抓到的原文压成概要 —— 只允许复述原文，不许补充 */
export const ARTICLE_SUMMARY_SYSTEM =
`你在为一位行业研究员做资料卡。给你一篇政策文件或行业报道的正文，请压成 2-3 句话的概要。
要求：
1. 只写原文里**确实说了**的事：发生了什么、谁说的、关键数字或结论。
2. 不要评价，不要引申，不要补充原文之外的背景——你只是在复述。
3. 抓到的正文可能夹带网页导航、广告、评论区文字，忽略它们，只概括主体内容。
4. 如果正文残缺到看不出在讲什么，只回一个字：无。
5. 120 字以内，简体中文，直接输出概要本身。`;

export const articleSummaryUser = (title, body) =>
`标题：${title}

正文（可能含网页杂质）：
${body}`;

/* 撰写时引用资讯：只能用概要里的信息 */
export const hotspotRefBlock = (hot) => {
  if (!hot?.title) return null;
  const summary = String(hot.summary || '').trim();
  return `—— 本篇要引用的资讯 ——
原标题：${hot.title}${hot.platform ? `（来源：${hot.platform}）` : ''}
${summary ? `原文概要：${summary}` : '原文概要：抓不到原文，只有这个标题。'}
${hot.angle ? `引用它的角度：${hot.angle}` : ''}

写作要求：
- 在开头或相关小节里**把它作为背景或由头引出来**（政策动向、行业数据、竞争事件），别写成新闻转述，也别通篇围着它转——它是论据之一，不是主体。
- ${summary
    ? '引用时只能用上面概要里给出的信息。概要没说的条款、数字、机构、时间一律不要写。'
    : '**没有原文概要，所以你不知道这条资讯的具体内容**。只能写到「近期有相关政策/动向」这个程度，绝对不要编造条款、数字或当事人说法。'}
- 明确写出它对本文核心判断的影响；如果它只是背景、不影响判断，就直说是背景。
- 不要写「据报道」「有数据显示」这类看似有出处、实则没有的表述。`;
};

/* ==================================================================
 * 报告章节：一个研究对象下的几条内容线
 * ================================================================== */

/* 章节模板：一份报告由哪几块构成，每块要作者提供什么数据与事实 */
export const SECTION_PRESETS = [
  {
    name: '市场规模',
    purpose: '把市场有多大、增长多快、由哪些部分构成说清楚，并交代测算口径',
    guide: '先给口径再给数字：统计范围（含谁不含谁）、时间窗口、是原始数据还是推算；'
      + '优先给区间和增速而不是一个孤立的绝对值；可得数据与推算过程分开写；'
      + '与其它公开口径不一致时说明差异和原因；拿不到数据的地方直说数据缺口。',
    fields: [
      { label: '已知的规模数据', hint: '数值 + 年份 + 来源（机构、报告名、口径）', required: true },
      { label: '统计口径', hint: '含/不含哪些细分、按收入还是出货量、地域范围', required: true },
      { label: '推算用的假设', hint: '怎么从已知推出未知：单价、渗透率、增速等' },
      { label: '数据缺口', hint: '拿不到的是什么，会影响哪个结论' },
    ],
  },
  {
    name: '竞争格局',
    purpose: '讲清主要玩家、份额分布、竞争打法和最近发生的变化',
    guide: '先分层（头部/腰部/新进入/跨界者）再讲份额，区分份额与声量；'
      + '每个玩家的判断都要有可核查依据（公开财报、招投标、产品发布）；'
      + '点明格局变化的驱动因素，并说明份额数据的口径与滞后性。',
    fields: [
      { label: '主要玩家与份额', hint: '谁、多少份额、数据来源与时间', required: true },
      { label: '关键竞争维度', hint: '价格、渠道、技术、生态、客户关系等，哪个是决定性的' },
      { label: '最近的变化事件', hint: '融资、并购、价格战、新品、人事变动等，带时间' },
      { label: '判断依据', hint: '你凭什么下这个判断' },
    ],
  },
  {
    name: '技术路线',
    purpose: '拆清可选的技术方案、成熟度差异与取舍条件',
    guide: '每条路线给成熟度（实验室/试点/量产）、代表玩家与关键指标对比；'
      + '避免「最好/最优」式判断，改写成适用条件；'
      + '说明被淘汰或未被采纳的路线及其原因；区分工程问题与商业问题。',
    fields: [
      { label: '候选技术路线', hint: '有几条、分别是什么', required: true },
      { label: '成熟度与代表玩家', hint: '处在什么阶段，谁在做' },
      { label: '关键指标对比', hint: '成本、性能、良率、能耗等可比指标，带口径' },
      { label: '未被采纳的原因', hint: '哪些路线为什么出局' },
    ],
  },
  {
    name: '政策环境',
    purpose: '梳理相关法规与政策，并说清对主体的具体影响和时间表',
    guide: '政策要写全名称、发文机关、发文字号与发布时间；引条款要准确；'
      + '严格区分**已生效**与**征求意见稿**；'
      + '落到业务动作上：资质、成本、合规义务、过渡期与截止时间；不做超出文本的推断。',
    fields: [
      { label: '相关政策', hint: '名称 + 发文机关 + 文号 + 时间', required: true },
      { label: '关键条款要点', hint: '直接约束本主体的那几条，尽量用原文', required: true },
      { label: '生效与过渡期', hint: '什么时候生效、有没有过渡期安排' },
      { label: '对本主体的影响', hint: '业务、资质、成本、时间表各有什么变化' },
    ],
  },
  {
    name: '风险与不确定性',
    purpose: '列出可能证伪核心判断的因素，以及需要持续观察的信号',
    guide: '每条风险写清触发信号、影响面和概率高低，不要写「存在一定风险」这种笼统的话；'
      + '区分可承受与不可承受；给出对冲或应对动作；'
      + '同时写明判断成立的前提条件，以及信息缺口带来的不确定性。',
    fields: [
      { label: '风险项', hint: '具体是什么风险，不要只写大类', required: true },
      { label: '触发信号', hint: '看到什么就说明它正在发生' },
      { label: '影响面', hint: '影响到哪个结论、哪个环节、量级多大' },
      { label: '对冲或应对', hint: '现在能做什么' },
    ],
  },
  {
    name: '结论与建议',
    purpose: '收束判断，给出可执行、可验证的建议动作',
    guide: '先复述核心判断（含成立条件），再给建议：谁来做、什么时候做、做到什么算成；'
      + '严格区分事实、判断与建议三层；'
      + '列出还需要进一步验证的问题和验证方式；不要用「建议持续关注」这类无法执行的建议收尾。',
    fields: [
      { label: '核心判断', hint: '一句话，含成立条件', required: true },
      { label: '依据摘要', hint: '支撑这个判断的最强两三条依据' },
      { label: '建议动作', hint: '谁 + 何时 + 判断标准', required: true },
      { label: '待验证的问题', hint: '还需要查证什么、怎么查' },
    ],
  },
];

export const sectionBlock = (section, inputs = null) => {
  if (!section?.name) return null;
  const lines = [
    `章节名：${section.name}`,
    section.purpose ? `这个章节讲什么：${section.purpose}` : null,
    section.guide ? `这个章节的写作要点：${section.guide}` : null,
  ].filter(Boolean);

  const head = `—— 本篇所属章节 ——
${lines.join('\n')}

本篇必须是这个章节该有的样子：它和主体下其它章节的区别，就体现在上面这几句里。
章节要点和通用体裁规范冲突时，以章节要点为准。`;

  const materials = sectionInputsBlock(section, inputs);
  return materials ? `${head}\n\n${materials}` : head;
};

/* 章节要的素材：作者自己填的，是这篇里唯一可信的事实来源 */
export const sectionInputsBlock = (section, inputs) => {
  const fields = Array.isArray(section?.fields) ? section.fields : [];
  if (!fields.length || !inputs) return null;

  const filled = fields
    .map((f) => ({ label: f.label, value: String(inputs[f.label] ?? '').trim() }))
    .filter((f) => f.value);
  const missing = fields.filter((f) => !String(inputs[f.label] ?? '').trim()).map((f) => f.label);
  if (!filled.length) return null;

  return `—— 作者为这个章节提供的数据与事实 ——
${filled.map((f) => `【${f.label}】${f.value}`).join('\n')}

这些是作者本人提供的数据与事实，**是这篇里唯一可信的事实来源**：
- 写作时优先用它们，把它们展开成有依据的论证，而不是原样复述一遍。
- **不要编造它们之外的数字、机构名、时间、条款、案例或他人引语。**${missing.length
    ? `\n- 作者没有填「${missing.join('」「')}」，说明他没提供这部分信息——不要脑补，也不要拿行业通用的估算值冒充事实，如实写成数据缺口。`
    : ''}`;
};

/* ==================================================================
 * 汇报要点：语气 / 重读 / 停顿 / 表情 / 动作
 * 单独一层，不往报告正文里塞标记——正文该保持干净可直接发
 * ================================================================== */

/* 情绪的固定分类——模型给的 emotion 是自由发挥的文字，
   关键词匹配基本命中不了，所以让它顺手归到这五类里的一类 */
export const TONE_TAGS = ['结论', '数据', '风险', '背景', '建议'];

export const CUES_SCHEMA = {
  type: 'object',
  properties: {
    overall: {
      type: 'object',
      properties: {
        tone: { type: 'string', description: '整体汇报基调，一句话' },
        pace: { type: 'string', description: '讲述节奏建议，一句话' },
        note: { type: 'string', description: '汇报时最该注意的一件事，一句话；没有就留空字符串' },
      },
      required: ['tone', 'pace', 'note'],
      additionalProperties: false,
    },
    cues: {
      type: 'array', minItems: 1, maxItems: 24,
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: '这段要讲的原文，从正文里逐字照抄，按出现顺序，段落之间不重叠' },
          emotion: { type: 'string', description: '这段要强调什么，具体些，如「核心判断，放慢讲」「这组数字要念准」「风险提示，语气转沉」；平铺直叙就写「平述」' },
          tone_tag: {
            type: 'string', enum: ['结论', '数据', '风险', '背景', '建议'],
            description: '把这段归到最接近的一类，便于下游做确定性匹配。拿不准就给「背景」',
          },
          stress: {
            type: 'array', maxItems: 4, items: { type: 'string' },
            description: '要重点讲出来的词或数字，必须是这段原文里出现过的；没有就给空数组',
          },
          pause: { type: 'string', description: '停顿位置和时长，如「说完"同比 23%"停一拍再接依据」；不需要就留空字符串' },
          expression: { type: 'string', description: '演示提示：这一页放什么（图表、表格、不要念全表）、要不要停下来让对方看；不需要就留空字符串' },
          gesture: { type: 'string', description: '预判的追问：对方最可能问的一个问题，一句话；想不到就留空字符串' },
        },
        required: ['quote', 'emotion', 'tone_tag', 'stress', 'pause', 'expression', 'gesture'],
        additionalProperties: false,
      },
    },
  },
  required: ['overall', 'cues'],
  additionalProperties: false,
};

export const CUES_SYSTEM =
`你是给研究报告做汇报准备的人。给你一份要讲的内容，你要标出该怎么讲、哪些地方要强调、可能被追问什么。

**怎么切段**：按「一口气讲完的一句或几句」切，不是按标点也不是按段落。
quote 必须从正文**逐字照抄**（含标点），按正文顺序排列，段落之间不重叠。
标题、表格、参考来源这类不念出来的内容跳过，不要给它们标提示。

**每条要给什么**：
- emotion：这段要强调什么。要具体——「核心判断，放慢讲」「这组数字要念准」「风险提示，语气转沉」，
  而不是「认真地」「平稳地」这种没法执行的词。真的就是平铺直叙，就写「平述」。
- tone_tag：把这段归到「结论/数据/风险/背景/建议」里最接近的一类。
  结论=核心判断与建议，数据=规模、份额、增速、指标，风险=不确定性与证伪信号，
  背景=政策与行业背景，建议=下一步动作，其余给背景。
- stress：要重点讲出来的词或数字，**必须是这段原文里真实出现过的**，最多 4 个。没有就给空数组。
- pause：停顿在哪、停多久，如「说完"同比 23%"停一拍再接依据」。不需要就留空字符串。
- expression：**演示提示**——这一页该放什么（图表、对照表、不要念全表）、要不要停下来让对方看。
  绝大多数段落不需要专门提示，不需要就留空字符串。
- gesture：**预判的追问**——对方最可能问的一个问题，一句话。想不到就留空字符串。

**铁律**：
1. **不要每条都填满**。一份报告里真正需要专门标强调或追问的地方通常不超过三分之一。
   为了显得认真而每条都配一句，讲出来会像念稿机器——留空是完全正确的答案。
2. 给了研究视角的，强调的重点要符合这个视角关心的东西（产业方关心落地，投资机构关心回报与风险）。
3. 只做汇报准备，**不要改写、增删正文一个字**，也不要新增正文里没有的数字或结论。
4. 全部使用简体中文。`;

export const cuesUser = (draft, persona, text) => {
  const context = [
    creatorBlock(persona),
    `—— 报告体裁 ——\n${platformSpec(draft.platform).label}${draft.tone ? `　风格：${draft.tone}` : ''}`,
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 要讲的内容 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

请标出汇报时该怎么讲、哪些要强调、可能被问什么。记住：不需要的地方就留空，不要凑。`;
};

/* ==================================================================
 * 多体裁适配：把一篇报告改写成另一个体裁的版本
 *
 * 关键决定是**改写，不是重新生成**。
 * 重新生成会让每个体裁的事实、例子、数字各说各的——同一件事在摘要和正式报告里
 * 变成两个故事，读者一对照就露馅，而且和"章节素材是唯一可信事实来源"那条直接冲突。
 * 所以这里只准重排结构、调语气、增删详略，事实层一个字都不能动。
 * ================================================================== */

export const ADAPT_SYSTEM =
`你要把一份已经写好的报告，改成另一种体裁的版本。

**最重要的一条：事实层不许动。**
原文里的数据、口径、时间、机构、条款、案例、结论——一个都不能改、不能加。
目标体裁篇幅短就**整块删**，不要把每句话压缩成缩写体；篇幅长可以把原有的点展开讲透，
但展开只能用原文已有的信息，**不许补充原文没有的数据、案例或调研结论**。

**要改的是这三样**：
1. **结构**：按目标体裁的惯例重排。行业报告要分节展开论证，摘要要一页纸结论先行，
   备忘录要补齐测算与假设，政策解读要先给文号和条款。
2. **详略**：哪些点该展开、哪些该一笔带过，取决于目标体裁的读者要什么（决策者要结论，执行者要动作）。
3. **表述密度**：按目标体裁调整术语密度与限定语的多少。

**铁律**：
1. **不许把原体裁的格式痕迹带过来**。原文是长篇报告就不要把附录和参考来源搬进一页纸摘要；
   原文是摘要就不要再抽出小标题式骨架。目标体裁不用的结构，一律去掉。
2. **数据与口径必须原样保留**：可以删掉整个数据点，但不能改写它的时间、范围或单位。
   原文标注为「假设」「待验证」的，改编后仍要保留这个标注。
3. 目标篇幅是硬约束，宁可少写一个点，也不要超。
4. 只输出改好的正文，**不要任何说明、前言、"以下是…"**，也不要用引号包起来。
5. 全部使用简体中文。`;

export const adaptUser = (draft, persona, text, fromKey, toKey) => {
  const from = platformSpec(fromKey);
  const to = platformSpec(toKey);
  const context = [
    creatorBlock(persona),
    draft.tone ? `—— 行文风格 ——\n${draft.tone}` : null,
  ].filter(Boolean).join('\n\n');

  return `${context}

—— 原文是给「${from.label}」写的 ——
===== 原文开始 =====
${text}
===== 原文结束 =====

—— 要改成「${to.label}」 ——
${to.spec}
篇幅：${to.length} 字左右。

请给出「${to.label}」版本的正文。记住：结构、语气、详略可以改，**事实一个字都不能动**。`;
};

/* ==================================================================
 * 图表建议：给一篇文章挑几个图表位
 *
 * 保不住人物一致性，已经证明不可用。这里是**一篇 2-5 张**的文章图表，
 * 而且明确要求**不画具体的人**——报告图表本来就该是数据图和结构图，
 * 绕开人物，一致性问题就不存在。
 * ================================================================== */

export const ILLUS_SCHEMA = {
  type: 'object',
  properties: {
    look: { type: 'string', description: '整篇统一的图表风格，一句话（配色、版式、字体风格），会拼进每张图的提示词' },
    items: {
      type: 'array', minItems: 1, maxItems: 5,
      items: {
        type: 'object',
        properties: {
          anchor: {
            type: 'string',
            description: '这张图放在哪一段之后。从正文里**逐字照抄**那一段的开头 10-20 个字，必须能在正文里找到',
          },
          prompt: { type: 'string', description: '图表内容描述：画什么图（折线/柱状/堆积/矩阵/流程/结构），横纵轴或维度的含义、数据来源与口径。不写风格词（风格由 look 统一给）' },
          alt: { type: 'string', description: '图表标题，12 字以内；不需要就给空字符串' },
        },
        required: ['anchor', 'prompt', 'alt'],
        additionalProperties: false,
      },
    },
  },
  required: ['look', 'items'],
  additionalProperties: false,
};

export const ILLUS_SYSTEM =
`你要给一份报告挑几个图表位，并说清楚每张图该画什么。

**给几张**：按报告的长度和结构定，2-5 张。**宁可少给**——
图表是用来承载数据和关系的，不是给版面填空；纯文字结论不需要图表。
图表位应该落在**章节之间**或**一段完整论证讲完之后**，不要插在一句话中间。

**图表内容怎么写**：
- 写清**图表形式**（折线/柱状/堆积/散点/矩阵/流程/组织结构）和**数据维度**：横轴、纵轴、分组、单位。
- 数据来源与口径能写就写上（哪一年、什么统计范围）；数据在正文里没给全的，写清缺哪一项，
  **不要为了好看编一组数**。
- 如果这段内容其实不适合用图表达（比如纯定性判断、政策条款），就少给或不给，不要硬凑。
- 不要写风格词（"高级感""科技感"），整篇风格由 look 统一给，写两处会打架。

**图和文的关系**：图表要承载正文里说不清的关系——趋势、结构、对比、分布。
讲"份额从 30% 降到 18%"就画份额变化；讲三家路线取舍就画对照矩阵。

**铁律**：
1. anchor 必须从正文**逐字照抄**，取那一段开头的 10-20 个字，且必须真的能在正文里找到。
2. look 里把**配色、版式、字体风格**三件事定死，让几张图看起来像同一份报告里的。
3. 图表标题直白说明它在展示什么，不要用营销式标题。
4. 全部使用简体中文。`;

export const illusUser = (draft, persona, text, platformKey) => {
  const p = platformSpec(platformKey);
  const context = [creatorBlock(persona), `—— 报告体裁 ——\n${p.label}`].filter(Boolean).join('\n\n');
  return `${context}

—— 报告正文 ——
===== 正文开始 =====
${text}
===== 正文结束 =====

请给出图表方案。记住：宁可少给，图表要承载数据关系，anchor 必须逐字照抄正文里的一段开头。`;
};

/* ==================================================================
 * 素材召回
 *
 * 和章节素材是同一层意思——**作者提供的真实信息**，是这篇里唯一可信的事实来源。
 * 区别只在来源：章节素材是这篇现填的，素材库是攒下来的。
 * 拼进 user 消息时用同样的措辞，模型不需要区分这两者。
 * ================================================================== */

export const materialsBlock = (list) => {
  if (!list?.length) return null;
  return `—— 作者素材库里和这个议题相关的记录 ——
${list.map((m) => `【${m.kind}】${m.title}\n${m.body}`).join('\n\n')}

这些是作者本人积累的真实材料，**和章节素材一样，是这篇里可信的事实来源**：
- 用得上就用，把它们展开成有依据的论证，不要原样罗列。
- **用不上的不要硬塞**——为了用素材而跑题，比不用素材更糟。
- 同样**不要编造它们之外的数字、机构名、条款、时间或他人引语**。`;
};
