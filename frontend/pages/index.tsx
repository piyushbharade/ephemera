import { FormEvent, useEffect, useMemo, useState } from 'react';
import { CopyButton } from '../components/CopyButton';
import { Layout } from '../components/Layout';
import { RedactLines } from '../components/Redact';
import { Segmented } from '../components/Segmented';
import { byteLength, deriveKey, encrypt, exportKey, generateKey, newSalt, toB64Url } from '../lib/crypto-engine';
import {
  EXPIRY,
  GHOST_LINES,
  MAX_BYTES,
  OPENS,
  expiryLong,
  opensPhrase,
  plural,
  prefersReducedMotion,
} from '../lib/format';

type Phase = 'compose' | 'locking' | 'sealing' | 'sealed';

/** Everything we show after a secret has been stored. None of it contains the plain text. */
interface Sealed {
  id: string;
  base: string; // link up to the #
  fragment: string; // what comes after the # (the key, or "p" when a password is used)
  usedPassword: boolean;
  ttl: number;
  views: number;
  ciphertext: string;
  iv: string;
  salt: string;
}

const MIN_PASSWORD = 8;

export default function Home() {
  const [phase, setPhase] = useState<Phase>('compose');
  const [secret, setSecret] = useState('');
  const [ttl, setTtl] = useState<number>(3600);
  const [views, setViews] = useState<number>(1);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [ghost, setGhost] = useState<string[]>([]);
  const [sealed, setSealed] = useState<Sealed | null>(null);

  const bytes = useMemo(() => byteLength(secret), [secret]);
  const tooLong = bytes > MAX_BYTES;
  const passwordOk = !usePassword || password.length >= MIN_PASSWORD;
  const canSubmit = secret.trim().length > 0 && !tooLong && passwordOk && phase === 'compose';

  // After the redaction animation has played, wipe the plain text from the page.
  useEffect(() => {
    if (phase !== 'sealing') return;
    const wait = prefersReducedMotion() ? 0 : Math.min(ghost.length, 14) * 90 + 550 + 500;
    const timer = setTimeout(() => {
      setSecret('');
      setPassword('');
      setGhost([]);
      setPhase('sealed');
    }, wait);
    return () => clearTimeout(timer);
  }, [phase, ghost.length]);

  async function lock(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError('');
    setPhase('locking');
    try {
      // 1. Make the key. Either random (it will travel in the link) or from the password.
      let key: CryptoKey;
      let salt = '';
      let fragment: string;
      if (usePassword) {
        const saltBytes = newSalt();
        key = await deriveKey(password, saltBytes);
        salt = toB64Url(saltBytes);
        fragment = 'p'; // a marker only: this link carries no key
      } else {
        key = await generateKey();
        fragment = await exportKey(key);
      }

      // 2. Encrypt in the browser. Only the scrambled result is uploaded.
      const { ciphertext, iv } = await encrypt(secret, key);
      const res = await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ciphertext, iv, salt, ttl_seconds: ttl, max_views: views }),
      });
      if (res.status === 429) throw new Error('Too many requests. Wait a minute and try again.');
      if (res.status === 422) throw new Error('That secret is too long to store. Shorten it and try again.');
      if (!res.ok) throw new Error('The server could not store the secret. Try again.');
      const { id } = (await res.json()) as { id: string };

      setSealed({
        id,
        base: `${window.location.origin}/s/${id}`,
        fragment,
        usedPassword: usePassword,
        ttl,
        views,
        ciphertext,
        iv,
        salt,
      });
      setGhost(secret.split('\n').slice(0, GHOST_LINES));
      setPhase('sealing');
    } catch (err) {
      setError(
        err instanceof TypeError
          ? 'Could not reach the server. Check that the backend is running.'
          : err instanceof Error
            ? err.message
            : 'Something went wrong. Try again.',
      );
      setPhase('compose');
    }
  }

  function reset() {
    setSealed(null);
    setUsePassword(false);
    setShowPassword(false);
    setError('');
    setPhase('compose');
  }

  return (
    <Layout title="Ephemera: share secrets that delete themselves">
      <div className="home">
        <div className="intro">
          <h1 className="display">Share a password once. Then it&rsquo;s gone.</h1>
          <p className="lead">
            Ephemera locks your secret in your browser before it is sent. The server only holds scrambled text, and
            deletes it the first time someone opens the link.
          </p>

          <dl className="promises">
            <div>
              <dt>Locked in your browser</dt>
              <dd>The key is made on your device and stays inside the link. The server never receives it.</dd>
            </div>
            <div>
              <dt>Opens once</dt>
              <dd>The first open deletes the secret from the server. You can allow up to 5 opens.</dd>
            </div>
            <div>
              <dt>Gone on schedule</dt>
              <dd>A secret nobody opens is deleted after 5 minutes, 1 hour, 1 day or 7 days.</dd>
            </div>
          </dl>

          <details className="limits">
            <summary>What Ephemera can&rsquo;t protect against</summary>
            <ul>
              <li>Anyone who gets the full link can open it once. Send a password by a different route than the link.</li>
              <li>
                If the key in a link is cut off or wrong, the secret is still used up. Ephemera checks the link before
                asking the server, but it cannot catch every mistake.
              </li>
              <li>You trust the server to deliver honest code. For sensitive use, host it yourself.</li>
              <li>Malware on your device can read what you type.</li>
            </ul>
          </details>
        </div>

        {(phase === 'compose' || phase === 'locking') && (
          <section className="sheet" aria-labelledby="composer-title">
            <h2 id="composer-title" className="sheet-title">
              New secret
            </h2>
            <form onSubmit={lock} noValidate>
              <div className="field">
                <label htmlFor="secret">Secret</label>
                <textarea
                  id="secret"
                  className="paper paper-input"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Paste a password, an API key or a whole .env file"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={phase === 'locking'}
                  aria-describedby="secret-count"
                />
                <p id="secret-count" className={tooLong ? 'field-foot over' : 'field-foot'}>
                  {tooLong
                    ? `Too long. The limit is ${MAX_BYTES.toLocaleString()} bytes, and this is ${bytes.toLocaleString()}.`
                    : `${bytes.toLocaleString()} of ${MAX_BYTES.toLocaleString()} bytes`}
                </p>
              </div>

              <div className="row">
                <fieldset className="field">
                  <legend>Expires after</legend>
                  <Segmented
                    name="expiry"
                    value={ttl}
                    options={EXPIRY.map((e) => ({ value: e.value as number, label: e.label }))}
                    onChange={setTtl}
                  />
                </fieldset>
                <fieldset className="field">
                  <legend>Times it can be opened</legend>
                  <Segmented
                    name="opens"
                    value={views}
                    options={OPENS.map((n) => ({ value: n as number, label: String(n) }))}
                    onChange={setViews}
                  />
                </fieldset>
              </div>

              <div className="field">
                <label className="check">
                  <input type="checkbox" checked={usePassword} onChange={(e) => setUsePassword(e.target.checked)} />
                  <span>Also protect it with a password</span>
                </label>
                {usePassword && (
                  <div className="pw">
                    <div className="pw-input">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        autoComplete="new-password"
                        spellCheck={false}
                        aria-label="Password"
                        aria-describedby="pw-hint"
                      />
                      <button type="button" className="btn quiet small" onClick={() => setShowPassword((s) => !s)}>
                        {showPassword ? 'Hide' : 'Show'}
                      </button>
                    </div>
                    <p id="pw-hint" className="field-foot">
                      {password.length > 0 && password.length < MIN_PASSWORD
                        ? `Use at least ${MIN_PASSWORD} characters. You have ${password.length}.`
                        : 'The link will not contain a key. Tell the recipient the password by a different route.'}
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}

              <button type="submit" className="btn primary wide" disabled={!canSubmit}>
                {phase === 'locking' ? 'Locking…' : 'Lock and create link'}
              </button>
              <p className="field-foot assure">Encrypted with AES-256-GCM in this browser before anything is sent.</p>
            </form>
          </section>
        )}

        {phase === 'sealing' && (
          <section className="sheet" aria-labelledby="sealing-title" aria-live="polite">
            <h2 id="sealing-title" className="sheet-title">
              Locking your secret
            </h2>
            <div className="paper paper-view tall">
              <RedactLines lines={ghost} mode="cover" />
            </div>
          </section>
        )}

        {phase === 'sealed' && sealed && <Result sealed={sealed} onReset={reset} />}
      </div>
    </Layout>
  );
}

