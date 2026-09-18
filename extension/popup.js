let videoInfo;
const titleEl = document.getElementById('title');
const statusEl = document.getElementById('status');
const button = document.getElementById('convert');
const mediaUrlInput = document.getElementById('mediaUrl');
const progressPanel = document.getElementById('progressPanel');
const progressBar = document.getElementById('progressBar');
const percentEl = document.getElementById('percent');
const phaseEl = document.getElementById('phase');
const elapsedEl = document.getElementById('elapsed');
const fileNameEl = document.getElementById('fileName');

function setStatus(text, error = false) {
  statusEl.textContent = text;
  statusEl.style.color = error ? '#c5221f' : '#3c4043';
}
function setProgress(progress, phase, startedAt, filename = '') {
  progressPanel.hidden = false;
  const value = Math.max(0, Math.min(100, Number(progress) || 0));
  progressBar.style.width = `${value}%`;
  percentEl.textContent = `${value}%`;
  phaseEl.textContent = phase;
  elapsedEl.textContent = `已用时 ${Math.max(0, Math.floor((Date.now() - startedAt) / 1000))} 秒`;
  fileNameEl.textContent = filename;
}

async function loadInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url?.includes('bilibili.com/video/')) {
    titleEl.textContent = '请先打开 Bilibili 视频页面';
    return;
  }
  try {
    videoInfo = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' });
    titleEl.textContent = videoInfo.title || videoInfo.videoId || '未读取到视频标题';
    mediaUrlInput.value = videoInfo.mediaUrl || '';
    button.disabled = !videoInfo.mediaUrl;
    if (!videoInfo.mediaUrl) setStatus('未找到可直接访问的媒体地址，请等待视频播放后重试。', true);
  } catch (error) {
    titleEl.textContent = '无法读取页面信息';
    setStatus(error.message, true);
  }
}

button.addEventListener('click', () => {
  button.disabled = true;
  setStatus('正在提交转换任务…');
  const startedAt = Date.now();
  setProgress(0, '准备任务', startedAt);
  chrome.runtime.sendMessage({
    type: 'CONVERT',
    payload: { ...videoInfo, mediaUrl: mediaUrlInput.value.trim(), bitrate: document.getElementById('bitrate').value }
  }, async (response) => {
    if (chrome.runtime.lastError || !response?.ok) {
      setStatus(chrome.runtime.lastError?.message || response?.error || '提交失败', true);
      button.disabled = false;
      return;
    }
    setStatus('服务端正在处理媒体，请保持窗口打开。');
    setProgress(1, '下载媒体', startedAt);
    const timer = setInterval(async () => {
      try {
        const result = await fetch(`http://127.0.0.1:3000/api/jobs/${response.jobId}`).then((r) => r.json());
        if (result.status === 'processing') {
          setProgress(result.progress || 5, (result.progress || 0) > 0 ? '转换音频' : '下载媒体', startedAt);
        } else if (result.status === 'completed') {
          clearInterval(timer);
          await chrome.downloads.download({ url: `http://127.0.0.1:3000/api/jobs/${response.jobId}/file`, filename: result.filename, saveAs: true });
          setProgress(100, '已完成', startedAt, result.filename);
          setStatus('转换完成，已开始下载。');
          button.disabled = false;
        } else if (result.status === 'failed') {
          clearInterval(timer); setProgress(result.progress || 0, '转换失败', startedAt); setStatus(result.error || '转换失败', true); button.disabled = false;
        }
      } catch (error) { clearInterval(timer); setStatus('无法连接本地服务，请确认 npm start 仍在运行。', true); button.disabled = false; }
    }, 1000);
  });
});

mediaUrlInput.addEventListener('input', () => {
  button.disabled = !mediaUrlInput.value.trim();
});

// 批量下载按钮
const batchBtn = document.getElementById('batchBtn');
if (batchBtn) {
  batchBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('batch.html') });
  });
}

loadInfo();
