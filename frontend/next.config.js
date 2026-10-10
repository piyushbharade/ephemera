/** @type {import('next').NextConfig} */

// Where the FastAPI backend runs. 127.0.0.1 (not "localhost") avoids an IPv6
// lookup problem on macOS where Node tries ::1 but the backend listens on IPv4.
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';

const isProd = process.env.NODE_ENV === 'production';

// Strict Content-Security-Policy: only our own scripts, styles and fonts, and
// the page may only talk to its own server. (Applied in production builds;
// Next.js development mode needs extra permissions that this policy blocks.)
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // The browser talks to one address; Next.js forwards /api/* to FastAPI.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${BACKEND_URL}/api/:path*` }];
  },

  async headers() {
    return [
      {
        // Every page: never leak the link (and the key in it) through the Referer header.
        source: '/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          ...(isProd ? [{ key: 'Content-Security-Policy', value: csp }] : []),
        ],
      },
      {
        // Secret pages and API calls: never store them in the browser cache or history.
        source: '/s/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store' }],
      },
    ];
  },
};

module.exports = nextConfig;
