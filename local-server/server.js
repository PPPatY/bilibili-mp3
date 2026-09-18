const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { execFileSync } = require('node:child_process');

const PORT = Number(process.env.PORT || 3000);
const jobs = new Map();
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bilibili-mp3-'));

const BATCH_STORE_PATH = path.join(__dirname, 'batch-store.json');

function loadBatchStore() {
  if (!fs.existsSync(BATCH_STORE_PATH)) {
    return { version: '1.0', jobs: {}, activeJobId: null, downloadHistory: {} };
  }
  try {
    return JSON.parse(fs.readFileSync(BATCH_STORE_PATH, 'utf8'));
  } catch (error) {
    console.error('加载 batch-store.json 失败:' , error.message);
    return { version: '1.0', jobs: {}, activeJobId: null, downloadHistory: {} };
  }
}

function saveBatchStore(store) {
  try {
    fs.writeFileSync(BATCH_STORE_PATH, JSON.stringify(store, null, 2), 'utf8');
  } catch (error) {
    console.error('保存 batch-store.json 失败:' , error.message);
    throw error;
  }
}

try {
  execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
} catch {
  console.warn('警告：未找到 FFmpeg。请安装 FFmpeg 并确保 ffmpeg 命令已加入 PATH。');
}

function headers(extra = {}) { return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', ...extra }; }
function json(res, status, body) { res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8' })); res.end(JSON.stringify(body)); }
function safeName(value) { return (value || 'bilibili-audio').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 100) || 'bilibili-audio'; }
function readBody(req) { return new Promise((resolve, reject) => { let data = ''; req.on('data', (c) => { data += c; if (data.length > 1000000) req.destroy(); }); req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } }); req.on('error', reject); }); }
function hasAudioStream(filePath) {
  try {
    const result = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=index', '-of', 'csv=p=0', filePath], { encoding: 'utf8' });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}
function getDuration(filePath) {
  try {
    const value = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { encoding: 'utf8' });
    const duration = Number.parseFloat(value);
    return Number.isFinite(duration) && duration > 0 ? duration : 0;
  } catch { return 0; }
}

async function runJob(job, input) {
  job.status = 'processing';
  const inputPath = path.join(tempRoot, `${job.id}.input`);
  const outputPath = path.join(tempRoot, `${job.id}.mp3`);
  const candidates = [...new Set([input.mediaUrl, ...(input.mediaCandidates || [])].filter((url) => /^https?:\/\//i.test(url)))];
  if (!candidates.length) throw new Error('没有可直接访问的媒体地址（可能是 blob: 地址），请等待视频播放后重试。');
  const requestHeaders = {
    Referer: input.pageUrl || 'https://www.bilibili.com/',
    Origin: 'https://www.bilibili.com',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/131 Safari/537.36',
    Accept: '*/*',
    ...(input.cookieHeader ? { Cookie: input.cookieHeader } : {})
  };
  const failures = [];
  let selected;
  for (const source of candidates) {
    try {
      const response = await fetch(source, { redirect: 'follow', headers: requestHeaders });
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      await new Promise((resolve, reject) => {
        const file = fs.createWriteStream(inputPath);
        require('node:stream').Readable.fromWeb(response.body).pipe(file).on('finish', resolve).on('error', reject);
      });
      const stat = fs.statSync(inputPath);
      const contentType = response.headers.get('content-type') || '';
      const bytes = fs.readFileSync(inputPath);
      const preview = bytes.subarray(0, 300).toString('utf8').replace(/\s+/g, ' ').trim();
      const header = bytes.subarray(0, 16).toString('ascii');
      if (stat.size < 1024 || /^\s*</.test(header) || /^\s*[\[{]/.test(header) || /^ok$/i.test(preview)) {
        throw new Error(`${contentType || '未知类型'}，${stat.size} 字节${preview ? `：${preview.slice(0, 100)}` : ''}`);
      }
      if (!hasAudioStream(inputPath)) {
        throw new Error(`文件不包含音频流（${contentType || '未知类型'}，可能是视频轨）`);
      }
      selected = { source, contentType, bytes: stat.size };
      break;
    } catch (error) {
      failures.push(`${new URL(source).hostname}: ${error.message}`);
      try { fs.unlinkSync(inputPath); } catch {}
    }
  }
  if (!selected) throw new Error(`所有媒体地址都不可用。\n${failures.slice(0, 3).join('\n')}`);
  job.sourceUrl = selected.source;
  job.sourceContentType = selected.contentType;
  job.sourceBytes = selected.bytes;
  const duration = getDuration(inputPath);
  await new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-codec:a', 'libmp3lame', '-b:a', input.bitrate || '192k', '-progress', 'pipe:1', '-nostats', outputPath]);
    let err = '', progress = '';
    ff.stdout.on('data', (data) => {
      progress += data.toString();
      const matches = [...progress.matchAll(/out_time_ms=(\d+)/g)];
      const latest = matches.at(-1)?.[1];
      if (latest && duration) job.progress = Math.min(99, Math.round((Number(latest) / 1000000 / duration) * 100));
      progress = progress.slice(-2000);
    });
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('error', (e) => reject(new Error(`无法启动 FFmpeg：${e.message}`)));
    ff.on('close', (code) => code === 0 ? resolve() : reject(new Error(err.slice(-500) || `FFmpeg 退出码 ${code}`)));
  });
  // FFmpeg 必须在读取完输入文件后才能清理临时源文件。
  fs.unlink(inputPath, () => {});
  job.status = 'completed'; job.progress = 100; job.filename = `${safeName(input.title)}.mp3`; job.outputPath = outputPath;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, headers()); return res.end(); }
  try {
    if (req.method === 'POST' && req.url === '/api/convert') {
      const input = await readBody(req);
      if (!input.mediaUrl) return json(res, 400, { error: '缺少 mediaUrl' });
      const id = crypto.randomUUID(); const job = { id, status: 'queued', progress: 0, createdAt: Date.now() }; jobs.set(id, job);
      runJob(job, input).catch((error) => {
        job.status = 'failed'; job.error = error.message;
        for (const suffix of ['.input', '.mp3']) fs.unlink(path.join(tempRoot, `${id}${suffix}`), () => {});
      });
      return json(res, 202, { jobId: id, status: job.status });
    }
    const match = req.url.match(/^\/api\/jobs\/([^/]+)(\/file)?$/);
    if (match) {
      const job = jobs.get(match[1]); if (!job) return json(res, 404, { error: '任务不存在或已过期' });
      if (match[2]) { if (job.status !== 'completed') return json(res, 409, { error: '文件尚未完成' }); res.writeHead(200, headers({ 'Content-Type': 'audio/mpeg', 'Content-Disposition': `attachment; filename="${encodeURIComponent(job.filename)}"` })); return fs.createReadStream(job.outputPath).pipe(res); }
      return json(res, 200, job);
    }
    // 批量任务存储API
    if (req.method === 'GET' && req.url === '/api/batch/store') {
      const store = loadBatchStore();
      return json(res, 200, store);
    }
    if (req.method === 'POST' && req.url === '/api/batch/store') {
      const store = await readBody(req);
      saveBatchStore(store);
      return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Not found' });
  } catch (error) { json(res, 400, { error: error.message }); }
});

server.listen(PORT, '127.0.0.1', () => console.log(`Bilibili MP3 local server: http://127.0.0.1:${PORT}`));
