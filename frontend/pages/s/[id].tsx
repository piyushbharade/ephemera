import Link from 'next/link';
import { useRouter } from 'next/router';
import { type CSSProperties, useEffect, useState } from 'react';
import { CopyButton } from '../../components/CopyButton';
import { Layout } from '../../components/Layout';
import { FakeLines, RedactLines } from '../../components/Redact';
import { Shredded } from '../../components/Shredded';
import { decrypt, deriveKey, fromB64Url, importKey } from '../../lib/crypto-engine';
import { plural } from '../../lib/format';

type View =
  | { kind: 'checking' }
  | { kind: 'ready' }
  | { kind: 'working' }
  | { kind: 'open'; text: string; viewsLeft: number }
  | { kind: 'cleared'; viewsLeft: number }
  | { kind: 'gone' }
  | { kind: 'failed' };

const AUTO_CLEAR_SECONDS = 60;

/** Checks the link BEFORE asking the server, because asking uses up one of the secret's opens. */
function problemWith(fragment: string): string {
  if (fragment === '')
    return 'This link is incomplete. Ask the sender for the full link, including everything after the #.';
  if (fragment === 'p' || /^[A-Za-z0-9_-]{43}$/.test(fragment)) return '';
  return 'This link looks damaged: the key after the # is the wrong length. Ask the sender for the full link.';
}

