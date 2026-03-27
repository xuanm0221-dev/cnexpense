'use client';

/**
 * 년/월 선택 컴포넌트
 */

import { extractYears, extractMonthsForYear, formatYearMonth } from '@/utils/formatters';

interface MonthSelectorProps {
  months: string[];
  selectedMonth: string;
  onChange: (month: string) => void;
}

export default function MonthSelector({
  months,
  selectedMonth,
  onChange,
}: MonthSelectorProps) {
  const years = extractYears(months);
  const [currentYear, currentMonth] = selectedMonth.split('-');
  
  const availableMonths = extractMonthsForYear(months, currentYear);
  
  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = e.target.value;
    const monthsInYear = extractMonthsForYear(months, newYear);
    // 새 연도의 첫 번째 월로 설정
    const newMonth = monthsInYear[0] || '01';
    onChange(`${newYear}-${newMonth}`);
  };
  
  const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newMonth = e.target.value;
    onChange(`${currentYear}-${newMonth}`);
  };
  
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1.5 bg-white/95 rounded-xl border border-slate-300 px-3 py-2 shadow-sm shadow-slate-200/40">
        <svg
          className="w-5 h-5 text-slate-500"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
          />
        </svg>
        
        <select
          value={currentYear}
          onChange={handleYearChange}
          className="border-none bg-transparent text-sm font-semibold text-slate-800 focus:outline-none focus:ring-0"
        >
          {years.map(year => (
            <option key={year} value={year}>
              {year}년
            </option>
          ))}
        </select>
        
        <select
          value={currentMonth}
          onChange={handleMonthChange}
          className="border-none bg-transparent text-sm font-semibold text-slate-800 focus:outline-none focus:ring-0"
        >
          {availableMonths.map(month => (
            <option key={month} value={month}>
              {parseInt(month)}월
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
