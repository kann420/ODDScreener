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
