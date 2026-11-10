(function() {
  // Pointer capture supports the same handle on touch screens, pens and mice.
  class KaraokeQueueDrag {
    constructor({ container, enabled, getOrder, onDrop }) {
      this.container = container;
      this.enabled = enabled;
      this.getOrder = getOrder;
      this.onDrop = onDrop;
      this.session = null;
      container.addEventListener('pointerdown', event => this.down(event));
      container.addEventListener('pointermove', event => this.move(event));
      container.addEventListener('pointerup', event => this.up(event));
      container.addEventListener('pointercancel', () => this.cancel());
      container.addEventListener('lostpointercapture', () => this.cancel());
      container.addEventListener('keydown', event => this.key(event));
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.cancel(); });
    }
    get active() { return Boolean(this.session); }
    get orderSignature() { return this.session?.order.join('\0'); }
    rows() { return [...this.container.querySelectorAll('.song-list > .song-row[data-song-id]')]; }
    down(event) {
      const handle = event.target.closest('.user-drag-handle');
      if (!handle || handle.disabled || !this.enabled() || event.button !== 0 || this.session) return;
      const row = handle.closest('[data-song-id]');
      if (!row) return;
      event.preventDefault();
      handle.focus({ preventScroll: true });
      const rect = row.getBoundingClientRect();
      this.session = { handle, row, id: row.dataset.songId, order: [...this.getOrder()], pointerId: event.pointerId, startY: event.clientY, y: event.clientY, offset: event.clientY - rect.top, rect, list: row.parentElement, dragging: false };
      this.container.setPointerCapture(event.pointerId);
    }
    move(event) {
      const state = this.session;
      if (!state || event.pointerId !== state.pointerId) return;
      state.y = event.clientY;
      if (!state.dragging && Math.abs(state.y - state.startY) < 6) return;
      event.preventDefault();
      if (!state.dragging) this.start();
      this.place();
    }
    start() {
      const state = this.session;
      state.dragging = true;
      state.ghost = state.row.cloneNode(true);
      state.ghost.classList.add('queue-drag-ghost');
      state.ghost.setAttribute('aria-hidden', 'true');
      state.ghost.inert = true;
      Object.assign(state.ghost.style, { width: state.rect.width + 'px', height: state.rect.height + 'px', left: state.rect.left + 'px', top: '0px' });
      document.body.append(state.ghost);
      state.row.classList.add('queue-drag-source');
      document.body.classList.add('queue-dragging');
      state.handle.setAttribute('aria-pressed', 'true');
      this.frame = requestAnimationFrame(() => this.scrollFrame());
    }
    place() {
      const state = this.session;
      if (!state?.dragging) return;
      state.ghost.style.transform = `translateY(${state.y - state.offset}px) scale(1.015)`;
      const otherRows = this.rows().filter(row => row !== state.row);
      const before = otherRows.find(row => {
        const rect = row.getBoundingClientRect();
        return state.y < rect.top + rect.height / 2;
      });
      const anchor = before || null;
      if (anchor !== state.row.nextElementSibling) state.list.insertBefore(state.row, anchor);
      this.rows().forEach((row, index) => { row.querySelector('.song-rank').textContent = index + 1; });
    }
    scrollFrame() {
      const state = this.session;
      if (!state?.dragging) return;
      const pane = this.container.closest('.tab-panel');
      const paneScrolls = pane && pane.scrollHeight > pane.clientHeight && /auto|scroll/.test(getComputedStyle(pane).overflowY);
      const scroll = paneScrolls ? pane : document.scrollingElement;
      const bounds = paneScrolls ? pane.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      let bottom = Math.min(innerHeight, bounds.bottom);
      const dock = document.querySelector('.request-page .col-left');
      if (dock && getComputedStyle(dock).position === 'fixed') bottom = Math.min(bottom, dock.getBoundingClientRect().top - 8);
      const top = Math.max(0, bounds.top);
      let delta = 0;
      if (state.y < top + 48) delta = -Math.min(14, Math.max(1, (top + 48 - state.y) / 4));
      else if (state.y > bottom - 48) delta = Math.min(14, Math.max(1, (state.y - bottom + 48) / 4));
      if (delta) {
        if (paneScrolls) scroll.scrollTop += delta;
        else window.scrollBy(0, delta);
        this.place();
      }
      this.frame = requestAnimationFrame(() => this.scrollFrame());
    }
    up(event) {
      const state = this.session;
      if (!state || event.pointerId !== state.pointerId) return;
      const toIndex = this.rows().indexOf(state.row);
      const changed = state.dragging && toIndex !== state.order.indexOf(state.id);
      this.finish();
      if (changed) this.onDrop(state.id, toIndex, state.order, false);
    }
    finish() {
      const state = this.session;
      if (!state) return;
      this.session = null;
      cancelAnimationFrame(this.frame);
      state.ghost?.remove();
      state.row.classList.remove('queue-drag-source');
      state.handle.setAttribute('aria-pressed', 'false');
      document.body.classList.remove('queue-dragging');
      if (this.container.hasPointerCapture(state.pointerId)) this.container.releasePointerCapture(state.pointerId);
    }
    cancel() {
      const state = this.session;
      if (!state) return;
      const rows = new Map(this.rows().map(row => [row.dataset.songId, row]));
      state.order.forEach((id, index) => {
        const row = rows.get(id);
        if (row) { state.list.append(row); row.querySelector('.song-rank').textContent = index + 1; }
      });
      this.finish();
    }
    key(event) {
      if (event.key === 'Escape' && this.session) { event.preventDefault(); this.cancel(); return; }
      const handle = event.target.closest('.user-drag-handle');
      if (!handle || handle.disabled || !this.enabled() || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const order = [...this.getOrder()];
      const id = handle.dataset.id;
      const from = order.indexOf(id), to = from + (event.key === 'ArrowUp' ? -1 : 1);
      if (from >= 0 && to >= 0 && to < order.length) this.onDrop(id, to, order, true);
    }
  }
  window.KaraokeQueueDrag = KaraokeQueueDrag;
})();
