import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gather • Virtual Tabletop',
  description: 'A shared table for every kind of adventure.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
