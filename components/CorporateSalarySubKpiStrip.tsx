'use client';

import type { SalarySubKpiCardModel } from '@/lib/salary-sub-kpi';
import type { CostSideDetail } from '@/lib/corporate-headcount';
import { toThousandCNY } from '@/utils/formatters';

const NAVY = '#0f2747';

function yoyTone(idx: number | 'N/A'): string {
  if (idx === 'N/A') return 'text-slate-400';
  return idx >= 100 ? 'text-red-600' : 'text-blue-600';
}

function SalarySubKpiCard({
  model,
  costLabel,
}: {
  model: SalarySubKpiCardModel;
  costLabel: string;
}) {
  const prevK = toThousandCNY(model.heroPrevAmountCny);
  const currK = toThousandCNY(model.heroAmountCny);
  const heroIdx = model.heroYoyIndexPct;

  const empty = model.rows.length === 0 && model.heroAmountCny === 0;

  const summaryLine = !empty && (
    <p className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-sm sm:text-[15px] leading-snug text-slate-900">
      <span className="font-bold tracking-[-0.02em]">{model.title}</span>
      <span className="text-[10px] sm:text-[11px] font-bold uppercase tracking-wide text-sky-800 bg-sky-100/90 px-1.5 py-0.5 rounded">
        YTD
      </span>
      <span className="font-bold tabular-nums">{currK}</span>
      <span className="text-slate-600 tabular-nums font-medium">
        (전년 동기 {prevK}
        {heroIdx != null && (
          <>
            {', '}
            <span
              className={
                heroIdx >= 100 ? 'text-red-600 font-semibold' : 'text-blue-600 font-semibold'
              }
            >
              {heroIdx}%
            </span>
          </>
        )}
        )
      </span>
    </p>
  );

  return (
    <article
      className="flex min-w-0 rounded-xl bg-white shadow-[4px_6px_20px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/75 overflow-hidden"
      aria-label={`${model.title} 급여 중분류 KPI, YTD ${currK}, 전년 동기 YTD ${prevK}, 지수% ${heroIdx != null ? `${heroIdx}%` : '없음'}, ${costLabel}`}
    >
      <div
        className="w-[5px] shrink-0 self-stretch min-h-[5rem] rounded-full my-3 ml-2.5"
        style={{ backgroundColor: NAVY }}
        aria-hidden
      />
      <div className="flex-1 min-w-0 px-3 py-3 sm:px-4 sm:py-3.5">
        {empty ? (
          <p className="text-xs text-slate-500">
            <span className="font-semibold text-slate-700">{model.title}</span>
            {' · '}
            급여 중분류 데이터가 없습니다.
          </p>
        ) : (
          <>
            <div className="mb-2.5">{summaryLine}</div>

            <div className="overflow-x-auto -mx-0.5">
              <table className="w-full min-w-[520px] text-left text-[10px] sm:text-[11px] border-collapse">
                <thead>
                  <tr className="text-slate-500 font-semibold border-b border-slate-200/90">
                    <th className="py-1.5 pr-2 font-semibold w-[4.5rem]">하위급여</th>
                    <th className="py-1.5 pl-2 pr-1 text-right font-semibold border-l border-slate-200/90">
                      당월 금액
                    </th>
                    <th className="py-1.5 px-1 text-right font-semibold">당월 인당</th>
                    <th className="py-1.5 px-1 text-right font-semibold bg-sky-50/90 text-sky-800/90">
                      당월 YOY
                    </th>
                    <th className="py-1.5 pl-2 pr-1 text-right font-semibold border-l border-slate-200/90">
                      YTD 금액
                    </th>
                    <th className="py-1.5 px-1 text-right font-semibold">YTD 인당</th>
                    <th className="py-1.5 pl-1 text-right font-semibold bg-sky-50/90 text-sky-800/90">
                      YTD YOY
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {model.rows.map(row => (
                    <tr
                      key={row.label}
                      className="border-b border-slate-100/95 last:border-0 text-slate-800"
                    >
                      <td className="py-1.5 pr-2 font-medium text-slate-700 whitespace-nowrap">
                        {row.label}
                      </td>
                      <td className="py-1.5 pl-2 pr-1 text-right tabular-nums font-medium border-l border-slate-200/90">
                        {row.month.amountKFormatted}
                      </td>
                      <td className="py-1.5 px-1 text-right tabular-nums">
                        {row.month.perPersonLabel}
                      </td>
                      <td
                        className={`py-1.5 px-1 text-right tabular-nums bg-sky-50/80 ${
                          row.month.yoyIndexPct === 'N/A'
                            ? 'font-normal'
                            : `font-semibold ${yoyTone(row.month.yoyIndexPct)}`
                        }`}
                      >
                        {row.month.yoyIndexPct === 'N/A' ? '\u00A0' : `${row.month.yoyIndexPct}%`}
                      </td>
                      <td className="py-1.5 pl-2 pr-1 text-right tabular-nums font-medium border-l border-slate-200/90">
                        {row.ytd.amountKFormatted}
                      </td>
                      <td className="py-1.5 px-1 text-right tabular-nums">
                        {row.ytd.perPersonLabel}
                      </td>
                      <td
                        className={`py-1.5 pl-1 text-right tabular-nums bg-sky-50/80 ${
                          row.ytd.yoyIndexPct === 'N/A'
                            ? 'font-normal'
                            : `font-semibold ${yoyTone(row.ytd.yoyIndexPct)}`
                        }`}
                      >
                        {row.ytd.yoyIndexPct === 'N/A' ? '\u00A0' : `${row.ytd.yoyIndexPct}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </article>
  );
}

type Props = {
  cards: SalarySubKpiCardModel[];
  costType: CostSideDetail;
};

export default function CorporateSalarySubKpiStrip({ cards, costType }: Props) {
  const costLabel = costType === '직접비' ? '직접비' : '영업비';

  return (
    <section
      className="mb-5"
      aria-label={`법인 급여 중분류 KPI (${costLabel})`}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {cards.map(card => (
          <SalarySubKpiCard key={card.title} model={card} costLabel={costLabel} />
        ))}
      </div>
    </section>
  );
}
