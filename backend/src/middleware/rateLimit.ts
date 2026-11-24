import { Request, Response, NextFunction } from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
}

export function createRateLimiter(options: RateLimiterOptions) {
  const { windowMs, max, message = 'Too many requests, please try again later.' } = options;
  const hits = new Map<string, number[]>();

  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [ip, timestamps] of hits.entries()) {
      const valid = timestamps.filter(ts => ts > cutoff);
      if (valid.length === 0) {
        hits.delete(ip);
      } else {
        hits.set(ip, valid);
      }
    }
  }, Math.min(windowMs, 60_000));

  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const now = Date.now();
    const cutoff = now - windowMs;

    const existing = hits.get(ip) || [];
    const recent = existing.filter(ts => ts > cutoff);

    if (recent.length >= max) {
      const oldestInWindow = recent[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + windowMs - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      return res.status(429).json({ error: message });
    }

    recent.push(now);
    hits.set(ip, recent);
    next();
  };
}
