(function() {
  function roomApi(path) { return window.karaokeRoom?.url(path) || path; }
  const list = document.getElementById('sharedHistoryList');
  const status = document.getElementById('historyStatus');
  const count = document.getElementById('historyCount');
  const dateLabel = document.getElementById('historyDate');
  const refresh = document.getElementById('historyRefreshBtn');
  const themeBtn = document.getElementById('historyThemeBtn');
  const embeddedPanel = document.getElementById('tabToday');
  const timeFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
  const dateFormat = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'long' });
  let pending = false;
  let reloadRequested = false;
  let hasData = false;
  let timer;

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    themeBtn.textContent = theme === 'dark' ? '☀' : '◐';
  }
  if (themeBtn) {
    setTheme(localStorage.getItem('vrs_theme') || 'light');
    themeBtn.addEventListener('click', () => {
      const theme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      localStorage.setItem('vrs_theme', theme);
      setTheme(theme);
    });
  }

  function node(tag, className, text) {
    const el = document.createElement(tag);
    el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function render(data) {
    dateLabel.textContent = dateFormat.format(new Date(data.date + 'T12:00:00+07:00'));
    count.textContent = `${data.songs.length} รายการที่ขอวันนี้`;
    const fragment = document.createDocumentFragment();
    for (const song of data.songs) {
      const row = node('li', 'song-row history-row');
      const time = node('time', 'history-time', timeFormat.format(new Date(song.requestedAt)));
      time.dateTime = new Date(song.requestedAt).toISOString();
      const image = node('img', 'song-thumb');
      image.alt = '';
      image.loading = 'lazy';
      image.src = '/css/default-cover.png';
      try {
        const url = new URL(song.thumbnail, location.origin);
        if (url.protocol === 'https:' || url.origin === location.origin) image.src = url.href;
      } catch (err) { /* Keep the local cover when a saved URL is invalid. */ }
      image.addEventListener('error', () => { image.src = '/css/default-cover.png'; }, { once: true });
      const info = node('div', 'song-info');
      info.append(node('div', 'song-title', song.title));
      info.append(node('div', 'song-meta', `ขอโดย ${song.requester} · ${song.duration}`));
      if (song.playlistTitle) info.append(node('div', 'song-meta', `จากเพลย์ลิสต์ ${song.playlistTitle}`));
      row.append(time, image, info);
      fragment.append(row);
    }
    list.replaceChildren(fragment);
    status.textContent = data.songs.length ? '' : 'วันนี้ยังไม่มีใครขอเพลง ลองเป็นคนเลือกเพลงแรกของวันได้ที่หน้าขอเพลง';
    status.hidden = data.songs.length > 0;
    status.classList.remove('history-error');
    hasData = true;
  }

  async function load() {
    if (document.hidden || (embeddedPanel && !embeddedPanel.classList.contains('active'))) return;
    if (pending) { reloadRequested = true; return; }
    pending = true;
    refresh.disabled = true;
    refresh.textContent = 'กำลังโหลด…';
    list.setAttribute('aria-busy', 'true');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(roomApi('/api/history/today'), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('History unavailable');
      const data = await response.json();
      if (!data.success || !Array.isArray(data.songs)) throw new Error('Invalid history');
      render(data);
    } catch (err) {
      status.hidden = false;
      status.textContent = hasData
        ? 'อัปเดตประวัติไม่สำเร็จ กำลังแสดงข้อมูลล่าสุดที่โหลดได้ กดรีเฟรชเพื่อลองอีกครั้ง'
        : 'โหลดประวัติไม่สำเร็จ ตรวจสอบการเชื่อมต่อแล้วกดรีเฟรชรายการ';
      status.classList.add('history-error');
      if (!hasData) count.textContent = 'ยังโหลดประวัติไม่ได้';
    } finally {
      clearTimeout(timeout);
      pending = false;
      refresh.disabled = false;
      refresh.textContent = 'รีเฟรชรายการ';
      list.setAttribute('aria-busy', 'false');
      if (reloadRequested) { reloadRequested = false; scheduleLoad(); }
    }
  }
  function scheduleLoad() { clearTimeout(timer); timer = setTimeout(load, 200); }
  refresh.addEventListener('click', load);
  if (embeddedPanel) {
    // Reuse the main page's socket instead of opening a second connection per visitor.
    document.addEventListener('uwaverQueueUpdate', scheduleLoad);
    document.querySelector('.tab-btn[data-tab="today"]').addEventListener('click', scheduleLoad);
  } else if (typeof io === 'function') {
    const socket = io({ auth: { roomId: window.karaokeRoom?.id || 'main', playerPin: window.karaokeRoom?.playerPin() } });
    socket.on('connect', scheduleLoad);
    socket.on('queueUpdate', scheduleLoad);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleLoad(); });
  setInterval(() => { if (!document.hidden) load(); }, 60000);
  if (!embeddedPanel) load();
})();
