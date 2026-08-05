/**
 * 비용 심층분석 화면(광고비 효율분석·AI보고서·비용구조 보고서·스코어카드)이 공통으로 쓰는
 * 집계 데이터 형태.
 *
 * cn-report(dcsai_cn-report)의 비용 대시보드 컴포넌트가 기대하는 구조를 그대로 따른다.
 * 비용(SAP)의 원천 JSON(대분류/구성 계층)을 이 형태로 바꿔주는 것이 `expense-dash-adapter.ts`.
 *
 * 사업부 목록은 여기서 고정하지 않는다 — `lib/types.ts` 의 BUSINESS_UNITS,
 * `lib/retail-brands.ts` 의 RETAIL_BRAND_IDS/CORPORATE_RETAIL_UNIT 가 단일 기준이다.
 */

import type { CostType } from './types';

/** 사업부 — 법인(합산) 또는 개별 사업부 id */
export type BizUnit = string;

export type ExpenseMode = 'monthly' | 'ytd';

/** 사업부 × 연월 × 대분류 */
export interface MonthlyAggregated {
  biz_unit: string;
  year: number;
  month: number;
  /** "202606" */
  yyyymm: string;
  /** 대분류 (광고비·지급수수료·급여 …) */
  cost_lv1: string;
  amount: number;
  headcount: number;
  sales: number;
  /** 직접비 / 영업비 — 비용(SAP) 고유 축 */
  cost_type: CostType;
}

/** 사업부 × 연월 (대분류 합계) */
export interface MonthlyTotal {
  biz_unit: string;
  year: number;
  month: number;
  yyyymm: string;
  amount: number;
  headcount: number;
  sales: number;
}

/** 사업부 × 연월 × 대분류 × 구성 */
export interface CategoryDetail {
  biz_unit: string;
  year: number;
  month: number;
  yyyymm: string;
  cost_lv1: string;
  /** 구성 (계정 1차 + 적요 보정) */
  cost_lv2: string;
  /** 비용(SAP)은 2단계까지만 있어 항상 빈 문자열 — cn-report 컴포넌트 호환용 */
  cost_lv3: string;
  amount: number;
  headcount?: number;
  cost_type: CostType;
}

export interface AggregatedData {
  monthly_aggregated: MonthlyAggregated[];
  monthly_total: MonthlyTotal[];
  category_detail: CategoryDetail[];
  metadata: {
    /** 실제 데이터에 존재하는 사업부 */
    target_biz_units: string[];
    years: number[];
    months: number[];
    /** 이 집계에 담긴 비용구분 */
    cost_types: CostType[];
    /** 매출이 붙은 사업부 (경영지원처럼 자체 매출이 없는 곳은 빠진다) */
    sales_biz_units: string[];
    /** 적요로 추정 분류한 대분류 → 해당 월 (화면 '추정' 배지용) */
    estimatedMonths: Record<string, string[]>;
    generatedAt: string;
  };
}
