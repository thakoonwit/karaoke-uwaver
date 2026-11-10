const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const RoomRegistry = require('../rooms');

function temporaryRegistry(run) {
  const parent = fs.realpathSync(os.tmpdir());
  const dataDir = fs.mkdtempSync(path.join(parent, 'karaoke-registry-'));
  try { run(dataDir); }
  finally {
    if (path.dirname(dataDir) !== parent || !path.basename(dataDir).startsWith('karaoke-registry-')) throw Error('Unsafe cleanup path');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

test('room definitions persist without exposing PIN hashes; queues load lazily and unknown rooms never use the main queue', () => temporaryRegistry(dataDir => {
  let loads = 0;
  const defaultQueue = { createRoom: id => { loads++; return { id, save() {} }; } };
  const registry = new RoomRegistry({ defaultQueue, adminPin: 'main-pin', dataDir, maxRooms: 2 });
  const a = registry.create('  Sales  ', '1111'), b = registry.create('Studio', '2222');
  assert.equal(a.name, 'Sales'); assert.equal(loads, 0);
  assert.ok(registry.list().every(item => Object.keys(item).sort().join(',') === 'createdAt,id,name'));
  assert.throws(() => registry.create('Full', '3333'), /เต็ม/);
  assert.equal(registry.resolve('../queue'), null);
  assert.equal(registry.resolve('DEADBEEF'), null);
  assert.equal(registry.resolve('main').queue, defaultQueue);
  const restored = new RoomRegistry({ defaultQueue, adminPin: 'main-pin', dataDir });
  assert.equal(loads, 0);
  const roomA = restored.resolve(a.id), roomB = restored.resolve(b.id);
  assert.notEqual(roomA.queue, roomB.queue);
  assert.equal(restored.verifyPin(roomA, '1111'), true);
  assert.equal(restored.verifyPin(roomA, '2222'), false);
  assert.equal(restored.verifyPin(roomB, '2222'), true);
  assert.equal(restored.verifyPin(roomA, undefined), false);
}));

test('idle room queues release memory while connected rooms and their persisted definitions stay available', () => temporaryRegistry(dataDir => {
  let saves = 0, loads = 0;
  const defaultQueue = { createRoom: () => { loads++; return { save() { saves++; } }; } };
  const registry = new RoomRegistry({ defaultQueue, adminPin: 'pin', dataDir });
  assert.throws(() => registry.create(' ', '1234'));
  assert.throws(() => registry.create('Room', '123'));
  assert.throws(() => registry.create('Room', 'not-numeric'));
  const a = registry.create('Idle', '1111'), b = registry.create('Connected', '2222');
  const idle = registry.resolve(a.id), connected = registry.resolve(b.id);
  connected.connections.add('socket');
  registry.evict(Math.max(idle.touchedAt, connected.touchedAt) + 31 * 60000);
  assert.equal(registry.live.has(a.id), false);
  assert.equal(registry.live.has(b.id), true);
  assert.equal(registry.definitions.has(a.id), true);
  assert.equal(saves, 1);
  registry.resolve(a.id);
  assert.equal(loads, 3);
}));

test('room queues persist to different files, stop at the configured bound and reject oversized metadata before mutation', () => {
  const files = new Map();
  const root = path.join(__dirname, '..');
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'queue.js'), 'utf8'), {
    module, __dirname: root, process: { env: {} }, console: { log() {}, warn() {}, error() {} },
    require: name => name === 'fs' ? { existsSync: file => files.has(file), mkdirSync() {}, readFileSync: file => files.get(file), writeFileSync: (file, data) => files.set(file, data) } : require(name)
  });
  const a = module.exports.createRoom('AAAAAAAA'), b = module.exports.createRoom('BBBBBBBB');
  const song = i => ({ videoId: 'video' + i, title: 'Song ' + i, duration: '3:00', durationSec: 180 });
  for (let batch = 0; batch < 6; batch++) a.addPlaylist({ title: 'Set', songs: Array.from({ length: 20 }, (_, index) => song(batch * 20 + index)), requester: 'Singer', deviceId: 'test' });
  assert.equal(a.items.length, 100);
  assert.equal(b.items.length, 0);
  assert.equal(b.isAutoDjEnabled, false);
  assert.throws(() => a.addSong({ ...song(999), requester: 'Singer', deviceId: 'test' }), /เต็ม/);
  assert.throws(() => b.addSong({ ...song(999), title: 'x'.repeat(501) }));
  assert.equal(b.items.length, 0);
  assert.equal(module.exports.createRoom('AAAAAAAA').items.length, 100);
  assert.equal(module.exports.createRoom('BBBBBBBB').items.length, 0);
});
