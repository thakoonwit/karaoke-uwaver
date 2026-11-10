const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/js/profile.js'), 'utf8');

function page(storage = new Map(), failWrite = false) {
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, {
      value: '', hidden: false, open: false, attrs: {}, handlers: {}, classList: { add() {}, remove() {}, toggle() {} },
      addEventListener(event, handler) { this.handlers[event] = handler; },
      setAttribute(key, value) { this.attrs[key] = value; }, removeAttribute(key) { delete this.attrs[key]; },
      focus() {}, showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); }
    });
    return elements.get(id);
  };
  vm.runInNewContext(source, {
    document: { getElementById: element, body: element('body') },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem(key, value) { if (failWrite) throw Error('Storage blocked'); storage.set(key, value); } }
  });
  return { element, save(name) { element('profileNameInput').value = name; element('profileForm').handlers.submit({ preventDefault() {} }); } };
}

test('first visit requires a valid trimmed name, remembers it and skips onboarding after reload', () => {
  const storage = new Map();
  const first = page(storage);
  assert.equal(first.element('profileDialog').open, true);
  assert.equal(first.element('profileCloseBtn').hidden, true);
  let cancelled = false;
  first.element('profileDialog').handlers.cancel({ preventDefault() { cancelled = true; } });
  assert.equal(cancelled, true);
  for (const name of ['   ', 'x'.repeat(21)]) {
    first.save(name);
    assert.equal(first.element('profileDialog').open, true);
    assert.equal(first.element('nicknameInput').value, '');
    assert.equal(storage.has('vrs_nickname'), false);
  }
  first.save('  Koon  ');
  assert.equal(storage.get('vrs_nickname'), 'Koon');
  assert.equal(first.element('nicknameInput').value, 'Koon');
  assert.equal(first.element('profileDialog').open, false);
  const next = page(storage);
  assert.equal(next.element('profileDialog').open, false);
  assert.equal(next.element('nicknameInput').value, 'Koon');
});

test('settings drafts do not change request identity until saved; cancel keeps the saved name', () => {
  const storage = new Map([['vrs_nickname', 'Original']]);
  const settings = page(storage);
  settings.element('profileSettingsBtn').handlers.click();
  assert.equal(settings.element('profileNameInput').value, 'Original');
  assert.equal(settings.element('profileCloseBtn').hidden, false);
  settings.element('profileNameInput').value = 'Draft';
  settings.element('profileCloseBtn').handlers.click();
  assert.equal(settings.element('nicknameInput').value, 'Original');
  settings.element('profileSettingsBtn').handlers.click();
  assert.equal(settings.element('profileNameInput').value, 'Original');
  settings.save('New singer');
  assert.equal(settings.element('nicknameInput').value, 'New singer');
  assert.equal(page(storage).element('nicknameInput').value, 'New singer');
});

test('blocked storage leaves the form open and does not pretend the name was remembered', () => {
  const blocked = page(new Map(), true);
  blocked.save('Singer');
  assert.equal(blocked.element('profileDialog').open, true);
  assert.equal(blocked.element('profileError').hidden, false);
  assert.equal(blocked.element('nicknameInput').value, '');
});
