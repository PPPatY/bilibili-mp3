const API_BASE = 'http://127.0.0.1:3000';

/**
 * 统一消息处理器
 * [INPUT]: 来自popup.js的CONVERT消息，来自batch.js的批量任务控制消息
 * [OUTPUT]: 处理单次转换和批量任务调度
 * [POS]: 扩展的后台消息中心
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 处理合集解析请求（代理chrome.tabs操作）
  if (message.type === 'PARSE_COLLECTION_REQUEST') {
    handleParseCollectionRequest(message.url)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  // 处理单次转换请求
  if (message?.type === 'CONVERT') {
    const payload = message.payload || {};
    Promise.all([
      chrome.cookies.getAll({ url: payload.pageUrl || 'https://www.bilibili.com/' }),
      chrome.cookies.getAll({ url: payload.mediaUrl || payload.pageUrl || 'https://www.bilibili.com/' })
    ]).then(([pageCookies, mediaCookies]) => {
      const cookies = [...pageCookies, ...mediaCookies].reduce((map, cookie) => map.set(`${cookie.domain}|${cookie.name}`, cookie), new Map());
      return fetch(`${API_BASE}/api/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, cookieHeader: [...cookies.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ') })
      });
    })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `服务返回 ${response.status}`);
        return body;
      })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }
  
  // 处理批量任务控制消息
  if (message.type === 'START_BATCH') {
    runBatchJob(message.batchJob);
    sendResponse({ ok: true });
    return true;
  }
  
  if (message.type === 'PAUSE_BATCH') {
    if (activeBatchJob && activeBatchJob.batchId === message.batchId) {
      activeBatchJob.status = 'paused';
      saveBatchJob(activeBatchJob);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: '任务未运行' });
    }
    return true;
  }
  
  if (message.type === 'RESUME_BATCH') {
    if (activeBatchJob && activeBatchJob.batchId === message.batchId) {
      activeBatchJob.status = 'running';
      runBatchJob(activeBatchJob);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: '任务未找到' });
    }
    return true;
  }
  
  if (message.type === 'CANCEL_BATCH') {
    if (activeBatchJob && activeBatchJob.batchId === message.batchId) {
      activeBatchJob.status = 'cancelled';
      saveBatchJob(activeBatchJob);
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: '任务未找到' });
    }
    return true;
  }

  if (message.type === 'SKIP_VIDEO') {
    if (activeBatchJob && activeBatchJob.batchId === message.batchId) {
      const videoIndex = message.videoIndex;
      if (activeBatchJob.videos[videoIndex]) {
        // 标记为跳过
        activeBatchJob.videos[videoIndex].status = 'skipped';

        // 更新统计
        if (activeBatchJob.videos[videoIndex].status === 'pending') {
          activeBatchJob.stats.pending--;
        } else if (activeBatchJob.videos[videoIndex].status === 'failed') {
          activeBatchJob.stats.failed--;
        }
        activeBatchJob.stats.skipped++;

        // 保存状态
        saveBatchJob(activeBatchJob);
        sendResponse({ ok: true });
      } else {
        sendResponse({ ok: false, error: '视频不存在' });
      }
    } else {
      sendResponse({ ok: false, error: '任务未找到' });
    }
    return true;
  }

  return false;
});

/**
 * 批量任务调度器
 * [INPUT]: 依赖 batch.js 的任务消息，content.js 的视频信息，服务端转换API
 * [OUTPUT]: 串行执行批量下载任务，更新任务状态
 * [POS]: 批量下载功能的后端调度中心
 * [PROTOCOL]: 处理 START_BATCH, PAUSE_BATCH, RESUME_BATCH, CANCEL_BATCH 消息
 */

// 批量任务全局状态
let activeBatchJob = null;
let batchProcessing = false;

// 保存批量任务到服务端
async function saveBatchJob(batchJob) {
  try {
    const response = await fetch('http://127.0.0.1:3000/api/batch/store');
    const store = await response.json();
    
    store.jobs[batchJob.batchId] = batchJob;
    store.activeJobId = batchJob.batchId;
    
    await fetch('http://127.0.0.1:3000/api/batch/store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(store)
    });
  } catch (error) {
    console.error('保存批量任务失败:', error);
  }
}

