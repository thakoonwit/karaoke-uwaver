const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.KARAOKE_DATA_DIR || path.join(__dirname, 'data');
const QUEUE_FILE = path.join(DATA_DIR, 'queue.json');
const bangkokDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
});

const AUTO_DJ_PLAYLIST = [
  { videoId: 'jfKfPfyJRdk', title: 'Lofi Hip Hop Radio - Beats to Relax/Study to', channelTitle: 'Lofi Girl', duration: '4:00', durationSec: 240, thumbnail: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg' },
  { videoId: '5qap5aO4i9A', title: 'Lofi Hip Hop Radio - 24/7 Chill Beats', channelTitle: 'Lofi Girl', duration: '3:45', durationSec: 225, thumbnail: 'https://img.youtube.com/vi/5qap5aO4i9A/hqdefault.jpg' },
  { videoId: 'n61ULEU7QD4', title: 'Chill Lofi Beats for Work & Study', channelTitle: 'Lofi Records', duration: '4:20', durationSec: 260, thumbnail: 'https://img.youtube.com/vi/n61ULEU7QD4/hqdefault.jpg' },
  { videoId: 'TURbeWK2wwg', title: 'Relaxing Acoustic Guitar Chill Beats', channelTitle: 'Acoustic Chill', duration: '3:50', durationSec: 230, thumbnail: 'https://img.youtube.com/vi/TURbeWK2wwg/hqdefault.jpg' },
  { videoId: 'pLq93lOdaLg', title: 'Chillhop Essentials - Relaxing Lofi Beats', channelTitle: 'Chillhop Music', duration: '4:10', durationSec: 250, thumbnail: 'https://img.youtube.com/vi/pLq93lOdaLg/hqdefault.jpg' }
];

function validateMetadata(song) {
  if (!song || typeof song !== 'object') throw new Error('ข้อมูลเพลงไม่ถูกต้อง');
  const limits = { title: 500, videoId: 64, thumbnail: 2048, channelTitle: 200, duration: 24, requester: 20, deviceId: 128 };
  for (const [key, limit] of Object.entries(limits)) {
    if (song[key] != null && (typeof song[key] !== 'string' || song[key].length > limit)) throw new Error('ข้อมูลเพลงยาวเกินกำหนดหรือรูปแบบไม่ถูกต้อง');
  }
  if (song.videoId && !/^[a-zA-Z0-9_-]+$/.test(song.videoId)) throw new Error('รหัสวิดีโอไม่ถูกต้อง');
  if (song.thumbnail && (!/^(https?:\/\/|\/[^/])/.test(song.thumbnail) || /[<>"']/.test(song.thumbnail))) throw new Error('ลิงก์ปกเพลงไม่ถูกต้อง');
  if (song.duration && /[<>"']/.test(song.duration)) throw new Error('ระยะเวลาเพลงไม่ถูกต้อง');
  if (song.durationSec != null && (!Number.isFinite(song.durationSec) || song.durationSec < 0)) throw new Error('ระยะเวลาเพลงไม่ถูกต้อง');
}

class QueueManager {
  constructor(options = {}) {
    this.storageDir = options.roomId ? path.join(DATA_DIR, 'rooms') : DATA_DIR;
    this.queueFile = options.roomId ? path.join(this.storageDir, options.roomId + '.json') : QUEUE_FILE;
    this.maxRoomQueue = options.roomId ? 100 : Infinity;
    this.currentSong = null;
    this.playerVolume = 100;
    this.items = [];
    this.history = [];
    this.requestHistory = [];
    this.isAcceptingRequests = true;
    this.isUserReorderEnabled = false;
    this.isAutoDjEnabled = !options.roomId;
    this.isTodayHistoryReplayEnabled = !options.roomId;
    this.maxQueuePerDevice = parseInt(process.env.MAX_QUEUE_PER_DEVICE || '2', 10);
    this.maxTrackMinutes = parseInt(process.env.MAX_TRACK_MINUTES || '10', 10);
    this.cooldownMinutes = parseInt(process.env.REQUEST_COOLDOWN_MINUTES || '0', 10);
    this.lastRequestByDevice = {}; // Stores { deviceId: timestamp }

    this.ensureStorage();
    this.load();
  }

  ensureStorage() {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
    if (!fs.existsSync(this.queueFile)) {
      this.save();
    }
  }

  load() {
    try {
      if (fs.existsSync(this.queueFile)) {
        const data = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'));
        if (Number.isInteger(data.playerVolume) && data.playerVolume >= 0 && data.playerVolume <= 100) {
          this.playerVolume = data.playerVolume;
        }
        this.currentSong = data.currentSong || null;
        this.items = Array.isArray(data.items) ? data.items : [];
        this.history = Array.isArray(data.history) ? data.history.slice(-200) : [];
        // Older installs can recover requests still present in their saved queue/history.
        this.requestHistory = Array.isArray(data.requestHistory)
          ? data.requestHistory
          : [...this.history, ...this.items, ...(this.currentSong ? [this.currentSong] : [])];
        this.isAcceptingRequests = typeof data.isAcceptingRequests === 'boolean' ? data.isAcceptingRequests : true;
        this.isUserReorderEnabled = data.isUserReorderEnabled === true;
        this.isAutoDjEnabled = typeof data.isAutoDjEnabled === 'boolean' ? data.isAutoDjEnabled : true;
        this.isTodayHistoryReplayEnabled = typeof data.isTodayHistoryReplayEnabled === 'boolean' ? data.isTodayHistoryReplayEnabled : true;
        if (typeof data.maxQueuePerDevice === 'number') this.maxQueuePerDevice = data.maxQueuePerDevice;
        if (typeof data.maxTrackMinutes === 'number') this.maxTrackMinutes = data.maxTrackMinutes;
        if (typeof data.cooldownMinutes === 'number') this.cooldownMinutes = data.cooldownMinutes;
        this.lastRequestByDevice = data.lastRequestByDevice || {};
      }
    } catch (err) {
      console.error('[Queue] Error loading queue.json, initializing empty state:', err.message);
      this.currentSong = null;
      this.items = [];
      this.history = [];
      this.requestHistory = [];
      this.isAcceptingRequests = true;
      this.isUserReorderEnabled = false;
      this.isAutoDjEnabled = true;
      this.isTodayHistoryReplayEnabled = true;
      this.maxQueuePerDevice = parseInt(process.env.MAX_QUEUE_PER_DEVICE || '2', 10);
      this.maxTrackMinutes = parseInt(process.env.MAX_TRACK_MINUTES || '10', 10);
      this.cooldownMinutes = parseInt(process.env.REQUEST_COOLDOWN_MINUTES || '0', 10);
      this.lastRequestByDevice = {};
      this.save();
    }
  }

  save() {
    try {
      // Match the existing on-disk playback history limit in RAM as well.
      if (this.history.length > 200) this.history.splice(0, this.history.length - 200);
      const oldestCooldown = Date.now() - Math.max(86400000, this.cooldownMinutes * 60000);
      for (const deviceId of Object.keys(this.lastRequestByDevice)) {
        if (this.lastRequestByDevice[deviceId] < oldestCooldown) delete this.lastRequestByDevice[deviceId];
      }
      this.requestHistory = this.getTodayRequestHistory().songs;
      const data = {
        requestHistory: this.requestHistory,
        playerVolume: this.playerVolume,
        currentSong: this.currentSong,
        items: this.items,
        history: this.history.slice(-200),
        isAcceptingRequests: this.isAcceptingRequests,
        isUserReorderEnabled: this.isUserReorderEnabled,
        isAutoDjEnabled: this.isAutoDjEnabled,
        isTodayHistoryReplayEnabled: this.isTodayHistoryReplayEnabled,
        maxQueuePerDevice: this.maxQueuePerDevice,
        maxTrackMinutes: this.maxTrackMinutes,
        cooldownMinutes: this.cooldownMinutes,
        lastRequestByDevice: this.lastRequestByDevice
      };
      if (this.maxRoomQueue !== Infinity) this.requestHistory = this.requestHistory.slice(-500);
      data.requestHistory = this.requestHistory;
      fs.writeFileSync(this.queueFile, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      console.error('[Queue] Error saving queue.json:', err.message);
    }
  }

  /**
   * Add a new song to the queue with strict validation rules
   */
  addSong(songData) {
    validateMetadata(songData);
    if (this.items.length >= this.maxRoomQueue) throw new Error('คิวห้องนี้เต็มแล้ว กรุณารอให้เพลงในคิวลดลง');
    const { title, videoId, thumbnail, channelTitle, duration, durationSec, requester, deviceId } = songData;

    const maxQueuePerDevice = this.maxQueuePerDevice;
    const maxTrackMinutes = this.maxTrackMinutes;
    const cooldownMinutes = this.cooldownMinutes;

    // Rule 1: Check if server is accepting requests
    if (!this.isAcceptingRequests) {
      throw new Error('ระบบปิดรับเพลงชั่วคราว');
    }

    // Rule 2: Max track duration
    if (durationSec > maxTrackMinutes * 60) {
      throw new Error(`เพลงนี้ยาวเกิน ${maxTrackMinutes} นาที`);
    }

    // Rule 3: Cooldown check per device (minimum 2 minutes)
    const now = Date.now();
    const lastTime = this.lastRequestByDevice[deviceId] || 0;
    const elapsedMinutes = (now - lastTime) / (1000 * 60);

    if (elapsedMinutes < cooldownMinutes) {
      const remainingSec = Math.ceil((cooldownMinutes * 60 * 1000 - (now - lastTime)) / 1000);
      throw new Error(`กรุณารอสักครู่ก่อนขอเพลงเพิ่ม (รออีก ${remainingSec} วินาที)`);
    }

    // Rule 4: Max pending songs per device
    const devicePendingCount = this.items.filter(item => item.deviceId === deviceId).length;
    if (devicePendingCount >= maxQueuePerDevice) {
      throw new Error(`คุณมีเพลงรอครบ ${maxQueuePerDevice} เพลงแล้ว`);
    }

    // Rule 5: No duplicate songs in queue or currently playing
    const isDupQueue = this.items.some(item => item.videoId === videoId);
    const isDupCurrent = this.currentSong && !this.currentSong.isAutoDj && this.currentSong.videoId === videoId;

    if (isDupQueue || isDupCurrent) {
      throw new Error('เพลงนี้อยู่ในคิวแล้ว');
    }

    const newItem = {
      id: 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
      title: title || 'Unknown Title',
      videoId,
      thumbnail: thumbnail || `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      channelTitle: channelTitle || '',
      duration: duration || '0:00',
      durationSec: durationSec || 0,
      requester: requester || 'พนักงานออฟฟิศ',
      deviceId: deviceId || 'unknown_device',
      requestedAt: now
    };

    this.items.push(newItem);
    this.requestHistory.push({ ...newItem });
    this.lastRequestByDevice[deviceId] = now;

    // If currently playing Auto-DJ song, advance immediately to the user's song!
    if (this.currentSong && this.currentSong.isAutoDj) {
      this.nextSong();
    }

    this.save();
    return newItem;
  }

  /**
   * Add multiple songs from a playlist to the queue
   */
  addPlaylist(playlistData) {
    const { title, songs, requester, deviceId } = playlistData;

    if (!this.isAcceptingRequests) {
      throw new Error('ระบบปิดรับเพลงชั่วคราว');
    }

    if (!Array.isArray(songs) || songs.length === 0) {
      throw new Error('ไม่พบรายการเพลงในเพลย์ลิสต์');
    }
    validateMetadata({ requester, deviceId });
    if (title != null && (typeof title !== 'string' || title.length > 200)) throw new Error('ชื่อเพลย์ลิสต์ไม่ถูกต้อง');
    for (const song of songs) validateMetadata(song);

    const maxTrackMinutes = this.maxTrackMinutes;
    const maxPlaylistImport = parseInt(process.env.MAX_PLAYLIST_IMPORT || '20', 10);

    const now = Date.now();
    const addedSongs = [];
    let skippedCount = 0;

    for (const song of songs) {
      if (this.items.length >= this.maxRoomQueue) break;
      if (addedSongs.length >= maxPlaylistImport) break;
      if (!song.videoId || !song.title) continue;

      // Skip tracks longer than maxTrackMinutes
      if (song.durationSec && song.durationSec > maxTrackMinutes * 60) {
        skippedCount++;
        continue;
      }

      // Check duplicates in queue, current playing, or already added in this batch
      const isDupQueue = this.items.some(item => item.videoId === song.videoId);
      const isDupCurrent = this.currentSong && !this.currentSong.isAutoDj && this.currentSong.videoId === song.videoId;
      const isDupBatch = addedSongs.some(item => item.videoId === song.videoId);

      if (isDupQueue || isDupCurrent || isDupBatch) {
        skippedCount++;
        continue;
      }

      const newItem = {
        id: 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: song.title,
        videoId: song.videoId,
        thumbnail: song.thumbnail || `https://img.youtube.com/vi/${song.videoId}/hqdefault.jpg`,
        channelTitle: song.channelTitle || '',
        duration: song.duration || '0:00',
        durationSec: song.durationSec || 0,
        requester: requester || 'พนักงานออฟฟิศ',
        deviceId: deviceId || 'unknown_device',
        playlistTitle: title || '',
        requestedAt: now
      };

      this.items.push(newItem);
      this.requestHistory.push({ ...newItem });
      addedSongs.push(newItem);
    }

    if (addedSongs.length === 0) {
      throw new Error('ไม่มีเพลงใหม่ที่สามารถเพิ่มได้ (เพลงอาจอยู่ในคิวแล้ว หรือความยาวเกินกำหนด)');
    }

    this.lastRequestByDevice[deviceId] = now;

    // If currently playing Auto-DJ or no current song, start playing the first song!
    if (!this.currentSong || this.currentSong.isAutoDj) {
      this.nextSong();
    }

    this.save();

    return {
      addedCount: addedSongs.length,
      skippedCount,
      addedSongs
    };
  }

  /**
   * Shared request log; separate from playback history so removed requests remain visible.
   * Project only public display fields; never expose device identifiers.
   */
  getTodayRequestHistory(now = Date.now()) {
    const date = bangkokDay.format(new Date(now));
    const entries = new Map();
    for (const item of this.requestHistory) {
      if (!item || item.isAutoDj || !item.videoId || !Number.isFinite(item.requestedAt)) continue;
      const requested = new Date(item.requestedAt);
      if (!Number.isFinite(requested.getTime()) || bangkokDay.format(requested) !== date) continue;
      const key = item.id || JSON.stringify([item.videoId, item.requester, item.requestedAt]);
      entries.set(key, {
        id: key, videoId: item.videoId, title: item.title || 'ไม่ทราบชื่อเพลง',
        thumbnail: item.thumbnail || '', requester: item.requester || 'พนักงานออฟฟิศ',
        duration: item.duration || '0:00', requestedAt: item.requestedAt,
        playlistTitle: item.playlistTitle || ''
      });
    }
    return {
      date, timeZone: 'Asia/Bangkok',
      songs: [...entries.values()].sort((a, b) => b.requestedAt - a.requestedAt)
    };
  }

  /**
   * Get unique songs requested today
   */
  getTodayRequestedSongs() {
    const todayStr = new Date().toDateString();
    const uniqueMap = new Map();

    this.history.forEach(item => {
      if (!item.videoId || item.isAutoDj) return;
      const timestamp = item.requestedAt || item.finishedAt || item.startedAt;
      if (timestamp && new Date(timestamp).toDateString() === todayStr) {
        if (!uniqueMap.has(item.videoId)) {
          uniqueMap.set(item.videoId, item);
        }
      }
    });

    return Array.from(uniqueMap.values());
  }

  /**
   * Pop the next song from queue and set as currentSong
   */
  nextSong() {
    if (this.currentSong && !this.currentSong.isAutoDj) {
      this.history.push({
        ...this.currentSong,
        finishedAt: Date.now()
      });
    }

    if (this.items.length > 0) {
      this.currentSong = this.items.shift();
      this.currentSong.startedAt = Date.now();
    } else if (this.isTodayHistoryReplayEnabled && this.getTodayRequestedSongs().length > 0) {
      // Today's History Replay Mode: Pick a random song requested today
      const todaySongs = this.getTodayRequestedSongs();
      const randomTrack = todaySongs[Math.floor(Math.random() * todaySongs.length)];
      this.currentSong = {
        title: randomTrack.title,
        videoId: randomTrack.videoId,
        thumbnail: randomTrack.thumbnail,
        channelTitle: randomTrack.channelTitle || '',
        duration: randomTrack.duration || '0:00',
        durationSec: randomTrack.durationSec || 0,
        id: 'today_replay_' + Date.now() + '_' + Math.random().toString(36).substring(2, 5),
        requester: `🔄 สุ่มจากเพลงวันนี้ (${randomTrack.requester || 'พนักงานออฟฟิศ'})`,
        deviceId: 'today_replay_system',
        isAutoDj: true,
        startedAt: Date.now()
      };
    } else if (this.isAutoDjEnabled) {
      // Auto-DJ Fallback Mode: Pick a random song from Auto-DJ Playlist
      const randomAutoTrack = AUTO_DJ_PLAYLIST[Math.floor(Math.random() * AUTO_DJ_PLAYLIST.length)];
      this.currentSong = {
        ...randomAutoTrack,
        id: 'autodj_' + Date.now(),
        requester: '🤖 Auto-DJ',
        deviceId: 'autodj_system',
        isAutoDj: true,
        startedAt: Date.now()
      };
    } else {
      this.currentSong = null;
    }

    this.save();
    return this.currentSong;
  }

  /**
   * Toggle Auto-DJ status (Admin command)
   */
  toggleAutoDj(status) {
    if (typeof status === 'boolean') {
      this.isAutoDjEnabled = status;
    } else {
      this.isAutoDjEnabled = !this.isAutoDjEnabled;
    }
    if (!this.isAutoDjEnabled && this.currentSong && this.currentSong.isAutoDj) {
      this.nextSong();
    }
    this.save();
    return this.isAutoDjEnabled;
  }

  /**
   * Toggle Today History Replay status (Admin command)
   */
  toggleTodayHistoryReplay(status) {
    if (typeof status === 'boolean') {
      this.isTodayHistoryReplayEnabled = status;
    } else {
      this.isTodayHistoryReplayEnabled = !this.isTodayHistoryReplayEnabled;
    }
    this.save();
    return this.isTodayHistoryReplayEnabled;
  }

  /**
   * Move a pending song by one position without changing playback or request history.
   */
  moveSong(songId, direction, expectedNeighborId) {
    if (typeof songId !== 'string' || !songId) throw new Error('ไม่พบ ID เพลงที่ต้องการเลื่อน');
    if (direction !== 'up' && direction !== 'down') throw new Error('ทิศทางการเลื่อนคิวไม่ถูกต้อง');
    const index = this.items.findIndex(item => item.id === songId);
    if (index === -1) throw new Error('เพลงนี้ไม่อยู่ในคิวแล้ว กรุณารอรายการอัปเดต');
    const target = index + (direction === 'up' ? -1 : 1);
    if (target < 0 || target >= this.items.length) throw new Error('ไม่สามารถเลื่อนเพลงเกินขอบเขตคิวได้');
    if (expectedNeighborId !== undefined && this.items[target].id !== expectedNeighborId) throw new Error('คิวเปลี่ยนแล้ว กรุณาลองเลื่อนจากรายการล่าสุด');
    [this.items[index], this.items[target]] = [this.items[target], this.items[index]];
    this.save();
  }

  setUserReorder(enabled) {
    if (typeof enabled !== 'boolean') throw new Error('กรุณาระบุสถานะเปิดหรือปิด');
    this.isUserReorderEnabled = enabled;
    this.save();
  }

  moveUserSong(songId, direction, expectedNeighborId) {
    if (!this.isUserReorderEnabled) throw new Error('แอดมินยังไม่อนุญาตให้ผู้ใช้จัดคิว');
    if (typeof expectedNeighborId !== 'string' || !expectedNeighborId) throw new Error('กรุณาใช้รายการคิวล่าสุด');
    this.moveSong(songId, direction, expectedNeighborId);
  }

  reorderUserSong(songId, toIndex, expectedOrder) {
    if (!this.isUserReorderEnabled) throw new Error('แอดมินยังไม่อนุญาตให้ผู้ใช้จัดคิว');
    if (!Array.isArray(expectedOrder) || expectedOrder.length !== this.items.length || !this.items.every((item, index) => item.id === expectedOrder[index])) throw new Error('คิวเปลี่ยนแล้ว กรุณาลองลากจากรายการล่าสุด');
    if (!Number.isInteger(toIndex) || toIndex < 0 || toIndex >= this.items.length) throw new Error('ตำแหน่งคิวไม่ถูกต้อง');
    const fromIndex = this.items.findIndex(item => item.id === songId);
    if (fromIndex === -1) throw new Error('เพลงนี้ไม่อยู่ในคิวรอร้องแล้ว');
    if (fromIndex === toIndex) return;
    const [song] = this.items.splice(fromIndex, 1);
    this.items.splice(toIndex, 0, song);
    this.save();
  }

  /** Remove a specific pending song by ID (Admin command). */
  removeSong(songId) {
    const index = this.items.findIndex(item => item.id === songId);
    if (index !== -1) {
      const removed = this.items.splice(index, 1)[0];
      this.save();
      return removed;
    }
    return null;
  }

  /**
   * Remove a specific song from queue if it belongs to the requesting device
   */
  removeOwnSong(songId, deviceId) {
    const index = this.items.findIndex(item => item.id === songId && item.deviceId === deviceId);
    if (index !== -1) {
      const removed = this.items.splice(index, 1)[0];
      this.save();
      return removed;
    }
    throw new Error('ไม่สามารถลบเพลงนี้ได้ (เฉพาะผู้ขอเพลงเท่านั้น)');
  }

  /**
   * Clear all pending items in queue (Admin command)
   */
  clearQueue() {
    const count = this.items.length;
    this.items = [];
    this.save();
    return count;
  }

  /**
   * Toggle accepting requests (Admin command)
   */
  setAcceptingRequests(status) {
    this.isAcceptingRequests = !!status;
    this.save();
    return this.isAcceptingRequests;
  }

  /**
   * Get top 5 most requested songs in office history
   */
  getTopSongs() {
    const counts = {};
    const songDetails = {};

    [...this.history, ...this.items, ...(this.currentSong ? [this.currentSong] : [])].forEach(item => {
      if (!item.videoId || item.isAutoDj) return;
      counts[item.videoId] = (counts[item.videoId] || 0) + 1;
      if (!songDetails[item.videoId]) {
        songDetails[item.videoId] = {
          videoId: item.videoId,
          title: item.title,
          thumbnail: item.thumbnail,
          channelTitle: item.channelTitle || '',
          duration: item.duration || '0:00',
          durationSec: item.durationSec || 0
        };
      }
    });

    return Object.keys(counts)
      .map(videoId => ({
        ...songDetails[videoId],
        requestCount: counts[videoId]
      }))
      .sort((a, b) => b.requestCount - a.requestCount)
      .slice(0, 5);
  }

  /**
   * Update request & queue limit settings (Admin command)
   */
  updateSettings(newSettings = {}) {
    if (newSettings.maxQueuePerDevice !== undefined) {
      const val = parseInt(newSettings.maxQueuePerDevice, 10);
      if (!isNaN(val) && val >= 1 && val <= 50) this.maxQueuePerDevice = val;
    }
    if (newSettings.maxTrackMinutes !== undefined) {
      const val = parseInt(newSettings.maxTrackMinutes, 10);
      if (!isNaN(val) && val >= 1 && val <= 180) this.maxTrackMinutes = val;
    }
    if (newSettings.cooldownMinutes !== undefined) {
      const val = parseInt(newSettings.cooldownMinutes, 10);
      if (!isNaN(val) && val >= 0 && val <= 60) this.cooldownMinutes = val;
    }
    this.save();
    return {
      maxQueuePerDevice: this.maxQueuePerDevice,
      maxTrackMinutes: this.maxTrackMinutes,
      cooldownMinutes: this.cooldownMinutes
    };
  }

  /**
   * Return formatted queue state for UI & Socket.IO broadcast
   */
  getState() {
    return {
      currentSong: this.currentSong,
      queue: this.items,
      totalInQueue: this.items.length,
      isAcceptingRequests: this.isAcceptingRequests,
      isUserReorderEnabled: this.isUserReorderEnabled,
      isAutoDjEnabled: this.isAutoDjEnabled,
      isTodayHistoryReplayEnabled: this.isTodayHistoryReplayEnabled,
      settings: {
        maxQueuePerDevice: this.maxQueuePerDevice,
        maxTrackMinutes: this.maxTrackMinutes,
        cooldownMinutes: this.cooldownMinutes
      },
      topSongs: this.getTopSongs()
    };
  }
}

module.exports = new QueueManager();
module.exports.createRoom = roomId => {
  if (!/^[A-F0-9]{8}$/.test(roomId)) throw new Error('รหัสห้องไม่ถูกต้อง');
  return new QueueManager({ roomId });
};
