'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** `/commerce` has no content of its own — it redirects to the first tab. */
export default function CommerceIndexPage(): JSX.Element {
  const router = useRouter();
  useEffect(() => {
    router.replace('/commerce/products');
  }, [router]);
  return <p>Loading…</p>;
}
