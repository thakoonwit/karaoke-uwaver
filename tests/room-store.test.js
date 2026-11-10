const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const FirestoreRoomStore = require('../room-store');
const RoomRegistry = require('../rooms');

const keys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const credentials = { project_id: 'karaoke-test', client_email: 'test@karaoke-test.iam.gserviceaccount.com',
  private_key: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }) };
const info = { id: 'ABCDEF01', name: 'Test Room', salt: 'a'.repeat(32), pinHash: 'b'.repeat(64), createdAt: 1000 };
const doc = room => ({ name: 'projects/karaoke-test/databases/(default)/documents/karaokeRooms/' + room.id,
  fields: { name: { stringValue: room.name }, salt: { stringValue: room.salt }, pinHash: { stringValue: room.pinHash }, createdAt: { integerValue: String(room.createdAt) } } });

test('Firestore authenticates with a signed server token, paginates rooms and uploads only room metadata', async () => {
  let tokens = 0, pages = 0, writes = 0;
  const store = new FirestoreRoomStore(credentials, { fetchImpl: async (url, options) => {
    if (url.includes('oauth2.googleapis.com')) {
      tokens++;
      const parts = options.body.get('assertion').split('.');
      assert.equal(crypto.verify('RSA-SHA256', Buffer.from(parts.slice(0, 2).join('.')), keys.publicKey, Buffer.from(parts[2], 'base64url')), true);
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url'));
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/datastore');
      assert.equal(payload.exp - payload.iat, 3600);
      return Response.json({ access_token: 'test-only-token', expires_in: 3600 });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    if (options.method === 'POST') {
      writes++;
      assert.equal(new URL(url).searchParams.get('documentId'), info.id);
      assert.deepEqual(JSON.parse(options.body), { fields: doc(info).fields });
      return Response.json(doc(info));
    }
    pages++;
    if (!new URL(url).searchParams.has('pageToken')) return Response.json({ documents: [doc(info)], nextPageToken: 'page 2' });
    assert.equal(new URL(url).searchParams.get('pageToken'), 'page 2');
    return Response.json({ documents: [] });
  } });
  assert.deepEqual(await store.load(), [info]);
  await store.create({ ...info, pin: '1234', queue: ['must not upload'], history: [], qrDataUrl: 'not stored' });
  assert.equal(tokens, 1); assert.equal(pages, 2); assert.equal(writes, 1);
});

test('Firestore renews rejected tokens once and exposes no remote error payload or credentials', async () => {
  let tokens = 0, reads = 0;
  const store = new FirestoreRoomStore(credentials, { fetchImpl: async url => {
    if (url.includes('oauth2.googleapis.com')) return Response.json({ access_token: 'token-' + ++tokens, expires_in: 3600 });
    if (++reads === 1) return Response.json({ error: 'private remote payload' }, { status: 401 });
    return Response.json({ error: 'private remote payload' }, { status: 403 });
  } });
  await assert.rejects(store.load(), error => error.message === 'Firestore room storage failed (403)');
  assert.equal(tokens, 2); assert.equal(reads, 2);
  assert.equal(FirestoreRoomStore.fromEnv({}), null);
  assert.throws(() => FirestoreRoomStore.fromEnv({ ROOM_STORAGE: 'firestore' }), /FIREBASE_SERVICE_ACCOUNT_JSON/);
  assert.throws(() => FirestoreRoomStore.fromEnv({ FIREBASE_SERVICE_ACCOUNT_JSON: 'invalid' }), /JSON/);
});

test('dedicated Firebase user logs in server-side, refreshes tokens and shares simultaneous authentication', async () => {
  let now = 1000000, logins = 0, refreshes = 0, reads = 0;
  const store = new FirestoreRoomStore({ project_id: 'karaoke-test', api_key: 'test-key', email: 'backend@example.com', password: 'test-only-password' }, {
    now: () => now,
    fetchImpl: async (url, options) => {
      if (url.includes('signInWithPassword')) {
        logins++;
        assert.deepEqual(JSON.parse(options.body), { email: 'backend@example.com', password: 'test-only-password', returnSecureToken: true });
        return Response.json({ idToken: 'id-token', refreshToken: 'refresh-one', expiresIn: '3600' });
      }
      if (url.includes('securetoken.googleapis.com')) {
        refreshes++;
        assert.equal(options.body.get('grant_type'), 'refresh_token');
        assert.equal(options.body.get('refresh_token'), 'refresh-one');
        return Response.json({ id_token: 'renewed-id-token', refresh_token: 'refresh-two', expires_in: '3600' });
      }
      reads++;
      assert.equal(options.headers.Authorization, reads <= 2 ? 'Bearer id-token' : 'Bearer renewed-id-token');
      assert.ok(!JSON.stringify(options).includes('test-only-password'));
      return Response.json({ documents: [] });
    }
  });
  await Promise.all([store.load(), store.load()]);
  assert.equal(logins, 1); assert.equal(refreshes, 0);
  now += 3600000;
  await store.load();
  assert.equal(logins, 1); assert.equal(refreshes, 1);
});

test('user authentication fails closed, rejects partial config and never creates Firebase users', async () => {
  const env = { ROOM_STORAGE: 'firestore', FIREBASE_PROJECT_ID: 'karaoke-test', FIREBASE_API_KEY: 'test-key', FIREBASE_AUTH_EMAIL: 'backend@example.com', FIREBASE_AUTH_PASSWORD: 'secret-test-password' };
  assert.ok(FirestoreRoomStore.fromEnv(env) instanceof FirestoreRoomStore);
  assert.throws(() => FirestoreRoomStore.fromEnv({ ...env, FIREBASE_AUTH_PASSWORD: '' }), /ให้ครบ/);
  let attempts = 0;
  const store = new FirestoreRoomStore({ project_id: 'karaoke-test', api_key: 'test-key', email: 'backend@example.com', password: 'secret-test-password' }, {
    fetchImpl: async url => {
      attempts++; assert.ok(url.includes('signInWithPassword'));
      return Response.json({ error: { message: 'secret remote error' } }, { status: 400 });
    }
  });
  await assert.rejects(store.load(), error => error.message === 'Firebase email/password authentication failed (400)');
  assert.equal(attempts, 1);
});

function directory(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const dir = fs.mkdtempSync(path.join(parent, 'karaoke-cloud-rooms-'));
  t.after(() => {
    if (path.dirname(dir) !== parent || !path.basename(dir).startsWith('karaoke-cloud-rooms-')) throw Error('Unsafe test cleanup');
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('cloud room IDs and control PINs survive complete loss of local disk without storing queues', async t => {
  const saved = new Map();
  const store = { load: async () => [...saved.values()].map(room => ({ ...room })),
    create: async room => { saved.set(room.id, { ...room }); } };
  let queueLoads = 0;
  const defaultQueue = { createRoom: id => { queueLoads++; return { id, items: [], save() {} }; } };
  const firstDir = directory(t), freshDir = directory(t);
  const old = new RoomRegistry({ defaultQueue, adminPin: 'admin', dataDir: firstDir });
  const oldRoom = old.create('Printed QR room', '1234');
  const enabled = new RoomRegistry({ defaultQueue, adminPin: 'admin', dataDir: firstDir, store });
  await enabled.initialize();
  const newRoom = await enabled.createPersisted('Cloud Room', '5678');
  assert.equal(queueLoads, 0);
  assert.deepEqual(Object.keys(saved.get(oldRoom.id)).sort(), ['createdAt', 'id', 'name', 'pinHash', 'salt']);
  const recovered = new RoomRegistry({ defaultQueue, adminPin: 'admin', dataDir: freshDir, store });
  await recovered.initialize();
  assert.deepEqual(recovered.list(), enabled.list());
  assert.equal(recovered.verifyPin(recovered.resolve(oldRoom.id), '1234'), true);
  assert.equal(recovered.verifyPin(recovered.resolve(newRoom.id), '5678'), true);
  assert.deepEqual(recovered.resolve(newRoom.id).queue.items, []);
  assert.ok(!JSON.stringify(recovered.list()).includes('pinHash'));
  fs.writeFileSync(path.join(freshDir, 'rooms.json'), '{truncated cache');
  const fromBrokenCache = new RoomRegistry({ defaultQueue, adminPin: 'admin', dataDir: freshDir, store });
  await fromBrokenCache.initialize();
  assert.deepEqual(fromBrokenCache.list(), enabled.list());
});

test('failed cloud writes do not create temporary rooms; concurrent creates respect the room limit', async t => {
  let accept, fail = true;
  const store = { load: async () => [], create: async () => {
    if (fail) throw Error('unavailable');
    await new Promise(resolve => { accept = resolve; });
  } };
  const registry = new RoomRegistry({ defaultQueue: {}, adminPin: 'admin', dataDir: directory(t), store, maxRooms: 1 });
  await registry.initialize();
  await assert.rejects(registry.createPersisted('Failed', '1234'), /unavailable/);
  assert.equal(registry.definitions.size, 0);
  fail = false;
  const pending = registry.createPersisted('First', '1234');
  await assert.rejects(registry.createPersisted('Second', '5678'), /เต็ม/);
  assert.equal(registry.list().length, 1);
  accept(); await pending;
  assert.equal(registry.list().length, 2);
  store.load = async () => { throw Error('offline'); };
  await assert.rejects(registry.initialize(), /offline/);
  assert.equal(registry.definitions.size, 1);
});
