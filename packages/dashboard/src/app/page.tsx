import Link from 'next/link';
import { competitorKpis, latestSnapshot, enrichmentStatus, recentNewAds } from '../lib/db';
import { AdCard } from '../components/AdCard';

export const dynamic = 'force-dynamic';

function badge(n: number, kind: 'new' | 'stopped' | 'neutral' = 'neutral') {
  const colors = {
    new: 'bg-emerald-100 text-emerald-800',
    stopped: 'bg-rose-100 text-rose-800',
    neutral: 'bg-slate-100 text-slate-700',
  };
  return <span className={`inline-flex min-w-[2.4rem] justify-center rounded px-2 py-0.5 text-xs font-medium ${colors[kind]}`}>{n}</span>;
}

export default function Home() {
  const kpis = competitorKpis();
  const googleSnap = latestSnapshot('google');
  const metaSnap = latestSnapshot('meta');
  const enrich = enrichmentStatus();
  const newest = recentNewAds(24, 18);
  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">키움증권 경쟁사 광고 모니터링</h1>
          <p className="mt-1 text-sm text-slate-600">Meta·Google 공개 광고 라이브러리 기반, 매일 10:00 / 15:00 KST 수집</p>
        </div>
        <div className="text-right text-xs text-slate-500">
          {googleSnap && (
            <div>Google 최근 수집: {new Date(googleSnap.run_at).toLocaleString('ko-KR')} · 활성 {googleSnap.ads_active}건</div>
          )}
          {metaSnap && (
            <div>Meta 최근 수집: {new Date(metaSnap.run_at).toLocaleString('ko-KR')} · 활성 {metaSnap.ads_active}건</div>
          )}
          <div className="mt-1">
            영상 썸네일 수집: <span className="font-semibold text-slate-700">{enrich.enriched.toLocaleString()}/{enrich.total.toLocaleString()}</span>
            <span className="ml-1 text-slate-400">({enrich.pct}%)</span>
          </div>
        </div>
      </header>

      {enrich.pct < 100 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
          <span className="font-semibold">영상 썸네일·재생 데이터 수집 진행 중</span>
          <span className="mx-2 text-amber-300">|</span>
          <span>{enrich.enriched.toLocaleString()}/{enrich.total.toLocaleString()} 완료 ({enrich.pct}%)</span>
          <span className="ml-2 text-amber-700">완료 전 카드는 회색 placeholder로 표시됩니다. 페이지 새로고침하면 추가됩니다.</span>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-amber-100">
            <div className="h-full rounded bg-amber-500 transition-all" style={{ width: `${enrich.pct}%` }} />
          </div>
        </div>
      )}

      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">경쟁사 KPI 매트릭스</h2>
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left">경쟁사</th>
                <th className="px-3 py-3 text-right">활성 광고</th>
                <th className="px-3 py-3 text-right">신규 (24h)</th>
                <th className="px-3 py-3 text-right">종료 (24h)</th>
                <th className="px-3 py-3 text-right">중간 운영일</th>
                <th className="px-3 py-3 text-right">VIDEO</th>
                <th className="px-3 py-3 text-right">IMAGE</th>
                <th className="px-3 py-3 text-right">TEXT</th>
                <th className="px-3 py-3 text-right">기타</th>
                <th className="px-3 py-3 text-right">고유 LP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {kpis.map((k) => (
                <tr key={k.competitor_key} className={k.is_client ? 'bg-kiwoom-50/60' : ''}>
                  <td className="px-4 py-3">
                    <Link href={`/competitor/${k.competitor_key}`} className="font-medium text-slate-900 hover:underline">
                      {k.name_kr}
                    </Link>
                    {k.is_client ? <span className="ml-2 rounded bg-kiwoom px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">client</span> : null}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold">{k.active_total.toLocaleString()}</td>
                  <td className="px-3 py-3 text-right">{badge(k.new_24h, k.new_24h ? 'new' : 'neutral')}</td>
                  <td className="px-3 py-3 text-right">{badge(k.stopped_24h, k.stopped_24h ? 'stopped' : 'neutral')}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.median_run_days ?? '-'}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.format_video || '-'}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.format_image || '-'}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.format_text || '-'}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.format_other || '-'}</td>
                  <td className="px-3 py-3 text-right text-slate-700">{k.unique_landing_pages || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">경쟁사 바로가기</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {kpis.map((k) => (
            <Link
              key={k.competitor_key}
              href={`/competitor/${k.competitor_key}`}
              className={`rounded-lg border border-slate-200 bg-white px-3 py-3 text-center shadow-sm transition hover:border-slate-400 ${k.is_client ? 'ring-1 ring-kiwoom/40' : ''}`}
            >
              <div className="text-sm font-semibold text-slate-900">{k.name_kr}</div>
              <div className="mt-1 text-xs text-slate-500">활성 {k.active_total.toLocaleString()}</div>
              {k.is_client ? <span className="mt-1 inline-block rounded bg-kiwoom px-1 py-0.5 text-[9px] font-semibold uppercase text-white">client</span> : null}
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-500">최근 신규 광고 (지난 24h, 전 경쟁사)</h2>
        {newest.length === 0 ? (
          <p className="text-sm text-slate-500">최근 24시간 내 신규 광고가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {newest.map((a) => (
              <div key={a.id}>
                <div className="mb-1 text-xs font-medium text-slate-600">{a.competitor_name_kr}</div>
                <AdCard ad={a} />
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
