/** The Ephemera logo: a page with one line redacted. */
export function Mark({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1.5" y="1.5" width="29" height="29" rx="3" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <rect x="7" y="8" width="12" height="3" fill="currentColor" opacity="0.4" />
      <rect x="7" y="14" width="18" height="6" fill="currentColor" />
      <rect x="7" y="23" width="9" height="3" fill="currentColor" opacity="0.4" />
    </svg>
  );
}
