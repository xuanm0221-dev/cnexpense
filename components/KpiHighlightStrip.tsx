'use client';

/**
 * 홈 우측 상단 KPI 3종 (비용 / 매출대비 / 판매매출) — 가로 배치.
 * 상세 페이지 CorporateDetailKpiCard 와 같은 지표를, 헤더 조회 기간(당월·누적·분기) 한 열만 보여준다.
 */

import type { CorporateKpiColumn, CorporateKpiMetrics } from '@/lib/detail-corporate-kpi';
import type { Currency } from '@/lib/exchange-rates';
import type { ViewMode } from '@/lib/types';
import { formatAmount } from '@/utils/formatters';

/** 매출은 금액이 커서 위안도 백만 단위로 표기 (상세 KPI 카드와 동일) */
function toMillionCNY(amount: number): string {
  return (
    (amount / 1_000_000).toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }) + 'M'
  );
}

type Tone = 'cost' | 'rate' | 'sales';

const TONE: Record<Tone, { chip: string; card: string; accent: string }> = {
  cost: {
    chip: 'bg-rose-50 text-rose-700',
    card: 'from-rose-50/70 to-white border-rose-100',
    accent: 'bg-rose-400',
  },
  rate: {
    chip: 'bg-sky-50 text-sky-700',
    card: 'from-sky-50/70 to-white border-sky-100',
    accent: 'bg-sky-400',
  },
  sales: {
    chip: 'bg-emerald-50 text-emerald-700',
    card: 'from-emerald-50/70 to-white border-emerald-100',
    accent: 'bg-emerald-400',
  },
};

function LoadingTile() {
  return (
    <div className="space-y-2 py-1">
      <div className="h-5 w-24 rounded bg-zinc-200/80 animate-pulse" />
      <div className="h-3 w-32 rounded bg-zinc-100 animate-pulse" />
    </div>
  );
}

function Tile({
  tone,
  label,
  main,
  sub,
  loading,
}: {
  tone: Tone;
  label: string;
  main: string;
  sub: React.ReactNode;
  loading: boolean;
}) {
  const t = TONE[tone];
  return (
    <div
      className={`relative flex-1 min-w-0 rounded-2xl border bg-gradient-to-b ${t.card} px-3.5 py-3 shadow-[0_10px_26px_rgba(15,23,42,0.07)] overflow-hidden`}
    >
      <span className={`absolute inset-x-0 top-0 h-[3px] ${t.accent}`} aria-hidden />
      <div className="flex items-center gap-2 mb-1.5">
        <span className={`inline-flex rounded-md px-2 py-0.5 text-[12px] font-semibold ${t.chip}`}>
          {label}
        </span>
      </div>
      {loading ? (
        <LoadingTile />
      ) : (
        <>
          <div className="text-[22px] font-bold tabular-nums leading-none tracking-[-0.02em] text-slate-900">
            {main}
          </div>
          <div className="mt-1.5 text-[11.5px] leading-tight text-slate-500 tabular-nums">
            {sub}
          </div>
        </>
      )}
    </div>
  );
}

/** 전년=100 지수 — 100 이상 빨강(증가), 미만 파랑 */
function indexTag(index: number | null) {
  if (index === null) return null;
  return (
    <span className={`ml-1 font-semibold ${index >= 100 ? 'text-rose-600' : 'text-sky-700'}`}>
      ({Math.round(index)}%)
    </span>
  );
}

type Props = {
  metrics: CorporateKpiMetrics;
  /** 헤더 조회 기간 — 어떤 열을 보여줄지 결정 */
  viewMode: ViewMode;
  retailLoading: boolean;
  currency: Currency;
  title: string;
  /** 비용·매출대비 산출 기준 (판매매출은 탭과 무관) */
  activeCostSide?: '직접비' | '영업비';
};

export default function KpiHighlightStrip({
  metrics,
  viewMode,
  retailLoading,
  currency,
  title,
  activeCostSide,
}: Props) {
  /** 누적(YTD)이면 YTD 열, 그 외(당월·분기)는 선택 기간 열 */
  const col: CorporateKpiColumn = viewMode === '누적(YTD)' ? metrics.ytd : metrics.month;

  const salesMain =
    col.sales == null
      ? '—'
      : currency === 'CNY'
        ? toMillionCNY(col.sales)
        : formatAmount(col.sales, currency);
  const salesPrev =
    col.salesPrev == null
      ? '—'
      : currency === 'CNY'
        ? toMillionCNY(col.salesPrev)
        : formatAmount(col.salesPrev, currency);

  return (
    <section aria-label={`${title} (${viewMode})`} className="w-full min-w-0">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <h2 className="text-sm font-semibold tracking-tight text-slate-700">{title}</h2>
        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-800 text-white">
          {viewMode}
        </span>
        {activeCostSide && (
          <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
            비용·비용률: {activeCostSide}
          </span>
        )}
      </div>
      <div className="flex flex-col sm:flex-row gap-3">
        <Tile
          tone="cost"
          label="비용"
          loading={false}
          main={formatAmount(col.cost, currency)}
          sub={
            <>
              전년 {formatAmount(col.costPrev, currency)}
              {indexTag(col.costYoYIndexPct)}
            </>
          }
        />
        <Tile
          tone="rate"
          label="매출대비"
          loading={retailLoading}
          main={col.rate == null ? '—' : `${col.rate.toFixed(1)}%`}
          sub={
            col.ratePrev == null ? (
              '전년 —'
            ) : (
              <>
                전년 {col.ratePrev.toFixed(1)}%
                {col.rateYoYpp != null && (
                  <span
                    className={`ml-1 font-semibold ${
                      col.rateYoYpp >= 0 ? 'text-rose-600' : 'text-sky-700'
                    }`}
                  >
                    ({col.rateYoYpp >= 0 ? '+' : ''}
                    {col.rateYoYpp.toFixed(1)}%p)
                  </span>
                )}
              </>
            )
          }
        />
        <Tile
          tone="sales"
          label="판매매출"
          loading={retailLoading}
          main={salesMain}
          sub={
            <>
              전년 {salesPrev}
              {indexTag(col.salesYoYIndexPct)}
            </>
          }
        />
      </div>
    </section>
  );
}
