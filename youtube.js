const axios = require('axios').create({ timeout: 15000, maxContentLength: 8 * 1024 * 1024 });

// Simple in-memory search cache (1 hour TTL)
const searchCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_SEARCH_CACHE_ENTRIES = 100;

function cacheSearch(key, data) {
  const now = Date.now();
  for (const [storedKey, entry] of searchCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) searchCache.delete(storedKey);
  }
  searchCache.delete(key);
  while (searchCache.size >= MAX_SEARCH_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value);
  searchCache.set(key, { timestamp: now, data });
}

/**
 * Extract YouTube Video ID from various URL formats or direct ID
 */
function parseVideoId(input) {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // Standard YouTube URL: https://www.youtube.com/watch?v=VIDEO_ID
  // Short URL: https://youtu.be/VIDEO_ID
  // YouTube Music: https://music.youtube.com/watch?v=VIDEO_ID
  // Shorts: https://www.youtube.com/shorts/VIDEO_ID
  // Embed: https://www.youtube.com/embed/VIDEO_ID
  const urlRegex = /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/|music\.youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/;
  const match = trimmed.match(urlRegex);

  if (match && match[1]) {
    return match[1];
  }

  // Direct 11-character Video ID format
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Extract YouTube Playlist ID from various URL formats or direct ID
 */
function parsePlaylistId(input) {
  if (!input || typeof input !== 'string') return null;

  const trimmed = input.trim();

  // 1. Check for list= parameter in URL (e.g. ?list=PLxxx or &list=PLxxx)
  const match = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
  if (match && match[1]) {
    return match[1];
  }

  // 2. Direct Playlist ID starting with PL, RD, OLAK5uy_, UU, FL, etc.
  if (/^(?:PL|OLAK5uy_|RD|UU|FL)[a-zA-Z0-9_-]{10,}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Parse ISO 8601 Duration format (e.g., PT3M45S, PT1H2M30S) to seconds & string
 */
function parseIsoDuration(durationStr) {
  if (!durationStr) return { durationSec: 0, durationStr: '0:00' };

  const match = durationStr.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return { durationSec: 0, durationStr: '0:00' };

  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);

  const totalSeconds = hours * 3600 + minutes * 60 + seconds;

  let formatted = '';
  if (hours > 0) {
    formatted = `${hours}:${minutes < 10 ? '0' : ''}${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  } else {
    formatted = `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`;
  }

  return {
    durationSec: totalSeconds,
    durationStr: formatted
  };
}

/**
 * Unlimited zero-quota fallback search using native YouTube HTML scraping
 */
async function searchVideosFallback(query) {
  try {
    console.log(`[YouTube Scraper] Searching via zero-quota HTML fallback for: "${query}"`);
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
      }
    });

    const html = res.data;
    const jsonMatch = html.match(/var ytInitialData = ({.*?});<\/script>/s) || html.match(/ytInitialData = ({.*?});/s);

    if (!jsonMatch) {
      throw new Error('ไม่พบข้อมูลผลการค้นหาจาก YouTube');
    }

    const data = JSON.parse(jsonMatch[1]);
    const items = data?.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const results = [];
    for (const item of items) {
      if (results.length >= 5) break;
      const v = item.videoRenderer;
      if (!v || !v.videoId) continue;

      const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown Title';
      const channelTitle = v.ownerText?.runs?.[0]?.text || 'YouTube';
      const duration = v.lengthText?.simpleText || '3:30';
      const thumbnail = v.thumbnail?.thumbnails?.[0]?.url || `https://img.youtube.com/vi/${v.videoId}/hqdefault.jpg`;

      const parts = duration.split(':').map(n => parseInt(n, 10));
      let durationSec = 210;
      if (parts.length === 2) durationSec = parts[0] * 60 + parts[1];
      if (parts.length === 3) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];

      results.push({
        videoId: v.videoId,
        title,
        channelTitle,
        thumbnail,
        duration,
        durationSec,
        embeddable: true
      });
    }

    if (results.length === 0) {
      throw new Error('ไม่พบผลลัพธ์การค้นหาเพลงนี้');
    }

    return {
      type: 'search_results',
      results
    };
  } catch (err) {
    console.error('[YouTube Scraper] Zero-quota fallback error:', err.message);
    throw new Error('ไม่พบผลลัพธ์การค้นหาเพลงนี้ (กรุณาวางลิงก์ YouTube โดยตรงแทน)');
  }
}

/**
 * Search videos with automatic zero-quota fallback
 */
