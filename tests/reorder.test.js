const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const quiet = { log() {}, warn() {}, error() {} };
const song = id => ({ id, videoId: id, title: 'Song ' + id, requester: id, requestedAt: Date.now() });
function disk() {
  let saved = JSON.stringify({ items: ['a','b','c'].map(song), currentSong: song('playing'), history: [song('played')] });
  return {
    load() {
      const module = { exports: {} };
      vm.runInNewContext(fs.readFileSync(path.join(root, 'queue.js'), 'utf8'), {
        module, __dirname: root, URL, process: { env: {} }, console: quiet,
        require: name => name === 'fs' ? { existsSync: () => true, readFileSync: () => saved,
          writeFileSync: (file, data) => { saved = data; } } : require(name)
      });
      return module.exports;
    }
  };
}
const ids = queue => Array.from(queue.items, item => item.id);

test('users can reorder any pending song only while the persisted room permission is enabled', () => {
  const store = disk();
  const queue = store.load();
  queue.items[1].deviceId = 'someone-else';
  assert.equal(queue.isUserReorderEnabled, false);
  assert.throws(() => queue.moveUserSong('b', 'up', 'a'), /อนุญาต/);
  assert.throws(() => queue.setUserReorder('true'));
  queue.setUserReorder(true);
  queue.moveUserSong('b', 'up', 'a');
  assert.deepEqual(ids(queue), ['b', 'a', 'c']);
  assert.equal(store.load().isUserReorderEnabled, true);
  queue.setUserReorder(false);
  assert.throws(() => queue.moveUserSong('a', 'up', 'b'), /อนุญาต/);
  assert.equal(store.load().isUserReorderEnabled, false);
  assert.deepEqual(ids(queue), ['b', 'a', 'c']);
});

test('user reordering rejects changed neighbours, missing IDs, active songs and queue boundaries', () => {
  const queue = disk().load();
  queue.setUserReorder(true);
  const before = JSON.stringify(queue.getState());
  for (const args of [['b', 'up', 'c'], ['a', 'up', 'b'], ['c', 'down', 'b'], ['playing', 'up', 'a'], ['b', 'sideways', 'a'], ['b', 'up', undefined]]) {
    assert.throws(() => queue.moveUserSong(...args));
    assert.equal(JSON.stringify(queue.getState()), before);
  }
});

test('dragging moves a song across several positions atomically and rejects stale snapshots', () => {
  const store = disk();
  const queue = store.load();
  assert.throws(() => queue.reorderUserSong('c', 0, ['a', 'b', 'c']), /อนุญาต/);
  queue.setUserReorder(true);
  const current = JSON.stringify(queue.currentSong), history = JSON.stringify(queue.getTodayRequestHistory());
  queue.reorderUserSong('c', 0, ['a', 'b', 'c']);
  assert.deepEqual(ids(queue), ['c', 'a', 'b']);
  assert.deepEqual(ids(store.load()), ['c', 'a', 'b']);
  const before = JSON.stringify(queue.getState());
  for (const [id, target, snapshot] of [['b', 0, ['a', 'b', 'c']], ['a', -1, ['c', 'a', 'b']], ['a', 3, ['c', 'a', 'b']], ['a', 1.5, ['c', 'a', 'b']], ['playing', 0, ['c', 'a', 'b']], ['a', 0, null]]) {
    assert.throws(() => queue.reorderUserSong(id, target, snapshot));
    assert.equal(JSON.stringify(queue.getState()), before);
  }
  queue.reorderUserSong('c', 2, ['c', 'a', 'b']);
  assert.deepEqual(ids(queue), ['a', 'b', 'c']);
  assert.equal(JSON.stringify(queue.currentSong), current);
  assert.equal(JSON.stringify(queue.getTodayRequestHistory()), history);
});

test('moves pending songs one position and persists their order without changing playback or history', () => {
  const store = disk();
  const queue = store.load();
  const current = JSON.stringify(queue.currentSong);
  const history = JSON.stringify(queue.history);
  const requests = JSON.stringify(queue.getTodayRequestHistory());
  queue.moveSong('b', 'up');
  assert.deepEqual(ids(queue), ['b','a','c']);
  queue.moveSong('b', 'down');
  assert.deepEqual(ids(queue), ['a','b','c']);
  queue.moveSong('c', 'up');
  assert.deepEqual(ids(store.load()), ['a','c','b']);
  assert.equal(JSON.stringify(queue.currentSong), current);
  assert.equal(JSON.stringify(queue.history), history);
  assert.equal(JSON.stringify(queue.getTodayRequestHistory()), requests);
});

test('rejects stale IDs, the playing song, invalid directions and queue boundaries without mutation', () => {
  const queue = disk().load();
  const before = JSON.stringify(queue.getState());
  for (const [id, direction] of [['a','up'],['c','down'],['playing','up'],['deleted','down'],['b','first'],[null,'up']]) {
    assert.throws(() => queue.moveSong(id,direction));
    assert.equal(JSON.stringify(queue.getState()), before);
  }
  queue.items = [song('only')];
  assert.throws(() => queue.moveSong('only','up'));
  assert.throws(() => queue.moveSong('only','down'));
  queue.items = [];
  assert.throws(() => queue.moveSong('only','up'));
});

test('admin API protects reordering with PIN and broadcasts the new queue only on success', () => {
  const routes = new Map(), events = [];
  const queue = disk().load();
  const app = { use() {}, get() {}, post: (url,...handlers) => routes.set(url,handlers) };
  const express = Object.assign(() => app,{ json() {},urlencoded() {},static() {} });
  class Server { to() { return this; } on() {} emit(event,state) { events.push({event,state}); } }
  vm.runInNewContext(fs.readFileSync(path.join(root,'server.js'),'utf8'), {
    __dirname: root, URL, console: quiet, process: { env: { ADMIN_PIN: 'test-pin' } },
    require: name => ({ dotenv: { config() {} },express,'socket.io':{Server},
      http:{createServer:()=>({listen(){}})},os:{networkInterfaces:()=>({})},qrcode:{},
      './rooms': require('../rooms'), './queue':queue,'./youtube':{},'./audio':{prefetchAudioStreamUrl(){}} })[name] || require(name)
  });
  function move(songId,direction,pin='test-pin') {
    let status=200,body;
    const req={headers:{'x-admin-pin':pin},body:{action:'move',songId,direction}};
    const res={status(value){status=value;return this;},json(value){body=value;}};
    const [auth,handler]=routes.get('/api/admin/action');
    auth(req,res,()=>handler(req,res));
    return {status,body};
  }
  assert.equal(move('b','up','wrong').status,401);
  assert.equal(move('gone','up').status,400);
  assert.equal(move('a','up').status,400);
  assert.equal(events.length,0);
  assert.equal(move('b','up').body.success,true);
  assert.deepEqual(ids(queue),['b','a','c']);
  assert.equal(events.at(-1).event,'queueUpdate');
  assert.deepEqual(Array.from(events.at(-1).state.queue,item=>item.id),['b','a','c']);
  assert.ok(events.every(item=>item.event!=='playerCommand'));
});
