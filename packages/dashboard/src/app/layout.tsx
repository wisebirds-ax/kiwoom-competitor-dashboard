import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: '키움증권 경쟁사 광고 모니터링',
  description: 'Competitor ad creative dashboard for 키움증권',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">
        <nav className="border-b border-slate-700/60 bg-slate-900/80 backdrop-blur-sm sticky top-0 z-40">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-3">
            <div className="flex items-center gap-3">
              <span className="text-sm font-bold tracking-tight text-white">Wisebirds</span>
              <span className="rounded bg-violet-600/30 px-2 py-0.5 text-[11px] font-semibold text-violet-300">경쟁사 모니터링</span>
            </div>
            <span className="text-xs text-slate-400">Meta · Google 광고 라이브러리 기반</span>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
