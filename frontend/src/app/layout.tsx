import type { JSX } from 'react';

import type { Metadata } from 'next';
import 'bootstrap/dist/css/bootstrap.min.css';

export const metadata: Metadata = {
  title: 'Content Hub',
  description: 'Content Hub admin — Phase 1 (auth + connected accounts)',
};

export default function RootLayout({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <html lang="en">
      <body>
        <div className="container py-4">{children}</div>
      </body>
    </html>
  );
}
