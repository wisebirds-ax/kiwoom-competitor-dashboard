import Link from 'next/link';
import { competitorKpis, latestSnapshot, recentNewAds } from '../lib/db';
import { AdCard } from '../components/AdCard';

export const dynamic = 'force-dynamic';

function KpiCard({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-800/60 px-5 py-4">
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p className={`mt-1.5 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-slate-500">{sub}</p>}
    </div>
  );
}

export default function Home() {
  const kpis = competitorKpis();
  const googleSnap = latestSnapshot('google');
  const metaSnap = latestSnapshot('meta');
  const newest = recentNewAds(24, 18);

  const totalActive = kpis.reduce((s, k) => s + k.active_total, 0);
  const totalNew24h = kpis.reduce((s, k) => s + k.new_24h, 0);
  const totalStopped24h = kpis.reduce((s, k) => s + k.stopped_24h, 0);
  const competitors = kpis.filter((k) => !k.is_client);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      {/* Page header */}
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-white">경쟁사 광고 모니터링</h1>
        <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-400">
          {googleSnap && <span>Google 최근 수집: {new Date(googleSnap.run_at).toLocaleString('ko-KR')}</span>}
          {metaSnap && <span>· Meta 최근 수집: {new Date(metaSnap.run_at).toLocaleString('ko-KR')}</span>}
        </div>
      </header>

      {/* KPI summary cards */}
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiCard label="활성 광고 (전체)" value={totalActive.toLocaleString()} color="text-violet-300" />
        <KpiCard label="신규 광고 (24h)" value={totalNew24h} color="text-emerald-400" />
        <KpiCard label="종료 광고 (24h)" value={totalStopped24h} color="text-rose-400" />
        <KpiCard label="모니터링 경쟁사" value={competitors.length} sub="+ 키움증권 기준" color="text-sky-300" />
      </section>

      {/* Competitor matrix table */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">경쟁사 KPI 매트릭스</h2>
        <div className="overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/60">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-slate-500">경쟁사</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">활성</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">신규 24h</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">종료 24h</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">VIDEO</th>
                <th className="px-3 py-3 text-right text-xs font-medium uppercase tracking-wider text-slate-500">IMAGE</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/40">
              {kpis.map((k) => (
                <tr key={k.competitor_key} className={`transition hover:bg-slate-700/30 ${k.is_client ? 'bg-violet-900/10' : ''}`}>
                  <td className="px-4 py-3">
                    <Link href={`/competitor/${k.competitor_key}`} className="flex items-center gap-2 font-medium text-slate-100 hover:text-violet-300 transition">
                      {k.name_kr}
                      {k.is_client ? <span className="rounded bg-violet-600/40 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">client</span> : null}
                    </Link>
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-bold text-white">{k.active_total.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">
                    {k.new_24h > 0
                      ? <span className="rounded bg-emerald-900/50 px-2 py-0.5 text-xs font-semibold text-emerald-400">+{k.new_24h}</span>
                      : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {k.stopped_24h > 0
                      ? <span className="rounded bg-rose-900/50 px-2 py-0.5 text-xs font-semibold text-rose-400">-{k.stopped_24h}</span>
                      : <span className="text-slate-600">-</span>}
                  </td>
                  <td className="px-3 py-3 text-right text-slate-300">{k.format_video || <span className="text-slate-600">-</span>}</td>
                  <td className="px-3 py-3 text-right text-slate-300">{k.format_image || <span className="text-slate-600">-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Quick links */}
      <section className="mb-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">경쟁사 바로가기</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {kpis.map((k) => (
            <Link
              key={k.competitor_key}
              href={`/competitor/${k.competitor_key}`}
              className={`group rounded-xl border border-slate-700/50 bg-slate-800/60 px-3 py-3 text-center transition hover:border-violet-500/60 hover:bg-slate-700/60 ${k.is_client ? 'border-violet-600/40 bg-violet-900/10' : ''}`}
            >
              <div className="text-sm font-semibold text-slate-100 group-hover:text-violet-300 transition">{k.name_kr}</div>
              <div className="mt-1 text-xs text-slate-500">활성 {k.active_total.toLocaleString()}</div>
              {k.is_client ? <span className="mt-1 inline-block rounded bg-violet-600/30 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">client</span> : null}
            </Link>
          ))}
        </div>
      </section>

      {/* Recent new ads */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">최근 신규 광고 (지난 24h · 전 경쟁사)</h2>
        {newest.length === 0 ? (
          <p className="text-sm text-slate-500">최근 24시간 내 신규 광고가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {newest.map((a) => (
              <div key={a.id}>
                <div className="mb-1.5 text-xs font-medium text-slate-400">{a.competitor_name_kr}</div>
                <AdCard ad={a} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
