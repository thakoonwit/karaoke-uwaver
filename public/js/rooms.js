(function() {
  const list = document.getElementById('roomsList');
  const status = document.getElementById('roomsStatus');
  const createForm = document.getElementById('createRoomForm');
  const createBtn = document.getElementById('createRoomBtn');
  const createError = document.getElementById('createRoomError');
  const joinError = document.getElementById('joinRoomError');
  const linkFor = (path, id) => path + '?room=' + encodeURIComponent(id);
  function link(text, href, className) {
    const el = document.createElement('a'); el.textContent = text; el.href = href; if (className) el.className = className; return el;
  }
  async function loadRooms() {
    const refresh = document.getElementById('refreshRoomsBtn'); refresh.disabled = true;
    try {
      const response = await fetch('/api/rooms'); const data = await response.json();
      if (!response.ok || !data.success) throw Error();
      list.replaceChildren();
      for (const room of data.rooms) {
        const row = document.createElement('li');
        const info = document.createElement('div');
        const title = link(room.name, linkFor('/', room.id));
        const code = document.createElement('span'); code.textContent = room.id === 'main' ? 'ห้องหลัก' : room.id;
        info.append(title, code);
        const actions = document.createElement('nav'); actions.className = 'room-row-actions'; actions.setAttribute('aria-label', room.name);
        actions.append(link('QR / พิมพ์', linkFor('/room-qr.html', room.id), 'room-enter-link'), link('เข้าห้อง →', linkFor('/', room.id), 'room-enter-link'));
        row.append(info, actions);
        list.append(row);
      }
      status.textContent = ''; status.hidden = true;
    } catch { status.hidden = false; status.textContent = 'โหลดห้องไม่สำเร็จ กดรีเฟรชเพื่อลองใหม่'; }
    finally { refresh.disabled = false; }
  }
  createForm.addEventListener('submit', async event => {
    event.preventDefault(); if (createBtn.disabled) return;
    createBtn.disabled = true; createBtn.textContent = 'กำลังสร้างห้อง…'; createError.hidden = true;
    const name = document.getElementById('roomNameInput').value.trim();
    const pin = document.getElementById('roomPinInput').value;
    try {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, pin }) });
      const data = await response.json();
      if (!response.ok || !data.success) throw Error(data.message || 'สร้างห้องไม่สำเร็จ');
      const room = data.room;
      try { localStorage.setItem('karaoke_room_pin_' + room.id, pin); } catch {}
      const panel = document.getElementById('createdRoomPanel'); panel.hidden = false;
      document.getElementById('createdRoomTitle').textContent = room.name + ' พร้อมแล้ว';
      document.getElementById('createdRoomCode').textContent = 'รหัสห้อง ' + room.id;
      document.getElementById('createdPlayerLink').href = linkFor('/player', room.id);
      document.getElementById('createdRequestLink').href = linkFor('/', room.id);
      document.getElementById('createdAdminLink').href = linkFor('/admin', room.id);
      document.getElementById('createdPrintLink').href = linkFor('/room-qr.html', room.id);
      const roomUrl = document.getElementById('createdRoomUrl');
      roomUrl.value = new URL(linkFor('/', room.id), location.origin).href;
      document.getElementById('createdRoomQr').hidden = true;
      const qrStatus = document.getElementById('createdQrStatus'); qrStatus.hidden = false; qrStatus.textContent = 'กำลังสร้าง QR Code…';
      document.getElementById('copyRoomStatus').textContent = '';
      createForm.reset(); loadRooms();
      panel.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      try {
        const qrResponse = await fetch(linkFor('/api/qrcode', room.id)); const qr = await qrResponse.json();
        if (!qrResponse.ok || !qr.success) throw Error();
        const image = document.getElementById('createdRoomQr'); image.src = qr.qrDataUrl; image.hidden = false;
        roomUrl.value = qr.requestUrl; qrStatus.hidden = true;
      } catch { qrStatus.textContent = 'สร้าง QR ไม่สำเร็จ ใช้ลิงก์ห้องด้านซ้ายได้'; }
    } catch (err) { createError.textContent = err.message || 'เชื่อมต่อไม่ได้ กรุณาลองอีกครั้ง'; createError.hidden = false; }
    finally { createBtn.disabled = false; createBtn.textContent = 'สร้างห้อง'; }
  });
  document.getElementById('joinRoomForm').addEventListener('submit', async event => {
    event.preventDefault(); joinError.hidden = true;
    const raw = document.getElementById('roomCodeInput').value.trim();
    const id = raw.toLowerCase() === 'main' ? 'main' : raw.toUpperCase();
    try {
      const response = await fetch(linkFor('/api/status', id)); const data = await response.json();
      if (!response.ok || !data.success) throw Error();
      location.assign(linkFor('/', data.room.id));
    } catch { joinError.hidden = false; joinError.textContent = 'ไม่พบห้องนี้ ตรวจสอบรหัสห้องแล้วลองอีกครั้ง'; }
  });
  document.getElementById('copyRoomLinkBtn').addEventListener('click', async () => {
    const input = document.getElementById('createdRoomUrl'); const message = document.getElementById('copyRoomStatus');
    try { await navigator.clipboard.writeText(input.value); message.textContent = 'คัดลอกแล้ว'; }
    catch { input.select(); message.textContent = 'เลือกลิงก์ไว้แล้ว กดคัดลอกได้เลย'; }
  });
  document.getElementById('refreshRoomsBtn').addEventListener('click', loadRooms);
  try { document.documentElement.dataset.theme = localStorage.getItem('vrs_theme') || 'dark'; } catch {}
  loadRooms();
})();