// 处理单个视频
async function processSingleVideo(batchJob, videoIndex) {
  const video = batchJob.videos[videoIndex];
  video.status = 'processing';
  batchJob.updatedAt = Date.now();
  await saveBatchJob(batchJob);

  let tab = null;
  let pageLoadListener = null;
  
  try {
    // 打开视频页面（隐藏标签）
    tab = await chrome.tabs.create({ url: video.url, active: false });
    
    // 等待页面加载（带超时）
    await new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (pageLoadListener) {
          chrome.tabs.onUpdated.removeListener(pageLoadListener);
        }
        reject(new Error('页面加载超时'));
      }, 30000); // 30秒超时
      
      pageLoadListener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === 'complete') {
          clearTimeout(timeoutId);
          chrome.tabs.onUpdated.removeListener(pageLoadListener);
          pageLoadListener = null;
          setTimeout(resolve, 2000); // 额外等待2秒确保播放器初始化
        }
      };
      chrome.tabs.onUpdated.addListener(pageLoadListener);
    });

    // 获取视频信息
    const videoInfo = await chrome.tabs.sendMessage(tab.id, { type: 'GET_VIDEO_INFO' });
    
    if (!videoInfo.mediaUrl) {
      throw new Error('未找到媒体地址');
    }

    // 获取Cookie
    const cookies = await chrome.cookies.getAll({ url: video.url });
    const cookieHeader = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 调用转换API
    const convertResponse = await fetch('http://127.0.0.1:3000/api/convert', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mediaUrl: videoInfo.mediaUrl,
        mediaCandidates: videoInfo.mediaCandidates || [],
        title: video.title,
        pageUrl: video.url,
        cookieHeader: cookieHeader,
        bitrate: batchJob.settings.bitrate
      })
    });

    const convertResult = await convertResponse.json();
    if (!convertResult.jobId) {
      throw new Error('创建转换任务失败');
    }

    video.jobId = convertResult.jobId;
    await saveBatchJob(batchJob);

    // 轮询转换状态
    let attempts = 0;
    const maxAttempts = 300; // 最多5分钟
    
    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const statusResponse = await fetch(`http://127.0.0.1:3000/api/jobs/${video.jobId}`);
      const status = await statusResponse.json();
      
      if (status.status === 'completed') {
        video.status = 'completed';
        video.filename = status.filename;
        video.completedAt = Date.now();
        batchJob.stats.completed++;
        batchJob.stats.pending--;
        
        // 下载文件
        await chrome.downloads.download({
          url: `http://127.0.0.1:3000/api/jobs/${video.jobId}/file`,
          filename: status.filename,
          saveAs: false
        });
        
        await saveBatchJob(batchJob);
        return true;
      } else if (status.status === 'failed') {
        throw new Error(status.error || '转换失败');
      }
      
      attempts++;
    }
    
    throw new Error('转换超时');
  } catch (error) {
    video.retries++;
    video.error = error.message;
    
    if (video.retries >= batchJob.settings.retryLimit) {
      video.status = 'failed';
      batchJob.stats.failed++;
      batchJob.stats.pending--;
    } else {
      video.status = 'pending';
    }
    
    await saveBatchJob(batchJob);
    return false;
  } finally {
    // 清理页面加载监听器
    if (pageLoadListener) {
      try {
        chrome.tabs.onUpdated.removeListener(pageLoadListener);
      } catch (e) {
        console.error('移除页面加载监听器失败:', e);
      }
    }
    
    // 确保始终关闭标签页
    if (tab) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch (e) {
        console.error('关闭标签页失败:', e);
      }
    }
  }
}


// 批量任务主循环
async function runBatchJob(batchJob) {
  if (batchProcessing) {
    console.warn('已有批量任务在运行');
    return;
  }

  activeBatchJob = batchJob;
  batchProcessing = true;
  batchJob.status = 'running';
  await saveBatchJob(batchJob);

  try {
    for (let i = batchJob.currentIndex; i < batchJob.videos.length; i++) {
      // 检查是否暂停或取消
      if (batchJob.status === 'paused') {
        console.log('任务已暂停');
        batchProcessing = false;
        return;
      }
      
      if (batchJob.status === 'cancelled') {
        console.log('任务已取消');
        batchProcessing = false;
        return;
      }

      const video = batchJob.videos[i];
      
      // 跳过已完成或已跳过的视频
      if (video.status === 'completed' || video.status === 'skipped') {
        continue;
      }

      batchJob.currentIndex = i;
      await saveBatchJob(batchJob);

      // 处理视频
      const success = await processSingleVideo(batchJob, i);
      
      // 等待间隔（除了最后一个视频）
      if (i < batchJob.videos.length - 1) {
        await new Promise(resolve => setTimeout(resolve, batchJob.settings.interval));
      }
    }

    // 所有视频处理完成
    batchJob.status = 'completed';
    batchJob.currentIndex = batchJob.videos.length;
    await saveBatchJob(batchJob);
  } catch (error) {
    console.error('批量任务执行失败:', error);
    batchJob.status = 'failed';
    await saveBatchJob(batchJob);
  } finally {
    batchProcessing = false;
    activeBatchJob = null;
  }
}

/**
 * 处理合集解析请求
 * [INPUT]: batch.js发来的PARSE_COLLECTION_REQUEST消息
 * [OUTPUT]: 查找或创建标签页，发送PARSE_COLLECTION到content.js
 * [POS]: chrome.tabs API的代理层
 */
async function handleParseCollectionRequest(url) {
  try {
    // 提取BV号
    const bvMatch = url.match(/BV[a-zA-Z0-9]+/);
    if (!bvMatch) {
      return { ok: false, error: '无效的视频链接' };
    }
    
    // 查找已打开的标签页
    const tabs = await chrome.tabs.query({ url: '*://www.bilibili.com/video/*' });
    let targetTab = tabs.find(tab => tab.url.includes(bvMatch[0]));
    
    if (!targetTab) {
      // 创建新标签页
      targetTab = await chrome.tabs.create({ url, active: false });
      
      // 等待页面加载
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          reject(new Error('页面加载超时'));
        }, 30000);
        
        const listener = (tabId, changeInfo) => {
          if (tabId === targetTab.id && changeInfo.status === 'complete') {
            clearTimeout(timeoutId);
            chrome.tabs.onUpdated.removeListener(listener);
            // 额外等待2秒确保页面初始化
            setTimeout(resolve, 2000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
    }
    
    // 发送解析消息到content.js
    const response = await chrome.tabs.sendMessage(targetTab.id, { type: 'PARSE_COLLECTION' });
    
    if (response.ok && response.collection) {
      return { ok: true, collection: response.collection };
    } else {
      return { ok: false, error: response.error || '解析失败' };
    }
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
