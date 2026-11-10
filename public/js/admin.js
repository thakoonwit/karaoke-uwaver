(function() {
  function roomApi(path) { return window.karaokeRoom?.url(path) || path; }
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const authBox = document.getElementById('authBox');
  const adminPanel = document.getElementById('adminPanel');
  const pinForm = document.getElementById('pinForm');
  const pinInput = document.getElementById('pinInput');

  const toggleAcceptingSwitch = document.getElementById('toggleAcceptingSwitch');
  const toggleUserReorderSwitch = document.getElementById('toggleUserReorderSwitch');
  const userReorderStatusText = document.getElementById('userReorderStatusText');
  const acceptingStatusText = document.getElementById('acceptingStatusText');
  const toggleAutoDjSwitch    = document.getElementById('toggleAutoDjSwitch');
  const autoDjStatusText       = document.getElementById('autoDjStatusText');
  const toggleTodayHistorySwitch = document.getElementById('toggleTodayHistorySwitch');
  const todayHistoryStatusText   = document.getElementById('todayHistoryStatusText');
  const maxQueuePerDeviceInput = document.getElementById('maxQueuePerDeviceInput');
  const maxTrackMinutesInput   = document.getElementById('maxTrackMinutesInput');
  const cooldownMinutesInput   = document.getElementById('cooldownMinutesInput');
  const saveLimitsBtn          = document.getElementById('saveLimitsBtn');
  const adminPlayerBadge      = document.getElementById('adminPlayerBadge');
  const adminPlayerDot        = document.getElementById('adminPlayerDot');
  const adminPlayerStatusText = document.getElementById('adminPlayerStatusText');
  const adminNowPlayingInfo = document.getElementById('adminNowPlayingInfo');
  const pauseResumeBtn = document.getElementById('pauseResumeBtn');
  const skipBtn = document.getElementById('skipBtn');
  const playerVolumeInput = document.getElementById('playerVolumeInput');
  const playerVolumeValue = document.getElementById('playerVolumeValue');
  const playerVolumeHint = document.getElementById('playerVolumeHint');
  let isAdjustingVolume = false;
  const clearQueueBtn = document.getElementById('clearQueueBtn');
  const adminQueueCount = document.getElementById('adminQueueCount');
  const adminQueueContainer = document.getElementById('adminQueueContainer');
  const qrCodeImg = document.getElementById('qrCodeImg');
  const localUrlText = document.getElementById('localUrlText');
  const toastContainer = document.getElementById('toastContainer');

  let currentAdminPin = sessionStorage.getItem('vrs_admin_pin_' + (window.karaokeRoom?.id || 'main')) || window.karaokeRoom?.playerPin() || '';
  let currentState = null;
  let queueMovePending = false;
  let adminProgressTimer = null;

  // Dark Mode Theme
  function initTheme() {
    const savedTheme = localStorage.getItem('vrs_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggleBtn.textContent = savedTheme === 'dark' ? '☀️' : '🌙';
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('vrs_theme', newTheme);
    themeToggleBtn.textContent = newTheme === 'dark' ? '☀️' : '🌙';
  });

  initTheme();

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    let icon = type === 'success' ? '✅' : (type === 'error' ? '⚠️' : 'ℹ️');
    toast.innerHTML = `<span>${icon}</span>`;
    const messageNode = document.createElement('span');
    messageNode.textContent = String(message);
    toast.appendChild(messageNode);
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function formatTime(sec) {
    if (isNaN(sec) || sec < 0) return '0:00';
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  }

  // --- Auth Verification ---
  async function verifyPin(pin) {
    try {
      const res = await fetch(roomApi('/api/admin/verify-pin'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const data = await res.json();
      if (data.success) {
        currentAdminPin = pin;
        sessionStorage.setItem('vrs_admin_pin_' + (window.karaokeRoom?.id || 'main'), pin);
        authBox.style.display = 'none';
        adminPanel.style.display = 'block';
        // Show queue panel on right side (desktop)
        const queueWrapper = document.getElementById('adminQueueWrapper');
        const queuePlaceholder = document.getElementById('adminQueuePlaceholder');
        if (queueWrapper) queueWrapper.style.display = 'block';
        if (queuePlaceholder) queuePlaceholder.style.display = 'none';
        loadQrCode();
        initSocket();
        showToast('เข้าสู่ระบบผู้ดูแลระบบสำเร็จ', 'success');
      } else {
        showToast(data.message || 'รหัส PIN ไม่ถูกต้อง', 'error');
      }
    } catch (err) {
      showToast('ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้', 'error');
    }
  }

  pinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    verifyPin(pinInput.value.trim());
  });

  if (currentAdminPin) {
    verifyPin(currentAdminPin);
  }

  // --- Load QR Code ---
  async function loadQrCode() {
    try {
      const res = await fetch(roomApi('/api/qrcode'));
      const data = await res.json();
      if (data.success) {
        qrCodeImg.src = data.qrDataUrl;
        localUrlText.textContent = data.requestUrl || data.localUrl;
      }
    } catch (err) {
      console.error('Failed to load QR code:', err);
    }
  }

  // --- Admin API Action Helper ---
  async function sendAdminAction(action, extraData = {}) {
    if (!currentAdminPin) return;

    try {
      const res = await fetch(roomApi('/api/admin/action'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-pin': currentAdminPin
        },
        body: JSON.stringify({ action, ...extraData })
      });
      const data = await res.json();
      if (data.success) {
        showToast(data.message, 'success');
        return true;
      } else {
        showToast(data.message || 'การดำเนินการล้มเหลว', 'error');
      }
    } catch (err) {
      showToast('เกิดข้อผิดพลาดในการสั่งการ', 'error');
    }
    return false;
  }

  // --- Render State ---
  function renderAdminState(state) {
    currentState = state;
    if (toggleUserReorderSwitch) {
      toggleUserReorderSwitch.checked = state.isUserReorderEnabled === true;
      userReorderStatusText.textContent = state.isUserReorderEnabled === true
        ? 'เปิดอยู่ · ทุกคนเลื่อนเพลงใดก็ได้ในคิวรอร้อง'
        : 'ปิดอยู่ · เฉพาะแอดมินจัดคิวได้';
    }
    const { currentSong, queue, playerState, isAcceptingRequests } = state;
    if (!isAdjustingVolume && Number.isInteger(playerState?.volume)) {
      playerVolumeInput.value = playerState.volume;
      playerVolumeValue.textContent = `${playerState.volume}%`;
    }
    playerVolumeHint.textContent = playerState?.isOnline
      ? 'ปรับเสียงเพลงที่เครื่อง Player · 0% คือเงียบ'
      : 'Player ออฟไลน์ · ระดับเสียงที่บันทึกจะใช้เมื่อเชื่อมต่อ';

    // Toggle Switches
    toggleAcceptingSwitch.checked = isAcceptingRequests;
    acceptingStatusText.textContent = isAcceptingRequests ? 'เปิดรับคำขอเพลงจากทุกคน' : 'ปิดรับคำขอเพลงชั่วคราว';

    if (toggleAutoDjSwitch) {
      toggleAutoDjSwitch.checked = state.isAutoDjEnabled !== false;
      autoDjStatusText.textContent = state.isAutoDjEnabled !== false ? 'เปิดเพลงคลอเบาๆ เมื่อคิวเพลงว่าง' : 'ปิดระบบ Auto-DJ ชั่วคราวแล้ว';
    }

    if (toggleTodayHistorySwitch) {
      toggleTodayHistorySwitch.checked = state.isTodayHistoryReplayEnabled !== false;
      todayHistoryStatusText.textContent = state.isTodayHistoryReplayEnabled !== false ? 'เมื่อคิวหมด จะสุ่มเพลงที่เคยขอในวันนี้มาเล่นต่อ' : 'ปิดระบบสุ่มเพลงจากประวัติวันนี้แล้ว';
    }

    // Dynamic Limits Settings
    if (state.settings) {
      if (maxQueuePerDeviceInput && document.activeElement !== maxQueuePerDeviceInput) {
        maxQueuePerDeviceInput.value = state.settings.maxQueuePerDevice;
      }
      if (maxTrackMinutesInput && document.activeElement !== maxTrackMinutesInput) {
        maxTrackMinutesInput.value = state.settings.maxTrackMinutes;
      }
      if (cooldownMinutesInput && document.activeElement !== cooldownMinutesInput) {
        cooldownMinutesInput.value = state.settings.cooldownMinutes;
      }
    }

    // Player Status Badge
    if (playerState && playerState.isOnline) {
      adminPlayerBadge.className = 'badge online';
      if (adminPlayerDot) adminPlayerDot.className = 'dot-live';
      adminPlayerStatusText.textContent = 'Player ออนไลน์';
    } else {
      adminPlayerBadge.className = 'badge offline';
      if (adminPlayerDot) adminPlayerDot.className = 'dot-offline';
      adminPlayerStatusText.textContent = 'Player ออฟไลน์';
    }

    // Update Pause/Resume button state
    if (playerState && playerState.playbackState === 'paused') {
      pauseResumeBtn.innerHTML = '▶️ เล่นเพลงต่อ';
    } else {
      pauseResumeBtn.innerHTML = '⏸️ หยุดชั่วคราว';
    }

    if (adminProgressTimer) clearInterval(adminProgressTimer);

    // Now Playing Info
    if (currentSong) {
      adminNowPlayingInfo.innerHTML = `
        <div class="song-row" style="padding:0;border:none;margin-bottom:10px;">
          <img src="${currentSong.thumbnail}" class="song-thumb" onerror="this.src='/css/default-cover.png'">
          <div class="song-info">
            <div class="song-title">${escapeHtml(currentSong.title)}</div>
            <div class="song-meta">${escapeHtml(currentSong.requester)} · ${currentSong.duration}</div>
          </div>
        </div>
        <div class="progress-row" style="margin-bottom:4px;">
          <span class="progress-time" id="adminCurrentTimeText">0:00</span>
          <div class="progress-track"><div class="progress-fill" id="adminProgressBarFill"></div></div>
          <span class="progress-time">${currentSong.duration}</span>
        </div>
      `;

      const adminProgressBarFill = document.getElementById('adminProgressBarFill');
      const adminCurrentTimeText = document.getElementById('adminCurrentTimeText');
      const updateAdminProgress = () => {
        if (!currentSong.startedAt || !currentSong.durationSec) return;
        const elapsed = Math.min(currentSong.durationSec, Math.max(0, (Date.now() - currentSong.startedAt) / 1000));
        const pct = Math.min(100, (elapsed / currentSong.durationSec) * 100);
        if (adminProgressBarFill) adminProgressBarFill.style.width = pct + '%';
        if (adminCurrentTimeText) adminCurrentTimeText.textContent = formatTime(elapsed);
      };
      updateAdminProgress();
      adminProgressTimer = setInterval(updateAdminProgress, 1000);
    } else {
      adminNowPlayingInfo.innerHTML = `<p class="empty-state">รอเพลงจากทุกคน</p>`;
    }

    const queueScrollTop = adminQueueContainer.scrollTop;
    adminQueueCount.textContent = `${queue.length} เพลง`;
    if (!queue.length) {
      adminQueueContainer.innerHTML = `<p class="empty-state">รอเพลงจากทุกคน 🎧</p>`;
    } else {
      adminQueueContainer.innerHTML = '<ul class="song-list">' + queue.map((item, i) => `
        <li class="song-row">
          <span class="song-rank">${i + 1}</span>
          <img src="${item.thumbnail}" class="song-thumb" onerror="this.src='/css/default-cover.png'">
          <div class="song-info">
            <div class="song-title">${escapeHtml(item.title)}</div>
            <div class="song-meta">${escapeHtml(item.requester)} · ${item.duration}</div>
          </div>
          <div class="song-actions">
            <button class="btn-icon move-btn" data-id="${item.id}" data-direction="up" title="เลื่อนขึ้นหนึ่งลำดับ" aria-label="เลื่อนขึ้นหนึ่งลำดับ" ${queueMovePending || i === 0 ? 'disabled' : ''}><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6"></path></svg></button>
            <button class="btn-icon move-btn" data-id="${item.id}" data-direction="down" title="เลื่อนลงหนึ่งลำดับ" aria-label="เลื่อนลงหนึ่งลำดับ" ${queueMovePending || i === queue.length - 1 ? 'disabled' : ''}><svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m-6-6 6 6 6-6"></path></svg></button>
            <button class="btn-icon danger remove-btn" data-id="${item.id}" title="ลบออกจากคิว">✕</button>
          </div>
        </li>`).join('') + '</ul>';

      adminQueueContainer.querySelectorAll('.remove-btn').forEach(btn => {
        btn.onclick = () => sendAdminAction('remove', { songId: btn.getAttribute('data-id') });
      });
      adminQueueContainer.querySelectorAll('.move-btn').forEach(btn => {
        btn.onclick = async () => {
          if (queueMovePending) return;
          const songId = btn.dataset.id;
          const direction = btn.dataset.direction;
          queueMovePending = true;
          adminQueueContainer.querySelectorAll('.move-btn').forEach(button => { button.disabled = true; });
          try {
            await sendAdminAction('move', { songId, direction });
          } finally {
            queueMovePending = false;
            if (currentState) renderAdminState(currentState);
            const next = [...adminQueueContainer.querySelectorAll('.move-btn')]
              .find(button => button.dataset.id === songId && button.dataset.direction === direction && !button.disabled);
            (next || adminQueueContainer).focus({ preventScroll: true });
          }
        };
      });
    }
    adminQueueContainer.scrollTop = queueScrollTop;
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function initSocket() {
    const socket = io({ auth: { roomId: window.karaokeRoom?.id || 'main', playerPin: window.karaokeRoom?.playerPin() } });
    socket.on('queueUpdate', (state) => {
      renderAdminState(state);
    });
    socket.on('toastMessage', (data) => {
      showToast(data.message, data.type || 'info');
    });
  }

  // --- Controls Event Handlers ---
  playerVolumeInput.addEventListener('input', () => {
    isAdjustingVolume = true;
    playerVolumeValue.textContent = `${playerVolumeInput.value}%`;
  });
  playerVolumeInput.addEventListener('change', async () => {
    playerVolumeInput.disabled = true;
    const success = await sendAdminAction('setVolume', { volume: Number(playerVolumeInput.value) });
    isAdjustingVolume = false;
    playerVolumeInput.disabled = false;
    if (success) {
      // Refresh after the write so concurrent admin changes are reflected as well.
      try {
        const response = await fetch(roomApi('/api/status'));
        if (response.ok) renderAdminState(await response.json());
      } catch (err) { /* The next socket update will resync the control. */ }
    } else if (currentState) {
      renderAdminState(currentState);
    }
  });
  toggleAcceptingSwitch.addEventListener('change', (e) => {
    sendAdminAction('toggleAccepting', { acceptingStatus: e.target.checked });
  });

  if (toggleAutoDjSwitch) {
    toggleAutoDjSwitch.addEventListener('change', (e) => {
      sendAdminAction('toggleAutoDj', { autoDjStatus: e.target.checked });
    });
  }
  if (toggleUserReorderSwitch) {
    toggleUserReorderSwitch.addEventListener('change', async event => {
      const control = event.target;
      control.disabled = true;
      const success = await sendAdminAction('setUserReorder', { enabled: control.checked });
      if (!success) control.checked = currentState?.isUserReorderEnabled === true;
      control.disabled = false;
    });
  }

  if (toggleTodayHistorySwitch) {
    toggleTodayHistorySwitch.addEventListener('change', (e) => {
      sendAdminAction('toggleTodayHistoryReplay', { todayHistoryReplayStatus: e.target.checked });
    });
  }

  if (saveLimitsBtn) {
    saveLimitsBtn.addEventListener('click', () => {
      const maxQueue = parseInt(maxQueuePerDeviceInput.value, 10);
      const maxTrack = parseInt(maxTrackMinutesInput.value, 10);
      const cooldown = parseInt(cooldownMinutesInput.value, 10);

      if (isNaN(maxQueue) || maxQueue < 1 || maxQueue > 50) {
        showToast('กรุณาระบุจำนวนเพลงรอสูงสุด 1 - 50 เพลง', 'error');
        return;
      }
      if (isNaN(maxTrack) || maxTrack < 1 || maxTrack > 180) {
        showToast('กรุณาระบุความยาวเพลงสูงสุด 1 - 180 นาที', 'error');
        return;
      }
      if (isNaN(cooldown) || cooldown < 0 || cooldown > 60) {
        showToast('กรุณาระบุระยะเวลารอ (Cooldown) 0 - 60 นาที', 'error');
        return;
      }

      sendAdminAction('updateSettings', {
        maxQueuePerDevice: maxQueue,
        maxTrackMinutes: maxTrack,
        cooldownMinutes: cooldown
      });
    });
  }

  pauseResumeBtn.addEventListener('click', () => {
    if (currentState && currentState.playerState && currentState.playerState.playbackState === 'paused') {
      sendAdminAction('resume');
    } else {
      sendAdminAction('pause');
    }
  });

  skipBtn.addEventListener('click', () => {
    sendAdminAction('skip');
  });

  clearQueueBtn.addEventListener('click', () => {
    if (confirm('คุณแน่ใจหรือไม่ว่าต้องการล้างคิวเพลงทั้งหมด?')) {
      sendAdminAction('clear');
    }
  });

})();
