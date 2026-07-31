'use client';

/**
 * 홈·상세 공용 조회 컨트롤
 * - 기간 탭 (당월 / 누적(YTD) / 1~4분기)
 * - 관리식 / 재무식
 * - CNY / KRW + 환율표 (재무식일 때만)
 * - 전년금액 표시 토글 (재무식일 때만)
 */

import { CostBasis, ViewMode } from '@/lib/types';
import type { Currency } from '@/lib/exchange-rates';
import {
  VIEW_MODES,
  isQuarterView,
  quarterMonthNumbers,
  quarterNumber,
} from '@/lib/period';

const pillGroupClass =
  'inline-flex items-center rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40';

const pillClass = (active: boolean, disabled = false) =>
  `px-3 py-1.5 text-sm font-semibold rounded-lg transition-all ${
    active
      ? 'bg-white text-blue-600 shadow-sm shadow-slate-200/60'
      : disabled
        ? 'text-slate-300 cursor-not-allowed'
        : 'text-slate-500 hover:text-slate-700'
  }`;

export interface ViewControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  /** 비용 데이터가 없어 선택할 수 없는 기간 */
  disabledViewModes?: ViewMode[];
  costBasis: CostBasis;
  onCostBasisChange: (basis: CostBasis) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
  onOpenRateTable: () => void;
  /** 현재 적용 중인 환율 (없으면 미입력) */
  appliedRate: number | null;
  /** '월평균' | '기간평균' */
  appliedRateLabel: string;
  /** 전년금액 컬럼 토글 (없으면 버튼 숨김) */
  showPrevYearAmount?: boolean;
  onTogglePrevYearAmount?: () => void;
}

export default function ViewControls({
  viewMode,
  onViewModeChange,
  disabledViewModes,
  costBasis,
  onCostBasisChange,
  currency,
  onCurrencyChange,
  onOpenRateTable,
  appliedRate,
  appliedRateLabel,
  showPrevYearAmount,
  onTogglePrevYearAmount,
}: ViewControlsProps) {
  const isFinancial = costBasis === '재무식';

  return (
    <>
      {/* 기간 탭 */}
      <div className={pillGroupClass} role="group" aria-label="조회 기간">
        {VIEW_MODES.map(mode => {
          const disabled = disabledViewModes?.includes(mode) ?? false;
          return (
            <button
              key={mode}
              type="button"
              onClick={() => !disabled && onViewModeChange(mode)}
              disabled={disabled}
              title={
                disabled
                  ? '해당 기간의 비용 데이터가 없습니다'
                  : mode === '누적(YTD)'
                    ? '1월~선택월 누적'
                    : isQuarterView(mode)
                      ? `${quarterMonthNumbers(quarterNumber(mode)).join('·')}월 (누적 차감)`
                      : undefined
              }
              className={pillClass(viewMode === mode, disabled)}
            >
              {mode}
            </button>
          );
        })}
      </div>

      {/* 관리식 / 재무식 */}
      <div className={pillGroupClass} role="group" aria-label="집계 기준 전환">
        <button
          type="button"
          onClick={() => onCostBasisChange('관리식')}
          aria-pressed={costBasis === '관리식'}
          title="대분류 × 직접비/영업비 기준"
          className={pillClass(costBasis === '관리식')}
        >
          관리식
        </button>
        <button
          type="button"
          onClick={() => onCostBasisChange('재무식')}
          aria-pressed={isFinancial}
          title="연결계정과목 기준 (직접비/영업비 구분 없음)"
          className={pillClass(isFinancial)}
        >
          재무식
        </button>
      </div>

      {/* 통화 + 환율표 + 전년금액 (재무식 전용) */}
      {isFinancial && (
        <>
          <div className={pillGroupClass} role="group" aria-label="통화 전환">
            <button
              type="button"
              onClick={() => onCurrencyChange('CNY')}
              aria-pressed={currency === 'CNY'}
              title="위안 (천위안 K 표시)"
              className={pillClass(currency === 'CNY')}
            >
              CNY
            </button>
            <button
              type="button"
              onClick={() => onCurrencyChange('KRW')}
              aria-pressed={currency === 'KRW'}
              title="원화 (백만원 M 표시) — 평균환율 환산"
              className={pillClass(currency === 'KRW')}
            >
              KRW
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenRateTable}
            title="환율표 보기 / 입력"
            className="px-3 py-2 bg-white/95 border border-slate-300 rounded-xl hover:bg-slate-50 transition-all text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/40"
          >
            환율표
          </button>

          {onTogglePrevYearAmount && (
            <button
              type="button"
              onClick={onTogglePrevYearAmount}
              aria-pressed={showPrevYearAmount}
              title="표에 전년 동기간 금액 컬럼 표시"
              className={`px-3 py-2 rounded-xl border transition-all text-sm font-semibold shadow-sm shadow-slate-200/40 ${
                showPrevYearAmount
                  ? 'bg-blue-50 border-blue-300 text-blue-700'
                  : 'bg-white/95 border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              {showPrevYearAmount ? '전년금액 숨기기 ▲' : '전년금액 보기 ▼'}
            </button>
          )}

          {currency === 'KRW' && (
            <span
              className={`text-xs ${
                appliedRate === null ? 'text-red-500 font-medium' : 'text-slate-500'
              }`}
            >
              {appliedRate === null
                ? `${appliedRateLabel} 환율 미입력`
                : `${appliedRateLabel} ${appliedRate.toFixed(2)} 원/위안`}
            </span>
          )}
        </>
      )}
    </>
  );
}
