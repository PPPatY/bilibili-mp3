/**
 * batch.js - 批量下载管理页面逻辑
 * [INPUT]: 依赖 content.js 的 PARSE_COLLECTION, background.js 的批量任务消息
 * [OUTPUT]: 提供完整的批量任务UI交互
 * [POS]: 批量下载功能的前端控制器
 * [PROTOCOL]: 修改时同步更新 batch.html 的元素ID引用
 */

// DOM元素引用
const elements = {
  videoUrlInput: document.getElementById('videoUrlInput'),
  parseBtn: document.getElementById('parseBtn'),
  collectionInfo: document.getElementById('collectionInfo'),
  collectionTitle: document.getElementById('collectionTitle'),
  totalVideos: document.getElementById('totalVideos'),
  videoList: document.getElementById('videoList'),
  startIndexSelect: document.getElementById('startIndexSelect'),
  endIndexSelect: document.getElementById('endIndexSelect'),
  downloadPreview: document.getElementById('downloadPreview'),
  bitrateSelect: document.getElementById('bitrateSelect'),
  startBatchBtn: document.getElementById('startBatchBtn'),
  taskPanel: document.getElementById('taskPanel'),
  currentTaskTitle: document.getElementById('currentTaskTitle'),
  currentIndex: document.getElementById('currentIndex'),
  totalCount: document.getElementById('totalCount'),
  progressPercent: document.getElementById('progressPercent'),
  taskProgress: document.getElementById('taskProgress'),
  currentStatus: document.getElementById('currentStatus'),
  completedCount: document.getElementById('completedCount'),
  failedCount: document.getElementById('failedCount'),
  pendingCount: document.getElementById('pendingCount'),
  pauseBtn: document.getElementById('pauseBtn'),
  resumeBtn: document.getElementById('resumeBtn'),
  cancelBtn: document.getElementById('cancelBtn'),
  detailsPanel: document.getElementById('detailsPanel'),
  taskDetails: document.getElementById('taskDetails')
};

// 全局状态
let currentCollection = null;
let currentBatchJob = null;
let statusCheckInterval = null;

