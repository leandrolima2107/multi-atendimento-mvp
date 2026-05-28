import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import './globals.css';

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-display',
  weight: ['500', '600', '700'],
});

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-body',
  weight: ['400', '500', '600', '700', '800'],
});

const jetBrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-ui',
  weight: ['400', '500', '600', '700'],
});

export const metadata: Metadata = {
  title: 'Multi Atendimento',
  description: 'Central multi-tenant de atendimentos via WhatsApp',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html className={`${spaceGrotesk.variable} ${inter.variable} ${jetBrainsMono.variable}`} lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
