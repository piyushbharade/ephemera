/** Small helpers and shared constants for the interface. */

export const EXPIRY = [
  { value: 300, label: '5 min', long: '5 minutes' },
  { value: 3600, label: '1 hour', long: '1 hour' },
  { value: 86400, label: '1 day', long: '1 day' },
  { value: 604800, label: '7 days', long: '7 days' },
] as const;

export const OPENS = [1, 2, 3, 4, 5] as const;

/** Largest secret, measured in bytes. It keeps the encrypted text under the backend limit. */
export const MAX_BYTES = 12_000;

/** Lines shown while the redaction animation plays. */
export const GHOST_LINES = 9;

export const expiryLong = (seconds: number): string =>
  EXPIRY.find((e) => e.value === seconds)?.long ?? `${seconds} seconds`;

export const opensPhrase = (n: number): string => (n === 1 ? 'once' : `${n} times`);

export const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Widths for the decorative redaction bars shown before a secret is revealed. */
export const FAKE_LINE_WIDTHS = [88, 62, 94, 41, 76, 55] as const;

export const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
