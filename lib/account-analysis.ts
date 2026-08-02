/**
 * 계정별 분석 — 적요(텍스트) 기반 구성 증감 해설
 *
 * 데이터: data/processed/account-analysis.json (scripts/preprocess.py 가 생성)
 *   관리식: 사업부 → 직접비/영업비 → 대분류 → 구성 → 월별 금액(위안)
 *   재무식: 사업부 → 연결계정과목 → 구성(=관리식 대분류) → 월별 금액(위안)
 *
 * 증감 분해 (원화 기준일 때):
 *   실제 증감(KRW) = 당년CNY×당년환율 − 전년CNY×전년환율
 *                  = (당년CNY − 전년CNY)×전년환율   ← 물량효과 (구성·브랜드 해설의 기준)
 *                  + 당년CNY×(당년환율 − 전년환율)  ← 환율효과
 * 두 항의 합이 실제 증감과 정확히 일치하므로, 구성별 증감을 모두 더하면 ①의 물량효과가 된다.
 */

import type { CostBasis, CostType, MonthlyAmounts } from './types';
import type { Currency, ExchangeRateData } from './exchange-rates';
import {
  fromMonthly,
  periodCny,
  rateForMonth,
  type Period,
} from './period';

export interface AccountAnalysisData {
  metadata: {
    generatedAt: string;
    months: string[];
    /** 적요로 현행 계정 체계에 맞춘(=추정) 대분류별 월 목록 */
    추정월?: Record<string, string[]>;
  };
  관리식: Record<string, Record<string, Record<string, Record<string, MonthlyAmounts>>>>;
  재무식: Record<string, Record<string, Record<string, MonthlyAmounts>>>;
}

/** 계정 → 하위 구성 → 월별 금액. 카드·표·분석 패널이 같은 걸 본다 */
export type SubLevels = Record<string, Record<string, MonthlyAmounts>>;

/**
 * 선택 조건(기준·탭·사업부)에 맞는 전 계정의 하위 구성.
 * 1차는 G/L 계정, 적요 보정이 필요한 곳만 전처리에서 다른 라벨이 붙어 있다.
 */
export function buildSubLevels(
  data: AccountAnalysisData | null,
  costBasis: CostBasis,
  activeTab: CostType,
  units: string[]
): SubLevels {
  const out: SubLevels = {};
  if (!data) return out;

  const add = (category: string, buckets: Record<string, MonthlyAmounts> | undefined) => {
    if (!buckets) return;
    const target = out[category] ?? (out[category] = {});
    for (const [label, monthly] of Object.entries(buckets)) {
      const dst = target[label] ?? (target[label] = {});
      for (const [m, v] of Object.entries(monthly)) dst[m] = (dst[m] || 0) + v;
    }
  };

  for (const unit of units) {
    if (costBasis === '재무식') {
      const byAccount = data.재무식?.[unit];
      if (byAccount) for (const [account, buckets] of Object.entries(byAccount)) add(account, buckets);
      continue;
    }
    const sides = data.관리식?.[unit];
    if (!sides) continue;
    for (const side of ['직접비', '영업비'] as const) {
      if (activeTab !== '전체' && activeTab !== side) continue;
      const byCategory = sides[side];
      if (!byCategory) continue;
      for (const [category, buckets] of Object.entries(byCategory)) add(category, buckets);
    }
  }

  return out;
}

/**
 * 하위 구성 표시 라벨 — 계정명 앞의 대분류 접두어를 떼어 좁은 카드에서도 한 줄에 들어가게.
 * (예: '마케팅 홍보비-브랜딩' → '브랜딩', '복리후생비_사회보험' → '사회보험')
 */
const SUB_LABEL_PREFIXES = [
  '마케팅 홍보비-',
  '마케팅홍보비_',
  '광고선전비_',
  '복리후생비_',
  '여비교통비_',
  '감가상각비_',
  '소모품비_',
  '지급임차료_',
  '관리회계_',
  '수주회_',
  '지급수수료_',
];

export function shortSubLabel(label: string): string {
  for (const prefix of SUB_LABEL_PREFIXES) {
    if (label.startsWith(prefix)) {
      const rest = label.slice(prefix.length);
      if (rest) return rest;
    }
  }
  return label;
}

/** 표시 기간에 금액이 있는 구성만, 절대값 큰 순 */
export function sortSubLabels(
  buckets: Record<string, MonthlyAmounts> | undefined,
  months: string[]
): string[] {
  if (!buckets) return [];
  const weight = (label: string) =>
    months.reduce((s, m) => s + Math.abs(buckets[label]?.[m] ?? 0), 0);
  return Object.keys(buckets)
    .filter(label => weight(label) > 0)
    .sort((a, b) => weight(b) - weight(a));
}

