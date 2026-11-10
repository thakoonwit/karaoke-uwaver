// Optional legacy direct-audio support. The browser Player does not load this module.
const streamUrlCache = new Map();
const CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 32;
let inFlight = null;

function cacheUrl(videoId, url) {
  const now = Date.now();
  for (const [id, entry] of streamUrlCache) {
    if (now - entry.timestamp >= CACHE_TTL_MS) streamUrlCache.delete(id);
  }
  streamUrlCache.delete(videoId);
  while (streamUrlCache.size >= MAX_CACHE_ENTRIES) streamUrlCache.delete(streamUrlCache.keys().next().value);
  streamUrlCache.set(videoId, { url, timestamp: now });
}

async function extractUrl(videoId) {
  const extract = require('yt-dlp-exec');
  const url = `https://www.youtube.com/watch?v=${videoId}`;
  const options = { timeout: 20000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 };
  for (const format of ['bestaudio/best', null]) {
    try {
      const flags = { getUrl: true, noWarnings: true, extractorArgs: 'youtube:player_client=ios,android,web' };
      if (format) flags.format = format;
      const output = await extract(url, flags, options);
      const value = typeof output === 'string' ? output : output.stdout;
      const streamUrl = value && value.trim().split('\n')[0];
      if (streamUrl && /^https?:\/\//.test(streamUrl)) {
        cacheUrl(videoId, streamUrl);
        return streamUrl;
      }
    } catch (err) {
      // A timed-out or oversized process must not immediately start another one.
      if (err.timedOut || err.isMaxBuffer || err.name === 'MaxBufferError') throw new Error('Audio extraction exceeded resource limits');
      if (/sign in to confirm|not a bot|private video|video unavailable/i.test(`${err.stderr || ''} ${err.message || ''}`)) {
        throw new Error('YouTube did not allow this extraction');
      }
    }
  }
  throw new Error('Unable to extract an audio stream');
}

function getAudioStreamUrl(videoId) {
  if (typeof videoId !== 'string' || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return Promise.reject(new Error('Invalid video ID'));
  const cached = streamUrlCache.get(videoId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) return Promise.resolve(cached.url);
  streamUrlCache.delete(videoId);
  if (inFlight) {
    if (inFlight.videoId === videoId) return inFlight.promise;
    const error = new Error('Audio extraction is busy');
    error.statusCode = 503;
    return Promise.reject(error);
  }
  // Schedule extraction after assigning the shared promise, preventing duplicate processes.
  const promise = Promise.resolve().then(() => extractUrl(videoId)).finally(() => { inFlight = null; });
  inFlight = { videoId, promise };
  return promise;
}

module.exports = { getAudioStreamUrl };
