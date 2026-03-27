'use client';

/**
 * 상세 비용분석 상단: ← 홈, 제목, 브랜드 탭, 기준월
 */

import Link from 'next/link';
import MonthSelector from '@/components/MonthSelector';
import { isCorporateBusinessUnitSlug } from '@/lib/corporate-cost-merge';

export type DetailBrandTab = {
  /** URL 세그먼트(인코딩 전 키) */
  routeKey: string;
  /** 탭에 보이는 라벨 */
  label: string;
  /** href 경로 (이미 인코딩된 path) */
  href: string;
};

export const DETAIL_BRAND_TABS: DetailBrandTab[] = [
  { routeKey: '법인', label: '법인', href: '/cost/법인' },
  { routeKey: 'MLB', label: 'MLB', href: '/cost/MLB' },
  {
    routeKey: 'MLB KIDS',
    label: 'KIDS',
    href: `/cost/${encodeURIComponent('MLB KIDS')}`,
  },
  { routeKey: 'Discovery', label: 'DISCOVERY', href: '/cost/Discovery' },
  { routeKey: '경영지원', label: '공통', href: '/cost/경영지원' },
];

function isTabActive(decodedParam: string, tab: DetailBrandTab): boolean {
  if (tab.routeKey === '법인') {
    return isCorporateBusinessUnitSlug(decodedParam);
  }
  return decodedParam === tab.routeKey;
}

function titleForTab(decodedParam: string): string {
  const tab = DETAIL_BRAND_TABS.find(t => isTabActive(decodedParam, t));
  return tab ? tab.label : decodedParam;
}

interface CostDetailHeaderProps {
  decodedBusinessUnitParam: string;
  months: string[];
  selectedMonth: string;
  onMonthChange: (month: string) => void;
}

export default function CostDetailHeader({
  decodedBusinessUnitParam,
  months,
  selectedMonth,
  onMonthChange,
}: CostDetailHeaderProps) {
  const titleText = `${titleForTab(decodedBusinessUnitParam)} 비용분석`;

  return (
    <header className="bg-gradient-to-b from-white to-slate-50/90 border-b border-slate-200/80">
      <div className="max-w-[min(100vw,2880px)] mx-auto px-4 py-3 sm:py-4">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
          <div className="flex flex-col gap-3 min-w-0 lg:flex-row lg:flex-wrap lg:items-center lg:gap-3">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <Link
                href="/"
                className="shrink-0 text-lg text-gray-700 hover:text-gray-900 px-1"
                aria-label="홈 대시보드로 이동"
              >
                ←
              </Link>
              <h1 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
                {titleText}
              </h1>
            </div>

            <nav
              className="flex flex-wrap items-center gap-2 rounded-full bg-white/90 px-1.5 py-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40"
              aria-label="브랜드 전환"
            >
              {DETAIL_BRAND_TABS.map(tab => {
                const active = isTabActive(decodedBusinessUnitParam, tab);
                return (
                  <Link
                    key={tab.routeKey}
                    href={tab.href}
                    className={`px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-semibold border transition-all ${
                      active
                        ? 'border-violet-400 bg-violet-50 text-violet-700 shadow-[0_6px_16px_rgba(139,92,246,0.14)]'
                        : 'border-transparent text-slate-700 bg-white/0 hover:bg-slate-50 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          {months.length > 0 && selectedMonth && (
            <div className="shrink-0 xl:ml-auto">
              <MonthSelector
                months={months}
                selectedMonth={selectedMonth}
                onChange={onMonthChange}
              />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
