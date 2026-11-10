const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const { spawn } = require('node:child_process');
const WebSocket = require('ws');

test('real HTTP and Socket.IO isolate rooms, controls, QR codes and persisted state', { skip: !process.env.RUN_ROOM_INTEGRATION, timeout: 40000 }, async () => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  const dataDir = fs.mkdtempSync(path.join(tempRoot, 'karaoke-rooms-'));
  const listener = net.createServer();
  await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const clients = [];
  let child;
  async function boot() {
    child = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), KARAOKE_DATA_DIR: dataDir, MAX_ROOMS: '2', PUBLIC_URL: 'https://karaoke.uwaver.site', ADMIN_PIN: 'main-pin' }, stdio: ['ignore', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Server startup timed out')), 8000);
      child.once('exit', code => { clearTimeout(timeout); reject(Error('Server exited: ' + code)); });
      child.stdout.on('data', data => { if (data.toString().includes('Local Machine')) { clearTimeout(timeout); resolve(); } });
      child.stderr.on('data', data => { if (data.toString().includes('EADDRINUSE')) reject(Error(data.toString())); });
    });
  }
  async function stop() {
    if (child && child.exitCode === null) await new Promise(resolve => { child.once('exit', resolve); child.kill(); });
  }
  async function api(route, room, body, pin) {
    const url = new URL(route, origin);
    if (room) url.searchParams.set('room', room);
    const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(pin ? { 'x-admin-pin': pin } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, ...await response.json() };
  }
  function connect(roomId, playerPin) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(origin.replace('http:', 'ws:') + '/socket.io/?EIO=4&transport=websocket');
      const client = { ws, events: [], waiters: [], send: (event, value) => ws.send('42' + JSON.stringify([event, value])) };
      clients.push(client);
      const timeout = setTimeout(() => reject(Error('Socket connect timed out')), 4000);
      ws.on('error', reject);
      ws.on('message', bytes => {
        const message = bytes.toString();
        if (message.startsWith('0')) ws.send('40' + JSON.stringify({ roomId, playerPin }));
        else if (message === '2') ws.send('3');
        else if (message.startsWith('40')) { clearTimeout(timeout); resolve(client); }
        else if (message.startsWith('42')) {
          const [event, value] = JSON.parse(message.slice(2));
          client.events.push({ event, value });
          for (const waiter of [...client.waiters]) if (waiter.event === event && waiter.predicate(value)) { clearTimeout(waiter.timeout); client.waiters.splice(client.waiters.indexOf(waiter), 1); waiter.resolve(value); }
        }
      });
      client.next = (event, predicate = () => true) => new Promise((resolveEvent, rejectEvent) => {
        const waiter = { event, predicate, resolve: resolveEvent };
        waiter.timeout = setTimeout(() => rejectEvent(Error('Missing event ' + event)), 4000);
        client.waiters.push(waiter);
      });
    });
  }
  const song = (videoId, requester = 'Singer') => ({ videoId, title: 'Track ' + videoId, thumbnail: '/logo.png', duration: '3:00', durationSec: 180, requester, deviceId: 'test-device' });
  try {
    await boot();
    const a = await api('/api/rooms', null, { name: 'Room A', pin: '1111' });
    const b = await api('/api/rooms', null, { name: 'Room B', pin: '2222' });
    assert.equal(a.status, 201); assert.equal(b.status, 201); assert.notEqual(a.room.id, b.room.id);
    assert.equal((await api('/api/rooms', null, { name: 'Too many', pin: '3333' })).status, 400);
    const roomA = a.room.id, roomB = b.room.id;
    const list = await api('/api/rooms');
    assert.ok(list.rooms.every(room => !('pin' in room) && !('pinHash' in room) && !('salt' in room)));
    assert.equal((await api('/api/status', 'DEADBEEF')).status, 404);
    const printedQr = new Map();
    for (const id of [roomA, roomB]) {
      const qr = await api('/api/qrcode', id);
      assert.equal(new URL(qr.requestUrl).searchParams.get('room'), id);
      assert.equal(new URL(qr.requestUrl).searchParams.has('pin'), false);
      assert.ok(qr.qrDataUrl.startsWith('data:image/png;base64,'));
      const response = await fetch(origin + '/api/qrcode.svg?room=' + id);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/svg\+xml/);
      const svg = await response.text();
      assert.match(svg, /<svg[^>]+viewBox=/);
      assert.equal(svg, await require('qrcode').toString(qr.requestUrl, { type: 'svg', margin: 4, errorCorrectionLevel: 'M' }));
      printedQr.set(id, { svg, url: qr.requestUrl });
    }
    assert.notEqual(printedQr.get(roomA).svg, printedQr.get(roomB).svg);
    assert.equal((await fetch(origin + '/api/qrcode.svg?room=DEADBEEF')).status, 404);
    const watchA = await connect(roomA), watchB = await connect(roomB);
    assert.equal((await api('/api/request', roomA, song('aaaaaaaaaaa'))).success, true);
    assert.equal((await api('/api/request', roomA, song('bbbbbbbbbbb'))).success, true);
    assert.equal((await api('/api/request', roomB, song('ccccccccccc'))).success, true);
    assert.equal((await api('/api/status', roomA)).currentSong.videoId, 'aaaaaaaaaaa');
    assert.equal((await api('/api/status', roomB)).currentSong.videoId, 'ccccccccccc');
    assert.equal((await api('/api/history/today', roomA)).songs.length, 2);
    assert.equal((await api('/api/history/today', roomB)).songs.length, 1);
    assert.equal((await api('/api/request', roomA, { ...song('ddddddddddd', 'Another singer'), deviceId: 'other-device' })).success, true);
    let pending = (await api('/api/status', roomA)).queue;
    const move = { songId: pending[1].id, direction: 'up', expectedNeighborId: pending[0].id };
    assert.equal((await api('/api/request/move', roomA, move)).status, 403);
    assert.equal((await api('/api/admin/action', roomA, { action: 'setUserReorder', enabled: true })).status, 401);
    assert.equal((await api('/api/admin/action', roomA, { action: 'setUserReorder', enabled: 'true' }, '1111')).status, 400);
    assert.equal((await api('/api/admin/action', roomA, { action: 'setUserReorder', enabled: true }, '1111')).success, true);
    assert.equal((await api('/api/status', roomB)).isUserReorderEnabled, false);
    assert.equal((await api('/api/request/move', roomA, move)).success, true);
    pending = (await api('/api/status', roomA)).queue;
    assert.deepEqual(pending.map(item => item.videoId), ['ddddddddddd', 'bbbbbbbbbbb']);
    assert.equal((await api('/api/request/move', roomA, move)).status, 400);
    assert.equal((await api('/api/request/move', roomA, { songId: pending[1].id, direction: 'up', expectedNeighborId: pending[0].id })).success, true);
    await api('/api/request', roomA, { ...song('eeeeeeeeeee'), deviceId: 'third-device' });
    const beforeDrag = (await api('/api/status', roomA)).queue;
    const drag = { songId: beforeDrag[2].id, toIndex: 0, expectedOrder: beforeDrag.map(item => item.id) };
    assert.equal((await api('/api/request/reorder', roomA, drag)).success, true);
    const afterDrag = (await api('/api/status', roomA)).queue;
    assert.deepEqual(afterDrag.map(item => item.videoId), ['eeeeeeeeeee', 'bbbbbbbbbbb', 'ddddddddddd']);
    assert.equal((await api('/api/request/reorder', roomA, drag)).status, 400);
    assert.equal((await api('/api/status', roomB)).currentSong.videoId, 'ccccccccccc');
    assert.equal((await api('/api/request/reorder', roomA, { songId: afterDrag[0].id, toIndex: 2, expectedOrder: afterDrag.map(item => item.id) })).success, true);
    await api('/api/admin/action', roomA, { action: 'setUserReorder', enabled: false }, '1111');
    assert.equal((await api('/api/request/move', roomA, move)).status, 403);
    assert.equal((await api('/api/request/reorder', roomA, drag)).status, 403);
    await api('/api/admin/action', roomA, { action: 'setUserReorder', enabled: true }, '1111');
    const playerA = await connect(roomA, '1111');
    const online = watchA.next('queueUpdate', state => state.playerState.isOnline);
    playerA.send('playerConnect'); await online;
    assert.equal((await api('/api/status', roomB)).playerState.isOnline, false);
    const denied = await connect(roomB, '1111'); const failure = denied.next('playerAccessDenied'); denied.send('playerConnect'); await failure;
    assert.equal((await api('/api/status', roomB)).playerState.isOnline, false);
    const duplicate = await connect(roomA, '1111'); const duplicateFailure = duplicate.next('playerAccessDenied'); duplicate.send('playerConnect'); await duplicateFailure;
    watchA.send('songEnded');
    assert.equal((await api('/api/status', roomA)).currentSong.videoId, 'aaaaaaaaaaa');
    const advanced = watchA.next('queueUpdate', state => state.currentSong?.videoId === 'bbbbbbbbbbb'); playerA.send('songEnded'); await advanced;
    assert.equal((await api('/api/status', roomB)).currentSong.videoId, 'ccccccccccc');
    assert.equal((await api('/api/admin/action', roomA, { action: 'setVolume', volume: 33 }, '2222')).status, 401);
    assert.equal((await api('/api/admin/action', roomA, { action: 'setVolume', volume: 33 }, '1111')).success, true);
    assert.equal((await api('/api/status', roomB)).playerState.volume, 100);
    const paused = playerA.next('playerCommand', data => data.command === 'pause');
    await api('/api/admin/action', roomA, { action: 'pause' }, '1111'); await paused;
    const reaction = watchA.next('newReaction'); watchA.send('sendReaction', { emoji: '🎉', roomId: roomB }); await reaction;
    assert.ok(watchA.events.filter(item => item.event === 'queueUpdate').every(item => item.value.room.id === roomA));
    assert.ok(watchB.events.filter(item => item.event === 'queueUpdate').every(item => item.value.room.id === roomB));
    assert.ok(!watchB.events.some(item => ['playerCommand', 'newReaction'].includes(item.event)));
    for (const client of clients) client.ws.terminate();
    await stop(); await boot();
    for (const [id, printed] of printedQr) {
      assert.equal((await api('/api/qrcode', id)).requestUrl, printed.url);
      assert.equal(await (await fetch(origin + '/api/qrcode.svg?room=' + id)).text(), printed.svg);
    }
    assert.equal((await api('/api/status', roomA)).playerState.volume, 33);
    assert.equal((await api('/api/status', roomA)).isUserReorderEnabled, true);
    assert.equal((await api('/api/status', roomB)).isUserReorderEnabled, false);
    assert.equal((await api('/api/status', roomB)).currentSong.videoId, 'ccccccccccc');
    assert.equal((await api('/api/admin/verify-pin', roomA, { pin: '1111' })).success, true);
  } finally {
    for (const client of clients) { for (const waiter of client.waiters) clearTimeout(waiter.timeout); client.ws.terminate(); }
    await stop();
    if (path.dirname(dataDir) !== tempRoot || !path.basename(dataDir).startsWith('karaoke-rooms-')) throw Error('Unsafe test cleanup path');
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
