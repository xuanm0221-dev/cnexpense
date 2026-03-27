/**
 * 대분류별 차트 색상 (내부 마스터 대분류 기준, 고정 매핑)
 */

const DEFAULT_PALETTE = [
  '#3b82f6',
  '#eab308',
  '#22c55e',
  '#a855f7',
  '#f97316',
  '#ec4899',
  '#14b8a6',
  '#6366f1',
  '#84cc16',
  '#f43f5e',
  '#64748b',
  '#0ea5e9',
  '#d946ef',
  '#78716c',
  '#059669',
];

/** DIRECT_COST_ORDER 등과 맞춘 고정 색 */
const NAMED_COLORS: Record<string, string> = {
  급여: '#2563eb',
  복리비: '#ca8a04',
  플랫폼수수료: '#16a34a',
  TP수수료: '#9333ea',
  광고비: '#ea580c',
  대리상지원금: '#db2777',
  수주회: '#0d9488',
  지급수수료: '#4f46e5',
  임차료: '#65a30d',
  물류비: '#e11d48',
  '진열/포장': '#475569',
  감가상각비: '#0284c7',
  세금과공과: '#c026d3',
  출장비: '#57534e',
  기타: '#94a3b8',
};

export function getCategoryChartColor(category: string, fallbackIndex: number): string {
  const named = NAMED_COLORS[category];
  if (named) return named;
  return DEFAULT_PALETTE[fallbackIndex % DEFAULT_PALETTE.length];
}

/** 상세 월별 트렌드 차트: 미매핑 스택 — 캡처형 연핑크·라벤더·회색·스카이·살몬·민트·은회색 */
export const DETAIL_STACK_PALETTE = [
  '#f5d4e0',
  '#e0d4f0',
  '#aeb6c2',
  '#b8daf2',
  '#f0c4b8',
  '#c0ead8',
  '#e2e8f0',
] as const;

export function getDetailStackColor(stackIndex: number): string {
  return DETAIL_STACK_PALETTE[stackIndex % DETAIL_STACK_PALETTE.length];
}

/** 상세 트렌드: 사용자 지정 고정색. 여기 없는 대분류는 getDetailTrendCategoryColor → DETAIL_STACK_PALETTE */
const DETAIL_TREND_NAMED: Record<string, string> = {
  급여: '#B9D9F5',
  복리비: '#8FA8C9',
  광고비: '#B8A8D9',
  수주회: '#97D6C3',
  지급수수료: '#EDC0DE',
  임차료: '#AECB7C',
  물류비: '#D7A5AE',
  감가상각비: '#8EB8DD',
  세금과공과: '#E7C86D',
  출장비: '#9E87C2',
  기타: '#A6907B',
};

/** 상세 트렌드 차트: 위 고정 매핑만 사용, 미포함 대분류는 DETAIL_STACK_PALETTE[fallbackIndex] */
const DETAIL_TREND_MERGED: Record<string, string> = {
  ...DETAIL_TREND_NAMED,
};

/**
 * 직접비/영업비 탭 전환 시에도 색은 대분류명만 본다. 비용구분별 팔레트 분기 없음.
 */
export function getDetailTrendCategoryColor(
  category: string,
  fallbackIndex: number
): string {
  const named = DETAIL_TREND_MERGED[category];
  if (named) return named;
  return DETAIL_STACK_PALETTE[fallbackIndex % DETAIL_STACK_PALETTE.length];
}
