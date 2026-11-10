require('dotenv').config();
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const os = require('os');
const QRCode = require('qrcode');

const queueManager = require('./queue');
const youtube = require('./youtube');
const RoomRegistry = require('./rooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || '1234';
const DIRECT_AUDIO_ENABLED = process.env.ENABLE_DIRECT_AUDIO === 'true';
const requestUrl = (process.env.PUBLIC_URL || 'https://karaoke.uwaver.site').replace(/\/+$/, '');
let activeSearches = 0;
let activeDirectStreams = 0;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const rooms = new RoomRegistry({ defaultQueue: queueManager, adminPin: ADMIN_PIN });
const defaultRoom = rooms.resolve('main');
const pinAttempts = new Map();

app.use((req, res, next) => {
  const id = req.query?.room ?? req.headers?.['x-room-id'] ?? 'main';
  const room = rooms.resolve(id);
  if (!room) return res.status(404).json({ success: false, message: 'Room not found', code: 'ROOM_NOT_FOUND' });
  req.karaokeRoom = room;
  next();
});
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', req.query.room ? 'index.html' : 'rooms.html')));
app.get('/rooms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'rooms.html')));
app.get('/api/rooms', (req, res) => res.json({ success: true, rooms: rooms.list() }));
app.post('/api/rooms', (req, res) => {
  try {
    const room = rooms.create(req.body.name, req.body.pin);
    res.status(201).json({ success: true, room });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Get physical local IPv4 address for Wi-Fi mobile access
 */
function getLocalIpAddress() {
  const interfaces = os.networkInterfaces();
  
  // 1. Try to find physical LAN / Wi-Fi IP first (192.168.x.x or 10.x.x.x)
  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('tailscale') || lowerName.includes('vethernet') || lowerName.includes('virtual') || lowerName.includes('vpn')) {
      continue; // Skip virtual network adapters
    }
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  // 2. Fallback to any non-internal IPv4
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }

  return 'localhost';
}

const localIp = getLocalIpAddress();
const localUrl = `http://${localIp}:${PORT}`;

function roomState(room) {
  return {
    ...room.queue.getState(), room: rooms.publicInfo(room),
    playerState: { isOnline: Boolean(room.playerSocketId), playbackState: room.playbackState, volume: room.queue.playerVolume }, localUrl
  };
}
function broadcastState(room = defaultRoom) { io.to(room.id).emit('queueUpdate', roomState(room)); }

function checkRoomPin(req, pin) {
  const room = req.karaokeRoom || defaultRoom;
  const key = room.id + ':' + (req.ip || 'local');
  const now = Date.now();
  const attempt = pinAttempts.get(key);
  if (attempt && attempt.until > now && attempt.count >= 10) return false;
  if (rooms.verifyPin(room, pin)) { pinAttempts.delete(key); return true; }
  if (pinAttempts.size >= 512) {
    for (const [id, item] of pinAttempts) if (item.until <= now) pinAttempts.delete(id);
    if (pinAttempts.size >= 512) pinAttempts.delete(pinAttempts.keys().next().value);
  }
  pinAttempts.set(key, { until: now + 60000, count: attempt && attempt.until > now ? attempt.count + 1 : 1 });
  return false;
}

io.on('connection', socket => {
  const room = rooms.resolve(socket.handshake?.auth?.roomId || 'main');
  if (!room) { socket.emit('roomError', { message: 'ไม่พบห้องนี้ กรุณาเลือกห้องใหม่' }); socket.disconnect(true); return; }
  socket.join(room.id);
  room.connections.add(socket.id);
  room.touchedAt = Date.now();
  socket.emit('queueUpdate', roomState(room));
  const isActivePlayer = () => room.playerSocketId === socket.id;
  socket.on('playerConnect', () => {
    if (room.id !== 'main' && !checkRoomPin({ karaokeRoom: room, ip: socket.handshake.address }, socket.handshake.auth?.playerPin)) {
      socket.emit('playerAccessDenied', { message: 'PIN ควบคุมห้องไม่ถูกต้อง' }); return;
    }
    if (room.playerSocketId && !isActivePlayer()) {
      socket.emit('playerAccessDenied', { message: 'ห้องนี้มีจอ Player เปิดอยู่แล้ว กรุณาปิดจอเดิมก่อน' }); return;
    }
    room.playerSocketId = socket.id;
    broadcastState(room);
  });
  socket.on('playerPlaybackState', state => {
    if (!isActivePlayer() || !['playing', 'paused', 'idle'].includes(state)) return;
    room.playbackState = state;
    broadcastState(room);
  });
  socket.on('songEnded', () => {
    if (!isActivePlayer()) return;
    room.queue.nextSong();
    broadcastState(room);
  });
  socket.on('songError', data => {
    if (!isActivePlayer()) return;
    const failed = room.queue.currentSong;
    if (data?.videoId && failed?.videoId !== data.videoId) return;
    if (failed && !failed.isAutoDj) io.to(room.id).emit('toastMessage', { type: 'error', message: `ไม่สามารถเล่นเพลง "${failed.title}" ได้ กำลังข้ามเพลง` });
    room.queue.nextSong();
    broadcastState(room);
  });
  socket.on('sendReaction', data => {
    if (!['👍', '❤️', '🔥', '🎉'].includes(data?.emoji)) return;
    io.to(room.id).emit('newReaction', { emoji: data.emoji });
  });
  socket.on('disconnect', () => {
    room.connections.delete(socket.id);
    room.touchedAt = Date.now();
    if (isActivePlayer()) { room.playerSocketId = null; room.playbackState = 'idle'; broadcastState(room); }
  });
});

/**
 * POST /api/request/delete - User deletes their own requested song
 */
app.post('/api/request/delete', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  try {
    const { songId, deviceId } = req.body;
    if (!songId || !deviceId) {
      return res.status(400).json({ success: false, message: 'ข้อมูลไม่ครบถ้วน' });
    }
    const removed = queueManager.removeOwnSong(songId, deviceId);
    broadcastState(room);
    res.json({ success: true, message: `ลบเพลง "${removed.title}" เรียบร้อยแล้ว` });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// --- REST API Endpoints ---
app.post('/api/request/reorder', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  if (!room.queue.isUserReorderEnabled) return res.status(403).json({ success: false, message: 'แอดมินยังไม่อนุญาตให้ผู้ใช้จัดคิว' });
  try {
    room.queue.reorderUserSong(req.body.songId, req.body.toIndex, req.body.expectedOrder);
    broadcastState(room);
    res.json({ success: true, message: 'จัดคิวแล้ว' });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});
app.post('/api/request/move', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  if (!room.queue.isUserReorderEnabled) return res.status(403).json({ success: false, message: 'แอดมินยังไม่อนุญาตให้ผู้ใช้จัดคิว' });
  try {
    room.queue.moveUserSong(req.body.songId, req.body.direction, req.body.expectedNeighborId);
    broadcastState(room);
    res.json({ success: true, message: 'เลื่อนคิวแล้ว' });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

/**
 * GET /api/status - Get current queue state and system status
 */
app.get('/api/status', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  res.json({
    success: true,
    ...queueManager.getState(),
    room: rooms.publicInfo(room),
    playerState: {
      isOnline: Boolean(room.playerSocketId),
      playbackState: room.playbackState,
      volume: queueManager.playerVolume
    },
    localUrl
  });
});

/**
 * GET /api/history/today - Shared requests for the current Bangkok calendar day
 */
app.get('/api/history/today', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ success: true, ...queueManager.getTodayRequestHistory() });
});

/** GET /api/qrcode - Get QR code DataURL for local Wi-Fi URL */
app.get('/api/qrcode', async (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  try {
    const roomRequestUrl = new URL(requestUrl);
    roomRequestUrl.searchParams.set('room', room.id);
    const qrDataUrl = await QRCode.toDataURL(roomRequestUrl.href, { width: 300, margin: 4, errorCorrectionLevel: 'M' });
    res.json({ success: true, localUrl, requestUrl: roomRequestUrl.href, room: rooms.publicInfo(room), qrDataUrl });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/search - Search YouTube videos or parse direct URL
 */
app.post('/api/search', async (req, res) => {
  if (activeSearches >= 2) {
    res.setHeader('Retry-After', '3');
    return res.status(503).json({ success: false, message: 'กำลังค้นหาเพลงให้ผู้ใช้อื่น กรุณาลองอีกครั้งในสักครู่' });
  }
  activeSearches++;
  try {
    const { query } = req.body;
    if (typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({ success: false, message: 'กรุณากรอกชื่อเพลงหรือลิงก์ YouTube' });
    }
    if (query.length > 500) return res.status(400).json({ success: false, message: 'ชื่อเพลงหรือลิงก์ยาวเกินกำหนด (สูงสุด 500 ตัวอักษร)' });

    const apiKey = process.env.YOUTUBE_API_KEY;
    const result = await youtube.searchVideos(query, apiKey, req.body.karaoke === true);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการค้นหา' });
  } finally {
    activeSearches--;
  }
});

/**
 * POST /api/request - Add a song to queue
 */
app.post('/api/request', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  try {
    const { title, videoId, thumbnail, channelTitle, duration, durationSec, requester, deviceId } = req.body;

    if (!videoId || !title) {
      return res.status(400).json({ success: false, message: 'ข้อมูลเพลงไม่ครบถ้วน' });
    }

    if (!requester || requester.trim() === '') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อเล่น' });
    }

    const addedItem = queueManager.addSong({
      title,
      videoId,
      thumbnail,
      channelTitle,
      duration,
      durationSec,
      requester,
      deviceId
    });

    // If queue was empty and player is idle, set currentSong immediately
    if (!queueManager.currentSong && queueManager.items.length === 1) {
      queueManager.nextSong();
    }

    broadcastState(room);

    res.json({
      success: true,
      message: 'เพิ่มเพลงเข้าคิวแล้ว',
      song: addedItem
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'ไม่สามารถเพิ่มเพลงเข้าคิวได้'
    });
  }
});

/**
 * POST /api/request/playlist - Add multiple songs from a playlist to queue
 */
app.post('/api/request/playlist', (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  try {
    const { title, songs, requester, deviceId } = req.body;

    if (!Array.isArray(songs) || songs.length === 0) {
      return res.status(400).json({ success: false, message: 'ข้อมูลเพลย์ลิสต์ไม่ถูกต้อง' });
    }

    if (!requester || requester.trim() === '') {
      return res.status(400).json({ success: false, message: 'กรุณาระบุชื่อเล่น' });
    }

    const result = queueManager.addPlaylist({
      title,
      songs,
      requester,
      deviceId
    });

    broadcastState(room);

    let msg = `เพิ่มเพลงจากเพลย์ลิสต์เข้าคิวแล้ว ${result.addedCount} เพลง`;
    if (result.skippedCount > 0) {
      msg += ` (ข้ามเพลงซ้ำหรือเกินกำหนด ${result.skippedCount} เพลง)`;
    }

    res.json({
      success: true,
      message: msg,
      result
    });
  } catch (err) {
    res.status(400).json({
      success: false,
      message: err.message || 'ไม่สามารถเพิ่มเพลย์ลิสต์เข้าคิวได้'
    });
  }
});

/**
 * GET /api/stream/:videoId - Direct audio stream proxy (Fixes YouTube 403 Referer CDN blocks on Render.com)
 */
app.get('/api/stream/:videoId', async (req, res) => {
  // The current browser Player uses YouTube IFrame directly, not this legacy proxy.
  if (!DIRECT_AUDIO_ENABLED) return res.status(503).json({ success: false, message: 'ปิดสตรีมเสียงตรงเพื่อประหยัด RAM กรุณาใช้หน้า Player' });
  if (!/^[a-zA-Z0-9_-]{11}$/.test(req.params.videoId)) return res.status(400).json({ success: false, message: 'รหัสวิดีโอไม่ถูกต้อง' });
  if (activeDirectStreams >= 2) {
    res.setHeader('Retry-After', '5');
    return res.status(503).json({ success: false, message: 'กำลังให้บริการสตรีมเสียง กรุณาลองใหม่ในสักครู่' });
  }
  activeDirectStreams++;
  const controller = new AbortController();
  const onClose = () => { if (!res.writableFinished) controller.abort(); };
  res.once('close', onClose);
  try {
    const { videoId } = req.params;
    const streamUrl = await require('./audio').getAudioStreamUrl(videoId);
    if (controller.signal.aborted) return;
    
    // Proxy the audio stream directly with YouTube referer header to bypass CDN 403 blocks
    const audioRes = await require('axios')({
      method: 'get',
      url: streamUrl,
      responseType: 'stream',
      timeout: 30000,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': 'https://www.youtube.com/'
      }
    });

    res.setHeader('Content-Type', audioRes.headers['content-type'] || 'audio/mpeg');
    if (audioRes.headers['content-length']) {
      res.setHeader('Content-Length', audioRes.headers['content-length']);
    }
    await require('stream/promises').pipeline(audioRes.data, res);
  } catch (err) {
    if (controller.signal.aborted || res.destroyed) return;
    console.error('[Server] Audio stream proxy error:', err.message);
    if (res.headersSent) res.destroy();
    else res.status(err.statusCode === 503 ? 503 : 500).json({ success: false, message: 'ไม่สามารถดึงสัญญาณเสียงได้ กรุณาลองอีกครั้ง' });
  } finally {
    res.removeListener('close', onClose);
    activeDirectStreams--;
  }
});

/**
 * Admin Middleware
 */
function verifyPinMiddleware(req, res, next) {
  const pin = req.headers['x-admin-pin'] || req.body.pin;
  if (!checkRoomPin(req, pin)) {
    return res.status(401).json({ success: false, message: 'รหัส PIN ไม่ถูกต้อง' });
  }
  next();
}

/**
 * POST /api/admin/verify-pin - Check PIN correctness
 */
app.post('/api/admin/verify-pin', (req, res) => {
  const { pin } = req.body;
  if (checkRoomPin(req, pin)) {
    res.json({ success: true, message: 'รหัส PIN ถูกต้อง' });
  } else {
    res.status(401).json({ success: false, message: 'รหัส PIN ไม่ถูกต้อง' });
  }
});

/**
 * POST /api/admin/action - Execute admin controls
 */
app.post('/api/admin/action', verifyPinMiddleware, (req, res) => {
  const room = req.karaokeRoom || defaultRoom;
  const queueManager = room.queue;
  const { action, songId, acceptingStatus } = req.body;

  try {
    let resultMessage = '';

    switch (action) {
      case 'setUserReorder':
        queueManager.setUserReorder(req.body.enabled);
        resultMessage = req.body.enabled ? 'เปิดให้ทุกคนในห้องจัดคิวแล้ว' : 'ปิดการจัดคิวโดยผู้ใช้แล้ว';
        break;
      case 'setVolume': {
        const volume = req.body.volume;
        if (!Number.isInteger(volume) || volume < 0 || volume > 100) {
          throw new Error('กรุณาระบุระดับเสียง 0 - 100%');
        }
        queueManager.playerVolume = volume;
        queueManager.save();
        resultMessage = room.playerSocketId
          ? `ส่งระดับเสียง ${volume}% ไปยัง Player แล้ว`
          : `บันทึกระดับเสียง ${volume}% แล้ว จะใช้เมื่อ Player เชื่อมต่อ`;
        break;
      }
      case 'pause':
        io.to(room.id).emit('playerCommand', { command: 'pause' });
        resultMessage = 'ส่งคำสั่งหยุดชั่วคราวไปยัง Player แล้ว';
        break;
      case 'resume':
        io.to(room.id).emit('playerCommand', { command: 'resume' });
        resultMessage = 'ส่งคำสั่งเล่นเพลงต่อไปยัง Player แล้ว';
        break;
      case 'skip':
        console.log('[Admin] Skip requested');
        queueManager.nextSong();
        resultMessage = 'ข้ามเพลงแล้ว';
        break;
      case 'move':
        queueManager.moveSong(songId, req.body.direction);
        resultMessage = req.body.direction === 'up' ? 'เลื่อนเพลงขึ้นหนึ่งลำดับแล้ว' : 'เลื่อนเพลงลงหนึ่งลำดับแล้ว';
        break;
      case 'remove':
        if (!songId) throw new Error('ไม่พบ ID เพลงที่ต้องการลบ');
        queueManager.removeSong(songId);
        resultMessage = 'ลบเพลงออกจากคิวแล้ว';
        break;
      case 'clear':
        const clearedCount = queueManager.clearQueue();
        resultMessage = `ล้างคิวทั้งหมดแล้ว (${clearedCount} รายการ)`;
        break;
      case 'toggleAccepting':
        const newStatus = queueManager.setAcceptingRequests(acceptingStatus);
        resultMessage = newStatus ? 'เปิดรับคำขอเพลงเรียบร้อยแล้ว' : 'ปิดรับคำขอเพลงชั่วคราวแล้ว';
        break;
      case 'toggleAutoDj':
        const autoDjStatus = queueManager.toggleAutoDj(req.body.autoDjStatus);
        resultMessage = autoDjStatus ? 'เปิดใช้งานระบบ Auto-DJ แล้ว' : 'ปิดระบบ Auto-DJ แล้ว';
        break;
      case 'toggleTodayHistoryReplay':
        const todayHistoryStatus = queueManager.toggleTodayHistoryReplay(req.body.todayHistoryReplayStatus);
        resultMessage = todayHistoryStatus ? 'เปิดใช้งานสุ่มเพลงจากประวัติวันนี้เมื่อคิวว่างแล้ว' : 'ปิดการสุ่มเพลงจากประวัติวันนี้แล้ว';
        break;
      case 'updateSettings':
        queueManager.updateSettings({
          maxQueuePerDevice: req.body.maxQueuePerDevice,
          maxTrackMinutes: req.body.maxTrackMinutes,
          cooldownMinutes: req.body.cooldownMinutes
        });
        resultMessage = 'บันทึกการตั้งค่าระบบเรียบร้อยแล้ว';
        break;
      default:
        return res.status(400).json({ success: false, message: 'คำสั่งไม่ถูกต้อง' });
    }

    broadcastState(room);
    res.json({ success: true, message: resultMessage });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message || 'เกิดข้อผิดพลาดในการดำเนินการ' });
  }
});

// Serve Page Routes
app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'history.html'));
});

app.get('/player', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'player.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Start Server
server.listen(PORT, () => {
  console.log('\n==================================================');
  console.log(`🎵 VRS Office Radio (Web YouTube Player Architecture)`);
  console.log(`💻 Local Machine Access:  http://localhost:${PORT}`);
  console.log(`📱 Wi-Fi Mobile Access:    ${localUrl}`);
  console.log(`📻 Central Player Page:   ${localUrl}/player`);
  console.log(`⚙️  Admin Dashboard:       ${localUrl}/admin`);
  console.log('==================================================\n');
});
