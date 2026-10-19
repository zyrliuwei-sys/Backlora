/** Thrown for anything the caller did wrong; routes turn it into respErr. */
export class BacklinkError extends Error {
  constructor(
    message: string,
    public status = 400
  ) {
    super(message);
  }
}

// D1 allows 100 bound parameters per statement.
export const IN_CHUNK = 90;

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size)
    out.push(items.slice(i, i + size));
  return out;
}

export function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}

export function strOrNull(v: unknown, max: number): string | null {
  const s = str(v, max);
  return s ? s : null;
}

export function numOrNull(v: unknown): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** Accepts an array or a comma/semicolon separated string. */
export function stringList(v: unknown, maxItems = 30, maxLen = 60): string[] {
  const list = Array.isArray(v)
    ? v
    : typeof v === 'string'
      ? v.split(/[,，;|]/)
      : [];
  const seen = new Set<string>();
  for (const t of list) {
    const s = String(t).trim().slice(0, maxLen);
    if (s) seen.add(s);
  }
  return [...seen].slice(0, maxItems);
}

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

export function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export function pageOf(page: number, pageSize: number) {
  return { limit: pageSize, offset: (page - 1) * pageSize };
}