async function searchVideos(query, apiKey, karaoke = false) {
  let trimmed = query.trim();
  const playlistId = parsePlaylistId(trimmed);
  const directVideoId = parseVideoId(trimmed);

  // 1. Direct Playlist URL or Playlist ID provided -> Fetch playlist details
  if (playlistId) {
    try {
      const playlist = await getPlaylistDetails(playlistId, apiKey);
      if (playlist && playlist.videos && playlist.videos.length > 0) {
        return {
          type: 'playlist',
          playlist
        };
      }
    } catch (plErr) {
      console.warn('[YouTube Playlist] Playlist fetch failed:', plErr.message);
      // If playlist fetch failed (e.g. private playlist) but URL has direct videoId, fallback to single video!
      if (directVideoId) {
        const video = await getVideoDetails(directVideoId, apiKey);
        return {
          type: 'direct',
          video
        };
      }
      throw new Error(plErr.message || 'ไม่สามารถโหลดเพลย์ลิสต์นี้ได้');
    }
  }

  // 2. Direct Video ID or URL provided -> Fetch details (Cost = 0 API Quota)
  if (directVideoId) {
    const video = await getVideoDetails(directVideoId, apiKey);
    return {
      type: 'direct',
      video
    };
  }

  // Resolve links and IDs before adding search terms; keep mode-specific cache keys.
  if (karaoke && !/karaoke|คาราโอเกะ/i.test(trimmed)) trimmed += ' karaoke';

  // 2. Check in-memory cache
  const cacheKey = trimmed.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp >= CACHE_TTL_MS) searchCache.delete(cacheKey);
  if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
    console.log(`[YouTube Cache] Serving search results from cache for: "${trimmed}"`);
    return cached.data;
  }

  // 3. If no API Key configured, use zero-quota fallback directly
  if (!apiKey || apiKey.trim() === '' || apiKey.includes('your_youtube_data_api_key')) {
    const fallbackRes = await searchVideosFallback(trimmed);
    cacheSearch(cacheKey, fallbackRes);
    return fallbackRes;
  }

  // 4. Try YouTube Data API v3 first
  try {
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(trimmed)}&key=${apiKey}`;
    const searchRes = await axios.get(searchUrl);

    if (!searchRes.data.items || searchRes.data.items.length === 0) {
      const fallbackRes = await searchVideosFallback(trimmed);
      cacheSearch(cacheKey, fallbackRes);
      return fallbackRes;
    }

    const videoIds = searchRes.data.items.map(item => item.id.videoId).join(',');

    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoIds}&key=${apiKey}`;
    const detailsRes = await axios.get(detailsUrl);

    const results = detailsRes.data.items.map(item => {
      const { durationSec, durationStr } = parseIsoDuration(item.contentDetails.duration);
      const thumbnail = item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '/css/default-cover.png';

      return {
        videoId: item.id,
        title: item.snippet.title,
        channelTitle: item.snippet.channelTitle,
        thumbnail,
        duration: durationStr,
        durationSec,
        embeddable: item.status ? item.status.embeddable : true
      };
    });

    const resData = {
      type: 'search_results',
      results
    };

    cacheSearch(cacheKey, resData);
    return resData;

  } catch (err) {
    console.warn('[YouTube API] Official API call failed, automatically switching to zero-quota fallback:', err.response?.data || err.message);

    // Automatic Fallback on Quota Exceeded, 403 Forbidden, or API Block
    try {
      const fallbackRes = await searchVideosFallback(trimmed);
      cacheSearch(cacheKey, fallbackRes);
      return fallbackRes;
    } catch (fallbackErr) {
      throw new Error(fallbackErr.message || 'ไม่พบผลลัพธ์การค้นหาเพลงนี้');
    }
  }
}

/**
 * Fetch specific video details using YouTube API or public oEmbed fallback (No API Key needed)
 */
