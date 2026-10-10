import type { CSSProperties } from 'react';
import { FAKE_LINE_WIDTHS } from '../lib/format';

/**
 * Lines of text with a black redaction bar.
 *   mode "cover"   - bars sweep across the text and hide it (used when sealing)
 *   mode "uncover" - bars slide away and reveal the text (used when opening)
 * The motion is pure CSS, so it needs no extra scripts and stops when the
 * visitor prefers reduced motion.
 */
export function RedactLines({ lines, mode }: { lines: string[]; mode: 'cover' | 'uncover' }) {
  return (
    <div className={`redact mode-${mode}`}>
      {lines.map((line, i) => (
        <span
          key={i}
          className={line.trim() === '' ? 'rl empty' : 'rl'}
          style={{ '--d': `${Math.min(i, 14) * 90}ms` } as CSSProperties}
        >
          {line === '' ? ' ' : line}
        </span>
      ))}
    </div>
  );
}

/** Decorative, always-covered bars. They stand in for text that has not been unlocked yet. */
export function FakeLines({ count = 6 }: { count?: number }) {
  return (
    <div className="redact mode-covered" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="rl fake" style={{ width: `${FAKE_LINE_WIDTHS[i % FAKE_LINE_WIDTHS.length]}%` }}>
          {' '}
        </span>
      ))}
    </div>
  );
}
