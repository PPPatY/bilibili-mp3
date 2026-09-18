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

// 解析合集信息
function parseCollection() {
  try {
    // 方案1: 尝试从分P列表解析（单视频多分P）
    const pageLinks = document.querySelectorAll('.list-box li');
    if (pageLinks.length > 1) {
      const videos = Array.from(pageLinks).map((li, index) => {
        const link = li.querySelector('.page-link');
        const titleText = link?.getAttribute('title') || link?.textContent?.trim() || `第${index + 1}P`;
        const href = link?.href || '';
        const bvMatch = href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
        const pageMatch = href.match(/[?&]p=(\d+)/);
        return {
          bvid: bvMatch?.[1] || location.pathname.match(/\/video\/(BV[a-zA-Z0-9]+)/)?.[1] || '',
          title: titleText,
          episode: parseInt(pageMatch?.[1] || (index + 1)),
          url: href || `${location.origin}${location.pathname}?p=${index + 1}`
        };
      });

      const mainTitle = document.querySelector('h1')?.textContent?.trim() || '合集';
      return {
        ok: true,
        collection: {
          title: mainTitle,
          videos: videos.filter(v => v.bvid)
        }
      };
    }

    // 方案2: 尝试从合集sections解析（系列合集）
    const sectionItems = document.querySelectorAll('.video-sections-content-list .video-episode-card');
    if (sectionItems.length > 0) {
      const videos = Array.from(sectionItems).map((item, index) => {
        const link = item.querySelector('.video-episode-card__info-title');
        const href = item.getAttribute('href') || link?.href || '';
        const bvMatch = href.match(/\/video\/(BV[a-zA-Z0-9]+)/);
        const titleText = link?.textContent?.trim() || `第${index + 1}集`;
        return {
          bvid: bvMatch?.[1] || '',
          title: titleText,
          episode: index + 1,
          url: href ? (href.startsWith('http') ? href : `https://www.bilibili.com${href}`) : ''
        };
      });

      const collectionTitle = document.querySelector('.video-sections-head-title')?.textContent?.trim() || '合集';
      return {
        ok: true,
        collection: {
          title: collectionTitle,
          videos: videos.filter(v => v.bvid)
        }
      };
    }

    // 没有找到合集，可能是单个视频
    return {
      ok: false,
      error: '当前视频不属于合集或分P视频，无法批量下载'
    };
  } catch (error) {
    return {
      ok: false,
      error: `解析合集信息失败: ${error.message}`
    };
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'GET_VIDEO_INFO') {
    sendResponse(collectVideoInfo());
  } else if (message?.type === 'PARSE_COLLECTION') {
    sendResponse(parseCollection());
  }
  return true;
});
