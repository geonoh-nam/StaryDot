// Which line the buddy says next. Never the one it just said — a three-line pool that
// repeats reads like a single line.
export function pickLine(pool, last) {
  if (!pool || pool.length === 0) return null;
  if (pool.length === 1) return pool[0];
  const rest = pool.filter((line) => line !== last);
  return rest[Math.floor(Math.random() * rest.length)];
}