// 工具函数：生成UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// 工具函数：安全的文件名
function safeName(name) {
  return name.replace(/[\\/:*?"<>|\n\r]/g, '_').substring(0, 200);
}

// 解析合集
async function parseCollection() {
  const url = elements.videoUrlInput.value.trim();
  if (!url) {
    alert('请输入视频链接');
    return;
  }

  if (!url.includes('bilibili.com/video/')) {
    alert('请输入有效的B站视频链接');
    return;
  }

  elements.parseBtn.disabled = true;
  elements.parseBtn.textContent = '解析中...';

  try {
    // 通过background.js代理chrome.tabs操作
    const response = await chrome.runtime.sendMessage({
      type: 'PARSE_COLLECTION_REQUEST',
      url: url
    });

    if (response.ok && response.collection) {
      currentCollection = response.collection;
      displayCollection(response.collection);
    } else {
      alert(response.error || '解析失败');
    }
  } catch (error) {
    alert('解析失败: ' + error.message);
  } finally {
    elements.parseBtn.disabled = false;
    elements.parseBtn.textContent = '解析合集';
  }
}

// 显示合集信息
function displayCollection(collection) {
  elements.collectionTitle.textContent = collection.title;
  elements.totalVideos.textContent = collection.videos.length;

  // 填充起始集数选择器
  elements.startIndexSelect.innerHTML = collection.videos
    .map((video, index) => `<option value="${index}">第${video.episode}集</option>`)
    .join('');

  // 填充结束集数选择器（默认选中最后一集）
  elements.endIndexSelect.innerHTML = collection.videos
    .map((video, index) => `<option value="${index}" ${index === collection.videos.length - 1 ? 'selected' : ''}>第${video.episode}集</option>`)
    .join('');

  // 更新下载预览
  updateDownloadPreview();

  // 监听起始集数变化
  elements.startIndexSelect.addEventListener('change', () => {
    const startIdx = parseInt(elements.startIndexSelect.value);
    const endIdx = parseInt(elements.endIndexSelect.value);

    // 如果结束集数小于起始集数，自动调整为起始集数
    if (endIdx < startIdx) {
      elements.endIndexSelect.value = startIdx;
    }

    // 更新下载预览
    updateDownloadPreview();
  });

  // 监听结束集数变化
  elements.endIndexSelect.addEventListener('change', () => {
    updateDownloadPreview();
  });

  // 显示视频列表预览
  elements.videoList.innerHTML = collection.videos
    .map(video => `<div class="video-item">第${video.episode}集 - ${video.title}</div>`)
    .join('');

  elements.collectionInfo.hidden = false;
}

// 更新下载预览
function updateDownloadPreview() {
  if (!currentCollection) return;

  const startIdx = parseInt(elements.startIndexSelect.value);
  const endIdx = parseInt(elements.endIndexSelect.value);
  const count = endIdx - startIdx + 1;

  elements.downloadPreview.textContent = `将下载 ${count} 集（第${currentCollection.videos[startIdx].episode}集 - 第${currentCollection.videos[endIdx].episode}集）`;
  elements.downloadPreview.style.color = count > 50 ? '#f59e0b' : '#10b981';
  elements.downloadPreview.style.fontWeight = '600';
}

// 开始批量下载
async function startBatch() {
  if (!currentCollection) {
    alert('请先解析合集');
    return;
  }

  const startIndex = parseInt(elements.startIndexSelect.value);
  const endIndex = parseInt(elements.endIndexSelect.value);
  const bitrate = elements.bitrateSelect.value;

  // 验证集数范围
  if (endIndex < startIndex) {
    alert('结束集数不能小于起始集数');
    return;
  }

  // 只包含选定范围内的视频
  const selectedVideos = currentCollection.videos.slice(startIndex, endIndex + 1);

  // 创建批量任务对象
  const batchJob = {
    batchId: generateUUID(),
    collectionTitle: currentCollection.title,
    collectionUrl: elements.videoUrlInput.value,
    videos: selectedVideos.map(video => ({
      ...video,
      status: 'pending',
      jobId: null,
      retries: 0,
      error: null,
      filename: null,
      completedAt: null
    })),
    startIndex: 0,  // 在selectedVideos中从0开始
    currentIndex: 0,
    status: 'pending',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    downloadDirectory: null,  // 首次下载时会弹出选择器并保存路径
    settings: {
      bitrate: bitrate,
      retryLimit: 3,
      interval: 5000
    },
    stats: {
      total: selectedVideos.length,
      completed: 0,
      failed: 0,
      skipped: 0,
      pending: selectedVideos.length
    }
  };

  currentBatchJob = batchJob;

  // 发送到 background.js 启动任务
  chrome.runtime.sendMessage({
    type: 'START_BATCH',
    batchJob: batchJob
  }, response => {
    if (response && response.ok) {
      // 显示任务面板
      showTaskPanel();
      // 开始轮询状态
      startStatusPolling();
    } else {
      alert('启动失败: ' + (response?.error || '未知错误'));
    }
  });
}

// 显示任务面板
function showTaskPanel() {
  elements.taskPanel.hidden = false;
  elements.detailsPanel.hidden = false;
  elements.currentTaskTitle.textContent = currentBatchJob.collectionTitle;
  elements.totalCount.textContent = currentBatchJob.stats.total;
  updateTaskDisplay();
}

// 更新任务显示
function updateTaskDisplay() {
  if (!currentBatchJob) return;

  const { stats, currentIndex, videos, status } = currentBatchJob;
  const progress = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  elements.currentIndex.textContent = Math.max(0, currentIndex - currentBatchJob.startIndex + 1);
  elements.progressPercent.textContent = progress;
  elements.taskProgress.style.width = progress + '%';
  elements.completedCount.textContent = stats.completed;
  elements.failedCount.textContent = stats.failed;
  elements.pendingCount.textContent = stats.pending;

  // 更新当前状态
  if (currentIndex < videos.length) {
    const currentVideo = videos[currentIndex];
    elements.currentStatus.textContent = `正在处理: ${currentVideo.title} (${currentVideo.status})`;
  } else {
    elements.currentStatus.textContent = '所有任务已完成';
  }

  // 更新控制按钮
  if (status === 'running') {
    elements.pauseBtn.hidden = false;
    elements.resumeBtn.hidden = true;
  } else if (status === 'paused') {
    elements.pauseBtn.hidden = true;
    elements.resumeBtn.hidden = false;
  }

  // 更新详情列表
  updateTaskDetails();
}

// 更新任务详情列表
function updateTaskDetails() {
  if (!currentBatchJob) return;

  const { videos, startIndex } = currentBatchJob;
  const displayVideos = videos.slice(startIndex);

  elements.taskDetails.innerHTML = displayVideos.map((video, index) => {
    const statusIcons = {
      completed: '✅',
      processing: '⏳',
      failed: '❌',
      skipped: '⏭️',
      pending: '⏱️'
    };

    const icon = statusIcons[video.status] || '⏱️';
    const statusText = {
      completed: '已完成',
      processing: '处理中',
      failed: `失败 (重试${video.retries}/3)`,
      skipped: '已跳过',
      pending: '等待中'
    }[video.status] || '等待中';

    const info = video.filename ? `(${video.filename})` : (video.error ? `错误: ${video.error}` : '');

    // 显示取消按钮：只对pending或failed状态的视频显示
    const showCancelBtn = (video.status === 'pending' || video.status === 'failed') &&
                          (currentBatchJob.status === 'running' || currentBatchJob.status === 'paused');
    const cancelBtn = showCancelBtn ? `<button class="cancel-single-btn" data-video-index="${startIndex + index}">✖ 取消</button>` : '';

    return `
      <div class="detail-item ${video.status}">
        <div class="detail-item-icon">${icon}</div>
        <div class="detail-item-content">
          <div class="detail-item-title">第${video.episode}集 - ${video.title}</div>
          <div class="detail-item-info">${statusText} ${info}</div>
        </div>
        ${cancelBtn}
      </div>
    `;
  }).join('');

  // 绑定单个取消按钮事件
  document.querySelectorAll('.cancel-single-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const videoIndex = parseInt(e.target.dataset.videoIndex);
      cancelSingleVideo(videoIndex);
    });
  });
}

