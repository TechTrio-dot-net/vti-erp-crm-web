import { isUuid } from '../lib/http';
import { ValidationError } from './errors';

const PHONE = /^[0-9+\-\s()]+$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** An ISO date, optionally with a time (what a date input or toISOString() sends) */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export const PHONE_MESSAGE = 'The phone number may only contain digits, spaces, +, - and brackets.';
export const STRONG_PASSWORD = /^(?=.*[A-Za-z])(?=.*\d).{8,}$/;
export const PASSWORD_MESSAGE = 'The password must be at least 8 characters and contain both letters and numbers.';

const isBlank = (value: unknown) => value === undefined || value === null || value === '';

function validCalendarDate(value: string): boolean {
  const day = value.slice(0, 10);
  const parsed = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day;
}

/** Query-string or JSON boolean: "1"/"true"/true → true, "0"/"false"/false → false */
export function toBool(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1' || value === 1) return true;
  if (value === 'false' || value === '0' || value === 0) return false;
  return undefined;
}

interface StringOptions {
  max?: number;
  message?: string;
  pattern?: RegExp;
  patternMessage?: string;
  /** Keep surrounding whitespace (default: trimmed) */
  raw?: boolean;
}

/**
 * Reads and checks request fields, collecting one message per field, then `done()` throws a 422
 * with all of them. Blank optional values ('' or null) come back as null; absent ones as undefined.
 */
export class Input {
  readonly errors: Record<string, string[]> = {};

  constructor(
    private readonly body: Record<string, unknown>,
    private readonly prefix = ''
  ) {}

