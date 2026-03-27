'use client';

import type { CorporateKpiColumn, CorporateKpiMetrics } from '@/lib/detail-corporate-kpi';
import { toThousandCNY } from '@/utils/formatters';

function toMillionCNY(amount: number): string {
  const m = amount / 1_000_000;
  return (
    m.toLocaleString('en-US', {
      maximumFractionDigits: 0,
      minimumFractionDigits: 0,
    }) + 'M'
  );
}

function CostCell({ col }: { col: CorporateKpiColumn }) {
  const main = toThousandCNY(col.cost);
  const prev = toThousandCNY(col.costPrev);
  const indexPct =
    col.costYoYIndexPct != null ? (
      <span className="font-semibold text-slate-600">
        {' '}
        ({Math.round(col.costYoYIndexPct)}%)
      </span>
    ) : null;
  return (
    <div className="space-y-1 min-w-0">
      <div className="font-semibold tabular-nums text-slate-900 leading-tight text-[16.5px] tracking-[-0.01em]">
        {main}
        {indexPct}
      </div>
      <div className="text-[13.5px] leading-tight text-slate-500 tabular-nums">전년 {prev}</div>
    </div>
  );
}

function RateCell({ col }: { col: CorporateKpiColumn }) {
  if (col.rate == null || col.ratePrev == null) {
    return <span className="text-zinc-400 text-[16.5px]">—</span>;
  }
  const main = `${col.rate.toFixed(1)}%`;
  const prev = `${col.ratePrev.toFixed(1)}%`;
  const pp =
    col.rateYoYpp != null ? (
      <span className="font-semibold text-slate-600">
        {' '}
        ({col.rateYoYpp >= 0 ? '+' : ''}
        {col.rateYoYpp.toFixed(1)}%p)
      </span>
    ) : null;
  return (
    <div className="space-y-1 min-w-0">
      <div className="font-semibold tabular-nums text-slate-900 leading-tight text-[16.5px] tracking-[-0.01em]">
        {main}
        {pp}
      </div>
      <div className="text-[13.5px] leading-tight text-slate-500 tabular-nums">전년 {prev}</div>
    </div>
  );
}

function SalesCell({ col }: { col: CorporateKpiColumn }) {
  if (col.sales == null || col.salesPrev == null) {
    return <span className="text-zinc-400 text-[16.5px]">—</span>;
  }
  const main = toMillionCNY(col.sales);
  const prev = toMillionCNY(col.salesPrev);
  const indexPct =
    col.salesYoYIndexPct != null ? (
      <span className="font-semibold text-slate-600">
        {' '}
        ({Math.round(col.salesYoYIndexPct)}%)
      </span>
    ) : null;
  return (
    <div className="space-y-1 min-w-0">
      <div className="font-semibold tabular-nums text-slate-900 leading-tight text-[16.5px] tracking-[-0.01em]">
        {main}
        {indexPct}
      </div>
      <div className="text-[13.5px] leading-tight text-slate-500 tabular-nums">전년 {prev}</div>
    </div>
  );
}

function LoadingCell() {
  return (
    <div className="space-y-1.5 py-0.5">
      <div className="h-[15px] w-[84px] rounded bg-zinc-200/80 animate-pulse" />
      <div className="h-[9px] w-36 rounded bg-zinc-100 animate-pulse" />
    </div>
  );
}

type Props = {
  metrics: CorporateKpiMetrics;
  retailLoading: boolean;
  /** 예: 법인 KPI, MLB KPI */
  title?: string;
  /** 차트와 동일: 비용·매출대비 산출 기준(판매매출 행은 탭과 무관) */
  activeCostSide?: '직접비' | '영업비';
  /** 접근성용 전체 설명 (미주입 시 title 기반 기본 문구) */
  ariaLabel?: string;
};

