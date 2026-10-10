// 定位访谈轮返回空内容的原因：直接打模型，打印原始返回。
import { chat } from '../src/llm.mjs'
import { interviewSystem } from '../src/prompts.mjs'

const messages = [
  { role: 'user', content: '我跟我老公结婚五年，他妈每周都来我们家住三天，他从来不表态。上周我吵了一次，现在冷战。' },
  { role: 'assistant', content: '他妈每周来住三天，这个频率是婚后一直这样，还是最近才变成这样的？\n\n这五年里，你老公有没有哪一次为这事跟他妈说过什么？' },
  { role: 'user', content: '他妈每次来都直接进我们房间收拾东西，我跟他说过三次，他每次都说明天跟我妈说，但从来没说过。' },
]

const variants = [
  {
    name: 'A. 当前实现：末尾插一条 user 系统提示',
    run: () =>
      chat({
        system: interviewSystem({ round: 2, maxRounds: 5 }),
        messages: [...messages, { role: 'user', content: '（系统提示：现在是第 2 轮，请按格式输出你的下一步问题。）' }],
        json: true,
        maxTokens: 600,
        temperature: 0.8,
      }),
  },
  {
    name: 'B. 去掉 JSON mode',
    run: () =>
      chat({
        system: interviewSystem({ round: 2, maxRounds: 5 }),
        messages,
        json: false,
        maxTokens: 600,
        temperature: 0.8,
      }),
  },
  {
    name: 'C. 单条拼接（把访谈记录压进一条 user）',
    run: () =>
      chat({
        system: interviewSystem({ round: 2, maxRounds: 5 }),
        messages: [
          {
            role: 'user',
            content: `访谈记录：\n${messages.map((m) => `${m.role === 'user' ? '客户' : '助手'}：${m.content}`).join('\n')}\n\n请输出下一步的 JSON。`,
          },
        ],
        json: true,
        maxTokens: 600,
        temperature: 0.8,
      }),
  },
]

for (const v of variants) {
  try {
    const { content, usage } = await v.run()
    console.log(`\n[${v.name}] OK tokens=${usage.prompt_tokens}/${usage.completion_tokens}`)
    console.log(JSON.stringify(content))
  } catch (error) {
    console.log(`\n[${v.name}] THROW -> ${error.message}`)
  }
}
