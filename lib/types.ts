/**
 * 비용 데이터 타입 정의
 */

// 월별 금액 (위안 단위)
export interface MonthlyAmounts {
  [month: string]: number; // "2024-01": 12345678
}

// 대분류별 카테고리 데이터
export interface CategoryData {
  [category: string]: MonthlyAmounts; // "급여": { "2024-01": 12345678 }
}

// 사업부별 데이터 (직접비/영업비)
export interface BusinessUnitCosts {
  직접비: CategoryData;
  영업비: CategoryData;
}

// 전체 비용 데이터
export interface BusinessUnitData {
  [businessUnit: string]: BusinessUnitCosts; // "MLB": { 직접비: {...}, 영업비: {...} }
}

// 최상위 데이터 구조
export interface CostData {
  metadata: {
    generatedAt: string;
    months: string[];
    businessUnits: string[];
  };
  data: BusinessUnitData;
}

// 인원수 데이터 구조
export interface HeadcountData {
  [businessUnit: string]: MonthlyAmounts; // "MLB": { "2024-01": 127, "2024-02": 124, ... }
}

// 매장 인원수 데이터 구조 (사무실 인원수와 동일한 구조)
export type StoreHeadcountData = HeadcountData;

// 리테일 매출 데이터 구조
export interface RetailSalesData {
  [businessUnit: string]: MonthlyAmounts; // "MLB": { "2024-01": 12345678, ... }
}

// YoY 계산 결과
export interface YoYResult {
  pct: number | 'N/A';    // 증감률 (%)
  deltaK: number | 'N/A'; // 증감액 (K)
}

// 대분류별 표시 데이터
export interface CategoryDisplayData {
  category: string;
  amount: number;      // 금액 (위안)
  amountK: string;     // 금액 (K 단위, 포맷팅)
  ratio: number;       // 구성비 (%)
  yoy: YoYResult;      // YoY 정보
}

// 뷰 모드
export type ViewMode = '당월' | '누적(YTD)';

// 비용 구분
export type CostType = '전체' | '직접비' | '영업비';

// 사업부 정보
export interface BusinessUnit {
  id: string;
  name: string;
  color: string;
}

// 사업부 설정
export const BUSINESS_UNITS: BusinessUnit[] = [
  { id: 'MLB', name: 'MLB', color: 'blue' },
  { id: 'MLB KIDS', name: 'MLB KIDS', color: 'yellow' },
  { id: 'Discovery', name: 'DISCOVERY', color: 'green' },
  { id: '경영지원', name: '경영지원', color: 'gray' },
  { id: 'Duvetica', name: 'Duvetica', color: 'gray' },
  { id: 'SUPRA', name: 'SUPRA', color: 'gray' },
];

// 색상 매핑
export const COLOR_SCHEME = {
  blue: {
    bg: 'bg-blue-500',
    hover: 'hover:bg-blue-600',
    text: 'text-blue-500',
    light: 'bg-blue-50',
    border: 'border-blue-200',
  },
  yellow: {
    bg: 'bg-yellow-500',
    hover: 'hover:bg-yellow-600',
    text: 'text-yellow-600',
    light: 'bg-yellow-50',
    border: 'border-yellow-200',
  },
  green: {
    bg: 'bg-green-500',
    hover: 'hover:bg-green-600',
    text: 'text-green-500',
    light: 'bg-green-50',
    border: 'border-green-200',
  },
  gray: {
    bg: 'bg-gray-600',
    hover: 'hover:bg-gray-700',
    text: 'text-gray-600',
    light: 'bg-gray-50',
    border: 'border-gray-200',
  },
  purple: {
    bg: 'bg-purple-600',
    hover: 'hover:bg-purple-700',
    text: 'text-purple-600',
    light: 'bg-purple-50',
    border: 'border-purple-200',
  },
};
