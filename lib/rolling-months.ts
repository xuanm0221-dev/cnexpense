/**
 * 기준월을 맨 오른쪽(맨 끝)으로 하는 연속 달력 월 YYYY-MM 배열
 */

function addCalendarMonths(year: number, month: number, delta: number): { y: number; m: number } {
  const idx = year * 12 + (month - 1) + delta;
  const y = Math.floor(idx / 12);
  const m = idx - y * 12 + 1;
  return { y, m };
}

/**
 * @param endMonth 기준월 "YYYY-MM"
 * @param monthCount 포함할 월 개수(기준월 포함). 예: 13이면 기준월부터 역으로 13개월
 */
export function getRollingMonthsEnding(endMonth: string, monthCount: number): string[] {
  const parts = endMonth.split('-');
  if (parts.length !== 2) return [];
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    month < 1 ||
    month > 12 ||
    monthCount < 1
  ) {
    return [];
  }

  const start = addCalendarMonths(year, month, -(monthCount - 1));
  let cy = start.y;
  let cm = start.m;
  const out: string[] = [];
  for (let i = 0; i < monthCount; i++) {
    out.push(`${cy}-${String(cm).padStart(2, '0')}`);
    const next = addCalendarMonths(cy, cm, 1);
    cy = next.y;
    cm = next.m;
  }
  return out;
}

/**
 * 상세 막대 차트: 기준월을 맨 오른쪽으로 하는 달력 연속 개월 수.
 * 13 → 기준월 2026-02일 때 2025-02 ~ 2026-02(전년 동월~기준월, 막대 13개).
 */
export const DETAIL_CHART_ROLLING_MONTH_COUNT = 13;

export function getRolling12MonthsEnding(endMonth: string): string[] {
  return getRollingMonthsEnding(endMonth, 12);
}

export function getDetailChartRollingMonths(endMonth: string): string[] {
  return getRollingMonthsEnding(endMonth, DETAIL_CHART_ROLLING_MONTH_COUNT);
}