async function getVideoDetails(videoId, apiKey) {
  // 1. Try YouTube Data API v3 if key exists
  if (apiKey && apiKey.trim() !== '' && !apiKey.includes('your_youtube_data_api_key')) {
    try {
      const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,status&id=${videoId}&key=${apiKey}`;
      const detailsRes = await axios.get(detailsUrl);

      if (detailsRes.data.items && detailsRes.data.items.length > 0) {
        const item = detailsRes.data.items[0];
        const { durationSec, durationStr } = parseIsoDuration(item.contentDetails.duration);
        const thumbnail = item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        return {
          videoId: item.id,
          title: item.snippet.title,
          channelTitle: item.snippet.channelTitle,
          thumbnail,
          duration: durationStr,
          durationSec,
          embeddable: item.status ? item.status.embeddable : true
        };
      }
    } catch (err) {
      console.warn('[YouTube API] API key lookup failed, falling back to public oEmbed:', err.response?.data || err.message);
    }
  }

  // 2. Fallback: Public YouTube oEmbed API (100% FREE, NO API KEY REQUIRED)
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const oembedRes = await axios.get(oembedUrl);

    return {
      videoId,
      title: oembedRes.data.title || `YouTube Video (${videoId})`,
      channelTitle: oembedRes.data.author_name || 'YouTube',
      thumbnail: oembedRes.data.thumbnail_url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: '3:30',
      durationSec: 210,
      embeddable: true
    };
  } catch (err) {
    // 3. Last fallback if oEmbed fails
    return {
      videoId,
      title: `YouTube Video (${videoId})`,
      channelTitle: 'YouTube',
      thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      duration: '3:30',
      durationSec: 210,
      embeddable: true
    };
  }
}

/**
 * Fetch YouTube Playlist details and videos (Dual strategy: API v3 + Zero-Quota Scraper Fallback)
 */
async function getPlaylistDetails(playlistId, apiKey) {
  // 1. Try YouTube Data API v3 if API key is provided
  if (apiKey && apiKey.trim() !== '' && !apiKey.includes('your_youtube_data_api_key')) {
    try {
      console.log(`[YouTube Playlist] Fetching playlist via API v3 (${playlistId})...`);
      const plUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&id=${playlistId}&key=${apiKey}`;
      const plRes = await axios.get(plUrl);
      const plSnippet = plRes.data.items?.[0]?.snippet;
      const playlistTitle = plSnippet?.title || 'YouTube Playlist';
      const channelTitle = plSnippet?.channelTitle || 'YouTube';
      const thumbnail = plSnippet?.thumbnails?.medium?.url || plSnippet?.thumbnails?.default?.url || '/css/default-cover.png';

      const itemsUrl = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=${playlistId}&key=${apiKey}`;
      const itemsRes = await axios.get(itemsUrl);
      const rawItems = itemsRes.data.items || [];

      const videoIds = rawItems.map(it => it.contentDetails?.videoId).filter(Boolean).slice(0, 50).join(',');
      let durationMap = {};
      if (videoIds) {
        try {
          const vUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,status&id=${videoIds}&key=${apiKey}`;
          const vRes = await axios.get(vUrl);
          (vRes.data.items || []).forEach(v => {
            const { durationSec, durationStr } = parseIsoDuration(v.contentDetails?.duration);
            durationMap[v.id] = { durationSec, durationStr, embeddable: v.status ? v.status.embeddable : true };
          });
        } catch (e) {
          console.warn('[YouTube Playlist] Video duration batch lookup warning:', e.message);
        }
      }

      const videos = [];
      for (const it of rawItems) {
        const videoId = it.contentDetails?.videoId;
        if (!videoId || it.snippet?.title === 'Private video' || it.snippet?.title === 'Deleted video') continue;
        const dur = durationMap[videoId] || { durationSec: 210, durationStr: '3:30', embeddable: true };
        videos.push({
          videoId,
          title: it.snippet?.title || 'Unknown Title',
          channelTitle: it.snippet?.videoOwnerChannelTitle || it.snippet?.channelTitle || channelTitle,
          thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
          duration: dur.durationStr,
          durationSec: dur.durationSec,
          embeddable: dur.embeddable
        });
      }

      if (videos.length > 0) {
        return {
          id: playlistId,
          title: playlistTitle,
          channelTitle,
          thumbnail,
          itemCount: videos.length,
          videos
        };
      }
    } catch (err) {
      console.warn('[YouTube Playlist] API v3 lookup failed, falling back to zero-quota scraper:', err.response?.data?.error?.message || err.message);
    }
  }

  // 2. Zero-Quota Fallback: Fetch via YouTube public HTML scraper
  return await getPlaylistFallback(playlistId);
}

/**
 * Zero-Quota YouTube Playlist HTML Scraper (Supports both lockupViewModel and playlistVideoRenderer)
 */
