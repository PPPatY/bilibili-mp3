function collectVideoInfo() {
  const video = document.querySelector('video');
  const title = document.querySelector('h1')?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*$/, '').trim();
  const match = location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/);
  const resourceUrls = performance.getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((url) => /^https?:\/\//i.test(url) && /\.(m4s|mp4|mp3|m4a)(\?|$)/i.test(url));
  const mediaCandidates = [...new Set([video?.currentSrc, video?.src, ...resourceUrls].filter(Boolean))];
  const audioCandidate = mediaCandidates.find((url) => /audio|\.m4a|\.mp3|audio.m4s/i.test(url));
  return {
    title,
    videoId: match?.[1] || '',
    mediaUrl: audioCandidate || mediaCandidates[0] || '',
    mediaCandidates,
    pageUrl: location.href
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_VIDEO_INFO') {
    sendResponse(collectVideoInfo());
  }
  return true;
});
