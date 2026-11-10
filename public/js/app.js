(function() {
  function roomApi(path) { return window.karaokeRoom?.url(path) || path; }
  // ── DOM references ──────────────────────────────────────────────────────
  const themeToggleBtn      = document.getElementById('themeToggleBtn');
  const nicknameInput       = document.getElementById('nicknameInput');
  const songQueryInput      = document.getElementById('songQueryInput');
  const requestForm         = document.getElementById('requestForm');
  const submitRequestBtn    = document.getElementById('submitRequestBtn');
  const playerStatusBadge   = document.getElementById('playerStatusBadge');
  const playerStatusDot     = document.getElementById('playerStatusDot');
  const playerStatusText    = document.getElementById('playerStatusText');
  const acceptingBadge      = document.getElementById('acceptingBadge');
  const nowPlayingContainer = document.getElementById('nowPlayingContainer');
  const queueContainer      = document.getElementById('queueContainer');
  const queueCountBadge     = document.getElementById('queueCountBadge');
  const searchModal         = document.getElementById('searchModal');
  const closeModalBtn       = document.getElementById('closeModalBtn');
  const modalTitle          = document.getElementById('modalTitle');
  const playlistBanner      = document.getElementById('playlistBanner');
  const searchResultsList   = document.getElementById('searchResultsList');
  const toastContainer      = document.getElementById('toastContainer');
  const favListContainer    = document.getElementById('favListContainer');
  const historyListContainer= document.getElementById('historyListContainer');
  const topChartListContainer = document.getElementById('topChartListContainer');

  let currentState  = null;
  let isSearching = false;
  let isSubmittingSong = false;
  let queueMovePending = false;
  let queueStateRevision = 0;
  let queueDrag = null;
  const searchIcon = '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>';

  // ── Device ID & Nickname ────────────────────────────────────────────────
  function getDeviceId() {
    let id = localStorage.getItem('vrs_device_id');
    if (!id) {
      id = 'dev_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
      localStorage.setItem('vrs_device_id', id);
    }
    return id;
  }
  const deviceId = getDeviceId();

  // ── Favorites helpers ───────────────────────────────────────────────────
  function getFavorites() {
    try { return JSON.parse(localStorage.getItem('vrs_favorites') || '[]'); }
    catch(e) { return []; }
  }
  function saveFavorites(favs) {
    localStorage.setItem('vrs_favorites', JSON.stringify(favs));
    renderFavorites();
  }
  function isFavorite(videoId) { return getFavorites().some(f => f.videoId === videoId); }
  function toggleFavorite(song) {
    let favs = getFavorites();
    const idx = favs.findIndex(f => f.videoId === song.videoId);
    if (idx !== -1) {
      favs.splice(idx, 1);
      showToast(`ยกเลิกเพลงโปรด "${song.title}"`, 'info');
    } else {
      favs.unshift({ videoId: song.videoId, title: song.title, thumbnail: song.thumbnail,
        channelTitle: song.channelTitle || '', duration: song.duration || '0:00', savedAt: Date.now() });
      showToast(`บันทึก "${song.title}" เป็นเพลงโปรดแล้ว`, 'success');
    }
    saveFavorites(favs);
    if (currentState) renderState(currentState);
  }

  // ── History helpers ─────────────────────────────────────────────────────
  const requestHistoryKey = 'vrs_request_history_' + (window.karaokeRoom?.id || 'main');
  function getHistory() {
    try { return JSON.parse(localStorage.getItem(requestHistoryKey) || ((window.karaokeRoom?.id || 'main') === 'main' ? localStorage.getItem('vrs_request_history') : null) || '[]'); }
    catch(e) { return []; }
  }
  function addToHistory(song) {
    let hist = getHistory().filter(h => h.videoId !== song.videoId);
    hist.unshift({ videoId: song.videoId, title: song.title, thumbnail: song.thumbnail,
      channelTitle: song.channelTitle || '', duration: song.duration || '0:00', requestedAt: Date.now() });
    localStorage.setItem(requestHistoryKey, JSON.stringify(hist.slice(0, 30)));
    renderHistory();
  }

  // ── Theme ───────────────────────────────────────────────────────────────
  const moonSvg = `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;
  const sunSvg  = `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;

  function initTheme() {
    const t = localStorage.getItem('vrs_theme') || 'dark';
    document.documentElement.setAttribute('data-theme', t);
    if (themeToggleBtn) themeToggleBtn.innerHTML = t === 'dark' ? sunSvg : moonSvg;
  }
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener('click', () => {
      const t = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('vrs_theme', t);
      themeToggleBtn.innerHTML = t === 'dark' ? sunSvg : moonSvg;
    });
  }
  initTheme();

  // ── Toast ────────────────────────────────────────────────────────────────
  function showToast(msg, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    let icon = `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;
    if (type === 'success') icon = `<svg class="svg-icon" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>`;
    if (type === 'error')   icon = `<svg class="svg-icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`;

    el.innerHTML = icon;
    const messageNode = document.createElement('span');
    messageNode.textContent = String(msg);
    el.appendChild(messageNode);
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0'; el.style.transition = 'opacity 0.3s';
      setTimeout(() => el.remove(), 350);
    }, 3500);
  }

  // ── Floating emoji ───────────────────────────────────────────────────────
  function spawnEmoji(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    el.style.left = (15 + Math.random() * 70) + 'vw';
    el.style.bottom = '80px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1800);
  }

  function escapeHtml(s) {
    if (!s) return '';
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  // ── Render state ─────────────────────────────────────────────────────────
  function renderState(state) {
    currentState = state;
    const { currentSong, queue, playerState, isAcceptingRequests, topSongs } = state;

    // Player status badge
    if (playerState && playerState.isOnline) {
      playerStatusBadge.className = 'badge online';
      playerStatusDot.className = 'dot-live';
      playerStatusText.textContent = 'Player ออนไลน์';
    } else {
      playerStatusBadge.className = 'badge offline';
      playerStatusDot.className = 'dot-offline';
      playerStatusText.textContent = 'Player ออฟไลน์';
    }

    // Accepting status
    if (isAcceptingRequests === false) {
      acceptingBadge.style.display = 'inline-flex';
      submitRequestBtn.disabled = true;
      submitRequestBtn.innerHTML = '<span>🔒</span><span>ปิดรับเพลงชั่วคราว</span>';
    } else {
      acceptingBadge.style.display = 'none';
      submitRequestBtn.disabled = isSearching;
      if (!isSearching) submitRequestBtn.innerHTML = searchIcon + '<span>ค้นหาเพลง</span>';
    }

    // Now Playing
    if (currentSong) {
      const favCls = isFavorite(currentSong.videoId) ? 'btn-icon active-fav' : 'btn-icon';
      const autoLabel = currentSong.isAutoDj ? 'Auto-DJ' : playerState?.playbackState === 'paused' ? 'พักการร้อง' : 'กำลังร้อง';

      nowPlayingContainer.innerHTML = `
        <div class="request-current-song">
          <img src="${escapeHtml(currentSong.thumbnail || '/css/default-cover.png')}" class="current-song-cover" alt="" width="64" height="64" onerror="this.onerror=null;this.src='/css/default-cover.png'">
          <div class="current-song-info">
            <div class="player-status-line">
              <span class="player-status-text">${autoLabel}</span>
            </div>
            <div class="player-song-title">${escapeHtml(currentSong.title)}</div>
            <div class="player-requester">ผู้ร้อง: <strong>${escapeHtml(currentSong.requester)}</strong></div>
          </div>
          <button id="nowFavBtn" class="${favCls}" aria-label="บันทึกเป็นเพลงโปรด" aria-pressed="${isFavorite(currentSong.videoId)}" title="เพลงโปรด"><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg></button>
        <details class="request-reactions">
          <summary aria-label="ส่งกำลังใจให้ผู้ร้อง" title="ส่งกำลังใจ"><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M8 14a4 4 0 0 0 8 0M8 9h.01M16 9h.01"/></svg></summary>
        <div class="reaction-strip">
          <button class="rxn-btn" data-emoji="👍" title="ส่งใจ">👍</button>
          <button class="rxn-btn" data-emoji="❤️" title="เลิฟ">❤️</button>
          <button class="rxn-btn" data-emoji="🔥" title="มันส์">🔥</button>
          <button class="rxn-btn" data-emoji="🎉" title="ปาร์ตี้">🎉</button>
        </div>
        </details>
        </div>
      `;

      document.getElementById('nowFavBtn').onclick = () => toggleFavorite(currentSong);

      nowPlayingContainer.querySelectorAll('.rxn-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const emoji = btn.getAttribute('data-emoji');
          socket.emit('sendReaction', { emoji, requester: nicknameInput.value.trim() });
        });
      });

    } else {
      nowPlayingContainer.innerHTML = '<p class="request-idle">ยังไม่มีเพลงกำลังร้อง เลือกเพลงแรกกันเลย</p>';
    }

    // Queue count
    if (queueCountBadge) {
      const count = queue ? queue.length : 0;
      queueCountBadge.textContent = `${count} เพลงในคิว`;
    }

    // Queue list
    if (queueDrag?.active && (state.isUserReorderEnabled !== true || queueDrag.orderSignature !== (queue || []).map(item => item.id).join('\0'))) queueDrag.cancel();
    if (!queueDrag?.active) {
    const userReorderHint = document.getElementById('userReorderHint');
    if (userReorderHint) userReorderHint.hidden = state.isUserReorderEnabled !== true;
    if (!queue || queue.length === 0) {
      queueContainer.innerHTML = `<p class="empty-state">รอรายการเพลงจากทุกคน 🎧</p>`;
    } else {
      let html = '<ul class="song-list">';
      queue.forEach((item, i) => {
        const isMine = item.deviceId === deviceId;
        const delBtn = isMine ? `<button class="btn-icon danger delete-own-btn" data-id="${item.id}" title="ยกเลิกเพลงนี้">🗑</button>` : '';
        const dragHandle = state.isUserReorderEnabled === true ? `<button type="button" class="btn-icon user-drag-handle" data-id="${escapeHtml(item.id)}" aria-label="จัดคิว ${escapeHtml(item.title)}" aria-describedby="queueDragHelp" title="ลากเพื่อจัดคิว" ${queue.length < 2 || queueMovePending ? 'disabled' : ''}><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01"/></svg></button>` : '';
        html += `
          <li class="song-row" data-song-id="${escapeHtml(item.id)}">
            ${dragHandle}
            <span class="song-rank">${i + 1}</span>
            <img src="${item.thumbnail}" class="song-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
            <div class="song-info">
              <div class="song-title">${escapeHtml(item.title)}</div>
              <div class="song-meta">${escapeHtml(item.requester)} · ${item.duration}</div>
            </div>
            <div class="song-actions">${delBtn}</div>
          </li>`;
      });
      html += '</ul>';
      queueContainer.innerHTML = html;

      queueContainer.querySelectorAll('.delete-own-btn').forEach(btn => {
        btn.onclick = () => deleteOwnSong(btn.getAttribute('data-id'));
      });
    }
    }

    renderFavorites();
    renderHistory();
    renderTopChart(topSongs || []);
  }

  // ── Render Favorites ──────────────────────────────────────────────────────
  function renderFavorites() {
    if (!favListContainer) return;
    const favs = getFavorites();
    if (!favs.length) {
      favListContainer.innerHTML = `<p class="empty-state">ยังไม่มีเพลงโปรด — กด ❤️ ในรายการเพลงเพื่อบันทึก</p>`;
      return;
    }
    favListContainer.innerHTML = favs.map(song => `
      <div class="song-row">
        <img src="${song.thumbnail}" class="song-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-meta">${escapeHtml(song.channelTitle)} · ${song.duration}</div>
        </div>
        <div class="song-actions">
          <button class="btn-icon request-fav-btn" data-video='${JSON.stringify(song).replace(/'/g,"&apos;")}' title="ขอเพลงนี้">+</button>
          <button class="btn-icon active-fav remove-fav-btn" data-id="${song.videoId}" title="ลบออก">❤️</button>
        </div>
      </div>`).join('');

    favListContainer.querySelectorAll('.request-fav-btn').forEach(btn => {
      btn.onclick = () => submitSongRequest(JSON.parse(btn.getAttribute('data-video')));
    });
    favListContainer.querySelectorAll('.remove-fav-btn').forEach(btn => {
      btn.onclick = () => saveFavorites(getFavorites().filter(f => f.videoId !== btn.getAttribute('data-id')));
    });
  }

  // ── Render History ────────────────────────────────────────────────────────
  function renderHistory() {
    if (!historyListContainer) return;
    const hist = getHistory();
    if (!hist.length) {
      historyListContainer.innerHTML = `<p class="empty-state">ยังไม่มีประวัติการขอเพลง</p>`;
      return;
    }
    historyListContainer.innerHTML = hist.map(song => `
      <div class="song-row">
        <img src="${song.thumbnail}" class="song-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-meta">${escapeHtml(song.channelTitle)} · ${song.duration}</div>
        </div>
        <div class="song-actions">
          <button class="btn-icon request-hist-btn" data-video='${JSON.stringify(song).replace(/'/g,"&apos;")}' title="ขอเพลงนี้อีกครั้ง">+</button>
        </div>
      </div>`).join('');

    historyListContainer.querySelectorAll('.request-hist-btn').forEach(btn => {
      btn.onclick = () => submitSongRequest(JSON.parse(btn.getAttribute('data-video')));
    });
  }

  // ── Render Top Chart ──────────────────────────────────────────────────────
  function renderTopChart(topSongs) {
    if (!topChartListContainer) return;
    if (!topSongs.length) {
      topChartListContainer.innerHTML = `<p class="empty-state">ยังไม่มีข้อมูลเพลงฮิต</p>`;
      return;
    }
    const medals = ['🥇','🥈','🥉'];
    topChartListContainer.innerHTML = topSongs.map((song, i) => `
      <div class="song-row">
        <span class="song-rank">${medals[i] || `#${i+1}`}</span>
        <img src="${song.thumbnail}" class="song-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
        <div class="song-info">
          <div class="song-title">${escapeHtml(song.title)}</div>
          <div class="song-meta">ขอแล้ว ${song.requestCount} ครั้ง · ${song.duration}</div>
        </div>
        <div class="song-actions">
          <button class="btn-icon request-top-btn" data-video='${JSON.stringify(song).replace(/'/g,"&apos;")}' title="ขอเพลงนี้">+</button>
        </div>
      </div>`).join('');

    topChartListContainer.querySelectorAll('.request-top-btn').forEach(btn => {
      btn.onclick = () => submitSongRequest(JSON.parse(btn.getAttribute('data-video')));
    });
  }

  // ── Tab switching ─────────────────────────────────────────────────────────
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.getAttribute('data-tab');
      const map = { queue: 'tabQueue', fav: 'tabFav', history: 'tabHistory', top: 'tabTop', today: 'tabToday' };
      if (map[id]) document.getElementById(map[id]).classList.add('active');
    });
  });

  // ── Socket.IO ─────────────────────────────────────────────────────────────
  if (window.KaraokeQueueDrag) queueDrag = new window.KaraokeQueueDrag({
    container: queueContainer,
    enabled: () => currentState?.isUserReorderEnabled === true && !queueMovePending,
    getOrder: () => (currentState?.queue || []).map(item => item.id),
    onDrop: reorderQueuedSong
  });
  const socket = io({ auth: { roomId: window.karaokeRoom?.id || 'main', playerPin: window.karaokeRoom?.playerPin() } });
  socket.on('queueUpdate', state => {
    queueStateRevision++;
    renderState(state);
    document.dispatchEvent(new Event('uwaverQueueUpdate'));
  });
  socket.on('toastMessage', d => showToast(d.message, d.type || 'info'));
  socket.on('newReaction', d => spawnEmoji(d.emoji));

  // ── Delete own song ───────────────────────────────────────────────────────
  async function reorderQueuedSong(songId, toIndex, expectedOrder, keyboard) {
    if (queueMovePending || currentState?.isUserReorderEnabled !== true) return;
    queueMovePending = true;
    queueContainer.querySelectorAll('.user-drag-handle').forEach(button => { button.disabled = true; });
    try {
      const response = await fetch(roomApi('/api/request/reorder'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ songId, toIndex, expectedOrder })
      });
      const result = await response.json();
      if (!response.ok || !result.success) showToast(result.message || 'เลื่อนคิวไม่สำเร็จ', 'error');
      const announcement = document.getElementById('queueOrderStatus');
      if (announcement) announcement.textContent = result.success ? `ย้ายเพลงไปลำดับ ${toIndex + 1} แล้ว` : result.message;
      // Reload on both success and stale/disabled errors to reflect other users' moves.
      const revision = queueStateRevision;
      const latest = await fetch(roomApi('/api/status'));
      const state = await latest.json();
      if (latest.ok && state.success && revision === queueStateRevision) currentState = state;
    } catch { showToast('เชื่อมต่อไม่ได้ กรุณาลองเลื่อนคิวอีกครั้ง', 'error'); }
    finally {
      queueMovePending = false;
      if (currentState) renderState(currentState);
      if (keyboard) {
        const handle = [...queueContainer.querySelectorAll('.user-drag-handle')].find(button => button.dataset.id === songId);
        handle?.focus({ preventScroll: true });
        handle?.scrollIntoView({ block: 'nearest' });
      }
    }
  }

  async function deleteOwnSong(songId) {
    try {
      const res  = await fetch(roomApi('/api/request/delete'), { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId, deviceId }) });
      const data = await res.json();
      showToast(data.message || (data.success ? 'ยกเลิกเพลงสำเร็จ' : 'ไม่สามารถยกเลิกได้'), data.success ? 'success' : 'error');
    } catch { showToast('เกิดข้อผิดพลาด', 'error'); }
  }

  // ── Submit song request ───────────────────────────────────────────────────
  async function submitSongRequest(song) {
    if (isSubmittingSong) return;
    const nickname = nicknameInput.value.trim();
    if (!nickname) { showToast('กรุณาระบุชื่อเล่นก่อน', 'error'); return; }
    isSubmittingSong = true;
    searchResultsList.setAttribute('aria-busy', 'true');
    try {
      const res  = await fetch(roomApi('/api/request'), { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...song, requester: nickname, deviceId }) });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'เพิ่มเพลงเข้าคิวแล้ว', 'success');
        addToHistory(song);
        songQueryInput.value = '';
        closeSearchModal();
      } else { showToast(data.message || 'ไม่สามารถขอเพลงได้', 'error'); }
    } catch { showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error'); }
    finally { isSubmittingSong = false; searchResultsList.setAttribute('aria-busy', 'false'); }
  }

  const MAX_PLAYLIST_SELECTION = 20;
  let selectedPlaylistVideos = new Map();

  // ── Submit playlist request ───────────────────────────────────────────────
  async function submitPlaylistRequest(playlist) {
    const nickname = nicknameInput.value.trim();
    if (!nickname) { showToast('กรุณาระบุชื่อเล่นก่อน', 'error'); return; }

    const addAllBtn = document.getElementById('playlistAddAllBtn');
    if (addAllBtn) {
      addAllBtn.disabled = true;
      addAllBtn.innerHTML = '<span>⏳</span><span>กำลังเพิ่มเพลงเข้าคิว...</span>';
    }

    try {
      const res = await fetch(roomApi('/api/request/playlist'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: playlist.title,
          songs: playlist.videos,
          requester: nickname,
          deviceId
        })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message || 'เพิ่มเพลงจากเพลย์ลิสต์เข้าคิวแล้ว', 'success');
        if (data.result && data.result.addedSongs) {
          data.result.addedSongs.forEach(song => addToHistory(song));
        }
        songQueryInput.value = '';
        closeSearchModal();
      } else {
        showToast(data.message || 'ไม่สามารถเพิ่มเพลย์ลิสต์ได้', 'error');
      }
    } catch {
      showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error');
    } finally {
      if (addAllBtn) {
        addAllBtn.disabled = false;
        const count = selectedPlaylistVideos.size;
        addAllBtn.innerHTML = `<span>➕</span><span>เพิ่มเพลงที่เลือกเข้าคิว (${count} เพลง)</span>`;
      }
    }
  }

  // ── Search form ───────────────────────────────────────────────────────────
  document.addEventListener('uwaverCatalogSearch', event => {
    if (isSearching) return;
    if (currentState?.isAcceptingRequests === false) { showToast('ห้องนี้ปิดรับเพลงชั่วคราว', 'error'); return; }
    const song = event.detail;
    if (!song || typeof song.title !== 'string' || typeof song.artist !== 'string') return;
    songQueryInput.value = (song.title + ' ' + song.artist).slice(0, 500);
    requestForm.requestSubmit();
  });
  requestForm.addEventListener('submit', async e => {
    e.preventDefault();
    if (isSearching || currentState?.isAcceptingRequests === false) return;
    const nickname = nicknameInput.value.trim();
    const query    = songQueryInput.value.trim();
    if (!nickname) { showToast('กรุณาระบุชื่อเล่น', 'error'); return; }
    if (!query)    { showToast('กรุณากรอกชื่อเพลงหรือวางลิงก์', 'error'); return; }
    localStorage.setItem('vrs_nickname', nickname);

    isSearching = true;
    document.dispatchEvent(new CustomEvent('uwaverSearchBusy', { detail: true }));
    submitRequestBtn.disabled = true;
    submitRequestBtn.innerHTML = '<span class="request-spinner" aria-hidden="true"></span><span>กำลังค้นหา…</span>';
    try {
      const res  = await fetch(roomApi('/api/search'), { method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, karaoke: document.getElementById('karaokeSearchInput').checked }) });
      const data = await res.json();
      if (!data.success) { showToast(data.message || 'ไม่พบผลลัพธ์', 'error'); return; }
      if (data.type === 'direct') {
        await submitSongRequest(data.video);
      } else if (data.type === 'playlist') {
        renderPlaylistResults(data.playlist);
        openSearchModal();
      } else if (data.type === 'search_results') {
        renderSearchResults(data.results);
        openSearchModal();
      }
    } catch { showToast('เกิดข้อผิดพลาดในการเชื่อมต่อ', 'error'); }
    finally {
      isSearching = false;
      document.dispatchEvent(new CustomEvent('uwaverSearchBusy', { detail: false }));
      submitRequestBtn.disabled = currentState?.isAcceptingRequests === false;
      submitRequestBtn.innerHTML = submitRequestBtn.disabled ? '<span>ปิดรับเพลงชั่วคราว</span>' : searchIcon + '<span>ค้นหาเพลง</span>';
    }
  });

  // ── Search results modal ──────────────────────────────────────────────────
  function renderSearchResults(results) {
    if (playlistBanner) playlistBanner.style.display = 'none';
    if (modalTitle) modalTitle.textContent = 'เลือกเพลงที่ต้องการ';
    searchResultsList.innerHTML = '';
    results.forEach(song => {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `
        <img src="${song.thumbnail}" class="result-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(song.title)}</div>
          <div class="result-meta">${escapeHtml(song.channelTitle)} · ${song.duration}</div>
        </div>
        <button class="result-add" aria-label="เพิ่ม ${escapeHtml(song.title)} เข้าคิว" title="เพิ่มเพลงนี้"><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
      `;
      row.onclick = () => submitSongRequest(song);
      searchResultsList.appendChild(row);
    });
  }

  // ── Playlist results modal with Multi-Select ──────────────────────────────
  function renderPlaylistResults(playlist) {
    if (modalTitle) modalTitle.textContent = 'เพลย์ลิสต์ YouTube';

    // 1. Initial selection: select first 20 songs by default
    selectedPlaylistVideos.clear();
    const initialCount = Math.min(MAX_PLAYLIST_SELECTION, (playlist.videos || []).length);
    for (let i = 0; i < initialCount; i++) {
      const s = playlist.videos[i];
      selectedPlaylistVideos.set(s.videoId, s);
    }

    // 2. Render Playlist Banner & Sticky Action Bar
    if (playlistBanner) {
      playlistBanner.style.display = 'flex';
      playlistBanner.innerHTML = `
        <div class="playlist-banner-header">
          <img src="${playlist.thumbnail}" class="playlist-banner-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
          <div class="playlist-banner-info">
            <span class="playlist-badge">เพลย์ลิสต์</span>
            <div class="playlist-banner-title">${escapeHtml(playlist.title)}</div>
            <div class="playlist-banner-meta">${escapeHtml(playlist.channelTitle)} · ${playlist.itemCount} เพลง</div>
          </div>
        </div>

        <div class="playlist-toolbar">
          <div class="playlist-counter">
            เลือกแล้ว <strong id="selectedCountText">${selectedPlaylistVideos.size}</strong> / ${MAX_PLAYLIST_SELECTION} เพลง
          </div>
          <div class="playlist-quick-actions">
            <button type="button" class="playlist-chip-btn" id="selectAllPlaylistBtn">เลือก 20 เพลง</button>
            <button type="button" class="playlist-chip-btn" id="clearPlaylistBtn">ล้างที่เลือก</button>
          </div>
        </div>

        <button class="playlist-add-all-btn" id="playlistAddAllBtn">
          <span>➕</span><span>เพิ่มเพลงที่เลือกเข้าคิว (${selectedPlaylistVideos.size} เพลง)</span>
        </button>
      `;

      // Helper to update selection count and button text/state
      const updateSelectionUI = () => {
        const count = selectedPlaylistVideos.size;
        const countText = document.getElementById('selectedCountText');
        const addAllBtn = document.getElementById('playlistAddAllBtn');
        if (countText) countText.textContent = count;
        if (addAllBtn) {
          if (count === 0) {
            addAllBtn.disabled = true;
            addAllBtn.innerHTML = '<span>⚠️</span><span>กรุณาเลือกเพลงอย่างน้อย 1 เพลง</span>';
          } else {
            addAllBtn.disabled = false;
            addAllBtn.innerHTML = `<span>➕</span><span>เพิ่มเพลงที่เลือกเข้าคิว (${count} เพลง)</span>`;
          }
        }

        // Update row highlight classes
        searchResultsList.querySelectorAll('.result-row.selectable').forEach(r => {
          const vid = r.getAttribute('data-video-id');
          if (selectedPlaylistVideos.has(vid)) {
            r.classList.add('selected');
          } else {
            r.classList.remove('selected');
          }
        });
      };

      // Select All (up to 20)
      const selectAllBtn = document.getElementById('selectAllPlaylistBtn');
      if (selectAllBtn) {
        selectAllBtn.onclick = (e) => {
          e.stopPropagation();
          selectedPlaylistVideos.clear();
          const count = Math.min(MAX_PLAYLIST_SELECTION, (playlist.videos || []).length);
          for (let i = 0; i < count; i++) {
            const s = playlist.videos[i];
            selectedPlaylistVideos.set(s.videoId, s);
          }
          updateSelectionUI();
        };
      }

      // Clear All
      const clearBtn = document.getElementById('clearPlaylistBtn');
      if (clearBtn) {
        clearBtn.onclick = (e) => {
          e.stopPropagation();
          selectedPlaylistVideos.clear();
          updateSelectionUI();
        };
      }

      // Submit Selected Songs Button
      const addAllBtn = document.getElementById('playlistAddAllBtn');
      if (addAllBtn) {
        addAllBtn.onclick = (e) => {
          e.stopPropagation();
          if (selectedPlaylistVideos.size === 0) {
            showToast('กรุณาเลือกเพลงอย่างน้อย 1 เพลง', 'error');
            return;
          }
          submitPlaylistRequest({
            title: playlist.title,
            videos: Array.from(selectedPlaylistVideos.values())
          });
        };
      }
    }

    // 3. Render Playlist Song Rows with Checkboxes
    searchResultsList.innerHTML = '';
    (playlist.videos || []).forEach((song, idx) => {
      const isSelected = selectedPlaylistVideos.has(song.videoId);
      const row = document.createElement('div');
      row.className = `result-row selectable ${isSelected ? 'selected' : ''}`;
      row.setAttribute('data-video-id', song.videoId);
      row.innerHTML = `
        <div class="result-checkbox">
          <svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>
        </div>
        <img src="${song.thumbnail}" class="result-thumb" alt="Cover" onerror="this.src='/css/default-cover.png'">
        <div class="result-info">
          <div class="result-title">${escapeHtml(song.title)}</div>
          <div class="result-meta">${escapeHtml(song.channelTitle)} · ${song.duration}</div>
        </div>
        <span class="song-rank" style="font-size:0.75rem;color:var(--text-tertiary);">${idx + 1}</span>
      `;

      // Click to toggle selection
      row.onclick = () => {
        if (selectedPlaylistVideos.has(song.videoId)) {
          selectedPlaylistVideos.delete(song.videoId);
        } else {
          if (selectedPlaylistVideos.size >= MAX_PLAYLIST_SELECTION) {
            showToast(`สามารถเลือกได้สูงสุด ${MAX_PLAYLIST_SELECTION} เพลงต่อครั้ง`, 'error');
            return;
          }
          selectedPlaylistVideos.set(song.videoId, song);
        }

        // Quick UI update for this specific row & header
        const count = selectedPlaylistVideos.size;
        const countText = document.getElementById('selectedCountText');
        const addAllBtn = document.getElementById('playlistAddAllBtn');
        if (countText) countText.textContent = count;
        if (addAllBtn) {
          if (count === 0) {
            addAllBtn.disabled = true;
            addAllBtn.innerHTML = '<span>⚠️</span><span>กรุณาเลือกเพลงอย่างน้อย 1 เพลง</span>';
          } else {
            addAllBtn.disabled = false;
            addAllBtn.innerHTML = `<span>➕</span><span>เพิ่มเพลงที่เลือกเข้าคิว (${count} เพลง)</span>`;
          }
        }
        row.classList.toggle('selected', selectedPlaylistVideos.has(song.videoId));
      };

      searchResultsList.appendChild(row);
    });
  }

  let modalReturnFocus = null;
  function openSearchModal() {
    modalReturnFocus = document.activeElement;
    songQueryInput.blur();
    searchModal.inert = false;
    searchModal.classList.add('active');
    searchModal.setAttribute('aria-hidden', 'false');
    document.querySelector('.app-layout').inert = true;
    document.body.classList.add('request-modal-open');
    closeModalBtn.focus();
  }
  function closeSearchModal() {
    document.querySelector('.app-layout').inert = false;
    document.body.classList.remove('request-modal-open');
    searchModal.classList.remove('active');
    searchModal.setAttribute('aria-hidden', 'true');
    searchModal.inert = true;
    modalReturnFocus?.focus({ preventScroll: true });
  }

  if (closeModalBtn) closeModalBtn.onclick = e => { e.stopPropagation(); closeSearchModal(); };
  if (searchModal)   searchModal.onclick   = e => { if (e.target === searchModal) closeSearchModal(); };
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape' && searchModal && searchModal.classList.contains('active')) closeSearchModal();
    if (e.key === 'Tab' && searchModal.classList.contains('active')) {
      const controls = [...searchModal.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')].filter(el => el.offsetParent !== null);
      const first = controls[0], last = controls[controls.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  });

  // ── Mood chip handlers ────────────────────────────────────────────────────
  document.querySelectorAll('.mood-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const mood = btn.getAttribute('data-mood');
      if (mood) { songQueryInput.value = mood; requestForm.dispatchEvent(new Event('submit')); }
    });
  });

})();