// 开始轮询状态
function startStatusPolling() {
  if (statusCheckInterval) {
    clearInterval(statusCheckInterval);
  }

  statusCheckInterval = setInterval(async () => {
    try {
      // 从服务端加载最新状态
      const response = await fetch('http://127.0.0.1:3000/api/batch/store');
      const store = await response.json();

      if (store.jobs && store.jobs[currentBatchJob.batchId]) {
        currentBatchJob = store.jobs[currentBatchJob.batchId];
        updateTaskDisplay();

        // 如果任务已完成，停止轮询
        if (currentBatchJob.status === 'completed' || currentBatchJob.status === 'cancelled') {
          clearInterval(statusCheckInterval);
        }
      }
    } catch (error) {
      console.error('轮询状态失败:', error);
    }
  }, 2000);
}

// 暂停任务
function pauseBatch() {
  chrome.runtime.sendMessage({
    type: 'PAUSE_BATCH',
    batchId: currentBatchJob.batchId
  });
}

// 恢复任务
function resumeBatch() {
  chrome.runtime.sendMessage({
    type: 'RESUME_BATCH',
    batchId: currentBatchJob.batchId
  });
}

// 取消任务
function cancelBatch() {
  const pendingCount = currentBatchJob.videos.filter(v => v.status === 'pending' || v.status === 'failed').length;
  const message = pendingCount > 0
    ? `确定要停止当前任务吗？\n\n已完成: ${currentBatchJob.stats.completed}集\n剩余未下载: ${pendingCount}集\n\n已下载的视频会保留。`
    : '当前任务已完成所有下载，确定要停止吗？';

  if (!confirm(message)) {
    return;
  }

  chrome.runtime.sendMessage({
    type: 'CANCEL_BATCH',
    batchId: currentBatchJob.batchId
  });
}

// 取消单个视频
function cancelSingleVideo(videoIndex) {
  if (!currentBatchJob || !currentBatchJob.videos[videoIndex]) {
    return;
  }

  const video = currentBatchJob.videos[videoIndex];

  if (!confirm(`确定要取消下载《第${video.episode}集 - ${video.title}》吗？`)) {
    return;
  }

  // 将该视频标记为skipped
  chrome.runtime.sendMessage({
    type: 'SKIP_VIDEO',
    batchId: currentBatchJob.batchId,
    videoIndex: videoIndex
  }, response => {
    if (response && response.ok) {
      // 立即更新本地状态
      currentBatchJob.videos[videoIndex].status = 'skipped';
      currentBatchJob.stats.pending--;
      currentBatchJob.stats.skipped++;
      updateTaskDisplay();
    } else {
      alert('取消失败: ' + (response?.error || '未知错误'));
    }
  });
}

// 事件监听
elements.parseBtn.addEventListener('click', parseCollection);
elements.startBatchBtn.addEventListener('click', startBatch);
elements.pauseBtn.addEventListener('click', pauseBatch);
elements.resumeBtn.addEventListener('click', resumeBatch);
elements.cancelBtn.addEventListener('click', cancelBatch);

// 页面加载时检查是否有未完成任务
window.addEventListener('load', async () => {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/batch/store');
    const store = await response.json();

    if (store.activeJobId && store.jobs[store.activeJobId]) {
      const job = store.jobs[store.activeJobId];
      if (job.status === 'running' || job.status === 'paused') {
        if (confirm(`检测到未完成任务《${job.collectionTitle}》，已完成${job.stats.completed}集，是否继续？`)) {
          currentBatchJob = job;
          currentCollection = {
            title: job.collectionTitle,
            videos: job.videos
          };
          showTaskPanel();
          if (job.status === 'running') {
            startStatusPolling();
          }
        }
      }
    }
  } catch (error) {
    console.error('加载任务失败:', error);
  }
});
