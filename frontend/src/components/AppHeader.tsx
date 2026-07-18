'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AppHeaderProps {
  /** Optional trailing controls (e.g. user email + logout). */
  children?: React.ReactNode;
}

const NAV_LINKS = [
  { href: '/content', label: 'Content' },
  { href: '/settings', label: 'Settings' },
];

/**
 * Minimal top nav shared by the authenticated admin pages so the CMS screens
 * are reachable from each other.
 */
export function AppHeader({ children }: AppHeaderProps): JSX.Element {
  const pathname = usePathname();

  return (
    <header className="d-flex flex-wrap justify-content-between align-items-center border-bottom pb-2 mb-4">
      <nav className="d-flex align-items-center gap-3">
        <span className="fw-semibold">Content Hub</span>
        {NAV_LINKS.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`text-decoration-none ${isActive ? 'fw-semibold' : 'text-muted'}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      {children && <div className="d-flex align-items-center gap-3">{children}</div>}
    </header>
  );
}
