# -*- coding: utf-8 -*-
"""
把 AI 投标技术方案生成工作台改造成可部署的作品集版本。
改动：
  1) vite.config.js 加 base:'./'  → 支持子目录部署
  2) cozeApi.js 演示模式重写     → 确定性成功 + 延长到可见的多阶段 + 指向真实样例页
  3) GenerationSuccess.jsx       → 演示模式下按钮文案与说明改为"查看交付样例"
  4) index.html 注入作品集说明层  → 首屏三秒知道这是什么
"""
import io, os, shutil, re

P = r'G:\bidding-workstation'

def rd(f): return io.open(os.path.join(P, f), encoding='utf-8').read()
def wr(f, s): io.open(os.path.join(P, f), 'w', encoding='utf-8').write(s)

# ============ 1. vite.config.js ============
f = 'vite.config.js'
s = rd(f)
if "base:" not in s:
    s = s.replace("  plugins: [react()],", "  plugins: [react()],\n  base: './',   // 相对路径，支持部署到子目录")
    wr(f, s)
    print('✅ vite.config.js 已加 base: "./"')
else:
    print('· vite.config.js 已有 base，跳过')

# ============ 2. cozeApi.js 演示模式 ============
f = 'src/services/cozeApi.js'
s = rd(f)
old_sim = """// 模拟工作流执行（演示模式）
const simulateWorkflow = async (file, requirements) => {
  // 模拟延迟
  await new Promise(resolve => setTimeout(resolve, 2000));

  // 随机决定成功或失败（80% 成功率）
  const success = Math.random() > 0.2;

  if (success) {
    return {
      success: true,
      data: {
        workflow_run_id: 'demo_' + Date.now(),
        document_link: 'https://example.feishu.cn/docx/demo123456',
        status: 'completed'
      }
    };
  } else {
    // 模拟各种错误
    const errorTypes = [
      ERROR_TYPES.FILE_UNREADABLE,
      ERROR_TYPES.TIMEOUT,
      ERROR_TYPES.NO_DOCUMENT_LINK
    ];
    const randomError = errorTypes[Math.floor(Math.random() * errorTypes.length)];

    return {
      success: false,
      error: {
        type: randomError,
        message: '模拟错误：' + randomError
      }
    };
  }
};"""
new_sim = """// 模拟工作流执行（演示模式 · 作品集用途）
// 与原实现的三点差异，都是为了"给面试官看"而不是"给开发调试"：
//   1) 确定性成功 —— 原版 20% 随机失败，访客有 1/5 概率撞到报错，演示现场不合适
//   2) 总耗时约 8.4 秒并分成三段 —— 原版 2 秒一闪而过，看不到产品的多阶段流程
//   3) 链接指向真实的交付样例页 —— 原版指向 example.feishu.cn 假地址，点开是死链
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const simulateWorkflow = async (file, requirements) => {
  // 分三段推进，让进度界面有机会展示"上传 → 解析 → 生成"的过程
  await sleep(2600);   // 阶段一：上传与解析招标文件
  await sleep(3200);   // 阶段二：提取评分项、生成方案框架
  await sleep(2600);   // 阶段三：分章节撰写正文、输出交付物

  return {
    success: true,
    data: {
      workflow_run_id: 'demo_' + Date.now(),
      // 真实可打开的交付样例页（与工作台一同部署），不是占位链接
      document_link: './bidding-sample.html',
      status: 'completed',
      demo: true
    }
  };
};"""
if old_sim in s:
    s = s.replace(old_sim, new_sim)
    print('✅ cozeApi.js 演示模式已重写（确定性成功 / 8.4 秒三段 / 指向真实样例页）')
else:
    print('❌ cozeApi.js 未匹配到原演示函数，跳过')

# 演示模式的状态查询也要指向真实页
s = s.replace(
    "      document_link: 'https://example.feishu.cn/docx/demo123456'\n    }\n  };\n};",
    "      document_link: './bidding-sample.html'\n    }\n  };\n};"
)
wr(f, s)

