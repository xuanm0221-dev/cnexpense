'use client';

/**
 * 환율표 모달 — 연도별 [월말 | 월평균 | 기간평균], 1월말~12월말
 *
 * - 로컬 개발 환경에서만 입력·저장 가능 (배포에서는 읽기 전용, API도 403)
 * - 입력은 소수점 2자리까지
 * - 환산에 실제로 쓰이는 값: 당월=월평균, 누적(YTD)=기간평균 (월말은 참고용)
 */

import { useEffect, useMemo, useState } from 'react';
import {
  MONTH_KEYS,
  RATE_COLUMNS,
  normalizeYearRates,
  toRateValue,
  yearsForRateTable,
  type ExchangeRateData,
  type RateColumn,
  type YearRates,
} from '@/lib/exchange-rates';

interface ExchangeRateTableProps {
  open: boolean;
  onClose: () => void;
  data: ExchangeRateData | null;
  /** 저장 성공 시 상위 상태 갱신 */
  onSaved: (next: ExchangeRateData) => void;
  /** 현재 적용 중인 셀 강조 (예: "2026-02") */
  highlightMonth?: string;
  /** 당월/누적에 따라 강조할 컬럼 */
  highlightColumn?: RateColumn;
  /** 비용 데이터의 월 목록 — 표에 표시할 연도 결정 */
  months?: string[];
}

/** 편집 중에는 사용자가 친 문자열 그대로 보관 (blur·저장 시 소수점 2자리로 정규화) */
type DraftRates = Record<string, Record<string, Record<RateColumn, string>>>;

function toCellString(v: number | null | undefined): string {
  return v === null || v === undefined ? '' : v.toFixed(2);
}

function buildDraft(
  years: string[],
  rates: Record<string, YearRates> | undefined
): DraftRates {
  const draft: DraftRates = {};
  for (const y of years) {
    const yearRates = normalizeYearRates(rates?.[y]);
    draft[y] = {};
    for (const mm of MONTH_KEYS) {
      draft[y][mm] = {
        월말: toCellString(yearRates[mm].월말),
        월평균: toCellString(yearRates[mm].월평균),
        기간평균: toCellString(yearRates[mm].기간평균),
      };
    }
  }
  return draft;
}

