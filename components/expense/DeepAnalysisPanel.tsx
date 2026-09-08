'use client';

/**
 * 심층분석 패널 — 우측 패널의 `심층분석` 탭 본문.
 *
 * 3개 화면을 서브탭으로 묶는다.
 *   AI보고서 · 비용구조 보고서 · 광고비 효율분석
 *
 * 광고비 효율분석만 클라이언트 메모리 집계(setExpenseData)를 쓰고, 나머지 셋은 각자 API 를
 * 호출한다. 그래서 집계 로딩은 해당 탭을 열 때만 한다 (첫 진입에 불필요한 Snowflake 질의 방지).
 */

import { useEffect, useState } from 'react';
import { Bot, FileText, LineChart } from 'lucide-react';
import AiReport from './AiReport';
import type { PlanBasis } from '@/lib/ai-report-builder';
import CostStructureReport from './CostStructureReport';
import { AdSalesEfficiencyAnalysis } from './AdSalesEfficiencyAnalysis';
import { hasExpenseData, setExpenseData } from '@/lib/expense-dash';
import type { CostType, ViewMode } from '@/lib/types';

const TABS = [
  { key: 'ai', label: 'AI보고서', Icon: Bot },
  { key: 'structure', label: '비용구조 보고서', Icon: FileText },
  { key: 'ad', label: '광고비 효율분석', Icon: LineChart },
] as const;

type TabKey = (typeof TABS)[number]['key'];

/** 광고비 효율분석 — 집계 데이터를 받아온 뒤 렌더 */
function AdEfficiencyTab({ unit, year, costType }: { unit: string; year: number; costType: CostType }) {
  const [ready, setReady] = useState(hasExpenseData());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setReady(false);
    setError(null);
    fetch(`/api/expense-aggregated?costType=${encodeURIComponent(costType)}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else {
          setExpenseData(j);
          setReady(true);
        }
      })
      .catch(e => alive && setError(e?.message ?? '집계 데이터를 불러오지 못했습니다.'));
    return () => {
      alive = false;
    };
  }, [costType]);

  if (error) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-rose-600">
        {error}
      </div>
    );
  }
  if (!ready) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
        집계 데이터를 불러오는 중입니다…
      </div>
    );
  }
  return (
    <div className="flex-1 overflow-y-auto p-4">
      <AdSalesEfficiencyAnalysis bizUnit={unit} year={year} />
    </div>
  );
}

export interface DeepAnalysisPanelProps {
  /** 선택된 사업부 (법인 또는 개별 사업부 id) */
  unit: string;
  /** 기준 월 "2026-06" */
  month: string;
  /** 카드와 같은 직접비/영업비 탭 */
  costType: CostType;
  /** 당월/누적 — AI보고서 집계 모드에 쓴다 */
  viewMode: ViewMode;
  /** 연간계획 기준 — 좌측 카드 전환탭을 따라간다 */
  planBasis?: PlanBasis;
}

export default function DeepAnalysisPanel({
  unit,
  month,
  costType,
  viewMode,
  planBasis = 'base',
}: DeepAnalysisPanelProps) {
  const [tab, setTab] = useState<TabKey>('ai');

  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const monthNum = Number(monthStr);

  if (!Number.isInteger(year) || !Number.isInteger(monthNum)) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
        기준 월을 선택해주세요.
      </div>
    );
  }

  // 누적(YTD) 계열 뷰는 YTD, 그 외는 당월 기준으로 본다
  const reportMode = viewMode === '누적(YTD)' ? 'ytd' : 'monthly';

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 py-2 border-b border-slate-200 bg-slate-50 overflow-x-auto">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[11.5px] font-semibold whitespace-nowrap transition-colors ${
              tab === key
                ? 'bg-slate-800 text-white'
                : 'text-slate-600 hover:bg-slate-200/70'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
        {/*
          사업부는 탭 줄 오른쪽 끝에만 표시한다. 광고비 효율분석은 선택 사업부 기준이라
          어느 사업부를 보고 있는지가 필요한데, 이것 때문에 줄을 하나 더 두진 않는다.
        */}
        <span className="ml-auto shrink-0 text-[11px] font-semibold text-slate-500 pl-2">
          {unit}
        </span>
      </div>

      {tab === 'ai' && (
        <AiReport
          year={year}
          month={monthNum}
          mode={reportMode}
          costType={costType}
          planBasis={planBasis}
        />
      )}
      {tab === 'structure' && (
        <CostStructureReport year={year} month={monthNum} costType={costType} />
      )}
      {tab === 'ad' && <AdEfficiencyTab unit={unit} year={year} costType={costType} />}
    </div>
  );
}
