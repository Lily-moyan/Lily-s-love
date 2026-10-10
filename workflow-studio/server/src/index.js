import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { api } from './routes.js';
import { seedDemo } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
seedDemo();

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api', api);

// 生产模式：直接托管前端构建产物
const webDist = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      res.sendFile(path.join(webDist, 'index.html'));
    } else {
      next();
    }
  });
}

const port = Number(process.env.PORT || 3010);
app.listen(port, '127.0.0.1', () => {
  console.log(`[wf-server] http://127.0.0.1:${port}`);
  console.log(
    `[wf-server] LLM 节点: ${process.env.LLM_API_KEY ? '已配置 API Key' : '未配置（mock 模式）'} · 模型: ${process.env.LLM_MODEL || 'deepseek-chat'}`,
  );
});
