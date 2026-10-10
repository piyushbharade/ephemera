import Head from 'next/head';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Mark } from './Mark';

export function Layout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Head>
        <title>{title}</title>
      </Head>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="masthead">
        <Link href="/" className="wordmark" aria-label="Ephemera, home">
          <Mark />
          <span>Ephemera</span>
        </Link>
        <p className="masthead-note">Zero-knowledge secret vault</p>
      </header>
      <main id="main" className="stage">
        {children}
      </main>
      <footer className="foot">
        <p>No accounts, no tracking and no third-party requests. The server never receives your key.</p>
      </footer>
    </>
  );
}
