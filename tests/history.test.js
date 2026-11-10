const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const now = Date.parse('2026-10-15T18:00:00Z'); // 01:00 on October 16 in Bangkok.
const quiet = { log() {}, error() {}, warn() {} };
class Clock extends Date {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
}
function storage(initial = {}) {
  let saved = JSON.stringify(initial);
  return {
    load() {
      const module = { exports: {} };
      vm.runInNewContext(fs.readFileSync(path.join(root, 'queue.js'), 'utf8'), {
        module, __dirname: root, URL, Date: Clock, console: quiet, process: { env: {} },
        require: name => name === 'fs' ? {
          existsSync: () => true, readFileSync: () => saved,
          writeFileSync: (file, data) => { saved = data; }
        } : require(name)
      });
      return module.exports;
    }
  };
}
function song(id, timestamp = now) {
  return { id, videoId: id, title: 'Song ' + id, requester: 'Listener ' + id,
    deviceId: 'private-device', duration: '3:00', durationSec: 180, requestedAt: timestamp };
}

test('migrates saved shared requests, uses Bangkok midnight, excludes Auto-DJ and device IDs', () => {
  const current = song('current');
  const queue = storage({ currentSong: current, items: [song('pending')], history: [
    current, song('before-midnight', Date.parse('2026-10-15T16:59:59Z')),
    song('at-midnight', Date.parse('2026-10-15T17:00:00Z')),
    { ...song('auto'), isAutoDj: true }, { ...song('invalid'), requestedAt: 9e99 }
  ] }).load();
  const result = queue.getTodayRequestHistory();
  assert.equal(result.date, '2026-10-16');
  assert.equal(result.timeZone, 'Asia/Bangkok');
  assert.deepEqual(Array.from(result.songs, item => item.id).sort(), ['at-midnight', 'current', 'pending']);
  assert.ok(result.songs.every(item => !('deviceId' in item)));
  assert.equal(queue.getTodayRequestHistory(Date.parse('2026-10-16T17:00:00Z')).songs.length, 0);
});

test('records accepted singles/playlists, keeps removed requests, preserves repeat requests after reload', () => {
  const disk = storage({ isAutoDjEnabled: false, isTodayHistoryReplayEnabled: false });
  const queue = disk.load();
  const first = queue.addSong(song('a'));
  assert.throws(() => queue.addSong(song('a')), /อยู่ในคิวแล้ว/);
  assert.equal(queue.getTodayRequestHistory().songs.length, 1);
  queue.removeSong(first.id);
  queue.addSong(song('a'));
  const imported = queue.addPlaylist({ title: 'Office playlist', requester: 'Another listener', deviceId: 'other-device',
    songs: [song('b'), song('b'), { ...song('too-long'), durationSec: 10000 }, song('c')] });
  assert.equal(imported.addedCount, 2);
  queue.clearQueue();
  const restored = disk.load().getTodayRequestHistory().songs;
  assert.equal(restored.length, 4);
  assert.equal(restored.filter(item => item.videoId === 'a').length, 2);
  assert.equal(restored.filter(item => item.playlistTitle === 'Office playlist').length, 2);
  assert.ok(restored.every(item => !('deviceId' in item)));
});

test('history route returns only the shared log and disables caching', () => {
  const routes = new Map();
  const queue = storage({ history: [song('a')] }).load();
  const app = { use() {}, post() {}, get: (url, handler) => routes.set(url, handler) };
  const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
  class Server { to() { return this; } on() {} }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), {
    __dirname: root, URL, console: quiet, process: { env: {} },
    require: name => ({ dotenv: { config() {} }, express, 'socket.io': { Server },
      http: { createServer: () => ({ listen() {} }) }, os: { networkInterfaces: () => ({}) },
      qrcode: {}, './rooms': require('../rooms'), './queue': queue, './youtube': {}, './audio': {} })[name] || require(name)
  });
  const headers = {};
  let body;
  routes.get('/api/history/today')({}, { setHeader: (key, value) => { headers[key] = value; }, json: value => { body = value; } });
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(body.success, true);
  assert.equal(body.songs.length, 1);
  assert.ok(!JSON.stringify(body).includes('private-device'));
  let file;
  routes.get('/history')({}, { sendFile: value => { file = value; } });
  assert.equal(file, path.join(root, 'public', 'history.html'));
});
