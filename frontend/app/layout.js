'use client';

import './globals.css';
import { usePathname } from 'next/navigation';
import Navbar from '../components/Navbar';

export default function RootLayout({ children }) {
  const pathname = usePathname();
  const showNavbar = pathname !== '/login' && pathname !== '/';

  return (
    <html lang="en">
      <body className="bg-gray-900 text-white min-h-screen">
        {showNavbar && <Navbar />}
        <main className={showNavbar ? 'container mx-auto px-6 py-8' : ''}>
          {children}
        </main>
      </body>
    </html>
  );
}
