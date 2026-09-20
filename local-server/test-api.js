// 测试API脚本
const testJobId = 'test-' + Date.now();

// 1. 测试创建任务
fetch('http://127.0.0.1:3000/api/convert', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mediaUrl: 'https://example.com/test.mp3',
    title: 'Test Video',
    pageUrl: 'https://www.bilibili.com/video/BV1234567890',
    bitrate: '192k'
  })
})
.then(r => r.json())
.then(result => {
  console.log('创建任务响应:', result);

  if (result.jobId) {
    // 2. 测试查询任务
    setTimeout(() => {
      fetch(`http://127.0.0.1:3000/api/jobs/${result.jobId}`)
        .then(r => r.json())
        .then(job => {
          console.log('任务状态:', job);
        })
        .catch(err => console.error('查询任务失败:', err));
    }, 1000);
  }
})
.catch(err => console.error('创建任务失败:', err));
