// AI漫剧《重回高一，我先卷为敬》第1集配音生成器
// 基于 msedge-tts（微软 Edge 在线语音，免费）
import { MsEdgeTTS, OUTPUT_FORMAT } from 'file:///G:/dsh/.npm-libs/node_modules/msedge-tts/dist/index.js'
import fs from 'node:fs'
import path from 'node:path'

const OUT_DIR = 'G:/dsh/重回高一，我先卷为敬/配音'
fs.mkdirSync(OUT_DIR, { recursive: true })

// 音色候选（按优先级，从微软在线语音列表里挑存在的）
const VOICE_CANDIDATES = {
  shenzhixia: ['zh-CN-XiaoxiaoNeural', 'zh-CN-XiaoyiNeural'],          // 沈智夏：知性清冷
  suxi:       ['zh-CN-XiaoshuangNeural', 'zh-CN-XiaoyiNeural'],        // 苏茜：元气活泼
  jiangming:  ['zh-CN-YunxiNeural', 'zh-CN-YunjianNeural'],            // 江明：清爽少年
}

// 9 句台词：文件名、角色、语速、音调、文本（TTS 版，标点已为朗读优化）
const LINES = [
  ['01_沈智夏_旁白_重来一次', 'shenzhixia', '-10%', '+0Hz',
   '如果人生能重来一次，我绝不会再把自己活成这样。'],
  ['02_沈智夏_旁白_真的回来了', 'shenzhixia', '-8%', '+0Hz',
   '2010年9月1日……我真的回来了。'],
  ['03_苏茜_摸底考宣战', 'suxi', '+15%', '+2Hz',
   '沈智夏，别发呆，老师点你名呢！这次摸底考，我可不会输给你。'],
  ['04_沈智夏_旁白_丫头嘴硬', 'shenzhixia', '-8%', '+0Hz',
   '上一世，这丫头嘴硬了一辈子，却是唯一真心待我的朋友。'],
  ['05_沈智夏_旁白_终于不是错过', 'shenzhixia', '-10%', '+0Hz',
   '江明……这一世，我们终于不是错过了。'],
  ['06_江明_挺快', 'jiangming', '-5%', '-2Hz', '挺快。'],
  ['07_沈智夏_你也不慢', 'shenzhixia', '-10%', '+0Hz', '你也不慢。'],
  ['08_沈智夏_旁白_卷要卷得值得', 'shenzhixia', '-5%', '+0Hz',
   '卷，我当然要卷。但这一世，我要卷得值得，也把错过的人，一个个抢回来。'],
  ['09_江明_哎呀没什么', 'jiangming', '+0%', '-1Hz', '哎呀，没什么。'],
]

async function resolveVoices() {
  const tts = new MsEdgeTTS()
  const all = await tts.getVoices()
  tts.close()
  const zh = all.filter(v => v.Locale === 'zh-CN')
  const map = {}
  for (const [role, cands] of Object.entries(VOICE_CANDIDATES)) {
    const hit = cands.find(c => zh.some(v => v.ShortName === c))
    map[role] = hit ?? 'zh-CN-XiaoxiaoNeural'
    console.log(`voice ${role} -> ${map[role]}`)
  }
  return map
}

function durationFromMeta(metaPath) {
  try {
    const data = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
    const list = data?.Metadata ?? data?.metadata ?? []
    let end = 0
    for (const w of list) {
      const off = ((w.Data?.Offset ?? w.Offset) ?? 0) / 10000 // 100ns -> ms
      const dur = ((w.Data?.Duration ?? w.Duration) ?? 0) / 10000
      end = Math.max(end, off + dur)
    }
    if (end > 0) return end
  } catch (e) { /* ignore */ }
  return null
}

async function main() {
  const voices = await resolveVoices()
  const results = []
  for (const [name, role, rate, pitch, text] of LINES) {
    try {
    const tts = new MsEdgeTTS()
    await tts.setMetadata(voices[role], OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
    })
    const target = path.join(OUT_DIR, name + '.mp3')
    const metaTarget = path.join(OUT_DIR, name + '_meta.json')
    if (fs.existsSync(target) && fs.existsSync(metaTarget)) {
      const dur = durationFromMeta(metaTarget)
      console.log(`SKIP ${name}.mp3 (already done) | ${dur ? dur.toFixed(2) : '?'} ms`)
      results.push({ name, role, rate, dur: dur ?? 0, durByMeta: dur != null })
      continue
    }
    const { audioFilePath, metadataFilePath } = await tts.toFile(OUT_DIR, text, { rate, pitch })
    tts.close()
    fs.renameSync(audioFilePath, target)
    let dur = null
    if (metadataFilePath) {
      fs.copyFileSync(metadataFilePath, metaTarget)
      dur = durationFromMeta(metaTarget)
    }
    const size = fs.statSync(target).size
    const sizeDur = (size * 8 / 48000) * 1000
    results.push({ name, role, rate, dur: dur ?? sizeDur, durByMeta: dur != null })
    console.log(`OK ${name}.mp3 | voice=${voices[role]} | ${(dur ?? sizeDur).toFixed(2)} ms`)
    } catch (e) {
      console.error(`LINE FAIL ${name}: ${e.message}`)
      results.push({ name, role, rate, dur: 0, durByMeta: false })
    }
  }
  console.log('=== SUMMARY ===')
  for (const r of results) {
    console.log(`${r.name}.mp3 | ${r.role} | ${r.rate} | ${r.dur.toFixed(2)} ms | 按时长计算:${r.durByMeta ? '词边界' : '码率估算'}`)
  }
  console.log('ALL DONE')
}

main().catch(e => { console.error('FATAL', e); process.exit(1) })
