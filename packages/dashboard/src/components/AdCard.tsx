'use client';

import { useState } from 'react';
import type { Ad } from '../lib/db';

export function AdCard({ ad }: { ad: Ad }) {
  const [open, setOpen] = useState(false);
  const videoSources = (() => {
    if (!ad.video_urls) return null;
    try { return JSON.parse(ad.video_urls) as Array<{ kind: string; id?: string; url?: string; poster?: string; embed?: string }>; }
    catch { return null; }
  })();
  const ytId = videoSources?.find((v) => v.kind === 'youtube')?.id ?? null;
  const fbVideo = videoSources?.find((v) => v.kind === 'fbcdn_mp4') ?? null;

  const imageLightbox = (() => {
    if (ytId || fbVideo) return null;
    if (ad.channel !== 'meta') return null;
    if (ad.format && ad.format !== 'image') return null;
    if (!ad.thumbnail_url) return null;
    return ad.thumbnail_url;
  })();

  const clickable = !!(ytId || fbVideo || imageLightbox);

  return (
    <>
      <article className="overflow-hidden rounded-xl border border-slate-700/50 bg-slate-800/60 shadow-sm transition hover:border-slate-600">
        <button
          type="button"
          onClick={() => clickable && setOpen(true)}
          disabled={!clickable}
          className="relative block aspect-video w-full overflow-hidden bg-slate-700/50 disabled:cursor-default"
        >
          {ad.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={ad.thumbnail_url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-[11px] uppercase tracking-wider text-slate-600">
              {ad.format ?? 'no preview'}
            </div>
          )}
          <span className={`absolute left-2 top-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white ${ad.channel === 'google' ? 'bg-blue-600/90' : 'bg-indigo-600/90'}`}>
            {ad.channel}
          </span>
          {ad.status === 'stopped' && (
            <span className="absolute right-2 top-2 rounded bg-rose-600/90 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">종료</span>
          )}
          {clickable && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/0 transition hover:bg-black/40">
              <span className="opacity-0 transition group-hover:opacity-100">
                {ytId && (
                  <svg className="h-10 w-10 text-white drop-shadow-md" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                )}
              </span>
            </div>
          )}
        </button>
        <div className="p-3 text-sm">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="capitalize">{ad.format ?? '-'}</span>
            <span>
              {ad.ad_started_at ? new Date(ad.ad_started_at).toLocaleDateString('ko-KR') : '-'}
              {' → '}
              {ad.ad_last_shown_at ? new Date(ad.ad_last_shown_at).toLocaleDateString('ko-KR') : '-'}
            </span>
          </div>
          {ad.copy_text && <p className="mt-2 line-clamp-2 text-xs text-slate-300">{ad.copy_text}</p>}
          {ad.landing_url && (
            <a href={ad.landing_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[11px] text-violet-400 hover:text-violet-300 hover:underline">
              {ad.landing_url}
            </a>
          )}
          <div className="mt-2 flex items-center justify-between text-[11px] text-slate-600">
            {ad.ad_agency ? <span className="truncate">{ad.ad_agency}</span> : <span />}
            {ad.detail_url && (
              <a href={ad.detail_url} target="_blank" rel="noreferrer" className="shrink-0 hover:text-slate-400 transition">원본 →</a>
            )}
          </div>
        </div>
      </article>

      {open && clickable && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
          onClick={() => setOpen(false)}
        >
          <div className="relative w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="absolute -top-10 right-0 rounded bg-white/10 px-3 py-1 text-sm text-white hover:bg-white/20 transition"
            >
              닫기
            </button>
            {ytId ? (
              <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
                <iframe
                  src={`https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                  className="h-full w-full"
                  title="ad preview"
                />
              </div>
            ) : fbVideo?.url ? (
              <div className="overflow-hidden rounded-xl bg-black">
                <video
                  src={fbVideo.url}
                  poster={fbVideo.poster ?? undefined}
                  controls autoPlay playsInline
                  className="max-h-[80vh] w-full"
                />
                {ad.copy_text && (
                  <div className="border-t border-white/10 bg-black/60 p-4 text-sm text-white">
                    <p className="whitespace-pre-line">{ad.copy_text}</p>
                  </div>
                )}
              </div>
            ) : imageLightbox ? (
              <div className="overflow-hidden rounded-xl bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={imageLightbox} alt="" className="max-h-[80vh] w-full object-contain" />
              </div>
            ) : null}
            <div className="mt-3 flex items-center justify-between text-xs text-white/70">
              <div>
                <span className="font-semibold text-white">{ad.competitor_name_kr}</span>
                {ad.ad_agency && <span className="ml-3 text-white/50">{ad.ad_agency}</span>}
                {ad.landing_url && (
                  <a href={ad.landing_url} target="_blank" rel="noreferrer" className="ml-3 text-violet-400 hover:text-violet-300">랜딩페이지 →</a>
                )}
              </div>
              {ad.detail_url && (
                <a href={ad.detail_url} target="_blank" rel="noreferrer" className="hover:text-white transition">
                  {ad.channel === 'meta' ? 'Meta' : 'Google'} 원본 →
                </a>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
