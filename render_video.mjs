// 《重回高一，我先卷为敬》第1集 自动初剪渲染脚本
// 用 ffmpeg：每镜一个片段（推拉运镜 + 配音对位）→ 拼接成片
import { spawn } from 'node:child_process'
import fs from 'node:fs'

const ROOT = 'G:/dsh/重回高一，我先卷为敬'
const IMG = (n) => `${ROOT}/第一集成图/${n}.png`
const VOI = (n) => `${ROOT}/配音/${n}.mp3`
const EGG = `${ROOT}/第一集成图/彩蛋图.png`
const WORK = 'G:/dsh/.render_work'
const FF = fs.readFileSync('G:/dsh/.ffmpeg_path.txt', 'utf8').trim()
const FPS = 25

// 运镜滤镜（2160x3840 超采样 → zoompan → 1080x1920）
const MOTION = {
  in:      `zoompan=z='min(1.0+0.0006*on,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  out:     `zoompan=z='max(1.15-0.0006*on,1.0)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  inFast:  `zoompan=z='min(1.0+0.004*on,1.35)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  inStrong:`zoompan=z='min(1.0+0.005*on,1.30)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  panR:    `zoompan=z='1.12':x='(iw-iw/zoom)*(on/N)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  panL:    `zoompan=z='1.12':x='(iw-iw/zoom)*(1-on/N)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
  hold:    `zoompan=z='1.05':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1920x1080:fps=${FPS}`,
}

// 片段定义：图、时长(秒)、运镜、配音[{文件, 偏移秒}]
const SEGS = [
  { img: IMG('1'),  dur: 6.2,  m: 'in',      audio: [{ f: VOI('01_沈智夏_旁白_重来一次'), off: 0.5 }] },
  { img: IMG('2'),  dur: 2.0,  m: 'inFast',  audio: [] },
  { img: IMG('3'),  dur: 4.5,  m: 'in',      audio: [] },
  { img: IMG('4'),  dur: 5.5,  m: 'panR',    audio: [{ f: VOI('02_沈智夏_旁白_真的回来了'), off: 0.2 }] },
  { img: IMG('5'),  dur: 6.5,  m: 'out',     audio: [{ f: VOI('03_苏茜_摸底考宣战'), off: 0.2 }] },
  { img: IMG('6'),  dur: 6.5,  m: 'in',      audio: [{ f: VOI('04_沈智夏_旁白_丫头嘴硬'), off: 0.2 }] },
  { img: IMG('7'),  dur: 8.0,  m: 'in',      audio: [{ f: VOI('05_沈智夏_旁白_终于不是错过'), off: 0.3 }] },
  { img: IMG('8'),  dur: 5.0,  m: 'out',     audio: [] },
  { img: IMG('9'),  dur: 5.5,  m: 'panL',    audio: [{ f: VOI('06_江明_挺快'), off: 0.3 }, { f: VOI('07_沈智夏_你也不慢'), off: 2.3 }] },
  { img: IMG('10'), dur: 10.0, m: 'in',      audio: [{ f: VOI('08_沈智夏_旁白_卷要卷得值得'), off: 0.3 }] },
  { img: EGG,       dur: 2.5,  m: 'in',      audio: [] },   // 彩蛋A 占位
  { img: EGG,       dur: 3.0,  m: 'inStrong',audio: [] },   // 彩蛋B 占位
  { img: EGG,       dur: 3.0,  m: 'hold',    audio: [{ f: VOI('09_江明_哎呀没什么'), off: 0.4 }] }, // 彩蛋C
]

function run(ff, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, args, { stdio: 'inherit' })
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${args.join(' ').slice(0, 200)}`))))
    p.on('error', reject)
  })
}

async function main() {
  fs.rmSync(WORK, { recursive: true, force: true })
  fs.mkdirSync(WORK, { recursive: true })
  const listLines = []
  for (let i = 0; i < SEGS.length; i++) {
    const seg = SEGS[i]
    const out = `${WORK}/seg${String(i + 1).padStart(2, '0')}.mp4`
    const frames = Math.round(seg.dur * FPS)
    const motion = MOTION[seg.m].replace(/on\/N/g, `on/${frames}`)
    const vf = `scale=3840:2160:force_original_aspect_ratio=increase,crop=3840:2160,${motion},format=yuv420p`
    const args = ['-y', '-loop', '1', '-framerate', String(FPS), '-t', String(seg.dur), '-i', seg.img]
    for (const a of seg.audio) args.push('-i', a.f)
    if (seg.audio.length === 0) args.push('-f', 'lavfi', '-t', String(seg.dur), '-i', 'anullsrc=r=44100:cl=stereo')
    const fc = [`[0:v]${vf}[v]`]
    if (seg.audio.length === 0) {
      fc.push('[1:a]aresample=44100[a]')
    } else if (seg.audio.length === 1) {
      const ms = Math.round(seg.audio[0].off * 1000)
      fc.push(`[1:a]aresample=44100,adelay=${ms}:all=1[a]`)
    } else {
      const parts = []
      seg.audio.forEach((a, k) => {
        const ms = Math.round(a.off * 1000)
        fc.push(`[${k + 1}:a]aresample=44100,adelay=${ms}:all=1[a${k}]`)
        parts.push(`[a${k}]`)
      })
      fc.push(`${parts.join('')}amix=inputs=${seg.audio.length}:normalize=0[a]`)
    }
    args.push('-filter_complex', fc.join(';'), '-map', '[v]', '-map', '[a]',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-r', String(FPS), '-t', String(seg.dur), out)
    console.log(`[${i + 1}/${SEGS.length}] ${seg.img.split('/').pop()} ${seg.dur}s ${seg.m}`)
    await run(FF, args)
    listLines.push(`file '${out}'`)
  }
  const listPath = `${WORK}/list.txt`
  fs.writeFileSync(listPath, listLines.join('\n'))
  const final = `${ROOT}/第1集_初剪v2_横屏.mp4`
  console.log('concat ->', final)
  await run(FF, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', final])
  const size = fs.statSync(final).size
  console.log(`DONE ${final} ${(size / 1024 / 1024).toFixed(1)} MB`)
}

main().catch((e) => { console.error('FATAL', e.message); process.exit(1) })
