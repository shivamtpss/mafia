import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Mafia — Social Deduction',
  description:
    'A real-time multiplayer social deduction game. Trust no one. Find the Mafia.',
};

export const viewport: Viewport = {
  themeColor: '#05060d',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="app-bg" aria-hidden />
        {children}
      </body>
    </html>
  );
}