export default function ExchangeRateTable({
  open,
  onClose,
  data,
  onSaved,
  highlightMonth,
  highlightColumn,
  months = [],
}: ExchangeRateTableProps) {
  const [draft, setDraft] = useState<DraftRates>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // 배포 환경에서는 입력 불가 (서버 API도 403)
  const editable = process.env.NODE_ENV !== 'production';

  const years = useMemo(() => yearsForRateTable(data, months), [data, months]);

  // 모달을 열 때마다 원본으로 초기화
  useEffect(() => {
    if (!open) return;
    setDraft(buildDraft(years, data?.rates));
    setDirty(false);
    setMessage(null);
  }, [open, data, years]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const setCell = (year: string, mm: string, col: RateColumn, value: string) => {
    setDraft(prev => ({
      ...prev,
      [year]: {
        ...prev[year],
        [mm]: { ...prev[year]?.[mm], [col]: value },
      },
    }));
    setDirty(true);
  };

  const handleChange = (year: string, mm: string, col: RateColumn, raw: string) => {
    // 숫자와 소수점만, 소수점 이하 2자리까지
    if (raw !== '' && !/^\d{0,6}(\.\d{0,2})?$/.test(raw)) return;
    setCell(year, mm, col, raw);
  };

  const handleBlur = (year: string, mm: string, col: RateColumn, raw: string) => {
    const v = toRateValue(raw);
    setCell(year, mm, col, v === null ? '' : v.toFixed(2));
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const rates: Record<string, YearRates> = {};
      for (const y of Object.keys(draft)) {
        const yearRates: YearRates = {};
        for (const mm of MONTH_KEYS) {
          const cell = draft[y]?.[mm];
          yearRates[mm] = {
            월말: toRateValue(cell?.월말),
            월평균: toRateValue(cell?.월평균),
            기간평균: toRateValue(cell?.기간평균),
          };
        }
        rates[y] = yearRates;
      }

      const res = await fetch('/api/exchange-rates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rates }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);

      onSaved({
        metadata: {
          unit: data?.metadata?.unit ?? 'KRW per 1 CNY',
          note: data?.metadata?.note,
          updatedAt: json.updatedAt,
        },
        rates,
      });
      setDirty(false);
      setMessage('저장했습니다 → data/masters/환율.json (커밋해야 배포에 반영됩니다)');
    } catch (e: any) {
      setMessage(`저장 실패: ${e.message}`);
    } finally {
      setSaving(false);
    }
  };

  const [hlYear, hlMonth] = (highlightMonth ?? '').split('-');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="환율표"
    >
      <div
        className="max-h-[88vh] w-full max-w-5xl overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">환율표 (CNY → KRW)</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              1 CNY 당 원화. 환산은 <b>당월 = 월평균</b>, <b>누적(YTD) = 기간평균</b> 을 사용합니다
              (월말은 참고용).
            </p>
            <p className="mt-1 text-xs font-medium text-amber-700">
              {editable
                ? '로컬 환경 — 값을 직접 입력하고 저장할 수 있습니다 (소수점 2자리).'
                : '배포 환경 — 읽기 전용입니다. 환율 수정은 로컬에서만 가능합니다.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="닫기"
          >
            ✕
          </button>
        </div>

        {/* 표 */}
        <div className="max-h-[60vh] overflow-auto px-5 py-4">
          <table className="w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr>
                <th className="sticky left-0 top-0 z-20 border border-slate-300 bg-white px-2 py-1.5" />
                {years.map(y => (
                  <th
                    key={y}
                    colSpan={3}
                    className="sticky top-0 z-10 border border-slate-300 bg-slate-100 px-2 py-1.5 text-center font-bold text-slate-800"
                  >
                    {y}년
                  </th>
                ))}
              </tr>
              <tr>
                <th className="sticky left-0 z-20 border border-slate-300 bg-white px-2 py-1.5" />
                {years.map(y =>
                  RATE_COLUMNS.map(col => (
                    <th
                      key={`${y}-${col}`}
                      className="border border-slate-300 bg-slate-50 px-2 py-1.5 text-center text-xs font-semibold text-slate-700"
                    >
                      {col}
                    </th>
                  ))
                )}
              </tr>
            </thead>
            <tbody>
              {MONTH_KEYS.map(mm => (
                <tr key={mm}>
                  <th className="sticky left-0 z-10 border border-slate-300 bg-white px-2 py-1 text-right text-xs font-semibold text-blue-700 whitespace-nowrap">
                    {parseInt(mm, 10)}월말
                  </th>
                  {years.map(y =>
                    RATE_COLUMNS.map(col => {
                      const value = draft[y]?.[mm]?.[col] ?? '';
                      const isApplied =
                        y === hlYear && mm === hlMonth && col === highlightColumn;
                      const emptyClass = value === '' ? 'text-slate-300' : 'text-emerald-700';
                      return (
                        <td
                          key={`${y}-${mm}-${col}`}
                          className={`border border-slate-300 p-0 ${
                            isApplied ? 'bg-blue-50 ring-2 ring-inset ring-blue-400' : ''
                          }`}
                          title={isApplied ? '현재 화면에 적용 중인 환율' : undefined}
                        >
                          {editable ? (
                            <input
                              type="text"
                              inputMode="decimal"
                              value={value}
                              onChange={e => handleChange(y, mm, col, e.target.value)}
                              onBlur={e => handleBlur(y, mm, col, e.target.value)}
                              placeholder="—"
                              aria-label={`${y}년 ${parseInt(mm, 10)}월 ${col}`}
                              className={`w-full min-w-[4.5rem] bg-transparent px-2 py-1 text-right outline-none focus:bg-blue-50/70 ${emptyClass}`}
                            />
                          ) : (
                            <span className={`block px-2 py-1 text-right ${emptyClass}`}>
                              {value === '' ? '—' : value}
                            </span>
                          )}
                        </td>
                      );
                    })
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 푸터 */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/70 px-5 py-3">
          <div className="text-xs text-slate-500">
            {message ??
              (data?.metadata?.updatedAt
                ? `최종 수정: ${new Date(data.metadata.updatedAt).toLocaleString('ko-KR')}`
                : '')}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              닫기
            </button>
            {editable && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!dirty || saving}
                className="rounded-lg bg-blue-600 px-3.5 py-1.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                {saving ? '저장 중…' : '저장'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
