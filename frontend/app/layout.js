import './globals.css';
import { connection } from 'next/server';
import AppShell from '../components/AppShell.js';

export const metadata = {
  title: 'InsightHub',
  description: 'Error tracking dashboard',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }) {
  // Render every page per request: the CSP nonce from proxy.js only exists at request time.
  await connection();
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-900 text-gray-100">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