/** 전년 금액이 적요 추정으로 채워진 계정인지 */
export function isEstimatedCategory(
  data: AccountAnalysisData | null,
  category: string
): boolean {
  return Boolean(data?.metadata?.추정월?.[category]?.length);
}

/** 브랜드(코스트센터) 구분 설명이 필요한 계정 — 나머지는 법인 합계만 본다 */
export const BRAND_SPLIT_ACCOUNTS = new Set([
  '급여',
  '인건비',
  '광고비',
  '광고선전비',
  '수주회',
]);

/** 인원 증감을 같이 보여줄 계정 */
const HEADCOUNT_ACCOUNTS = new Set(['급여', '인건비', '복리비']);

export interface AnalysisDelta {
  label: string;
  /** 표시 통화 기준 증감 (KRW면 전년 환율로 환산한 물량효과) */
  delta: number;
  /** 당기 금액 (표시 통화) */
  curr: number;
  /** 전년=100 지수 */
  index: number | null;
}

export interface AccountAnalysisRow {
  category: string;
  /** 표시 통화 당기·전년 금액 */
  curr: number;
  prev: number;
  index: number | null;
  delta: number;
  /** 원화일 때만 — 환율효과/물량효과 분해 */
  fx: {
    effect: number;
    volume: number;
    /** CNY 기준 증감률 (%) */
    cnyPct: number | null;
    currRate: number;
    prevRate: number;
  } | null;
  /** 구성별 증감 (물량 기준, |증감| 큰 순) */
  buckets: AnalysisDelta[];
  /** 브랜드별 증감 — 브랜드 구분이 필요한 계정 & 법인 선택 시에만 */
  brands: AnalysisDelta[];
  /** 인건비 계열에만 — 평균 인원 증감 */
  headcount: { office: number | null; store: number | null } | null;
}

export interface BuildAnalysisInput {
  data: AccountAnalysisData | null;
  costBasis: CostBasis;
  activeTab: CostType;
  /** 합산할 사업부 (법인이면 여러 개) */
  units: string[];
  /** 법인 전체 여부 — 브랜드 분해 노출 조건 */
  isCorporate: boolean;
  /** 카드와 같은 순서의 계정 목록 */
  categories: string[];
  period: Period;
  prevPeriod: Period;
  currency: Currency;
  exchangeRates: ExchangeRateData | null;
  /** 평균 인원 (당기/전년) — 인건비 계열 해설용 */
  headcount?: {
    office: { curr: number | null; prev: number | null };
    store: { curr: number | null; prev: number | null };
  };
}

/** 사업부 → 비용구분 → 계정 → 구성 → 월 에서, 선택 조건에 맞는 구성별 시계열 합 */
function collectBuckets(
  data: AccountAnalysisData,
  costBasis: CostBasis,
  activeTab: CostType,
  units: string[],
  category: string
): Record<string, Record<string, MonthlyAmounts>> {
  /** 브랜드 → 구성 → 월 */
  const byBrand: Record<string, Record<string, MonthlyAmounts>> = {};

  const addSide = (brand: string, side: Record<string, MonthlyAmounts> | undefined) => {
    if (!side) return;
    const target = byBrand[brand] ?? (byBrand[brand] = {});
    for (const [bucket, monthly] of Object.entries(side)) {
      const dst = target[bucket] ?? (target[bucket] = {});
      for (const [m, v] of Object.entries(monthly)) {
        dst[m] = (dst[m] || 0) + v;
      }
    }
  };

  for (const unit of units) {
    if (costBasis === '재무식') {
      addSide(unit, data.재무식?.[unit]?.[category]);
      continue;
    }
    const sides = data.관리식?.[unit];
    if (!sides) continue;
    if (activeTab === '직접비' || activeTab === '전체') {
      addSide(unit, sides['직접비']?.[category]);
    }
    if (activeTab === '영업비' || activeTab === '전체') {
      addSide(unit, sides['영업비']?.[category]);
    }
  }

  return byBrand;
}

/**
 * 전년=100 지수. 전년이 없거나(0) 너무 작으면(1천 위안 미만) 의미가 없고,
 * 999%를 넘는 값은 해설에서 오히려 방해가 되므로 표시하지 않는다.
 */
function safeIndex(curr: number, prev: number): number | null {
  if (prev === 0 || Math.abs(prev) < 1000) return null;
  const value = Math.round((curr / prev) * 100);
  return Math.abs(value) > 999 ? null : value;
}

/** 표시 라벨이 같은 항목은 한 줄로 합친다 (계정명 접두어를 떼면서 겹칠 수 있음) */
function mergeSameLabel(items: AnalysisDelta[]): AnalysisDelta[] {
  const byLabel = new Map<string, AnalysisDelta>();
  for (const item of items) {
    const hit = byLabel.get(item.label);
    if (hit) {
      hit.delta += item.delta;
      hit.curr += item.curr;
      hit.index = null; // 합친 뒤에는 개별 지수가 의미 없다
    } else {
      byLabel.set(item.label, { ...item });
    }
  }
  return [...byLabel.values()].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
}

