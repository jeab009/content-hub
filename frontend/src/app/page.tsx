import { redirect } from 'next/navigation';

/**
 * Phase 1 has no public landing page — everything funnels through login.
 * The settings page itself redirects back to /login if the session check
 * fails, so this is a safe default entry point.
 */
export default function HomePage(): never {
  redirect('/login');
}
