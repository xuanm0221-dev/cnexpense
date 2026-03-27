/**
 * 법인(전체) 뷰: 홈 법인 카드와 동일하게 6개 사업부 비용 데이터 합산
 */

import type {
  BusinessUnitCosts,
  BusinessUnitData,
  GlBreakdownByCategory,
} from './types';

/** 홈 대시보드 법인 카드와 동일한 사업부 목록 */
export const CORPORATE_BUSINESS_UNIT_IDS = [
  'MLB',
  'MLB KIDS',
  'Discovery',
  '경영지원',
  'Duvetica',
  'SUPRA',
] as const;

export function isCorporateBusinessUnitSlug(slug: string): boolean {
  return slug === '법인';
}

type SubMap = Record<string, Record<string, number>>;

function mergeSalarySide(target: SubMap, source: SubMap | undefined) {
  if (!source) return;
  for (const label of Object.keys(source)) {
    if (!target[label]) target[label] = {};
    for (const m of Object.keys(source[label])) {
      target[label][m] = (target[label][m] || 0) + source[label][m];
    }
  }
}

type WelfareSide = {
  중분류: Record<string, Record<string, number>>;
  현지직원세부: Record<string, Record<string, number>>;
};

function emptyWelfareSide(): WelfareSide {
  return { 중분류: {}, 현지직원세부: {} };
}

function mergeWelfareBucket(
  target: Record<string, Record<string, number>>,
  source: Record<string, Record<string, number>> | undefined
) {
  if (!source) return;
  for (const label of Object.keys(source)) {
    if (!target[label]) target[label] = {};
    for (const m of Object.keys(source[label])) {
      target[label][m] = (target[label][m] || 0) + source[label][m];
    }
  }
}

function mergeGlBreakdown(
  target: GlBreakdownByCategory,
  source: GlBreakdownByCategory | undefined
) {
  if (!source) return;
  for (const category of Object.keys(source)) {
    if (!target[category]) target[category] = {};
    const tCat = target[category];
    const sCat = source[category];
    for (const gl of Object.keys(sCat)) {
      if (!tCat[gl]) tCat[gl] = {};
      for (const m of Object.keys(sCat[gl])) {
        tCat[gl][m] = (tCat[gl][m] || 0) + sCat[gl][m];
      }
    }
  }
}

/**
 * 6개 사업부 직접비·영업비(및 선택적 급여/복리 중분류)를 합산한 법인용 구조
 */
export function mergeCorporateBusinessUnitCosts(
  unitData: BusinessUnitData
): BusinessUnitCosts {
  const out: BusinessUnitCosts = { 직접비: {}, 영업비: {} };

  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const bu = unitData[buId];
    if (!bu) continue;

    for (const side of ['직접비', '영업비'] as const) {
      for (const category in bu[side]) {
        if (!out[side][category]) out[side][category] = {};
        const dst = out[side][category];
        const src = bu[side][category];
        for (const month in src) {
          dst[month] = (dst[month] || 0) + src[month];
        }
      }
    }
  }

  const salaryOut: { 직접비: SubMap; 영업비: SubMap } = { 직접비: {}, 영업비: {} };
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const sub = unitData[buId]?.급여중분류;
    if (!sub) continue;
    mergeSalarySide(salaryOut.직접비, sub.직접비);
    mergeSalarySide(salaryOut.영업비, sub.영업비);
  }
  const salaryEmpty =
    Object.keys(salaryOut.직접비).length === 0 &&
    Object.keys(salaryOut.영업비).length === 0;
  if (!salaryEmpty) {
    out.급여중분류 = salaryOut;
  }

  const welfareOut: { 직접비: WelfareSide; 영업비: WelfareSide } = {
    직접비: emptyWelfareSide(),
    영업비: emptyWelfareSide(),
  };
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const w = unitData[buId]?.복리중분류;
    if (!w) continue;
    for (const ct of ['직접비', '영업비'] as const) {
      mergeWelfareBucket(welfareOut[ct].중분류, w[ct]?.중분류);
      mergeWelfareBucket(welfareOut[ct].현지직원세부, w[ct]?.현지직원세부);
    }
  }
  const welfareEmpty =
    Object.keys(welfareOut.직접비.중분류).length === 0 &&
    Object.keys(welfareOut.직접비.현지직원세부).length === 0 &&
    Object.keys(welfareOut.영업비.중분류).length === 0 &&
    Object.keys(welfareOut.영업비.현지직원세부).length === 0;
  if (!welfareEmpty) {
    out.복리중분류 = welfareOut;
  }

  const glOut: { 직접비: GlBreakdownByCategory; 영업비: GlBreakdownByCategory } = {
    직접비: {},
    영업비: {},
  };
  for (const buId of CORPORATE_BUSINESS_UNIT_IDS) {
    const g = unitData[buId]?.대분류별GL설명;
    if (!g) continue;
    mergeGlBreakdown(glOut.직접비, g.직접비);
    mergeGlBreakdown(glOut.영업비, g.영업비);
  }
  const glEmpty =
    Object.keys(glOut.직접비).length === 0 &&
    Object.keys(glOut.영업비).length === 0;
  if (!glEmpty) {
    out.대분류별GL설명 = glOut;
  }

  return out;
}