# ============ 3. GenerationSuccess.jsx ============
f = 'src/components/GenerationSuccess.jsx'
s = rd(f)
if 'isDemoMode' not in s:
    s = s.replace(
        "import React, { useState } from 'react';",
        "import React, { useState } from 'react';\nimport { isDemoMode } from '../services/cozeApi';"
    )
    s = s.replace(
        "const GenerationSuccess = ({ project, onBackToList, onCreateNew, onRegenerate }) => {\n  const [copied, setCopied] = useState(false);",
        "const GenerationSuccess = ({ project, onBackToList, onCreateNew, onRegenerate }) => {\n  const [copied, setCopied] = useState(false);\n  // 演示模式：链接指向真实的交付样例页，按钮与说明随之调整\n  const demo = isDemoMode();"
    )
    s = s.replace(
        '<div className="document-title">飞书文档已生成</div>',
        '<div className="document-title">{demo ? \'交付样例已就绪\' : \'飞书文档已生成\'}</div>'
    )
    s = s.replace(
        '<div className="document-subtitle">技术方案初稿</div>',
        '<div className="document-subtitle">{demo ? \'演示模式 · 未调用真实工作流\' : \'技术方案初稿\'}</div>'
    )
    s = s.replace(
        '              打开飞书文档\n',
        '              {demo ? \'查看交付样例（12 项物料）\' : \'打开飞书文档\'}\n'
    )
    # 在 document-card 之后插入演示说明
    s = s.replace(
        '        <div className="warning-section">',
        '''        {demo && (
          <div className="result-card" style={{ marginTop: '16px', borderLeft: '4px solid #5c7cfa' }}>
            <div className="result-row">
              <div className="result-label" style={{ minWidth: '88px' }}>说明</div>
              <div className="result-value" style={{ fontSize: '13px', lineHeight: 1.8 }}>
                当前为<strong>演示模式</strong>：不调用真实工作流，流程与状态展示为模拟数据。<br />
                上方链接指向<strong>真实的交付样例页</strong>，内含 12 项产出清单与 3 个脱敏样例片段
                （口播脚本 / 封面布局稿 / 拍摄设备清单）。<br />
                真实运行需配置 Coze 工作流密钥。
              </div>
            </div>
          </div>
        )}

        <div className="warning-section">'''
    )
    wr(f, s)
    print('✅ GenerationSuccess.jsx 已接入演示模式文案')
else:
    print('· GenerationSuccess.jsx 已改过，跳过')

# ============ 4. index.html 作品集说明层 ============
f = 'index.html'
s = rd(f)
if 'portfolio-intro' not in s:
    intro = '''    <div id="portfolio-intro">
      <div class="pi-box">
        <div class="pi-title">AI 投标技术方案生成工作台<span class="pi-tag">作品集 · 演示模式</span></div>
        <div class="pi-body">
          面向 <b>toB 投标场景</b>：把"读招标文件 → 写技术方案 → 产出配套物料"做成一个工作台。<br />
          当前为<b>演示模式</b>，不调用真实工作流，但完整体验全部交互流程；
          最终结果页的链接指向<b>真实交付样例</b>（12 项物料清单 + 脱敏片段）。<br />
          <span class="pi-author">李雪蓉 ｜ AI 应用产品经理（toB 方向）</span>
        </div>
        <button id="pi-close">开始体验</button>
      </div>
    </div>
    <style>
      #portfolio-intro{position:fixed;inset:0;z-index:9999;background:rgba(15,19,28,.72);
        display:flex;align-items:center;justify-content:center;padding:20px;
        font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans SC","Microsoft YaHei",sans-serif}
      #portfolio-intro .pi-box{background:#fff;color:#1a1a1a;border-radius:14px;padding:26px 28px;
        max-width:520px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.35);line-height:1.75;font-size:14px}
      #portfolio-intro .pi-title{font-size:18px;font-weight:700;margin-bottom:12px}
      #portfolio-intro .pi-tag{font-size:11px;font-weight:500;background:#eef2ff;color:#4054b2;
        border-radius:999px;padding:2px 9px;margin-left:8px;vertical-align:middle}
      #portfolio-intro .pi-body{color:#3b4252;font-size:13.5px}
      #portfolio-intro .pi-author{display:inline-block;margin-top:10px;color:#5a6270;font-size:12.5px}
      #portfolio-intro button{margin-top:20px;width:100%;padding:11px;border:none;border-radius:9px;
        background:#2b4c8c;color:#fff;font-size:14px;font-weight:600;cursor:pointer}
      #portfolio-intro button:hover{background:#223d73}
    </style>
    <script>
      document.getElementById('pi-close').addEventListener('click', function () {
        document.getElementById('portfolio-intro').style.display = 'none';
      });
    </script>
'''
    s = s.replace('  <div id="root"></div>', intro + '  <div id="root"></div>', 1)
    wr(f, s)
    print('✅ index.html 已注入作品集说明层')
else:
    print('· index.html 已有说明层，跳过')

print()
print('=== 源码改动清单 ===')
for f in ['vite.config.js', 'index.html', 'src/services/cozeApi.js', 'src/components/GenerationSuccess.jsx']:
    print('  %-44s %d B' % (f, os.path.getsize(os.path.join(P, f))))
