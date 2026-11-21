/** Thrown for invalid configuration; the message is shown to the user as is. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Typed reader for a plain JSON object (config file sections, driver options).
 * Every getter validates and falls back to the default when the key is missing.
 */
export class OptionReader {
  private readonly obj: Record<string, unknown>;
  private readonly path: string;
  private readonly seen = new Set<string>();

  constructor(raw: unknown, path: string) {
    if (raw === undefined || raw === null) raw = {};
    if (typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${path}: must be an object`);
    this.obj = raw as Record<string, unknown>;
    this.path = path;
  }

  has(key: string): boolean {
    return this.obj[key] !== undefined;
  }

  raw(key: string): unknown {
    this.seen.add(key);
    return this.obj[key];
  }

  string(key: string, fallback: string): string;
  string(key: string, fallback?: undefined): string | undefined;
  string(key: string, fallback?: string): string | undefined {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    if (typeof v !== 'string') throw new ConfigError(`${this.path}.${key}: must be a string`);
    return v;
  }

  number(key: string, fallback: number, range: { min?: number; max?: number; integer?: boolean } = {}): number {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) throw new ConfigError(`${this.path}.${key}: must be a number`);
    if (range.integer && !Number.isInteger(n)) throw new ConfigError(`${this.path}.${key}: must be an integer`);
    if (range.min !== undefined && n < range.min) throw new ConfigError(`${this.path}.${key}: must be >= ${range.min}`);
    if (range.max !== undefined && n > range.max) throw new ConfigError(`${this.path}.${key}: must be <= ${range.max}`);
    return n;
  }

  port(key: string, fallback: number): number {
    return this.number(key, fallback, { min: 0, max: 65535, integer: true });
  }

  boolean(key: string, fallback: boolean): boolean {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    if (typeof v !== 'boolean') throw new ConfigError(`${this.path}.${key}: must be true or false`);
    return v;
  }

  oneOf<const T extends string>(key: string, choices: readonly T[], fallback: T): T {
    const v = this.string(key);
    if (v === undefined) return fallback;
    if (!(choices as readonly string[]).includes(v)) {
      throw new ConfigError(`${this.path}.${key}: must be one of ${choices.join(', ')}`);
    }
    return v as T;
  }

  stringList(key: string, fallback: string[]): string[] {
    const v = this.raw(key);
    if (v === undefined) return fallback;
    if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) {
      throw new ConfigError(`${this.path}.${key}: must be a list of strings`);
    }
    return v as string[];
  }

  /** Keys present in the object that no getter asked for (typos in the config). */
  unknownKeys(): string[] {
    return Object.keys(this.obj).filter((k) => !this.seen.has(k));
  }
}
