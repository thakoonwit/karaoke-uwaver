(function() {
  const id = new URLSearchParams(location.search).get('room') || 'main';
  const status = document.getElementById('qrStatus');
  const poster = document.getElementById('qrPoster');
  const print = document.getElementById('printQr');
  const download = document.getElementById('downloadQr');
  const retry = document.getElementById('retryQr');
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true; retry.hidden = true; status.hidden = false;
    status.textContent = 'กำลังเตรียมป้าย QR…';
    print.disabled = true; download.hidden = true; poster.hidden = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/api/qrcode?room=' + encodeURIComponent(id), { signal:controller.signal });
      const data = await response.json();
      if (!response.ok || !data.success) throw Error(response.status === 404 ? 'ไม่พบห้องนี้ กลับไปเลือกห้องที่หน้าห้องได้เลย' : 'โหลด QR ไม่สำเร็จ ลองอีกครั้งได้เลย');
      const svgUrl = '/api/qrcode.svg?room=' + encodeURIComponent(data.room.id);
      const image = document.getElementById('posterQr');
      image.src = svgUrl;
      await image.decode();
      document.getElementById('qrRoomName').textContent = data.room.name;
      document.getElementById('qrRoomCode').textContent = 'รหัสห้อง ' + data.room.id;
      const link = document.getElementById('qrRequestUrl'); link.href = data.requestUrl; link.textContent = data.requestUrl;
      download.href = svgUrl; download.download = 'karaoke-room-' + data.room.id + '.svg';
      document.title = 'ป้าย QR ' + data.room.name + ' · Uwaver Karaoke';
      poster.hidden = false; status.hidden = true; print.disabled = false; download.hidden = false;
    } catch (err) {
      status.textContent = err.message && err.message.startsWith('ไม่พบห้อง') ? err.message : 'เตรียมป้ายไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วลองอีกครั้ง';
      retry.hidden = false;
    } finally { clearTimeout(timeout); loading = false; }
  }
  print.addEventListener('click', () => { if (!print.disabled) window.print(); });
  retry.addEventListener('click', load);
  load();
})();
