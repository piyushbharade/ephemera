import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';

const STRIPS = 18;
// Widths of the redacted lines on the page that gets shredded.
const DOC_BARS = [92, 64, 80, 47, 72, 30] as const;

/**
 * The "nothing here" screen. One page of redacted text is sliced into strips
 * that drop through a shredder (CSS only), and a stamp lands where it was.
 */
export function Shredded({
  title,
  stamp = 'Shredded',
  children,
}: {
  title: string;
  stamp?: string;
  children: ReactNode;
}) {
  return (
    <section className="sheet shredded" aria-labelledby="shred-title">
      <div className="shred" aria-hidden="true">
        {Array.from({ length: STRIPS }, (_, i) => (
          <span
            key={i}
            className="strip"
            style={
              {
                '--i': i,
                '--n': STRIPS,
                '--r': `${(i % 2 ? 1 : -1) * (3 + (i % 4))}deg`,
                '--x': `${((i % 5) - 2) * 7}px`,
              } as CSSProperties
            }
          >
            <span className="doc">
              {DOC_BARS.map((width, j) => (
                <i key={j} style={{ width: `${width}%` }} />
              ))}
            </span>
          </span>
        ))}
        <span className="stamp">{stamp}</span>
      </div>
      <h1 id="shred-title" className="sheet-title">
        {title}
      </h1>
      {children}
      <div className="actions">
        <Link className="btn primary" href="/">
          Create a new secret
        </Link>
      </div>
    </section>
  );
}
