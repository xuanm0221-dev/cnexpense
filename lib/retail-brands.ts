/**
 * 리테일 브랜드·채널 상수 — (mei)리테일 스킬 §2-2 / §10-3 정의
 * API 라우트(서버)와 페이지(클라이언트)가 공유
 */

/** DW_SALE.brd_cd → 사업부(브랜드) 라벨 */
export const RETAIL_BRAND_CODE_TO_UNIT: Record<string, string> = {
  M: 'MLB',
  I: 'MLB KIDS',
  X: 'Discovery',
  V: 'Duvetica',
  W: 'SUPRA',
};

/** 법인 = 리테일 5개 브랜드 합산 */
export const RETAIL_BRAND_IDS = [
  'MLB',
  'MLB KIDS',
  'Discovery',
  'Duvetica',
  'SUPRA',
] as const;

/** 법인 합산 키 (API가 직접 내려줌) */
export const CORPORATE_RETAIL_UNIT = '법인';

/** 경영지원 — 자체 브랜드 매출이 없어 법인 합산을 그대로 사용 */
export const MANAGEMENT_SUPPORT_UNIT = '경영지원';

/**
 * 5채널 (스킬 §10-3) — 4채널 + 미지정.
 * 미지정(`anlys_onoff_cls_nm IS NULL`)은 4채널 정의 밖이지만 합계 정합성을 위해 분리 집계.
 */
export const RETAIL_CHANNELS = [
  '직영(OFF)',
  '대리상(OFF)',
  '직영(ON)',
  '대리상(ON)',
  '미지정',
] as const;

export type RetailChannel = (typeof RETAIL_CHANNELS)[number];
