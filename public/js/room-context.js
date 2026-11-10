(function() {
  const id = new URLSearchParams(location.search).get('room') || 'main';
  const storageKey = 'karaoke_room_pin_' + id;
  const url = path => {
    const target = new URL(path, location.origin);
    target.searchParams.set('room', id);
    return target.pathname + target.search;
  };
  function playerPin() { try { return localStorage.getItem(storageKey) || ''; } catch { return ''; } }
  async function verifyPin(pin) {
    const response = await fetch(url('/api/admin/verify-pin'), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin })
    });
    const result = await response.json();
    return result.success === true;
  }
  let unlockPending = null;
  async function authorizePlayer() {
    if (id === 'main') return true;
    try { if (playerPin() && await verifyPin(playerPin())) return true; } catch {}
    if (unlockPending) return unlockPending;
    unlockPending = new Promise(resolve => {
      const dialog = document.createElement('dialog');
      dialog.className = 'room-unlock-dialog';
      dialog.setAttribute('aria-labelledby', 'roomUnlockTitle');
      dialog.innerHTML = '<form><h2 id="roomUnlockTitle">เปิดจอร้องเพลงของห้องนี้</h2><p>ใส่ PIN ที่ตั้งไว้ตอนสร้างห้อง</p><label for="roomUnlockPin">PIN ควบคุมห้อง</label><input id="roomUnlockPin" type="password" inputmode="numeric" required maxlength="10" autocomplete="current-password"><p class="room-error" role="alert"></p><div class="room-unlock-actions"><button type="button">ยกเลิก</button><button type="submit">เปิดจอร้องเพลง</button></div></form>';
      document.body.append(dialog);
      let accepted = false;
      const form = dialog.querySelector('form');
      const input = dialog.querySelector('input');
      const error = dialog.querySelector('.room-error');
      dialog.querySelector('button[type="button"]').onclick = () => dialog.close();
      form.onsubmit = async event => {
        event.preventDefault();
        const submit = form.querySelector('button[type="submit"]');
        submit.disabled = true;
        try {
          if (!await verifyPin(input.value)) { error.textContent = 'PIN ไม่ถูกต้อง กรุณาลองอีกครั้ง'; return; }
          try { localStorage.setItem(storageKey, input.value); } catch {}
          // An in-memory copy also supports browsers with storage disabled.
          window.karaokeRoom.playerPin = () => input.value;
          accepted = true;
          dialog.close();
        } catch { error.textContent = 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง'; }
        finally { submit.disabled = false; }
      };
      dialog.addEventListener('close', () => { dialog.remove(); unlockPending = null; resolve(accepted); });
      dialog.showModal();
      input.focus();
    });
    return unlockPending;
  }
  window.karaokeRoom = { id, url, playerPin, authorizePlayer };
  function bindPage() {
    document.querySelectorAll('a[href]').forEach(link => {
      const href = link.getAttribute('href');
      if (['/', '/player', '/admin', '/history'].includes(href)) link.href = url(href);
    });
    fetch(url('/api/status')).then(response => response.json()).then(state => {
      if (!state.success || !state.room) return;
      const name = state.room.name;
      const subtitle = document.querySelector('.brand-text p');
      if (subtitle) {
        const link = document.createElement('a');
        link.href = '/rooms'; link.className = 'room-context-link';
        link.textContent = name + ' · เปลี่ยนห้อง'; link.title = 'ห้อง ' + name + ' (' + id + ')';
        subtitle.replaceChildren(link);
      }
      const qrTitle = document.querySelector('.karaoke-join .join-title');
      if (qrTitle) qrTitle.textContent = name;
      const qrDescription = document.querySelector('.karaoke-join .join-description');
      if (qrDescription) qrDescription.textContent = 'สแกนขอเพลงห้องนี้';
      document.title = name + ' · ' + document.title;
    }).catch(() => {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindPage);
  else bindPage();
})();
