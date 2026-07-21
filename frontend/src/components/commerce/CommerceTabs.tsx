'use client';

import Link from 'next/link';

export type CommerceTab = 'products' | 'placements' | 'conversions';

const TABS: { key: CommerceTab; href: string; label: string }[] = [
  { key: 'products', href: '/commerce/products', label: 'Products' },
  { key: 'placements', href: '/commerce/placements', label: 'Placements' },
  { key: 'conversions', href: '/commerce/conversions', label: 'Conversions' },
];

/**
 * `/commerce` is a tabbed shell (design §4) rather than three top-level nav
 * items — the main nav is already six items wide. Each tab is a real route
 * (`/commerce/products`, etc.), so the tab bar is just navigation, not a
 * view-state switch — reload, back/forward and deep links all work.
 */
export function CommerceTabs({ active }: { active: CommerceTab }): JSX.Element {
  return (
    <div className="d-flex gap-1 mb-4" role="tablist" aria-label="Commerce sections">
      {TABS.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          role="tab"
          aria-selected={tab.key === active}
          className={`btn btn-sm ${tab.key === active ? 'btn-primary' : 'btn-outline-secondary'}`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
