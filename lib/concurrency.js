/**
 * Concurrency & Rate Limiting utilities
 *
 * - withConcurrency(fn, limit)    – classic concurrency gate (legacy API kept)
 * - ConcurrencyPool               – reusable pool with configurable limit
 * - RateLimiter                    – token-bucket limiter (requests/sec)
 * - mapWithConcurrency(items, fn, limit) – map over items with limited parallelism
 */

/* ---------- legacy simple gate ---------- */
let active = 0;
const queue = [];

export function withConcurrency(fn, limit = 4) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      active++;
      try {
        const res = await fn();
        resolve(res);
      } catch (e) {
        reject(e);
      } finally {
        active--;
        if (queue.length) queue.shift()();
      }
    };

    if (active < limit) run();
    else queue.push(run);
  });
}

/* ---------- reusable ConcurrencyPool ---------- */
export class ConcurrencyPool {
  constructor(limit = 6) {
    this._limit = limit;
    this._active = 0;
    this._queue = [];
  }

  run(fn) {
    return new Promise((resolve, reject) => {
      const execute = async () => {
        this._active++;
        try {
          resolve(await fn());
        } catch (e) {
          reject(e);
        } finally {
          this._active--;
          if (this._queue.length) this._queue.shift()();
        }
      };
      if (this._active < this._limit) execute();
      else this._queue.push(execute);
    });
  }
}

/* ---------- RateLimiter (token bucket) ---------- */
export class RateLimiter {
  /**
   * @param {number} rps – max requests per second
   */
  constructor(rps = 8) {
    this._interval = Math.ceil(1000 / rps); // ms between tokens
    this._last = 0;
    this._queue = [];
    this._running = false;
  }

  /** Acquire a slot, resolves when it's safe to proceed */
  acquire() {
    return new Promise((resolve) => {
      this._queue.push(resolve);
      if (!this._running) this._drain();
    });
  }

  async _drain() {
    this._running = true;
    while (this._queue.length) {
      const now = Date.now();
      const wait = Math.max(0, this._last + this._interval - now);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this._last = Date.now();
      const resolve = this._queue.shift();
      if (resolve) resolve();
    }
    this._running = false;
  }

  /** Run a function with rate limiting */
  async run(fn) {
    await this.acquire();
    return fn();
  }
}

/* ---------- mapWithConcurrency ---------- */
/**
 * Like Promise.all(items.map(fn)) but limits parallelism.
 * Also integrates an optional RateLimiter.
 *
 * @param {Array} items
 * @param {Function} fn – async (item, index) => result
 * @param {{ concurrency?: number, rateLimiter?: RateLimiter }} opts
 * @returns {Promise<Array>}
 */
export async function mapWithConcurrency(items, fn, opts = {}) {
  const { concurrency = 6, rateLimiter } = opts;
  const results = new Array(items.length);
  let idx = 0;

  const worker = async () => {
    while (idx < items.length) {
      const i = idx++;
      if (rateLimiter) await rateLimiter.acquire();
      results[i] = await fn(items[i], i);
    }
  };

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => worker()
  );

  await Promise.all(workers);
  return results;
}

/* ---------- Global shared instances ---------- */

/** Rate limiter for Polymarket CLOB – 8 req/s to stay under their 429 threshold */
export const polyRateLimiter = new RateLimiter(8);

/** Rate limiter for Opinion API – 10 req/s */
export const opinionRateLimiter = new RateLimiter(10);
