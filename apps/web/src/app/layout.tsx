import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Multi Atendimento',
  description: 'Inbox CRM multi-tenant para atendimento via WhatsApp',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