  static from(value: unknown, prefix = ''): Input {
    return new Input(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}, prefix);
  }

  private key(field: string) {
    return this.prefix ? `${this.prefix}.${field}` : field;
  }

  fail(field: string, message: string): void {
    const key = this.key(field);
    if (!this.errors[key]) this.errors[key] = [message];
  }

  hasError(field: string): boolean {
    return !!this.errors[this.key(field)];
  }

  raw(field: string): unknown {
    return this.body[field];
  }

  has(field: string): boolean {
    return this.body[field] !== undefined;
  }

  /** Merges another Input's errors (nested objects such as quotation lines) */
  absorb(other: Input): void {
    for (const [key, messages] of Object.entries(other.errors)) this.errors[key] ??= messages;
  }

  done(): void {
    if (Object.keys(this.errors).length) throw new ValidationError(this.errors);
  }

  requiredString(field: string, requiredMessage: string, options: StringOptions = {}): string {
    const value = this.body[field];
    if (typeof value !== 'string' || (options.raw ? value : value.trim()) === '') {
      this.fail(field, requiredMessage);
      return '';
    }
    return this.checkString(field, options.raw ? value : value.trim(), options) ?? '';
  }

  optionalString(field: string, options: StringOptions = {}): string | null | undefined {
    const value = this.body[field];
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string') {
      this.fail(field, options.message ?? 'This value must be text.');
      return null;
    }
    const text = options.raw ? value : value.trim();
    if (text === '') return null;
    return this.checkString(field, text, options);
  }

  private checkString(field: string, value: string, options: StringOptions): string | null {
    if (options.max !== undefined && value.length > options.max) {
      this.fail(field, `This value may not be greater than ${options.max} characters.`);
      return null;
    }
    if (options.pattern && !options.pattern.test(value)) {
      this.fail(field, options.patternMessage ?? options.message ?? 'This value has an invalid format.');
      return null;
    }
    return value;
  }

  optionalEmail(field: string, message = 'Enter a valid email address.'): string | null | undefined {
    const value = this.optionalString(field, { max: 255 });
    if (value && !EMAIL.test(value)) {
      this.fail(field, message);
      return null;
    }
    return value;
  }

  optionalPhone(field: string, max = 20): string | null | undefined {
    return this.optionalString(field, { max, pattern: PHONE, patternMessage: PHONE_MESSAGE });
  }

  requiredId(field: string, message: string): string {
    const value = this.body[field];
    if (!isUuid(value)) {
      this.fail(field, message);
      return '';
    }
    return value;
  }

  optionalId(field: string, message: string): string | null | undefined {
    const value = this.body[field];
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (!isUuid(value)) {
      this.fail(field, message);
      return null;
    }
    return value;
  }

  idArray(field: string, options: { message: string; minMessage?: string; eachMessage: string; required?: boolean }): string[] {
    const value = this.body[field];
    if (value === undefined && !options.required) return [];
    if (!Array.isArray(value)) {
      this.fail(field, options.message);
      return [];
    }
    if (options.minMessage && value.length === 0) {
      this.fail(field, options.minMessage);
      return [];
    }
    if (new Set(value).size !== value.length) {
      this.fail(field, "All values must be unique.");
      return [];
    }
    if (!value.every(isUuid)) {
      this.fail(field, options.eachMessage);
      return [];
    }
    return value as string[];
  }

  bool(field: string, message = 'This value must be true or false.'): boolean | undefined {
    const value = this.body[field];
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = toBool(value);
    if (parsed === undefined) this.fail(field, message);
    return parsed;
  }

  requiredBool(field: string, message: string): boolean {
    const parsed = this.bool(field, message);
    if (parsed === undefined) {
      this.fail(field, message);
      return false;
    }
    return parsed;
  }

  oneOf<T extends string>(field: string, values: readonly T[], message: string, options: { required?: boolean } = {}): T | undefined {
    const value = this.body[field];
    if (value === undefined && !options.required) return undefined;
    if (typeof value !== 'string' || !values.includes(value as T)) {
      this.fail(field, message);
      return undefined;
    }
    return value as T;
  }

  /** A number (numeric strings accepted); undefined when absent, null when blank and nullable */
  number(
    field: string,
    options: {
      required?: boolean;
      nullable?: boolean;
      integer?: boolean;
      decimals?: number;
      min?: number;
      max?: number;
      message: string;
      minMessage?: string;
      maxMessage?: string;
    }
  ): number | null | undefined {
    const value = this.body[field];
    if (isBlank(value)) {
      if (options.required) {
        this.fail(field, options.message);
        return undefined;
      }
      return value === undefined ? undefined : options.nullable ? null : undefined;
    }
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isFinite(n)) {
      this.fail(field, options.message);
      return undefined;
    }
    if (options.integer && !Number.isInteger(n)) {
      this.fail(field, options.message);
      return undefined;
    }
    if (options.decimals !== undefined && decimalsOf(n) > options.decimals) {
      this.fail(field, options.message);
      return undefined;
    }
    if (options.min !== undefined && n < options.min) {
      this.fail(field, options.minMessage ?? `This value must not be less than ${options.min}.`);
      return undefined;
    }
    if (options.max !== undefined && n > options.max) {
      this.fail(field, options.maxMessage ?? `This value must not be greater than ${options.max}.`);
      return undefined;
    }
    return n;
  }

  /** YYYY-MM-DD (strict) or an ISO date-time, returned as given; blank → null */
  date(field: string, options: { message: string; strict?: boolean; required?: boolean }): string | null | undefined {
    const value = this.body[field];
    if (isBlank(value)) {
      if (options.required) this.fail(field, options.message);
      return value === undefined ? undefined : null;
    }
    if (typeof value !== 'string' || !(options.strict ? DATE_ONLY : ISO_DATE).test(value) || !validCalendarDate(value)) {
      this.fail(field, options.message);
      return null;
    }
    return value;
  }

  stringArray(field: string, options: { allowed?: readonly string[]; message: string; unique?: boolean }): string[] | undefined {
    const value = this.body[field];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
      this.fail(field, options.message);
      return undefined;
    }
    if (options.unique && new Set(value).size !== value.length) {
      this.fail(field, 'All values must be unique.');
      return undefined;
    }
    if (options.allowed && !value.every((item) => options.allowed!.includes(item))) {
      this.fail(field, options.message);
      return undefined;
    }
    return value as string[];
  }
}

function decimalsOf(n: number): number {
  const text = String(n);
  if (text.includes('e-')) return Number(text.split('e-')[1]);
  return text.includes('.') ? text.split('.')[1].length : 0;
}

/** Validated page / per_page from a query string */
export function pageQuery(query: Record<string, unknown>, defaults: { perPage: number; maxPerPage?: number; minPerPage?: number }) {
  const input = Input.from(query);
  const page = input.number('page', { integer: true, min: 1, message: 'The page must be a whole number.' }) ?? 1;
  const perPage =
    input.number('per_page', {
      integer: true,
      min: defaults.minPerPage ?? 5,
      max: defaults.maxPerPage ?? 200,
      message: 'The per page value must be a whole number.',
    }) ?? defaults.perPage;
  input.done();
  return { page: page as number, perPage: perPage as number };
}

/** Laravel-style paginator meta the frontend's Paginated<T> expects */
export function meta(page: number, perPage: number, total: number, count: number) {
  return {
    current_page: page,
    last_page: Math.max(1, Math.ceil(total / perPage)),
    per_page: perPage,
    total,
    from: count ? (page - 1) * perPage + 1 : null,
    to: count ? (page - 1) * perPage + count : null,
  };
}

/** A search term safe for ILIKE '%term%' */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Optional search string from a query (max 100 characters) */
export function searchTerm(query: Record<string, unknown>): string | undefined {
  const value = query.search;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  if (value.length > 100) throw ValidationError.of({ search: 'This value may not be greater than 100 characters.' });
  return value.trim();
}
