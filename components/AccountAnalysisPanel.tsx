'use client';

/**
 * 계정별 분석 — 카드 우측. 계정 순서는 카드(대분류 표)와 동일.
 *
 * 한 계정당
 *   ① 환율효과 (원화일 때만) — 제외 시 전년비 / CNY 기준 증감률
 *   ② 구성별 증감 — 기표 적요를 키워드로 묶은 구성 (抖音·Douyin·틱톡 → 틱톡 하나로)
 *   ③ 브랜드별 증감 — 코스트센터 기준. 급여·인건비·광고비·수주회·출장비만 (법인 선택 시)
 */

import type { AccountAnalysisRow, AnalysisDelta } from '@/lib/account-analysis';
import type { Currency } from '@/lib/exchange-rates';
import { formatAmount, currencyUnitLabel } from '@/utils/formatters';

/** 증감액 — 부호 포함, 감소는 △ */
function signed(value: number, currency: Currency): string {
  const text = formatAmount(Math.abs(value), currency);
  if (Math.round(currency === 'CNY' ? value / 1000 : value / 1_000_000) === 0) {
    return `±${text}`;
  }
  return value > 0 ? `+${text}` : `△${text}`;
}

function toneOf(value: number): string {
  return value > 0 ? 'text-rose-600' : value < 0 ? 'text-sky-700' : 'text-slate-500';
}

/** 상위 N개 + 나머지 묶음. limit 0이면 전부 표시 */
function topDeltas(items: AnalysisDelta[], limit: number): AnalysisDelta[] {
  if (limit <= 0 || items.length <= limit) return items;
  const head = items.slice(0, limit);
  const restDelta = items.slice(limit).reduce((s, i) => s + i.delta, 0);
  const restCurr = items.slice(limit).reduce((s, i) => s + i.curr, 0);
  if (Math.abs(restDelta) < 1) return head;
  return [...head, { label: '그 외', delta: restDelta, curr: restCurr, index: null }];
}

function DeltaList({
  items,
  currency,
  limit,
}: {
  items: AnalysisDelta[];
  currency: Currency;
  limit: number;
}) {
  const shown = topDeltas(items, limit);
  if (shown.length === 0) return <span className="text-slate-400">—</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
      {shown.map((item, i) => (
        <span key={`${item.label}-${i}`} className="whitespace-nowrap">
          <span className="text-slate-600">{item.label}</span>{' '}
          <span className={`tabular-nums font-semibold ${toneOf(item.delta)}`}>
            {signed(item.delta, currency)}
          </span>
          {item.index !== null && (
            <span className="text-slate-400 tabular-nums"> {item.index}%</span>
          )}
        </span>
      ))}
    </span>
  );
}

/** 줄 앞 태그 — ①②③ 대신 무엇을 보는 줄인지 바로 알 수 있게 */
function RowTag({ children }: { children: React.ReactNode }) {
  return (
    <span className="shrink-0 inline-block w-[3.1rem] mr-1.5 text-[10px] font-semibold text-slate-500 bg-slate-100 rounded px-1 py-0.5 text-center align-top">
      {children}
    </span>
  );
}

function AccountBlock({ row, currency }: { row: AccountAnalysisRow; currency: Currency }) {
  const up = row.index !== null && row.index >= 100;

  return (
    <li className="px-3.5 py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="font-semibold text-slate-800 text-[12.5px]">{row.category}</span>
          <span className="text-[11px] tabular-nums text-slate-500">
            {formatAmount(row.curr, currency)}
            <span className="text-slate-400"> / 전년 {formatAmount(row.prev, currency)}</span>
          </span>
        </div>
        <span
          className={`shrink-0 tabular-nums font-bold text-[13px] ${
            row.index === null ? 'text-slate-400' : up ? 'text-rose-600' : 'text-sky-700'
          }`}
        >
          {row.index !== null ? `${row.index}%` : '—'}
        </span>
      </div>

      <div className="space-y-1 text-[11px] leading-relaxed">
        {row.fx && (
          <p className="flex items-start rounded bg-amber-50/70 px-1.5 py-1">
            <RowTag>환율효과</RowTag>
            <span className="min-w-0">
              <span className={`tabular-nums font-semibold ${toneOf(row.fx.effect)}`}>
                {signed(row.fx.effect, currency)}
              </span>{' '}
              제외 시 전년비{' '}
              <span className={`tabular-nums font-semibold ${toneOf(row.fx.volume)}`}>
                {signed(row.fx.volume, currency)}
              </span>
              <span className="text-slate-500">
                {' '}
                (CNY {row.fx.cnyPct === null ? '—' : `${row.fx.cnyPct > 0 ? '+' : ''}${row.fx.cnyPct.toFixed(1)}%`})
              </span>
            </span>
          </p>
        )}
        <p className="flex items-start">
          <RowTag>구성</RowTag>
          <span className="min-w-0">
            <DeltaList items={row.buckets} currency={currency} limit={0} />
            {row.headcount && (row.headcount.office !== null || row.headcount.store !== null) && (
              <span className="text-slate-500">
                {' '}
                · 평균인원 {row.headcount.office !== null && `사무실 ${row.headcount.office >= 0 ? '+' : ''}${Math.round(row.headcount.office)}명`}
                {row.headcount.office !== null && row.headcount.store !== null && ', '}
                {row.headcount.store !== null && `매장 ${row.headcount.store >= 0 ? '+' : ''}${Math.round(row.headcount.store)}명`}
              </span>
            )}
          </span>
        </p>
        {row.brands.length > 0 && (
          <p className="flex items-start">
            <RowTag>브랜드</RowTag>
            <span className="min-w-0">
              <DeltaList items={row.brands} currency={currency} limit={0} />
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

export interface AccountAnalysisPanelProps {
  rows: AccountAnalysisRow[];
  unitName: string;
  currency: Currency;
  periodLabel: string;
  /** 원화면 환율효과 기준 안내 */
  fxNote?: string | null;
}

export default function AccountAnalysisPanel({
  rows,
  unitName,
  currency,
  periodLabel,
  fxNote,
}: AccountAnalysisPanelProps) {
  return (
    <section
      className="w-full lg:flex-1 min-w-0 rounded-2xl border border-slate-200/80 bg-white shadow-[0_16px_40px_rgba(15,23,42,0.08)] overflow-hidden flex flex-col"
      aria-label={`${unitName} 계정별 분석`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-slate-800 text-white">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <h2 className="text-sm sm:text-base font-semibold tracking-tight">계정별 분석</h2>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/20">
            {unitName}
          </span>
          <span className="text-[11px] px-2 py-0.5 rounded-full bg-white/10 ring-1 ring-white/20">
            {periodLabel} · 전년비
          </span>
        </div>
        <span className="text-[11px] px-2 py-0.5 rounded-md bg-slate-700/70 ring-1 ring-white/10">
          단위 {currencyUnitLabel(currency)}
        </span>
      </div>

      {fxNote && (
        <p className="px-4 py-1.5 text-[11px] text-slate-500 bg-amber-50/60 border-b border-amber-100">
          {fxNote}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
          분석할 계정 데이터가 없습니다.
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {rows.map(row => (
            <AccountBlock key={row.category} row={row} currency={currency} />
          ))}
        </ul>
      )}
    </section>
  );
}
