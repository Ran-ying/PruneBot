class MessageBatcher {
  constructor({
    waitMs = 2_500,
    maxWaitMs = 8_000,
    maxMessages = 6,
    processBatch,
    logger = console,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
  } = {}) {
    if (typeof processBatch !== "function") {
      throw new Error("MessageBatcher 缺少 processBatch");
    }
    this.waitMs = Math.max(0, Number(waitMs) || 0);
    this.maxWaitMs = Math.max(this.waitMs, Number(maxWaitMs) || this.waitMs);
    this.maxMessages = Math.max(1, Number(maxMessages) || 1);
    this.processBatch = processBatch;
    this.logger = logger;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.now = now;
    this.states = new Map();
    this.closed = false;
  }

  getState(key) {
    let state = this.states.get(key);
    if (!state) {
      state = {
        pending: [],
        firstQueuedAt: null,
        debounceTimer: null,
        maxWaitTimer: null,
        processing: false,
        flushRequested: false,
      };
      this.states.set(key, state);
    }
    return state;
  }

  enqueue(key, item) {
    if (this.closed) throw new Error("MessageBatcher 已关闭");
    if (!key) throw new Error("MessageBatcher 缺少消息键");

    const state = this.getState(key);
    state.pending.push(item);
    if (state.firstQueuedAt === null) state.firstQueuedAt = this.now();

    if (state.pending.length >= this.maxMessages) {
      this.requestFlush(key, state);
      return;
    }
    this.schedule(key, state);
  }

  clearTimers(state) {
    if (state.debounceTimer) this.clearTimer(state.debounceTimer);
    if (state.maxWaitTimer) this.clearTimer(state.maxWaitTimer);
    state.debounceTimer = null;
    state.maxWaitTimer = null;
  }

  schedule(key, state) {
    if (state.debounceTimer) this.clearTimer(state.debounceTimer);
    state.debounceTimer = this.setTimer(
      () => this.requestFlush(key, state),
      this.waitMs,
    );

    if (!state.maxWaitTimer) {
      const elapsed = Math.max(0, this.now() - state.firstQueuedAt);
      state.maxWaitTimer = this.setTimer(
        () => this.requestFlush(key, state),
        Math.max(0, this.maxWaitMs - elapsed),
      );
    }
  }

  requestFlush(key, state = this.states.get(key)) {
    if (!state || this.closed) return;
    this.clearTimers(state);
    state.flushRequested = true;
    if (!state.processing) void this.drain(key, state);
  }

  async drain(key, state) {
    state.processing = true;
    try {
      while (state.flushRequested && state.pending.length > 0) {
        state.flushRequested = false;
        const batch = state.pending.splice(0, this.maxMessages);
        state.firstQueuedAt = state.pending.length > 0 ? this.now() : null;
        try {
          await this.processBatch(batch, key);
        } catch (error) {
          this.logger.error(`处理消息批次失败：${error.message}`);
        }

        if (state.pending.length >= this.maxMessages) {
          state.flushRequested = true;
        } else if (state.pending.length > 0 && !state.debounceTimer) {
          this.schedule(key, state);
        }
      }
    } finally {
      state.processing = false;
      if (state.pending.length === 0) {
        this.clearTimers(state);
        this.states.delete(key);
      } else if (state.flushRequested) {
        void this.drain(key, state);
      }
    }
  }

  close() {
    this.closed = true;
    const pending = [];
    for (const state of this.states.values()) {
      this.clearTimers(state);
      pending.push(...state.pending);
    }
    this.states.clear();
    return pending;
  }
}

module.exports = { MessageBatcher };
