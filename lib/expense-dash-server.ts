/**
 * 심층분석 API 들이 공유하는 서버측 데이터 로딩
 *
 * cost-report · ai-report · exec-scorecard 가 모두 같은 집계를 필요로 한다.
 * 라우트마다 JSON 을 읽고 매출을 조회하면 요청 하나에 Snowflake 질의가 여러 번 나가므로
 * 여기서 한 번만 만들고 **비용구분별로 캐시**한다.
 *
 * 서버 전용 (Snowflake 접속 포함).
 */

import { buildAggregatedData } from './expense-dash-adapter';
import { createExpenseQueries, type ExpenseQueries } from './expense-dash';
import { fetchMonthlySales, toRetailSalesData } from './retail-sales-monthly';
import type { AggregatedData } from './expense-dash-types';
import type { AccountAnalysisData } from './account-analysis';
import type { CostData, CostType, HeadcountData, StoreHeadcountData } from './types';

export interface LoadedExpenseData {
  data: AggregatedData;
  queries: ExpenseQueries;
  /** 매출 조회에 실패했으면 사유. 비용 분석은 매출 없이도 되어야 하므로 던지지 않는다 */
  salesError: string | null;
}

/** 원천 JSON 은 프로세스 수명 동안 안 바뀐다 (빌드 산출물) */
let _sources: {
  costData: CostData;
  analysis: AccountAnalysisData;
  headcount?: HeadcountData;
  storeHeadcount?: StoreHeadcountData;
} | null = null;

async function loadSources() {
  if (_sources) return _sources;
  const [costMod, analysisMod, headcountMod, storeMod] = await Promise.all([
    import('@/data/processed/aggregated-costs.json'),
    import('@/data/processed/account-analysis.json'),
    import('@/data/processed/headcount.json'),
    import('@/data/processed/store-headcount.json'),
  ]);
  _sources = {
    costData: costMod.default as unknown as CostData,
    analysis: analysisMod.default as unknown as AccountAnalysisData,
    headcount: (headcountMod.default as any)?.data as HeadcountData | undefined,
    storeHeadcount: (storeMod.default as any)?.data as StoreHeadcountData | undefined,
  };
  return _sources;
}

/** 매출은 조회 비용이 있으니 한 번만 (원천 월 범위 전체) */
let _salesPromise: Promise<{ sales: any; error: string | null }> | null = null;

function loadSales(months: string[]) {
  if (!_salesPromise) {
    _salesPromise = (async () => {
      if (months.length === 0) return { sales: null, error: null };
      try {
        const result = await fetchMonthlySales(months[0], months[months.length - 1]);
        return { sales: toRetailSalesData(result), error: null };
      } catch (e: any) {
        const error = e?.message ?? String(e);
        console.error('[expense-dash-server] 매출 조회 실패 — 비용만으로 진행:', error);
        return { sales: null, error };
      }
    })();
  }
  return _salesPromise;
}

const _byCostType = new Map<CostType, LoadedExpenseData>();

export async function loadExpenseData(costType: CostType): Promise<LoadedExpenseData> {
  const cached = _byCostType.get(costType);
  if (cached) return cached;

  const sources = await loadSources();
  const { sales, error } = await loadSales(sources.costData.metadata?.months ?? []);

  const data = buildAggregatedData({ ...sources, sales, costType });
  const loaded: LoadedExpenseData = {
    data,
    queries: createExpenseQueries(data),
    salesError: error,
  };
  _byCostType.set(costType, loaded);
  return loaded;
}

/** 전처리 재실행 등으로 데이터가 바뀌었을 때 */
export function clearExpenseCache(): void {
  _sources = null;
  _salesPromise = null;
  _byCostType.clear();
}
