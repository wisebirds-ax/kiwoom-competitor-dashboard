import Link from 'next/link';
import { listAds, listCompetitors } from '../../../lib/db';
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
        <p>알 수 없는 경쟁사: {key}</p>
        <Link href="/" className="text-blue-600 hover:underline">← 홈으로</Link>
      </main>
    );
  }
  const ads = listAds({
    competitor: key,
    channel: channel || undefined,
    status: (status as any) || 'active',
    limit: 600,
  });

  return (
    <main className="mx-auto max-w-7xl px-6 py-8">
      <header className="mb-6">
        <Link href="/" className="text-sm text-slate-500 hover:underline">← 전체 보기</Link>
        <h1 className="mt-2 text-2xl font-bold">{competitor.name_kr}</h1>
        <p className="text-sm text-slate-600">{ads.length}건 표시 중 (status: {status ?? 'active'}, channel: {channel ?? 'all'})</p>
      </header>

      <nav className="mb-6 flex flex-wrap gap-2 text-sm">
        <FilterLink k={key} param="channel" value="" current={channel}>채널 전체</FilterLink>
        <FilterLink k={key} param="channel" value="google" current={channel}>Google</FilterLink>
        <FilterLink k={key} param="channel" value="meta" current={channel}>Meta</FilterLink>
        <span className="mx-2 self-center text-slate-300">|</span>
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

function FilterLink({ k, param, value, current, children }: { k: string; param: string; value: string; current: string | undefined; children: React.ReactNode }) {
  const active = (value === '' && !current) || current === value;
  const href = `/competitor/${k}${value ? `?${param}=${value}` : ''}`;
  return (
    <Link
      href={href}
      className={`rounded-full border px-3 py-1 text-xs ${active ? 'border-slate-800 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400'}`}
    >
      {children}
    </Link>
  );
}
