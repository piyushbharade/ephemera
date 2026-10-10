import { useEffect, useRef, useState } from 'react';

/**
 * Copies text to the clipboard. With `clearAfter` (seconds) the clipboard is
 * emptied again after that time, so a secret does not sit there forever.
 * Browsers only allow this while the tab is open and focused.
 */
export function CopyButton({
  text,
  label,
  clearAfter,
  className = 'btn quiet',
}: {
  text: string;
  label: string;
  clearAfter?: number;
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [left, setLeft] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stop, []);

  async function copy() {
    stop();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      setState('failed');
      return;
    }
    setState('copied');
    const seconds = clearAfter ?? 2;
    setLeft(seconds);
    let remaining = seconds;
    timer.current = setInterval(() => {
      remaining -= 1;
      setLeft(remaining);
      if (remaining <= 0) {
        stop();
        if (clearAfter) navigator.clipboard.writeText('').catch(() => {});
        setState('idle');
      }
    }, 1000);
  }

  const text_ =
    state === 'copied'
      ? clearAfter
        ? `Copied. Clipboard clears in ${left} s`
        : 'Copied'
      : state === 'failed'
        ? 'Copy failed'
        : label;

  return (
    <>
      <button type="button" className={className} onClick={copy}>
        {text_}
      </button>
      <span className="sr-only" role="status">
        {state === 'copied' ? 'Copied to clipboard' : state === 'failed' ? 'Copy failed. Select the text and copy it yourself.' : ''}
      </span>
    </>
  );
}
