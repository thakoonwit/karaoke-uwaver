const crypto = require('crypto');

// Server-only Firestore REST access. No browser SDK, polling or queue uploads.
class FirestoreRoomStore {
  constructor(credentials, { fetchImpl = globalThis.fetch, now = Date.now } = {}) {
    const userAuth = credentials?.api_key && credentials?.email && credentials?.password;
    const serviceAuth = typeof credentials?.client_email === 'string' && typeof credentials?.private_key === 'string';
    if (!credentials || !/^[a-z][a-z0-9-]{4,62}$/.test(credentials.project_id || '') || (!userAuth && !serviceAuth)) {
      throw Error('Firebase room storage credentials ไม่ครบหรือไม่ถูกต้อง');
    }
    this.credentials = credentials;
    this.fetch = fetchImpl;
    this.now = now;
    this.base = 'https://firestore.googleapis.com/v1/projects/' + credentials.project_id + '/databases/(default)/documents/karaokeRooms';
    this.token = null;
    this.refresh = null;
  }
  static fromEnv(env = process.env) {
    if (env.FIREBASE_AUTH_EMAIL || env.FIREBASE_AUTH_PASSWORD) {
      if (!env.FIREBASE_PROJECT_ID || !env.FIREBASE_API_KEY || !env.FIREBASE_AUTH_EMAIL || !env.FIREBASE_AUTH_PASSWORD) {
        throw Error('ต้องตั้ง FIREBASE_PROJECT_ID, FIREBASE_API_KEY, FIREBASE_AUTH_EMAIL และ FIREBASE_AUTH_PASSWORD ให้ครบ');
      }
      return new FirestoreRoomStore({ project_id: env.FIREBASE_PROJECT_ID, api_key: env.FIREBASE_API_KEY,
        email: env.FIREBASE_AUTH_EMAIL, password: env.FIREBASE_AUTH_PASSWORD });
    }
    if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      if (env.ROOM_STORAGE === 'firestore') throw Error('ต้องตั้ง Firebase Auth email/password หรือ FIREBASE_SERVICE_ACCOUNT_JSON ก่อนใช้ Firestore');
      return null;
    }
    let credentials;
    try { credentials = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON); }
    catch { throw Error('FIREBASE_SERVICE_ACCOUNT_JSON ต้องเป็น JSON ของ service account'); }
    return new FirestoreRoomStore(credentials);
  }
  async userToken() {
    const refreshing = Boolean(this.refreshToken);
    const url = refreshing ? 'https://securetoken.googleapis.com/v1/token' : 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword';
    const response = await this.fetch(url + '?key=' + encodeURIComponent(this.credentials.api_key), {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': refreshing ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: refreshing ? new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.refreshToken }) :
        JSON.stringify({ email: this.credentials.email, password: this.credentials.password, returnSecureToken: true })
    });
    if (!response.ok) {
      if (refreshing && [400, 401].includes(response.status)) { this.refreshToken = null; return this.userToken(); }
      throw Error('Firebase email/password authentication failed (' + response.status + ')');
    }
    const body = await response.json();
    const value = refreshing ? body.id_token : body.idToken;
    const refreshToken = refreshing ? body.refresh_token : body.refreshToken;
    const expires = Number(refreshing ? body.expires_in : body.expiresIn);
    if (typeof value !== 'string' || typeof refreshToken !== 'string' || !Number.isFinite(expires) || expires <= 0) throw Error('Firebase token response invalid');
    this.refreshToken = refreshToken;
    this.token = { value, expiresAt: this.now() + expires * 1000 };
    return value;
  }
  async accessToken() {
    if (this.token && this.token.expiresAt > this.now() + 60000) return this.token.value;
    if (this.refresh) return this.refresh;
    this.refresh = (async () => {
      if (this.credentials.api_key) return this.userToken();
      const issued = Math.floor(this.now() / 1000);
      const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = encode({ alg: 'RS256', typ: 'JWT' }) + '.' + encode({
        iss: this.credentials.client_email, scope: 'https://www.googleapis.com/auth/datastore',
        aud: 'https://oauth2.googleapis.com/token', iat: issued, exp: issued + 3600
      });
      const signature = crypto.sign('RSA-SHA256', Buffer.from(input), this.credentials.private_key).toString('base64url');
      const response = await this.fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: input + '.' + signature }),
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) throw Error('Firebase authentication failed (' + response.status + ')');
      const body = await response.json();
      if (typeof body.access_token !== 'string' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw Error('Firebase token response invalid');
      this.token = { value: body.access_token, expiresAt: this.now() + body.expires_in * 1000 };
      return this.token.value;
    })();
    try { return await this.refresh; } finally { this.refresh = null; }
  }
  async request(url, options = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken();
      const response = await this.fetch(url, { ...options,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(10000)
      });
      if (response.status === 401 && attempt === 0) { this.token = null; continue; }
      if (!response.ok) {
        const error = Error('Firestore room storage failed (' + response.status + ')');
        error.status = response.status; throw error;
      }
      return response.json();
    }
  }
  async load() {
    const rooms = [];
    let pageToken = '';
    do {
      const url = new URL(this.base); url.searchParams.set('pageSize', '100');
      if (pageToken) url.searchParams.set('pageToken', pageToken);
      const page = await this.request(url.href);
      for (const doc of page.documents || []) {
        const f = doc.fields || {};
        rooms.push({ id: doc.name.split('/').pop(), name: f.name?.stringValue, salt: f.salt?.stringValue,
          pinHash: f.pinHash?.stringValue, createdAt: Number(f.createdAt?.integerValue) });
      }
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    return rooms;
  }
  async create(room) {
    // Explicit allowlist prevents queue, history, PIN plaintext or tokens reaching Firestore.
    const fields = {
      name: { stringValue: room.name }, salt: { stringValue: room.salt },
      pinHash: { stringValue: room.pinHash }, createdAt: { integerValue: String(room.createdAt) }
    };
    await this.request(this.base + '?documentId=' + encodeURIComponent(room.id), { method: 'POST', body: JSON.stringify({ fields }) });
  }
}
module.exports = FirestoreRoomStore;
