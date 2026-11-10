const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class RoomRegistry {
  constructor({ defaultQueue, adminPin, dataDir = process.env.KARAOKE_DATA_DIR || path.join(__dirname, 'data'), maxRooms = Number(process.env.MAX_ROOMS) || 20, store = null }) {
    this.defaultQueue = defaultQueue;
    this.adminPin = adminPin;
    this.file = path.join(dataDir, 'rooms.json');
    this.maxRooms = Math.min(100, Math.max(1, maxRooms));
    this.store = store;
    this.pendingCreates = 0;
    this.definitions = new Map();
    this.live = new Map();
    this.live.set('main', this.runtime({ id: 'main', name: 'ห้องหลัก', createdAt: 0 }, defaultQueue));
    if (fs.existsSync(this.file)) {
      try {
        const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (!Array.isArray(saved)) throw new Error('ข้อมูลห้องไม่ถูกต้อง');
        for (const room of saved) {
          if (this.validDefinition(room)) this.definitions.set(room.id, room);
        }
      } catch (err) {
        if (!this.store) throw err;
        console.warn('Room cache unreadable; restoring definitions from Firestore');
      }
    }
  }
  validDefinition(room) {
    return room && /^[A-F0-9]{8}$/.test(room.id) && typeof room.name === 'string' && room.name.trim().length > 0 && room.name.length <= 40 &&
      /^[a-f0-9]{64}$/.test(room.pinHash) && /^[a-f0-9]{32}$/.test(room.salt) && Number.isSafeInteger(room.createdAt) && room.createdAt >= 0;
  }
  saveDefinitions() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify([...this.definitions.values()]), 'utf8');
    fs.renameSync(this.file + '.tmp', this.file);
  }
  async initialize() {
    if (!this.store) return;
    // Cloud is authoritative. Migrate local-only definitions using their original IDs.
    const saved = await this.store.load();
    if (!saved.every(room => this.validDefinition(room))) throw Error('ข้อมูลห้องใน Firestore ไม่ถูกต้อง');
    const restored = new Map(saved.map(room => [room.id, room]));
    for (const [id, room] of this.definitions) {
      if (restored.has(id)) continue;
      if (!this.validDefinition(room)) throw Error('ข้อมูลห้องเดิมไม่ถูกต้อง');
      await this.store.create(room);
      restored.set(id, room);
    }
    this.definitions = restored;
    try { this.saveDefinitions(); } catch { console.warn('Room cache unavailable; definitions remain in Firestore'); }
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
  definition(name, pin) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 40) throw new Error('กรุณาใส่ชื่อห้อง 1–40 ตัวอักษร');
    if (typeof pin !== 'string' || !/^\d{4,10}$/.test(pin)) throw new Error('กรุณาตั้ง PIN เป็นตัวเลข 4–10 หลัก');
    if (this.definitions.size + this.pendingCreates >= this.maxRooms) throw new Error('จำนวนห้องเต็มแล้ว');
    let id;
    do { id = crypto.randomBytes(4).toString('hex').toUpperCase(); } while (this.definitions.has(id));
    const salt = crypto.randomBytes(16).toString('hex');
    const info = { id, name: name.trim(), salt, pinHash: this.hash(pin, salt), createdAt: Date.now() };
    return info;
  }
  create(name, pin) {
    if (this.store) throw Error('ใช้ createPersisted สำหรับห้อง Firestore');
    const info = this.definition(name, pin);
    const id = info.id;
    this.definitions.set(id, info);
    try {
      this.saveDefinitions();
    } catch (err) { this.definitions.delete(id); throw err; }
    return this.publicInfo(info);
  }
  async createPersisted(name, pin) {
    if (!this.store) return this.create(name, pin);
    const info = this.definition(name, pin);
    this.pendingCreates++;
    try {
      // A successful response always means this room has been saved remotely.
      await this.store.create(info);
      this.definitions.set(info.id, info);
      try { this.saveDefinitions(); } catch { console.warn('Room cache unavailable; definition saved in Firestore'); }
      return this.publicInfo(info);
    } finally { this.pendingCreates--; }
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
