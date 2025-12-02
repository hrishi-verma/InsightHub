import './globals.css'

export const metadata = {
  title: 'InsightHub',
  description: 'Real-Time Smart Log Monitoring System',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
