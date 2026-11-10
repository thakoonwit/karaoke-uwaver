(function() {
  const tab = document.querySelector('.tab-btn[data-tab="top"]');
  const list = document.getElementById('hitCatalogList');
  if (!tab || !list) return;
  const search = document.getElementById('hitCatalogSearch');
  const filters = document.getElementById('hitCatalogCategories');
  const count = document.getElementById('hitCatalogCount');
  const status = document.getElementById('hitCatalogStatus');
  const retry = document.getElementById('hitCatalogRetry');
  const sentinel = document.getElementById('hitCatalogSentinel');
  const panel = document.getElementById('tabTop');
  let data = null, pending = false, busy = false, category = 'all';
  let songs = [], visible = 0, observer = null, scheduled = false;
  const normalize = text => text.normalize('NFKC').toLocaleLowerCase('th').replace(/\s+/g, ' ').trim();

  function render() {
    if (!data) return;
    const terms = normalize(search.value).split(' ').filter(Boolean);
    songs = data.songs.filter(song => (category === 'all' || song.categories.includes(category)) && terms.every(term => normalize(song.title + ' ' + song.artist).includes(term)));
    count.textContent = songs.length + ' เพลง';
    status.textContent = songs.length ? '' : 'ไม่พบเพลงที่ตรงกัน ลองเปลี่ยนคำค้นหรือหมวดเพลง';
    status.hidden = songs.length > 0;
    list.replaceChildren();
    visible = 0;
    appendBatch();
    observeEnd();
    filters.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category)));
  }

  function appendBatch() {
    const batch = songs.slice(visible, visible + 20);
    const fragment = document.createDocumentFragment();
    batch.forEach((song, index) => {
      const row = document.createElement('li'); row.className = 'hit-catalog-song';
      const number = document.createElement('span'); number.className = 'hit-catalog-number'; number.textContent = visible + index + 1;
      const info = document.createElement('div'); info.className = 'hit-catalog-song-info';
      const title = document.createElement('span'); title.className = 'hit-catalog-song-title'; title.textContent = song.title;
      const artist = document.createElement('span'); artist.className = 'hit-catalog-artist'; artist.textContent = song.artist;
      info.append(title, artist);
      const button = document.createElement('button'); button.type = 'button'; button.className = 'hit-catalog-pick'; button.title = 'ค้นหาเวอร์ชันที่จะร้อง'; button.setAttribute('aria-label', 'ค้นหา ' + song.title + ' ' + song.artist); button.disabled = busy;
      button.innerHTML = '<svg class="svg-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16 16 4 4"/></svg>';
      button.addEventListener('click', () => { if (!busy) document.dispatchEvent(new CustomEvent('uwaverCatalogSearch', { detail: { title: song.title, artist: song.artist } })); });
      row.append(number, info, button); fragment.append(row);
    });
    list.append(fragment);
    visible += batch.length;
    sentinel.hidden = songs.length === 0;
    sentinel.textContent = visible < songs.length
      ? `แสดง ${visible} จาก ${songs.length} เพลง · เลื่อนเพื่อดูเพิ่มเติม`
      : `แสดงครบ ${songs.length} เพลงแล้ว`;
    if (visible >= songs.length) observer?.disconnect();
  }

  function nearEnd() {
    const rect = sentinel.getBoundingClientRect();
    const scrolls = /auto|scroll/.test(getComputedStyle(panel).overflowY);
    const bounds = scrolls ? panel.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    return rect.top <= Math.min(innerHeight, bounds.bottom) + 300 && rect.bottom >= Math.max(0, bounds.top);
  }
  function scheduleMore() {
    if (scheduled || !data || visible >= songs.length) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      if (document.hidden || !panel.classList.contains('active') || !nearEnd()) return;
      appendBatch();
      // Tall viewports may fit more than one batch without another intersection.
      scheduleMore();
    });
  }
  function observeEnd() {
    observer?.disconnect();
    if (!data || visible >= songs.length) return;
    if ('IntersectionObserver' in window) {
      const root = /auto|scroll/.test(getComputedStyle(panel).overflowY) ? panel : null;
      observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) scheduleMore();
      }, { root, rootMargin: '0px 0px 300px 0px' });
      observer.observe(sentinel);
    }
    scheduleMore();
  }

  async function load() {
    if (data) { observeEnd(); return; }
    if (pending) return;
    pending = true; retry.hidden = true; status.hidden = false; status.textContent = 'กำลังโหลดลิสต์เพลง…';
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch('/data/hits.json', { signal: controller.signal });
      if (!response.ok) throw Error();
      const result = await response.json();
      if (!Array.isArray(result.songs) || !Array.isArray(result.categories)) throw Error();
      data = result;
      filters.replaceChildren();
      for (const filter of [{ id: 'all', label: 'ทั้งหมด' }, ...data.categories]) {
        const button = document.createElement('button'); button.type = 'button'; button.dataset.category = filter.id; button.textContent = filter.label;
        button.addEventListener('click', () => { category = filter.id; render(); });
        filters.append(button);
      }
      render();
    } catch { status.hidden = false; status.textContent = 'โหลดลิสต์ไม่สำเร็จ ลองอีกครั้งได้เลย'; retry.hidden = false; }
    finally { pending = false; clearTimeout(timeout); }
  }
  tab.addEventListener('click', load);
  retry.addEventListener('click', load);
  search.addEventListener('input', render);
  panel.addEventListener('scroll', scheduleMore, { passive: true });
  window.addEventListener('scroll', scheduleMore, { passive: true });
  window.addEventListener('resize', observeEnd);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) scheduleMore(); });
  document.addEventListener('uwaverSearchBusy', event => {
    busy = event.detail === true;
    list.querySelectorAll('button').forEach(button => { button.disabled = busy; });
    list.setAttribute('aria-busy', String(busy));
  });
})();
