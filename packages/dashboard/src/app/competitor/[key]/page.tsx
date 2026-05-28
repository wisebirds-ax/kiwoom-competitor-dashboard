import Link from 'next/link';
import { listAds, listCompetitors, competitorKpis } from '../../../lib/db';
import { AdCard } from '../../../components/AdCard';

export const dynamic = 'force-dynamic';

type Params = { key: string };

export default async function CompetitorPage({ params, searchParams }: {
  params: Promise<Params>;
  searchParams: Promise<{ channel?: string; status?: string }>;
}) {
  const { key } = await params;
  const { channel, status } = await searchParams;
  const competitor = listCompetitors().find((c) => c.key === key);
  if (!competitor) {
    return (
      <main className="mx-auto max-w-6xl px-6 py-8">
        <p className="text-slate-400">알 수 없는 경쟁사: {key}</p>
        <Link href="/" className="text-violet-400 hover:underline">← 홈으로</Link>
      </main>
    );
  }

  const ads = listAds({
    competitor: key,
    channel: channel || undefined,
    status: (status as 'active' | 'stopped' | 'all') || 'active',
    limit: 600,
  });

  const kpi = competitorKpis().find((k) => k.competitor_key === key);

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <Link href="/" className="text-xs text-slate-500 hover:text-violet-400 transition">← 전체 보기</Link>
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">{competitor.name_kr}</h1>
            <p className="mt-0.5 text-xs text-slate-500">{ads.length}건 표시 · {status ?? 'active'} · {channel ?? '전채널'}</p>
          </div>
          {kpi && (
            <div className="flex gap-3 pb-0.5">
              <Chip label="활성" value={kpi.active_total} color="text-violet-300" />
              <Chip label="신규 24h" value={`+${kpi.new_24h}`} color="text-emerald-400" />
              <Chip label="종료 24h" value={`-${kpi.stopped_24h}`} color="text-rose-400" />
            </div>
          )}
        </div>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2">
        <FilterLink k={key} param="channel" value="" current={channel}>채널 전체</FilterLink>
        <FilterLink k={key} param="channel" value="google" current={channel}>Google</FilterLink>
        <FilterLink k={key} param="channel" value="meta" current={channel}>Meta</FilterLink>
        <span className="mx-1 self-center text-slate-700">|</span>
        <FilterLink k={key} param="status" value="active" current={status ?? 'active'}>활성</FilterLink>
        <FilterLink k={key} param="status" value="stopped" current={status}>종료</FilterLink>
        <FilterLink k={key} param="status" value="all" current={status}>전체</FilterLink>
      </nav>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ads.map((a) => (
          <AdCard key={a.id} ad={a} />
        ))}
      </div>
    </main>
  );
}

function Chip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return (
    <div className="rounded-lg border border-slate-700/50 bg-slate-800/60 px-3 py-1.5 text-center">
      <div className="text-[10px] text-slate-500">{label}</div>
      <div className={`text-sm font-bold ${color}`}>{value}</div>
    </div>
  );
}

function FilterLink({ k, param, value, current, children }: { k: string; param: string; value: string; current: string | undefined; children: React.ReactNode }) {
  const active = (value === '' && !current) || current === value;
  const href = `/competitor/${k}${value ? `?${param}=${value}` : ''}`;
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs transition ${active
        ? 'border-violet-500 bg-violet-600/20 text-violet-300'
        : 'border-slate-700 bg-slate-800/60 text-slate-400 hover:border-slate-500 hover:text-slate-200'}`}
    >
      {children}
    </Link>
  );
}
