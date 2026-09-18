const API_BASE = 'http://127.0.0.1:3000';

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'CONVERT') return;
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
});
