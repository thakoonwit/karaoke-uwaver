const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RoomRegistry {
  constructor({ defaultQueue, adminPin, dataDir = process.env.KARAOKE_DATA_DIR || path.join(__dirname, 'data'), maxRooms = Number(process.env.MAX_ROOMS) || 20 }) {
    this.defaultQueue = defaultQueue;
    this.adminPin = adminPin;
    this.file = path.join(dataDir, 'rooms.json');
    this.maxRooms = Math.min(100, Math.max(1, maxRooms));
    this.definitions = new Map();
    this.live = new Map();
    this.live.set('main', this.runtime({ id: 'main', name: 'ห้องหลัก', createdAt: 0 }, defaultQueue));
    if (fs.existsSync(this.file)) {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(saved)) throw new Error('ข้อมูลห้องไม่ถูกต้อง');
      for (const room of saved) {
        if (/^[A-F0-9]{8}$/.test(room.id) && typeof room.name === 'string' && /^[a-f0-9]{64}$/.test(room.pinHash) && /^[a-f0-9]{32}$/.test(room.salt)) this.definitions.set(room.id, room);
      }
    }
  }
  runtime(info, queue) { return { ...info, queue, playerSocketId: null, playbackState: 'idle', connections: new Set(), touchedAt: Date.now() }; }
  resolve(rawId = 'main') {
    if (typeof rawId !== 'string') return null;
    const id = rawId === 'main' ? 'main' : rawId.toUpperCase();
    this.evict();
    let room = this.live.get(id);
    if (!room) {
      const info = this.definitions.get(id);
      if (!info) return null;
      room = this.runtime(info, this.defaultQueue.createRoom(id));
      this.live.set(id, room);
    }
    room.touchedAt = Date.now();
    return room;
  }
  publicInfo(room) { return { id: room.id, name: room.name, createdAt: room.createdAt }; }
  list() {
    this.evict();
    return [this.publicInfo(this.live.get('main')), ...[...this.definitions.values()].map(room => this.publicInfo(room))];
  }
  create(name, pin) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('กรุณาใส่ชื่อห้อง 1–40 ตัวอักษร');
    if (typeof pin !== 'string' || !/^\d{4,10}$/.test(pin)) throw new Error('กรุณาตั้ง PIN เป็นตัวเลข 4–10 หลัก');
    if (this.definitions.size >= this.maxRooms) throw new Error('จำนวนห้องเต็มแล้ว');
    let id;
    do { id = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (this.definitions.has(id));
    const salt = crypto.randomBytes(16).toString('hex');
    const info = { id, name: name.trim(), salt, pinHash: this.hash(pin, salt), createdAt: Date.now() };
    this.definitions.set(id, info);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file + '.tmp', JSON.stringify([...this.definitions.values()]), 'utf8');
      fs.renameSync(this.file + '.tmp', this.file);
    } catch (err) { this.definitions.delete(id); throw err; }
    return this.publicInfo(info);
  }
  hash(pin, salt) { return crypto.createHash('sha256').update(salt + ':' + pin).digest('hex'); }
  verifyPin(room, pin) {
    if (typeof pin !== 'string') return false;
    if (room.id === 'main') return pin === this.adminPin;
    const actual = Buffer.from(this.hash(pin, room.salt), 'hex');
    return crypto.timingSafeEqual(actual, Buffer.from(room.pinHash, 'hex'));
  }
  evict(now = Date.now()) {
    for (const [id, room] of this.live) {
      if (id !== 'main' && !room.connections.size && now - room.touchedAt > 30 * 60000) {
        room.queue.save();
        this.live.delete(id);
      }
    }
  }
}
module.exports = RoomRegistry;