function mergeMonthly(maps: MonthlyAmounts[]): MonthlyAmounts {
  const out: MonthlyAmounts = {};
  for (const m of maps) {
    for (const [k, v] of Object.entries(m)) out[k] = (out[k] || 0) + v;
  }
  return out;
}

function periodRate(
  rates: ExchangeRateData | null,
  period: Period
): number | null {
  return rateForMonth(
    rates,
    period.endMonth,
    period.viewMode === '당월' ? '월평균' : '기간평균'
  );
}

export function buildAccountAnalysis(input: BuildAnalysisInput): AccountAnalysisRow[] {
  const {
    data,
    costBasis,
    activeTab,
    units,
    isCorporate,
    categories,
    period,
    prevPeriod,
    currency,
    exchangeRates,
    headcount,
  } = input;

  if (!data) return [];

  const isKrw = currency === 'KRW';
  const currRate = periodRate(exchangeRates, period);
  const prevRate = periodRate(exchangeRates, prevPeriod);
  /** 물량효과 환산 — 원화면 전년 환율(환율효과를 뺀 순수 증감) */
  const toDisplay = (cny: number) => (isKrw ? cny * (prevRate ?? 0) : cny);

  const rows: AccountAnalysisRow[] = [];

  for (const category of categories) {
    const byBrand = collectBuckets(data, costBasis, activeTab, units, category);
    const brandKeys = Object.keys(byBrand);
    if (brandKeys.length === 0) continue;

    /** 구성 → 월별 (전 브랜드 합) */
    const bucketMonthly: Record<string, MonthlyAmounts> = {};
    for (const brand of brandKeys) {
      for (const [bucket, monthly] of Object.entries(byBrand[brand])) {
        bucketMonthly[bucket] = mergeMonthly([bucketMonthly[bucket] ?? {}, monthly]);
      }
    }

    const totalMonthly = mergeMonthly(Object.values(bucketMonthly));
    const currCny = periodCny(fromMonthly(totalMonthly), period);
    const prevCny = periodCny(fromMonthly(totalMonthly), prevPeriod);
    if (currCny === 0 && prevCny === 0) continue;

    const curr = isKrw ? currCny * (currRate ?? 0) : currCny;
    const prev = isKrw ? prevCny * (prevRate ?? 0) : prevCny;
    const delta = curr - prev;

    const fx =
      isKrw && currRate !== null && prevRate !== null
        ? {
            effect: currCny * (currRate - prevRate),
            volume: (currCny - prevCny) * prevRate,
            cnyPct: prevCny !== 0 ? ((currCny - prevCny) / Math.abs(prevCny)) * 100 : null,
            currRate,
            prevRate,
          }
        : null;

    const bucketRows = Object.entries(bucketMonthly)
      .map(([label, monthly]) => {
        const c = periodCny(fromMonthly(monthly), period);
        const p = periodCny(fromMonthly(monthly), prevPeriod);
        return {
          label: shortSubLabel(label),
          delta: toDisplay(c - p),
          curr: isKrw ? c * (currRate ?? 0) : c,
          index: safeIndex(c, p),
        };
      })
      .filter(b => b.curr !== 0 || b.delta !== 0);
    const buckets: AnalysisDelta[] = mergeSameLabel(bucketRows);

    const needBrand = isCorporate && BRAND_SPLIT_ACCOUNTS.has(category);
    const brands: AnalysisDelta[] = needBrand
      ? brandKeys
          .map(brand => {
            const monthly = mergeMonthly(Object.values(byBrand[brand]));
            const c = periodCny(fromMonthly(monthly), period);
            const p = periodCny(fromMonthly(monthly), prevPeriod);
            return {
              label: brand,
              delta: toDisplay(c - p),
              curr: isKrw ? c * (currRate ?? 0) : c,
              index: safeIndex(c, p),
            };
          })
          .filter(b => b.curr !== 0 || b.delta !== 0)
          .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      : [];

    rows.push({
      category,
      curr,
      prev,
      index: prevCny !== 0 && Math.abs(prevCny) >= 1000 ? Math.round((curr / prev) * 100) : null,
      delta,
      fx,
      buckets,
      brands,
      headcount:
        HEADCOUNT_ACCOUNTS.has(category) && headcount
          ? {
              office:
                headcount.office.curr !== null && headcount.office.prev !== null
                  ? headcount.office.curr - headcount.office.prev
                  : null,
              store:
                headcount.store.curr !== null && headcount.store.prev !== null
                  ? headcount.store.curr - headcount.store.prev
                  : null,
            }
          : null,
    });
  }

  return rows;
}
