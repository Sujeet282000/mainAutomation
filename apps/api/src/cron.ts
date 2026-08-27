/** 5-field UTC cron matcher used by the worker ticker (no extra runtime deps). */
export function cronMatchesUtc(expr: string, date: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, dom, month, dow] = parts;
  return (
    fieldMatches(min, date.getUTCMinutes()) &&
    fieldMatches(hour, date.getUTCHours()) &&
    fieldMatches(dom, date.getUTCDate()) &&
    fieldMatches(month, date.getUTCMonth() + 1) &&
    fieldMatches(dow, date.getUTCDay())
  );
}

function fieldMatches(field: string, value: number): boolean {
  if (field === "*") return true;
  return field.split(",").some((part) => {
    if (part.startsWith("*/")) {
      const n = Number(part.slice(2));
      return n > 0 && value % n === 0;
    }
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number);
      return value >= a && value <= b;
    }
    return Number(part) === value;
  });
}

export function nextCronUtc(expr: string, from: Date): Date {
  const cursor = new Date(from);
  cursor.setUTCSeconds(0, 0);
  cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    if (cronMatchesUtc(expr, cursor)) return new Date(cursor);
    cursor.setUTCMinutes(cursor.getUTCMinutes() + 1);
  }
  return new Date(from.getTime() + 60_000);
}
