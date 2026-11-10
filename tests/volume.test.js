const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };

test('volume survives storage reload; legacy and invalid saved values default to 100', () => {
  let saved = '{}';
  const load = () => {
    const module = { exports: {} };
    vm.runInNewContext(source('queue.js'), {
      module, __dirname: root, URL, process: { env: {} }, console: quiet,
      require: name => name === 'fs' ? {
        existsSync: () => true, readFileSync: () => saved,
        writeFileSync: (file, data) => { saved = data; }
      } : require(name)
    });
    return module.exports;
  };
  assert.equal(load().playerVolume, 100);
  for (const volume of [0, 37, 100]) {
    const queue = load();
    queue.playerVolume = volume;
    queue.save();
    assert.equal(load().playerVolume, volume);
  }
  for (const invalid of [-1, 101, '30', null, 1.5]) {
    saved = JSON.stringify({ playerVolume: invalid });
    assert.equal(load().playerVolume, 100);
  }
});

test('admin volume action requires PIN, validates input, saves and broadcasts to clients', () => {
  const routes = new Map();
  const events = [];
  let saves = 0;
  const queue = { playerVolume: 100, getState: () => ({ queue: [] }), save: () => saves++ };
  const app = { use() {}, post: (url, ...handlers) => routes.set(url, handlers), get() {} };
  const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
  class Server { to() { return this; } on() {} emit(event, state) { events.push({ event, state }); } }
  vm.runInNewContext(source('server.js'), {
    __dirname: root, URL, console: quiet, process: { env: { ADMIN_PIN: 'test-pin' } },
    require: name => ({
      dotenv: { config() {} }, express, 'socket.io': { Server },
      http: { createServer: () => ({ listen() {} }) },
      os: { networkInterfaces: () => ({}) }, qrcode: {},
      './rooms': require('../rooms'), './queue': queue, './youtube': {}, './audio': {}
    })[name] || require(name)
  });
  function action(volume, pin = 'test-pin') {
    let code = 200, body;
    const req = { headers: { 'x-admin-pin': pin }, body: { action: 'setVolume', volume } };
    const res = { status(value) { code = value; return this; }, json(value) { body = value; } };
    const [auth, handler] = routes.get('/api/admin/action');
    auth(req, res, () => handler(req, res));
    return { code, body };
  }
  assert.equal(action(40, 'wrong').code, 401);
  for (const value of [-1, 101, '50', null, 1.5, undefined]) assert.equal(action(value).code, 400);
  assert.equal(saves, 0);
  for (const volume of [0, 45, 100]) {
    assert.equal(action(volume).body.success, true);
    assert.equal(queue.playerVolume, volume);
    assert.equal(events.at(-1).state.playerState.volume, volume);
  }
  assert.equal(saves, 3);
});

test('player applies delayed state, live changes, zero and reconnect without resetting on song change', () => {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, addEventListener(event, fn) { this[event] = fn; } });
    return elements.get(id);
  };
  const handlers = {};
  const volumes = [];
  let options, muted = false;
  const yt = { setVolume: value => volumes.push(value), unMute: () => { muted = false; },
    isMuted: () => muted, mute: () => { muted = true; }, loadVideoById() {}, stopVideo() {} };
  const window = {};
  vm.runInNewContext(source('public/js/player.js'), {
    window, console: quiet, navigator: {},
    document: { getElementById: element, documentElement: { setAttribute() {} }, addEventListener() {} },
    localStorage: { getItem: () => null },
    io: () => ({ on: (event, fn) => { handlers[event] = fn; }, emit() {} }),
    YT: { Player: function(id, config) { options = config; return yt; } }
  });
  window.onYouTubeIframeAPIReady();
  element('startPlayerBtn').click();
  const state = (volume, videoId = 'song-a') => ({ playerState: { volume }, queue: [],
    currentSong: { videoId, title: 'Song', requester: 'Listener' } });
  handlers.queueUpdate(state(35));
  assert.deepEqual(volumes, []);
  options.events.onReady({ target: yt });
  assert.equal(volumes.at(-1), 35);
  handlers.queueUpdate(state(35, 'song-b'));
  assert.equal(volumes.at(-1), 35);
  element('playerMuteBtn').click();
  handlers.queueUpdate(state(35, 'song-c'));
  assert.equal(muted, true);
  handlers.queueUpdate(state(0, 'song-c'));
  assert.equal(volumes.at(-1), 0);
  handlers.queueUpdate(state(60, 'song-c'));
  assert.equal(volumes.at(-1), 60);
  assert.equal(muted, false);
  handlers.connect();
  handlers.queueUpdate(state(60, 'song-c'));
  assert.ok(!volumes.includes(100));
});
