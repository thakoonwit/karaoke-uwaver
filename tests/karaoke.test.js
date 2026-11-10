const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const quiet = { log() {}, warn() {}, error() {} };

test('karaoke search has separate cached results, avoids duplicate suffixes and preserves direct links', async () => {
  const requests = [];
  const module = { exports: {} };
  const video = { id: 'abcdefghijk', snippet: { title: 'Song', channelTitle: 'Artist', thumbnails: { medium: { url: '/cover.png' } } }, contentDetails: { duration: 'PT3M' }, status: { embeddable: true } };
  vm.runInNewContext(source('youtube.js'), {
    module, console: quiet,
    require: name => name === 'axios' ? { create: () => ({ async get(url) {
      requests.push(new URL(url));
      return { data: { items: url.includes('/search?') ? [{ id: { videoId: video.id } }] : [video] } };
    } }) } : require(name)
  });
  const search = module.exports.searchVideos;
  await search('เพลงทดสอบ', 'test-key', true);
  await search('เพลงทดสอบ', 'test-key', false);
  await search('เพลงทดสอบ', 'test-key', true);
  assert.deepEqual(requests.filter(url => url.pathname.endsWith('/search')).map(url => url.searchParams.get('q')), ['เพลงทดสอบ karaoke', 'เพลงทดสอบ']);
  await search('เพลงอื่น คาราโอเกะ', 'test-key', true);
  assert.equal(requests.at(-2).searchParams.get('q'), 'เพลงอื่น คาราโอเกะ');
  const count = requests.length;
  const result = await search('https://youtu.be/abcdefghijk', 'test-key', true);
  assert.equal(result.type, 'direct');
  assert.equal(result.video.videoId, 'abcdefghijk');
  assert.equal(requests.length, count + 1);
  assert.equal(requests.at(-1).searchParams.get('id'), 'abcdefghijk');
});

test('player restarts the current song and reports a failed video only once without ending the next song', () => {
  const elements = new Map(), handlers = {}, emitted = [], calls = [];
  const element = id => {
    if (!elements.has(id)) elements.set(id, { style: {}, addEventListener(event, fn) { this[event] = fn; } });
    return elements.get(id);
  };
  let options;
  const yt = { unMute() {}, setVolume() {}, loadVideoById() {}, seekTo: (...args) => calls.push(args), playVideo: () => calls.push('play') };
  const window = {};
  vm.runInNewContext(source('public/js/player.js'), {
    window, console: quiet, navigator: {},
    document: { getElementById: element, documentElement: { setAttribute() {} }, addEventListener() {} },
    localStorage: { getItem: () => null },
    io: () => ({ on: (event, fn) => { handlers[event] = fn; }, emit: (...args) => emitted.push(args) }),
    YT: { Player: function(id, config) { options = config; return yt; } }
  });
  element('restartSongBtn').click();
  assert.equal(calls.length, 0);
  window.onYouTubeIframeAPIReady();
  element('startPlayerBtn').click();
  options.events.onReady();
  handlers.queueUpdate({ playerState: { volume: 50 }, queue: [], currentSong: { videoId: 'abcdefghijk', title: 'Song', requester: 'Singer', isAutoDj: true } });
  assert.equal(element('queuePrevBtn').disabled, true);
  assert.equal(element('queueNextBtn').disabled, true);
  const queue = Array.from({ length: 8 }, (_, i) => ({ id: 'q' + i, videoId: 'v' + i, title: 'Queue ' + i, requester: 'Singer', duration: '4:00' }));
  handlers.queueUpdate({ queue, currentSong: null });
  assert.equal(element('queuePageText').textContent, '1 / 3');
  assert.match(element('playerNextSong').textContent, /Queue 0/);
  element('queueNextBtn').click();
  assert.equal(element('queuePageText').textContent, '2 / 3');
  assert.match(element('playerQueueContainer').innerHTML, /Queue 3/);
  element('queueNextBtn').click();
  assert.equal(element('queueNextBtn').disabled, true);
  handlers.queueUpdate({ queue: queue.slice(1), currentSong: null });
  assert.equal(element('queuePageText').textContent, '1 / 3');
  assert.match(element('playerNextSong').textContent, /Queue 1/);
  handlers.queueUpdate({ playerState: { volume: 50 }, queue: [], currentSong: { videoId: 'abcdefghijk', title: 'Song', requester: 'Singer', isAutoDj: true } });
  element('restartSongBtn').click();
  assert.equal(JSON.stringify(calls), '[[0,true],"play"]');
  options.events.onError({ data: 150 });
  assert.deepEqual(emitted.map(args => args[0]), ['songError']);
});

test('QR endpoint encodes the public request domain and supports a deployment override', async () => {
  for (const publicUrl of [undefined, 'https://sing.example.com/']) {
    const routes = new Map();
    let encoded;
    const app = { use() {}, post() {}, get: (url, handler) => routes.set(url, handler) };
    const express = Object.assign(() => app, { json() {}, urlencoded() {}, static() {} });
    class Server { to() { return this; } on() {} }
    vm.runInNewContext(source('server.js'), {
      __dirname: root, URL, console: quiet, process: { env: { PUBLIC_URL: publicUrl } },
      require: name => ({ dotenv: { config() {} }, express, 'socket.io': { Server },
        http: { createServer: () => ({ listen() {} }) }, os: { networkInterfaces: () => ({}) },
        qrcode: { async toDataURL(url) { encoded = url; return 'data:image/png;base64,QR'; } },
        './rooms': require('../rooms'), './queue': {}, './youtube': {} })[name] || require(name)
    });
    let body;
    await routes.get('/api/qrcode')({}, { json: value => { body = value; } });
    const expected = publicUrl ? 'https://sing.example.com/?room=main' : 'https://karaoke.uwaver.site/?room=main';
    assert.equal(encoded, expected);
    assert.equal(body.requestUrl, expected);
    assert.equal(body.success, true);
  }
});
