'use client';

/**
 * 대시보드 헤더 컴포넌트
 * - 제목
 * - 년/월 선택기
 * - 당월/YTD 전역 탭
 * - 전처리 명령 복사 버튼
 */

import { useState } from 'react';
import MonthSelector from './MonthSelector';
import { ViewMode } from '@/lib/types';

const PREPROCESS_CMD_INCREMENTAL = 'python scripts/preprocess.py';
const PREPROCESS_CMD_FULL = 'python scripts/preprocess.py --full';

interface DashboardHeaderProps {
  months: string[];
  selectedMonth: string;
  viewMode: ViewMode;
  onMonthChange: (month: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
  showOtherBU: boolean;
  onToggleOtherBU: () => void;
}

export default function DashboardHeader({
  months,
  selectedMonth,
  viewMode,
  onMonthChange,
  onViewModeChange,
  showOtherBU,
  onToggleOtherBU,
}: DashboardHeaderProps) {
  const [copied, setCopied] = useState<string | null>(null);

  const copyPreprocessCmd = async (cmd: string, label: string) => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    } catch (err) {
      console.error('복사 실패:', err);
    }
  };

  return (
    <div className="bg-gradient-to-b from-white to-slate-50/90 border-b border-slate-200/80 px-2 py-4">
      <div className="max-w-[min(100vw,2400px)] mx-auto">
        {/* 제목 (가운데 정렬) */}
        <div className="flex items-center justify-center mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <svg
                className="w-6 h-6 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
            </div>
            <h1 className="text-5xl font-bold text-gray-900">
              F&F CHINA 비용 대시보드
            </h1>
          </div>
        </div>
        
        {/* 탭과 월 선택 */}
        <div className="flex items-center gap-5 border-b border-slate-200/80">
          {/* 당월 / 누적(YTD) 탭 */}
          <div className="pb-3">
            <div className="inline-flex items-center rounded-xl bg-slate-100/90 p-1 ring-1 ring-slate-200/80 shadow-sm shadow-slate-200/40">
              <button
                onClick={() => onViewModeChange('당월')}
                className={`px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === '당월'
                    ? 'bg-white text-blue-600 shadow-sm shadow-slate-200/60'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                당월
              </button>
              <button
                onClick={() => onViewModeChange('누적(YTD)')}
                className={`px-3.5 py-1.5 text-sm font-semibold rounded-lg transition-all ${
                  viewMode === '누적(YTD)'
                    ? 'bg-white text-blue-600 shadow-sm shadow-slate-200/60'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                누적(YTD)
              </button>
            </div>
          </div>
          
          {/* 월 선택 (누적 바로 옆) */}
          <div className="pb-3">
            <MonthSelector
              months={months}
              selectedMonth={selectedMonth}
              onChange={onMonthChange}
            />
          </div>

          <div className="pb-3">
            <button
              type="button"
              onClick={onToggleOtherBU}
              className="px-4 py-2 bg-white/95 border border-slate-300 rounded-xl hover:bg-slate-50 transition-all text-sm font-semibold text-slate-700 shadow-sm shadow-slate-200/40"
            >
              {showOtherBU ? '기타 사업부 숨기기 ▲' : '기타 사업부 보기 ▼'}
            </button>
          </div>
          
          {/* 전처리 명령 버튼 (우측 정렬) */}
          <div className="pb-3 ml-auto flex items-center gap-2">
            <span className="text-xs text-gray-400 mr-2">전처리:</span>
            <button
              onClick={() => copyPreprocessCmd(PREPROCESS_CMD_INCREMENTAL, '증분')}
              title={PREPROCESS_CMD_INCREMENTAL}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            >
              {copied === '증분' ? '복사됨 ✓' : '증분'}
            </button>
            <button
              onClick={() => copyPreprocessCmd(PREPROCESS_CMD_FULL, '전체')}
              title={PREPROCESS_CMD_FULL}
              className="px-3 py-1.5 text-xs font-medium rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 transition-colors"
            >
              {copied === '전체' ? '복사됨 ✓' : '전체'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
