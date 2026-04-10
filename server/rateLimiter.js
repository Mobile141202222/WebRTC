class SlidingWindowRateLimiter {
  constructor() {
    this.windows = new Map();
  }

  consume({ key, limit, windowMs }) {
    const now = Date.now();
    const currentWindow = this.windows.get(key) || [];
    const nextWindow = currentWindow.filter((timestamp) => now - timestamp < windowMs);

    if (nextWindow.length >= limit) {
      const retryAfterMs = Math.max(windowMs - (now - nextWindow[0]), 0);

      this.windows.set(key, nextWindow);

      return {
        allowed: false,
        remaining: 0,
        retryAfterMs,
      };
    }

    nextWindow.push(now);
    this.windows.set(key, nextWindow);

    return {
      allowed: true,
      remaining: Math.max(limit - nextWindow.length, 0),
      retryAfterMs: 0,
    };
  }
}

module.exports = {
  SlidingWindowRateLimiter,
};
