import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '키움증권 경쟁사 광고 모니터링',
  description: 'Competitor ad creative dashboard for 키움증권',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