function Result({ sealed, onReset }: { sealed: Sealed; onReset: () => void }) {
  const link = `${sealed.base}#${sealed.fragment}`;
  const short = (text: string, n = 26) => (text.length > n ? `${text.slice(0, n)}…` : text);

  return (
    <section className="sheet" aria-labelledby="result-title">
      <h2 id="result-title" className="sheet-title">
        Your link is ready
      </h2>
      <p className="lead-sm">
        Anyone with this link can open the secret {opensPhrase(sealed.views)}
        {sealed.usedPassword ? ', if they also know the password' : ''}. If nobody does, it is deleted after{' '}
        {expiryLong(sealed.ttl)}.
      </p>

      <div className="linkbox" data-testid="link">
        <code>
          <span className="lk-base">{sealed.base}</span>
          <span className="lk-hash">#{sealed.fragment}</span>
        </code>
      </div>
      <p className="field-foot">
        {sealed.usedPassword
          ? 'There is no key in this link. The password unlocks it, so send the password separately.'
          : 'The underlined part is the key. Your browser keeps it, and it is never sent to the server.'}
      </p>

      <div className="actions">
        <CopyButton text={link} label="Copy link" className="btn primary" />
        <button type="button" className="btn quiet" onClick={onReset}>
          Create another
        </button>
      </div>

      <div className="hood">
        <section aria-labelledby="hood-server">
          <h3 id="hood-server" className="hood-title server">
            Sent to the server
          </h3>
          <dl>
            <dt>Record</dt>
            <dd>secret:{sealed.id}</dd>
            <dt>Scrambled secret</dt>
            <dd>
              {short(sealed.ciphertext)} <span className="muted">({sealed.ciphertext.length} characters)</span>
            </dd>
            <dt>Random number (IV)</dt>
            <dd>{sealed.iv}</dd>
            {sealed.salt && (
              <>
                <dt>Password salt</dt>
                <dd>{sealed.salt}</dd>
              </>
            )}
            <dt>Allowed</dt>
            <dd>
              {sealed.views} {plural(sealed.views, 'open', 'opens')}, deleted after {expiryLong(sealed.ttl)}
            </dd>
          </dl>
        </section>
        <section aria-labelledby="hood-you">
          <h3 id="hood-you" className="hood-title you">
            Stays in your browser
          </h3>
          <dl>
            {sealed.usedPassword ? (
              <>
                <dt>Password</dt>
                <dd>Never uploaded. Only you and the recipient know it.</dd>
              </>
            ) : (
              <>
                <dt>Key</dt>
                <dd>Only in the link, after the #. The server cannot see it.</dd>
              </>
            )}
            <dt>Your original text</dt>
            <dd>Cleared from this page.</dd>
          </dl>
        </section>
      </div>

      <div className="verify">
        <p>To check it yourself, run this in Terminal. You will see only scrambled text.</p>
        <code className="cmd">redis-cli GET secret:{sealed.id}</code>
        <CopyButton text={`redis-cli GET secret:${sealed.id}`} label="Copy command" className="btn quiet small" />
      </div>
    </section>
  );
}