export default function CorporateDetailKpiCard({
  metrics,
  retailLoading,
  title = '법인 KPI',
  activeCostSide,
  ariaLabel,
}: Props) {
  const sectionAria =
    ariaLabel ??
    `${title}: 비용·매출대비는 ${activeCostSide ?? '차트 탭'} 기준, 판매매출은 기존 리테일 규칙(탭과 무관)`;
  const renderCell = (row: 'cost' | 'rate' | 'sales', col: CorporateKpiColumn) => {
    if (retailLoading && (row === 'sales' || row === 'rate')) {
      return <LoadingCell />;
    }
    if (row === 'cost') return <CostCell col={col} />;
    if (row === 'rate') return <RateCell col={col} />;
    return <SalesCell col={col} />;
  };

  const rowTone = {
    cost: {
      label: 'bg-rose-50 text-rose-700',
      month: 'bg-rose-50/70',
      ytd: 'bg-rose-100/55',
    },
    rate: {
      label: 'bg-sky-50 text-sky-700',
      month: 'bg-sky-50/70',
      ytd: 'bg-sky-100/55',
    },
    sales: {
      label: 'bg-emerald-50 text-emerald-700',
      month: 'bg-emerald-50/70',
      ytd: 'bg-emerald-100/55',
    },
  } as const;

  return (
    <section
      className="mb-5 w-full lg:w-[24%] lg:max-w-none max-w-[17.28rem]"
      aria-label={sectionAria}
    >
      <div className="rounded-2xl border border-slate-200/85 bg-gradient-to-b from-white to-slate-50/70 shadow-[0_14px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/70 overflow-hidden">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3.5 py-2.5 border-b border-slate-200/80 bg-gradient-to-r from-slate-50 via-white to-slate-50/80">
          <span
            className="h-2 w-2 rounded-full bg-slate-400 shrink-0 shadow-[0_0_0_4px_rgba(148,163,184,0.10)]"
            aria-hidden
          />
          <h2 className="text-[16.5px] font-semibold tracking-[-0.01em] text-slate-800">
            {title}
          </h2>
          {activeCostSide && (
            <span className="text-[11px] font-semibold text-slate-500 bg-slate-100/90 px-2 py-0.5 rounded-md">
              비용·비용률: {activeCostSide}
            </span>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left table-fixed">
            <colgroup>
              <col className="w-[22%]" />
              <col className="w-[39%]" />
              <col className="w-[39%]" />
            </colgroup>
            <thead>
              <tr className="border-b border-slate-200/80 bg-white/60">
                <th className="px-2.5 py-2 text-[13.5px] font-semibold tracking-[0.02em] text-slate-500">
                  내용
                </th>
                <th className="px-2.5 py-2 text-[13.5px] font-semibold tracking-[0.02em] text-slate-500">
                  당년
                </th>
                <th className="px-2.5 py-2 text-[13.5px] font-semibold tracking-[0.02em] text-slate-500">
                  YTD
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-slate-100/90">
                <td className="px-2.5 py-2 align-top">
                  <span className={`inline-flex rounded-md px-2 py-1 text-[15px] font-semibold ${rowTone.cost.label}`}>
                    비용
                  </span>
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.cost.month}`}>
                  {renderCell('cost', metrics.month)}
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.cost.ytd}`}>
                  {renderCell('cost', metrics.ytd)}
                </td>
              </tr>
              <tr className="border-b border-slate-100/90">
                <td className="px-2.5 py-2 align-top">
                  <span className={`inline-flex rounded-md px-2 py-1 text-[15px] font-semibold ${rowTone.rate.label}`}>
                    매출대비
                  </span>
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.rate.month}`}>
                  {renderCell('rate', metrics.month)}
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.rate.ytd}`}>
                  {renderCell('rate', metrics.ytd)}
                </td>
              </tr>
              <tr>
                <td className="px-2.5 py-2 align-top">
                  <span className={`inline-flex rounded-md px-2 py-1 text-[15px] font-semibold ${rowTone.sales.label}`}>
                    판매매출
                  </span>
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.sales.month}`}>
                  {renderCell('sales', metrics.month)}
                </td>
                <td className={`px-2.5 py-2 align-top ${rowTone.sales.ytd}`}>
                  {renderCell('sales', metrics.ytd)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