async function getPlaylistFallback(playlistId) {
  try {
    console.log(`[YouTube Playlist Scraper] Fetching playlist via zero-quota HTML fallback: ${playlistId}`);
    const url = `https://www.youtube.com/playlist?list=${playlistId}`;
    const res = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'th-TH,th;q=0.9,en;q=0.8'
      }
    });

    const match = res.data.match(/var ytInitialData = ({.*?});<\/script>/s) || res.data.match(/ytInitialData = ({.*?});/s);
    if (!match) throw new Error('ไม่พบข้อมูลเพลย์ลิสต์นี้จาก YouTube');
    const data = JSON.parse(match[1]);

    const twoCol = data.contents?.twoColumnBrowseResultsRenderer;
    const sidebar = twoCol?.sidebar?.playlistSidebarRenderer?.items;
    const pInfo = sidebar?.[0]?.playlistSidebarPrimaryInfoRenderer;
    const playlistTitle = pInfo?.title?.runs?.[0]?.text || pInfo?.title?.simpleText || data.metadata?.playlistMetadataRenderer?.title || 'YouTube Playlist';
    const channelTitle = pInfo?.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url || 'YouTube';
    const thumbnail = pInfo?.thumbnailRenderer?.playlistVideoThumbnailRenderer?.thumbnail?.thumbnails?.slice(-1)[0]?.url || '/css/default-cover.png';

    const tab0 = twoCol?.tabs?.[0]?.tabRenderer;
    const secList = tab0?.content?.sectionListRenderer?.contents || [];
    let rawItems = [];
    for (const sec of secList) {
      if (sec.itemSectionRenderer?.contents) {
        rawItems = rawItems.concat(sec.itemSectionRenderer.contents);
      }
    }

    const videos = [];
    for (const item of rawItems) {
      if (item.lockupViewModel) {
        const vm = item.lockupViewModel;
        const videoId = vm.contentId || vm.rendererContext?.commandContext?.onTap?.innertubeCommand?.watchEndpoint?.videoId;
        if (!videoId) continue;
        const title = vm.metadata?.lockupMetadataViewModel?.title?.content || 'Unknown Title';
        const ch = vm.metadata?.lockupMetadataViewModel?.metadata?.contentMetadataViewModel?.metadataRows?.[0]?.metadataParts?.[0]?.text?.content || 'YouTube';
        const duration = vm.contentImage?.thumbnailViewModel?.overlays?.[0]?.thumbnailBottomOverlayViewModel?.badges?.[0]?.thumbnailBadgeViewModel?.text || '3:30';
        const thumb = vm.contentImage?.thumbnailViewModel?.image?.sources?.slice(-1)[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        const parts = duration.split(':').map(n => parseInt(n, 10));
        let durationSec = 210;
        if (parts.length === 2 && !isNaN(parts[0])) durationSec = parts[0] * 60 + parts[1];
        if (parts.length === 3 && !isNaN(parts[0])) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];

        videos.push({ videoId, title, channelTitle: ch, duration, durationSec, thumbnail: thumb, embeddable: true });
      } else if (item.playlistVideoRenderer) {
        const v = item.playlistVideoRenderer;
        if (!v || !v.videoId) continue;
        const videoId = v.videoId;
        const title = v.title?.runs?.[0]?.text || v.title?.simpleText || 'Unknown Title';
        const ch = v.shortBylineText?.runs?.[0]?.text || 'YouTube';
        const duration = v.lengthText?.simpleText || '3:30';
        const thumb = v.thumbnail?.thumbnails?.slice(-1)[0]?.url || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

        const parts = duration.split(':').map(n => parseInt(n, 10));
        let durationSec = 210;
        if (parts.length === 2 && !isNaN(parts[0])) durationSec = parts[0] * 60 + parts[1];
        if (parts.length === 3 && !isNaN(parts[0])) durationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];

        videos.push({ videoId, title, channelTitle: ch, duration, durationSec, thumbnail: thumb, embeddable: true });
      }
    }

    if (videos.length === 0) {
      throw new Error('ไม่พบเพลงในเพลย์ลิสต์นี้ หรือเป็นเพลย์ลิสต์ส่วนตัว');
    }

    return {
      id: playlistId,
      title: playlistTitle,
      channelTitle,
      thumbnail,
      itemCount: videos.length,
      videos
    };
  } catch (err) {
    console.error('[YouTube Playlist Scraper] Error:', err.message);
    throw new Error('ไม่สามารถโหลดเพลย์ลิสต์นี้ได้ (กรุณาตรวจสอบว่าเพลย์ลิสต์เปิดเป็นสาธารณะหรือไม่)');
  }
}

module.exports = {
  parseVideoId,
  parsePlaylistId,
  parseIsoDuration,
  searchVideos,
  getVideoDetails,
  getPlaylistDetails
};
