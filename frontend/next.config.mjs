/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Pre-production security review, finding M-2: this app had zero response
  // security headers. Admin-only, single-user system — the header trio below
  // (clickjacking, MIME-sniffing, referrer leakage) is cheap and has no
  // downside; HSTS is included but without `preload` since that submission
  // is a one-way door this repo hasn't opted into. A full CSP is a larger,
  // separate effort for an App Router site (inline scripts/hydration) —
  // deliberately not attempted here, tracked as a fast-follow.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
