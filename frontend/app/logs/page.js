import { redirect } from 'next/navigation';

// The legacy log pages used a hardcoded token against the old /api/logs API. Retired.
export default function LegacyPage() {
  redirect('/dashboard');
}
