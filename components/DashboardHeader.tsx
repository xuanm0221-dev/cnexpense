'use client';

/**
 * 대시보드 헤더 컴포넌트
 * - 제목
 * - 년/월 선택기
 * - 당월/YTD 전역 탭
 * - CSV 다운로드 버튼
 */

import MonthSelector from './MonthSelector';
import { ViewMode } from '@/lib/types';

interface DashboardHeaderProps {
  months: string[];
  selectedMonth: string;
  viewMode: ViewMode;
  onMonthChange: (month: string) => void;
  onViewModeChange: (mode: ViewMode) => void;
}

export default function DashboardHeader({
  months,
  selectedMonth,
  viewMode,
  onMonthChange,
  onViewModeChange,
}: DashboardHeaderProps) {
  return (
    <div className="bg-white border-b border-gray-200 px-2 py-4">
      <div className="max-w-[1920px] mx-auto">
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
        <div className="flex items-center gap-6 border-b border-gray-200">
          {/* 당월 / 누적(YTD) 탭 */}
          <button
            onClick={() => onViewModeChange('당월')}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              viewMode === '당월'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            당월
          </button>
          <button
            onClick={() => onViewModeChange('누적(YTD)')}
            className={`pb-3 px-2 text-sm font-medium border-b-2 transition-colors ${
              viewMode === '누적(YTD)'
                ? 'border-blue-500 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            누적(YTD)
          </button>
          
          {/* 월 선택 (누적 바로 옆) */}
          <div className="pb-3">
            <MonthSelector
              months={months}
              selectedMonth={selectedMonth}
              onChange={onMonthChange}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