export default function Reveal() {
  const router = useRouter();
  const id = typeof router.query.id === 'string' ? router.query.id : '';

  const [view, setView] = useState<View>({ kind: 'checking' });
  const [fragment, setFragment] = useState<string | null>(null); // null until the browser has read it
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [remaining, setRemaining] = useState(AUTO_CLEAR_SECONDS);

  // The part after the # exists only in the browser. Read it once the page has loaded,
  // and again if someone edits the address bar without reloading.
  useEffect(() => {
    const read = () => setFragment(window.location.hash.slice(1));
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);

  // Ask whether the secret still exists. This does NOT use up an open, and it
  // lets a link that was already used show the "shredded" screen immediately.
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`/api/secrets/${encodeURIComponent(id)}/status`, { signal: controller.signal })
      .then((res) => setView(res.status === 404 ? { kind: 'gone' } : { kind: 'ready' }))
      .catch((err) => {
        if (err?.name !== 'AbortError') setView({ kind: 'ready' });
      });
    return () => controller.abort();
  }, [id]);

  const loaded = fragment !== null && id !== '' && view.kind !== 'checking';
  const needsPassword = fragment === 'p';
  const linkProblem = loaded ? problemWith(fragment) : '';

  // Count down, then remove the secret from the page.
  const opened = view.kind === 'open';
  useEffect(() => {
    if (!opened) return;
    setRemaining(AUTO_CLEAR_SECONDS);
    const timer = setInterval(() => setRemaining((r) => r - 1), 1000);
    return () => clearInterval(timer);
  }, [opened]);
  useEffect(() => {
    if (view.kind === 'open' && remaining <= 0) setView({ kind: 'cleared', viewsLeft: view.viewsLeft });
  }, [remaining, view]);

  async function reveal() {
    if (!loaded || linkProblem) return;
    if (needsPassword && password === '') {
      setError('Enter the password the sender gave you.');
      return;
    }
    setError('');
    setView({ kind: 'working' });

    // Nothing has been requested from the server until this moment.
    let data: { ciphertext: string; iv: string; salt: string; views_left: number };
    try {
      const res = await fetch(`/api/secrets/${encodeURIComponent(id)}`);
      if (res.status === 404) {
        setView({ kind: 'gone' });
        return;
      }
      if (res.status === 429) {
        setError('Too many requests. Wait a minute and try again.');
        setView({ kind: 'ready' });
        return;
      }
      if (!res.ok) throw new Error('bad status');
      data = await res.json();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
      setView({ kind: 'ready' });
      return;
    }

    try {
      const key = needsPassword ? await deriveKey(password, fromB64Url(data.salt)) : await importKey(fragment!);
      const text = await decrypt(data.ciphertext, data.iv, key);
      setView({ kind: 'open', text, viewsLeft: data.views_left });
    } catch {
      if (data.views_left > 0) {
        setError(
          `That password or key did not work, and it used one open. It can be opened ${data.views_left} more ${plural(data.views_left, 'time', 'times')}.`,
        );
        setView({ kind: 'ready' });
      } else {
        setView({ kind: 'failed' });
      }
    }
  }

  function clearFromScreen() {
    if (view.kind === 'open') setView({ kind: 'cleared', viewsLeft: view.viewsLeft });
  }

  return (
    <Layout title="Ephemera: a secret is waiting">
      <div className="center">
        {(view.kind === 'checking' || view.kind === 'ready' || view.kind === 'working') && (
          <section className="sheet" aria-labelledby="ready-title">
            <h1 id="ready-title" className="sheet-title">
              A secret is waiting for you
            </h1>
            <p className="lead-sm">
              Opening it counts as one of its allowed opens. After the last one, it is deleted from the server. The
              secret itself is not downloaded until you click the button.
            </p>
            <div className="paper paper-view">
              <FakeLines />
            </div>

            {needsPassword && (
              <div className="field">
                <label htmlFor="password">Password</label>
                <div className="pw-input">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && reveal()}
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button type="button" className="btn quiet small" onClick={() => setShowPassword((s) => !s)}>
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>
            )}

            {(linkProblem || error) && (
              <p className="error" role="alert">
                {linkProblem || error}
              </p>
            )}

            <div className="actions">
              <button
                type="button"
                className="btn primary"
                onClick={reveal}
                disabled={!loaded || !!linkProblem || view.kind === 'working'}
              >
                {view.kind === 'working' ? 'Unlocking…' : 'Reveal secret'}
              </button>
            </div>
          </section>
        )}

        {view.kind === 'open' && (
          <section className="sheet" aria-labelledby="open-title">
            <h1 id="open-title" className="sheet-title">
              Your secret
            </h1>
            <p className="status">
              <span className="dot" aria-hidden="true" />
              {view.viewsLeft > 0
                ? `Still on the server. It can be opened ${view.viewsLeft} more ${plural(view.viewsLeft, 'time', 'times')}.`
                : 'Deleted from the server. This is the only time it can be shown.'}
            </p>
            <div className="paper paper-view" data-testid="secret">
              <RedactLines lines={view.text.split('\n')} mode="uncover" />
            </div>
            <div className="timer" aria-hidden="true">
              <span style={{ transform: `scaleX(${Math.max(remaining, 0) / AUTO_CLEAR_SECONDS})` } as CSSProperties} />
            </div>
            <p className="field-foot">This page clears the secret in {Math.max(remaining, 0)} seconds.</p>
            <div className="actions">
              <CopyButton text={view.text} label="Copy secret" clearAfter={30} className="btn primary" />
              <button type="button" className="btn quiet" onClick={clearFromScreen}>
                Clear from screen
              </button>
            </div>
          </section>
        )}

        {view.kind === 'cleared' && (
          <section className="sheet" aria-labelledby="cleared-title">
            <h1 id="cleared-title" className="sheet-title">
              Cleared from this page
            </h1>
            <div className="paper paper-view">
              <FakeLines />
            </div>
            <p className="lead-sm">
              {view.viewsLeft > 0
                ? 'It is still on the server. Open the original link again to see it.'
                : 'It was deleted from the server, so it cannot be shown again.'}
            </p>
            <div className="actions">
              <Link className="btn primary" href="/">
                Create a new secret
              </Link>
            </div>
          </section>
        )}

        {view.kind === 'gone' && (
          <Shredded title="404: Payload shredded">
            <p className="lead-sm">
              This secret was already opened, has expired, or never existed. Ask the sender for a new link.
            </p>
          </Shredded>
        )}

        {view.kind === 'failed' && (
          <section className="sheet" aria-labelledby="failed-title">
            <h1 id="failed-title" className="sheet-title">
              Could not unlock this secret
            </h1>
            <p className="lead-sm">
              The password or key was wrong, and the secret has now been deleted from the server. Ask the sender to
              create a new one.
            </p>
            <div className="actions">
              <Link className="btn primary" href="/">
                Create a new secret
              </Link>
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
