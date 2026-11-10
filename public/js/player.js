(function() {
  function roomApi(path) { return window.karaokeRoom?.url(path) || path; }
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const startOverlay = document.getElementById('startOverlay');
  const startPlayerBtn = document.getElementById('startPlayerBtn');
  const wakeLockBanner = document.getElementById('wakeLockBanner');

  const playerStateBadge    = document.getElementById('playerStateBadge');
  const playerStateDot      = document.getElementById('playerStateDot');
  const playerStateText     = document.getElementById('playerStateText');
  const playerNowPlayingInfo= document.getElementById('playerNowPlayingInfo');
  const playerPauseResumeBtn= document.getElementById('playerPauseResumeBtn');
  const playerSkipBtn       = document.getElementById('playerSkipBtn');
  const playerMuteBtn       = document.getElementById('playerMuteBtn');
  const playerQueueCount    = document.getElementById('playerQueueCount');
  const playerQueueContainer= document.getElementById('playerQueueContainer');
  const playerControlBox    = document.getElementById('playerControlBox');
  const playerMediaCard     = document.getElementById('playerMediaCard');
  const toastContainer = document.getElementById('toastContainer');
  const stageModeBtn = document.getElementById('stageModeBtn');
  const restartSongBtn = document.getElementById('restartSongBtn');
  const queuePrevBtn = document.getElementById('queuePrevBtn');
  const queueNextBtn = document.getElementById('queueNextBtn');
  const queuePageText = document.getElementById('queuePageText');
  const playerNextSong = document.getElementById('playerNextSong');
  let queuePage = 0;
  let queuedSongs = [];
  let queueMarkup = '';
  const icons = {
    play: '<path d="m9 5 11 7-11 7z"/>', pause: '<path d="M8 5v14M16 5v14"/>',
    volume: '<path d="m11 5-6 4H2v6h3l6 4zM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14"/>',
    muted: '<path d="m11 5-6 4H2v6h3l6 4zM16 9l6 6M22 9l-6 6"/>',
    expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
    shrink: '<path d="M3 8h5V3m13 5h-5V3M8 21v-5H3m13 5v-5h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
    moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>'
  };
  function icon(name) { return `<svg class="player-icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`; }
  function setPlaybackVisual(playing) {
    playerPauseResumeBtn.innerHTML = icon(playing ? 'pause' : 'play') + `<span>${playing ? 'หยุดชั่วคราว' : 'เล่นเพลงต่อ'}</span>`;
    document.body?.setAttribute?.('data-playback', playing ? 'playing' : 'paused');
  }

  function renderQueue() {
    const pageSize = window.innerWidth < 700 ? 1 : window.innerWidth < 1100 ? 2 : window.innerHeight >= 900 ? 5 : 3;
    const pages = Math.max(1, Math.ceil(queuedSongs.length / pageSize));
    queuePage = Math.min(queuePage, pages - 1);
    queuePrevBtn.disabled = queuePage === 0;
    queueNextBtn.disabled = queuePage >= pages - 1;
    queuePageText.textContent = `${queuePage + 1} / ${pages}`;
    playerQueueCount.textContent = `${queuedSongs.length} เพลง`;
    playerNextSong.textContent = queuedSongs.length
      ? `เพลงถัดไป: ${queuedSongs[0].title} · ${queuedSongs[0].requester}`
      : 'เพลงถัดไป: ยังไม่มีเพลงในคิว';
    playerNextSong.title = playerNextSong.textContent;
    if (!queuedSongs.length) {
      const empty = '<p class="empty-state">เลือกเพลงจากมือถือเพื่อเพิ่มเข้าคิว</p>';
      if (queueMarkup !== empty) playerQueueContainer.innerHTML = queueMarkup = empty;
      return;
    }
    const offset = queuePage * pageSize;
    const markup = '<ul class="song-list">' + queuedSongs.slice(offset, offset + pageSize).map((item, index) => `
      <li class="song-row" style="--queue-order:${index}">
        <span class="song-rank">${offset + index + 1}</span>
        <img class="song-thumb queue-cover" src="${escapeHtml(item.thumbnail || '/css/default-cover.png')}" alt="" width="64" height="44" decoding="async" onerror="this.onerror=null;this.src='/css/default-cover.png'">
        <div class="song-info">
          <div class="song-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</div>
          <div class="song-meta">${escapeHtml(item.requester)} · ${escapeHtml(item.duration || '')}</div>
        </div>
      </li>`).join('') + '</ul>';
    if (queueMarkup !== markup) playerQueueContainer.innerHTML = queueMarkup = markup;
  }
  queuePrevBtn.addEventListener('click', () => { queuePage = Math.max(0, queuePage - 1); renderQueue(); });
  queueNextBtn.addEventListener('click', () => {
    queuePage++;
    renderQueue();
  });
  if (window.addEventListener) window.addEventListener('resize', renderQueue);
  async function loadRequestQr() {
    const image = document.getElementById('requestQrImage');
    const status = document.getElementById('requestQrStatus');
    const link = document.getElementById('requestQrLink');
    try {
      const response = await fetch(roomApi('/api/qrcode'));
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error('QR unavailable');
      const url = new URL(data.requestUrl);
      if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid URL');
      link.href = url.href;
      link.textContent = url.host;
      image.src = data.qrDataUrl;
      image.hidden = false;
      status.hidden = true;
    } catch {
      status.textContent = 'โหลด QR Code ไม่สำเร็จ ใช้ลิงก์ด้านล่างได้';
    }
  }

  function setStageMode(enabled) {
    document.body.classList.toggle('karaoke-stage', enabled);
    stageModeBtn.setAttribute('aria-pressed', String(enabled));
    stageModeBtn.innerHTML = icon(enabled ? 'shrink' : 'expand') + `<span>${enabled ? 'ย่อจอร้องเพลง' : 'ขยายจอร้องเพลง'}</span>`;
  }

  stageModeBtn.addEventListener('click', async () => {
    const enabled = stageModeBtn.getAttribute('aria-pressed') !== 'true';
    setStageMode(enabled);
    try {
      if (enabled && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
      else if (!enabled && document.fullscreenElement) await document.exitFullscreen();
    } catch {
      // Expanded layout also works when native fullscreen is unavailable.
    }
  });
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) setStageMode(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') setStageMode(false);
  });
  restartSongBtn.addEventListener('click', () => {
    if (!isPlayerReady || !currentVideoId) return;
    ytPlayer.seekTo(0, true);
    ytPlayer.playVideo();
  });

  let socket = null;
  let ytPlayer = null;
  let isApiReady = false;
  let isStarted = false;
  let wakeLock = null;
  let currentState = null;
  let currentVideoId = null;
  let isPlayerReady = false;
  let appliedVolume = null;

  function applyVolume(force = false) {
    const volume = currentState?.playerState?.volume;
    if (!isPlayerReady || !Number.isInteger(volume) || volume < 0 || volume > 100) return;
    if (force || volume !== appliedVolume) {
      ytPlayer.setVolume(volume);
      if (volume !== appliedVolume) {
        ytPlayer.unMute();
        playerMuteBtn.innerHTML = icon('volume') + '<span>ปิดเสียง</span>';
      }
      appliedVolume = volume;
    }
  }

  // Dark Mode Theme
  function initTheme() {
    const savedTheme = localStorage.getItem('vrs_theme') || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    themeToggleBtn.innerHTML = icon(savedTheme === 'dark' ? 'sun' : 'moon');
  }

  themeToggleBtn.addEventListener('click', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('vrs_theme', newTheme);
    themeToggleBtn.innerHTML = icon(newTheme === 'dark' ? 'sun' : 'moon');
  });

  initTheme();
  loadRequestQr();

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

  // --- Screen Wake Lock API ---
  async function requestWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Screen Wake Lock active');
        wakeLockBanner.style.display = 'none';
        
        wakeLock.addEventListener('release', () => {
          console.log('[WakeLock] Screen Wake Lock released');
        });
      } catch (err) {
        console.warn('[WakeLock] Could not acquire Screen Wake Lock:', err.message);
        wakeLockBanner.style.display = 'flex';
      }
    } else {
      console.warn('[WakeLock] Screen Wake Lock API not supported on this browser');
      wakeLockBanner.style.display = 'flex';
    }
  }

  document.addEventListener('visibilitychange', async () => {
    document.body?.setAttribute?.('data-page-hidden', String(document.hidden));
    if (wakeLock !== null && document.visibilityState === 'visible') {
      await requestWakeLock();
    }
  });

  // --- YouTube IFrame Player API Global Callback ---
  window.onYouTubeIframeAPIReady = function() {
    console.log('[YouTube IFrame API] Ready');
    isApiReady = true;

    ytPlayer = new YT.Player('youtube-player', {
      height: '100%',
      width: '100%',
      playerVars: {
        autoplay: 1,
        controls: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange,
        onError: onPlayerError
      }
    });
  };

  function onPlayerReady(event) {
    console.log('[YouTube Player] Player Instance Ready');
    isPlayerReady = true;
    if (ytPlayer) {
      if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
    }
    if (currentState) {
      renderPlayerState(currentState);
    }
  }

  function onPlayerStateChange(event) {
    if (!socket) return;
    if (event.data === YT.PlayerState.ENDED) {
      playerStateText.textContent = 'กำลังเปลี่ยนเพลง...';
      playerStateDot.className = 'dot-offline';
      socket.emit('songEnded');
    } else if (event.data === YT.PlayerState.PLAYING) {
      playerStateText.textContent = 'กำลังเล่นเพลง';
      playerStateDot.className = 'dot-live';
      setPlaybackVisual(true);
      socket.emit('playerPlaybackState', 'playing');
    } else if (event.data === YT.PlayerState.PAUSED) {
      playerStateText.textContent = 'หยุดชั่วคราว';
      playerStateDot.className = 'dot-offline';
      setPlaybackVisual(false);
      socket.emit('playerPlaybackState', 'paused');
    }
  }

  function onPlayerError(event) {
    console.warn('[YouTube Player] Error code:', event.data);
    if (socket) {
      if (currentState && currentState.currentSong && !currentState.currentSong.isAutoDj) {
        showToast(`เพลง "${currentState.currentSong.title}" ไม่อนุญาตให้เปิดภายนอก YouTube กำลังข้าม...`, 'error');
      }
      socket.emit('songError', { errorCode: event.data, videoId: currentVideoId });
    }
  }

  // --- Initialize Socket & Start Playback ---
  function startPlayer() {
    if (isStarted) return;
    isStarted = true;
    startOverlay.style.display = 'none';
    if (playerMediaCard) playerMediaCard.style.display = 'block';
    if (playerControlBox) playerControlBox.style.display = 'block';

    // Request Screen Wake Lock
    requestWakeLock();

    // Connect Socket.IO
    socket = io({ auth: { roomId: window.karaokeRoom?.id || 'main', playerPin: window.karaokeRoom?.playerPin() } });

    if (ytPlayer) {
      if (typeof ytPlayer.unMute === 'function') ytPlayer.unMute();
    }

    socket.on('connect', () => {
      console.log('[Socket.IO] Connected as Player');
      socket.emit('playerConnect');
    });

    socket.on('queueUpdate', (state) => {
      renderPlayerState(state);
    });

    socket.on('playerCommand', (cmdObj) => {
      handlePlayerCommand(cmdObj.command);
    });
    socket.on('playerAccessDenied', data => {
      socket.disconnect();
      isStarted = false;
      currentVideoId = null;
      if (isPlayerReady) ytPlayer.stopVideo();
      startOverlay.style.display = 'flex';
      playerMediaCard.style.display = 'none';
      playerControlBox.style.display = 'none';
      showToast(data.message, 'error');
    });

    socket.on('toastMessage', (data) => {
      showToast(data.message, data.type || 'info');
    });

    socket.on('newReaction', (data) => {
      spawnFloatingEmoji(data.emoji);
    });
  }

  function spawnFloatingEmoji(emoji) {
    const el = document.createElement('div');
    el.className = 'floating-emoji';
    el.textContent = emoji;
    const randomLeft = 20 + Math.random() * 60;
    el.style.left = randomLeft + 'vw';
    el.style.bottom = '140px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2000);
  }

  startPlayerBtn.addEventListener('click', async () => {
    if (window.karaokeRoom && !await window.karaokeRoom.authorizePlayer()) return;
    startPlayer();
  });

  // --- Render Player State ---
  function renderPlayerState(state) {
    currentState = state;
    applyVolume();
    const { currentSong, queue } = state;
    setPlaybackVisual(Boolean(currentSong) && state.playerState?.playbackState !== 'paused');

    // Update Player & YouTube Video ID
    if (currentSong) {
      if (currentVideoId !== currentSong.videoId && ytPlayer && typeof ytPlayer.loadVideoById === 'function') {
        currentVideoId = currentSong.videoId;
        ytPlayer.loadVideoById({ videoId: currentSong.videoId, startSeconds: 0 });
        applyVolume(true);
      }
      const nowMarkup = `
        <div class="song-row" style="padding:0;border:none;">
          <span class="playback-meter" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
          <div class="song-info">
            <div class="song-title">${escapeHtml(currentSong.title)}</div>
            <div class="song-meta">ผู้ร้อง: ${escapeHtml(currentSong.requester)} · ${currentSong.duration}</div>
          </div>
        </div>`;
      if (playerNowPlayingInfo && playerNowPlayingInfo.innerHTML !== nowMarkup) playerNowPlayingInfo.innerHTML = nowMarkup;
      if (playerStateText) playerStateText.textContent = 'กำลังเล่นเพลง';
      if (playerStateDot)  playerStateDot.className = 'dot-live';
    } else {
      currentVideoId = null;
      if (ytPlayer && typeof ytPlayer.stopVideo === 'function') ytPlayer.stopVideo();
      if (playerNowPlayingInfo) playerNowPlayingInfo.innerHTML = `<p class="empty-state">รอเพลงจากทุกคน</p>`;
      if (playerStateText) playerStateText.textContent = 'รอเพลงจากทุกคน';
    }

    if (queuedSongs[0]?.id !== queue[0]?.id || queuedSongs[0]?.videoId !== queue[0]?.videoId) queuePage = 0;
    queuedSongs = queue;
    renderQueue();
  }

  function handlePlayerCommand(command) {
    if (!ytPlayer) return;

    if (command === 'pause' && typeof ytPlayer.pauseVideo === 'function') {
      ytPlayer.pauseVideo();
    } else if (command === 'resume' && typeof ytPlayer.playVideo === 'function') {
      ytPlayer.playVideo();
    } else if (command === 'skip') {
      console.log('[Player] Skip command received');
      if (socket) socket.emit('songEnded');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- Button Event Listeners ---
  playerPauseResumeBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    const state = ytPlayer.getPlayerState();
    if (state === YT.PlayerState.PLAYING) {
      ytPlayer.pauseVideo();
    } else {
      ytPlayer.playVideo();
    }
  });

  playerSkipBtn.addEventListener('click', () => {
    if (socket) socket.emit('songEnded');
  });

  playerMuteBtn.addEventListener('click', () => {
    if (!ytPlayer) return;
    if (ytPlayer.isMuted()) {
      ytPlayer.unMute();
      playerMuteBtn.innerHTML = icon('volume') + '<span>ปิดเสียง</span>';
    } else {
      ytPlayer.mute();
      playerMuteBtn.innerHTML = icon('muted') + '<span>เปิดเสียง</span>';
    }
  });

})();
