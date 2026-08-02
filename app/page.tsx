'use client';

/**
 * 홈 대시보드 페이지
 */

import { useState, useEffect, useLayoutEffect, useMemo } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import BusinessUnitCard from '@/components/BusinessUnitCard';
import MonthlyAccountMatrixTable from '@/components/MonthlyAccountMatrixTable';
import KpiHighlightStrip from '@/components/KpiHighlightStrip';
import MonthlyCostTrendChart from '@/components/MonthlyCostTrendChart';
import CorporateSalarySubKpiStrip from '@/components/CorporateSalarySubKpiStrip';
import AccountAnalysisPanel from '@/components/AccountAnalysisPanel';
import {
  buildAccountAnalysis,
  buildSubLevels,
  type AccountAnalysisData,
} from '@/lib/account-analysis';
import { getSortedFinancialCategories } from '@/lib/calculations';
import {
  fromMonthly,
  headcountForPeriod,
  periodCny,
  previousYearPeriod,
} from '@/lib/period';
import {
  buildCorporateOfficeHeadcountByMonth,
  buildCorporateStoreHeadcountByMonth,
  sumCorporateOfficeHeadcountSnapshot,
  sumCorporateStoreHeadcountSnapshot,
} from '@/lib/corporate-headcount';
import { buildSalarySubKpiCardModel } from '@/lib/salary-sub-kpi';
import {
  getSortedCategories,
  getSortedCategoriesForMonths,
} from '@/lib/calculations';
import {
  buildDetailKpiMetrics,
  detailPageRetailKpiMode,
} from '@/lib/detail-corporate-kpi';
import { categorySortSide, selectCategoryData } from '@/lib/category-selection';
import { getDetailChartRollingMonths } from '@/lib/rolling-months';
import { CostBasis, CostData, ViewMode, CostType, BUSINESS_UNITS, HeadcountData, MonthlyAmounts, StoreHeadcountData, RetailSalesResponse } from '@/lib/types';
import {
  CORPORATE_BUSINESS_UNIT_IDS,
  mergeCorporateBusinessUnitCosts,
} from '@/lib/corporate-cost-merge';
import { CORPORATE_RETAIL_UNIT } from '@/lib/retail-brands';
import ExchangeRateTable from '@/components/ExchangeRateTable';
import { type Currency, type ExchangeRateData } from '@/lib/exchange-rates';
import {
  VIEW_MODES,
  buildPeriod,
  convertCategoryDataToKrw,
  isQuarterView,
  periodHasData,
  rateForMonth,
} from '@/lib/period';
import {
  loadCostData,
  isDataEmpty,
  loadExchangeRates,
  loadHeadcountData,
  loadStoreHeadcountData,
  loadRetailSales,
  loadAccountAnalysis,
  retailChannelsFor,
  retailMetricsFor,
  toRetailSalesData,
} from '@/lib/data-loader';

/** 카드 제목 드롭다운 목록 — 법인 + 전체 사업부 */
const UNIT_OPTIONS = [
  { id: CORPORATE_RETAIL_UNIT, name: '법인' },
  ...BUSINESS_UNITS.map(b => ({ id: b.id, name: b.name })),
];

export default function HomePage() {
  const [data, setData] = useState<CostData | null>(null);
  const [headcountData, setHeadcountData] = useState<HeadcountData | null>(null);
  const [storeHeadcountData, setStoreHeadcountData] = useState<StoreHeadcountData | null>(null);
  const [retailResponse, setRetailResponse] = useState<RetailSalesResponse | null>(null);
  const [analysisData, setAnalysisData] = useState<AccountAnalysisData | null>(null);
  const [retailLoading, setRetailLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 선택된 월 (기본값: 가장 최근 월)
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  
  // 뷰 모드 (당월 / 누적(YTD))
  const [viewMode, setViewMode] = useState<ViewMode>('당월');
  
  // 카드에 표시할 사업부 (드롭다운). '법인'이면 6개 사업부 합산
  const [selectedUnit, setSelectedUnit] = useState<string>(CORPORATE_RETAIL_UNIT);
  
  // 직접비/영업비/전체 탭 (모든 카드 동기화) — 관리식 기본은 영업비
  const [activeTab, setActiveTab] = useState<CostType>('영업비');

  // 집계 기준: 관리식(기본) / 재무식(연결계정과목)
  const [costBasis, setCostBasis] = useState<CostBasis>('관리식');

  /** 기준을 바꾸면 기본 보기도 함께 — 관리식=영업비 탭, 재무식=누적(YTD) */
  const handleCostBasisChange = (next: CostBasis) => {
    setCostBasis(next);
    if (next === '관리식') setActiveTab('영업비');
    else setViewMode('누적(YTD)');
  };

  // 통화 (재무식에서만 노출) + 환율표
  const [currency, setCurrency] = useState<Currency>('CNY');
  const [retailBaseResponse, setRetailBaseResponse] = useState<RetailSalesResponse | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateData | null>(null);
  const [rateTableOpen, setRateTableOpen] = useState(false);

  // 급여·복리비 중분류 토글 (모든 카드 동기화)
  const [salarySubExpanded, setSalarySubExpanded] = useState(false);
  const [welfareSubExpanded, setWelfareSubExpanded] = useState(false);
  
  // 데이터 로드 (초기 로드)
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [costData, headcount, storeHeadcount, rates, analysis] = await Promise.all([
          loadCostData(),
          loadHeadcountData(),
          loadStoreHeadcountData(),
          loadExchangeRates(),
          loadAccountAnalysis(),
        ]);

        if (isDataEmpty(costData)) {
          setError('비용 데이터가 없습니다. Python 전처리 스크립트를 실행해주세요.');
          return;
        }

        setData(costData);
        setHeadcountData(headcount);
        setStoreHeadcountData(storeHeadcount);
        setExchangeRates(rates);
        setAnalysisData(analysis);
        
        // 가장 최근 월을 기본값으로 설정 (비용+인원수 통합 월 목록 사용)
        const costMonths = costData.metadata.months;
        const headcountMonths = headcount ? Object.values(headcount).flatMap(bu => Object.keys(bu)) : [];
        const storeMonths = storeHeadcount ? Object.values(storeHeadcount).flatMap(bu => Object.keys(bu)) : [];
        const allMonths = [...new Set([...costMonths, ...headcountMonths, ...storeMonths])].sort();
        if (allMonths.length > 0) {
          setSelectedMonth(allMonths[allMonths.length - 1]);
        }
      } catch (err) {
        console.error('데이터 로드 실패:', err);
        setError('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
      }
    }
    
    fetchData();
  }, []);

  // 비용·인원수·매장인원수 월 목록 통합 (2026년 등 신규 월 표시)
  const mergedMonths = useMemo(() => {
    const costMonths = data?.metadata?.months ?? [];
    const headcountMonths = headcountData ? Object.values(headcountData).flatMap(bu => Object.keys(bu)) : [];
    const storeMonths = storeHeadcountData ? Object.values(storeHeadcountData).flatMap(bu => Object.keys(bu)) : [];
    return [...new Set([...costMonths, ...headcountMonths, ...storeMonths])].sort();
  }, [data, headcountData, storeHeadcountData]);

  /** 카드·우측 표가 함께 쓰는 선택 사업부 비용 (법인이면 6개 사업부 합산) */
  const selectedUnitCosts = useMemo(() => {
    if (!data) return undefined;
    return selectedUnit === CORPORATE_RETAIL_UNIT
      ? mergeCorporateBusinessUnitCosts(data.data)
      : data.data[selectedUnit];
  }, [data, selectedUnit]);

  // 조회 기간 (당월 / 누적 / 분기)
  const period = useMemo(
    () => buildPeriod(selectedMonth, viewMode),
    [selectedMonth, viewMode]
  );

  /**
   * 리테일 매출 로드.
   * 분기는 API에 분기 개념이 없어 **분기말 YTD − 직전분기말 YTD** 로 만든다.
   * (비용의 분기 계산 규칙과 동일)
   */
  useEffect(() => {
    if (!period.endMonth) return;
    let cancelled = false;

    async function fetchRetailSales() {
      setRetailLoading(true);
      try {
        const [end, base] = await Promise.all([
          loadRetailSales(period.endMonth),
          period.baseMonth ? loadRetailSales(period.baseMonth) : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setRetailResponse(end);
        setRetailBaseResponse(base);
      } catch (err) {
        console.error('리테일 매출 데이터 로드 실패:', err);
        if (!cancelled) {
          setRetailResponse(null);
          setRetailBaseResponse(null);
        }
      } finally {
        if (!cancelled) setRetailLoading(false);
      }
    }

    fetchRetailSales();
    return () => {
      cancelled = true;
    };
  }, [period.endMonth, period.baseMonth]);

  // 기간에 해당하는 월별 금액 맵 (위안) — 법인·경영지원 키 포함
  const retailSalesData = useMemo(() => {
    if (viewMode === '당월') return toRetailSalesData(retailResponse, '당월');
    const end = toRetailSalesData(retailResponse, '누적(YTD)');
    if (!isQuarterView(viewMode) || !period.baseMonth) return end;

    // 분기 = 분기말 누적 − 직전분기말 누적 (당년·전년 각각)
    const base = toRetailSalesData(retailBaseResponse, '누적(YTD)');
    if (!end) return null;
    if (!base) return end;

    const out: typeof end = {};
    for (const [unit, months] of Object.entries(end)) {
      const baseMonths = base[unit] ?? {};
      const merged: Record<string, number> = {};
      for (const [m, v] of Object.entries(months)) {
        // end 는 분기말 기준월 키, base 는 직전분기말 키 → 연도별로 대응시킨다
        const year = m.split('-')[0];
        const baseKey = Object.keys(baseMonths).find(k => k.startsWith(year));
        merged[m] = v - (baseKey ? baseMonths[baseKey] : 0);
      }
      out[unit] = merged;
    }
    return out;
  }, [retailResponse, retailBaseResponse, viewMode, period.baseMonth]);

  // 사무실 인원수 조회 헬퍼 함수
  const getOfficeHeadcount = (buId: string, month: string): number | null => {
    if (!headcountData || !headcountData[buId]) return null;
    return headcountData[buId][month] ?? null;
  };
  
  // 매장 인원수 조회 헬퍼 함수
  const getStoreHeadcount = (buId: string, month: string): number | null => {
    if (!storeHeadcountData || !storeHeadcountData[buId]) return null;
    return storeHeadcountData[buId][month] ?? null;
  };
  
  // 리테일 매출 조회 헬퍼 함수
  const getRetailSales = (buId: string, month: string): number | null => {
    if (!retailSalesData || !retailSalesData[buId]) return null;
    return retailSalesData[buId][month] ?? null;
  };
  
  // 리테일 매출 전체 데이터 조회 (YoY 계산용)
  const getRetailSalesData = (buId: string): { [month: string]: number } | null => {
    if (!retailSalesData || !retailSalesData[buId]) return null;
    return retailSalesData[buId];
  };

  // 채널 분해 (직영 ON/OFF · 대리상 ON/OFF) — 카드 리테일매출 호버용
  const getRetailChannels = (buId: string) =>
    retailChannelsFor(retailResponse, buId, viewMode === '당월' ? '당월' : '누적(YTD)');

  // 할인율 등 기간 지표
  const getRetailMetrics = (buId: string) =>
    retailMetricsFor(retailResponse, buId, viewMode === '당월' ? '당월' : '누적(YTD)');

  /**
   * 환산 환율 — 당월=월평균, 누적(YTD)=기간평균.
   * 전년 동기간은 그 시점 환율로 환산해야 원화 기준 YoY가 맞다.
   */
  const rateColumnLabel: '월평균' | '기간평균' =
    viewMode === '당월' ? '월평균' : '기간평균';
  const appliedRate = useMemo(
    () => rateForMonth(exchangeRates, period.endMonth, rateColumnLabel),
    [exchangeRates, period.endMonth, rateColumnLabel]
  );

  /** 비용 데이터가 없는 분기는 탭 비활성화 */
  const disabledViewModes = useMemo(
    () =>
      VIEW_MODES.filter(
        mode =>
          isQuarterView(mode) &&
          !periodHasData(buildPeriod(selectedMonth, mode), mergedMonths)
      ),
    [selectedMonth, mergedMonths]
  );
  // 재무식이 아닐 때는 항상 위안 기준
  const effectiveCurrency: Currency = costBasis === '재무식' ? currency : 'CNY';

  /** 우측 분석 지표(표·차트)가 함께 쓰는 계정 묶음 — 카드 탭·기준과 동일 */
  const analysisCategoryData = useMemo(
    () => selectCategoryData(selectedUnitCosts, costBasis, activeTab),
    [selectedUnitCosts, costBasis, activeTab]
  );

  /** 막대 차트 — 기준월을 맨 오른쪽으로 하는 13개월, 원화면 각 달 월평균 환율로 환산 */
  const chartMonths = useMemo(
    () => (selectedMonth ? getDetailChartRollingMonths(selectedMonth) : []),
    [selectedMonth]
  );
  const chartCategoryData = useMemo(
    () =>
      costBasis === '재무식' && effectiveCurrency === 'KRW'
        ? convertCategoryDataToKrw(analysisCategoryData, exchangeRates)
        : analysisCategoryData,
    [analysisCategoryData, costBasis, effectiveCurrency, exchangeRates]
  );

  /**
   * 차트 범례 선택 — 법인일 때만 상위에서 제어한다(급여만 켜면 급여 중분류 스트립 노출).
   */
  const [chartLegendSelected, setChartLegendSelected] = useState<Set<string>>(
    () => new Set()
  );
  const isCorporateUnit = selectedUnit === CORPORATE_RETAIL_UNIT;
  const legendCostSide = costBasis === '재무식' ? undefined : categorySortSide(activeTab);
  const chartCategoryKey = useMemo(
    () =>
      getSortedCategoriesForMonths(chartCategoryData, chartMonths, legendCostSide).join('|'),
    [chartCategoryData, chartMonths, legendCostSide]
  );

  useLayoutEffect(() => {
    if (!isCorporateUnit) return;
    setChartLegendSelected(new Set(chartCategoryKey ? chartCategoryKey.split('|') : []));
  }, [isCorporateUnit, chartCategoryKey]);

  /** 급여 범례만 켜져 있을 때 노출하는 급여 중분류 KPI */
  const showSalarySubKpiStrip =
    isCorporateUnit &&
    costBasis !== '재무식' &&
    chartLegendSelected.size === 1 &&
    chartLegendSelected.has('급여');

  const salarySubKpiCards = useMemo(() => {
    if (!showSalarySubKpiStrip || !data || !selectedUnitCosts || !selectedMonth) return [];
    const side = activeTab as '직접비' | '영업비' | '전체';
    const cards = [
      buildSalarySubKpiCardModel(
        '법인 전체',
        selectedUnitCosts,
        side,
        selectedMonth,
        sumCorporateOfficeHeadcountSnapshot(headcountData, selectedMonth),
        sumCorporateStoreHeadcountSnapshot(storeHeadcountData, selectedMonth),
        buildCorporateOfficeHeadcountByMonth(headcountData),
        buildCorporateStoreHeadcountByMonth(storeHeadcountData)
      ),
    ];

    for (const buId of ['MLB', 'MLB KIDS', 'Discovery'] as const) {
      const unit = data.data[buId];
      if (!unit) continue;
      const office = headcountData?.[buId] ?? null;
      const store = storeHeadcountData?.[buId] ?? null;
      cards.push(
        buildSalarySubKpiCardModel(
          buId,
          unit,
          side,
          selectedMonth,
          office?.[selectedMonth] ?? null,
          store?.[selectedMonth] ?? null,
          office,
          store
        )
      );
    }
    return cards;
  }, [
    showSalarySubKpiStrip,
    data,
    selectedUnitCosts,
    selectedMonth,
    activeTab,
    headcountData,
    storeHeadcountData,
  ]);

  /**
   * KPI 3종 (비용·매출대비·판매매출) — 상세 페이지와 같은 지표, 조회 기간 연동.
   * retailSalesData 는 이미 조회 기간 기준(분기=누적 차감)이라 당월·분기는 1열, 누적은 2열에서 읽는다.
   */
  const kpiMetrics = useMemo(() => {
    if (!selectedUnitCosts || !selectedMonth) return null;
    return buildDetailKpiMetrics(
      selectedUnitCosts,
      retailSalesData,
      retailSalesData,
      selectedMonth,
      detailPageRetailKpiMode(selectedUnit),
      costBasis === '재무식' || activeTab === '전체' ? undefined : activeTab,
      { viewMode, costBasis, currency: effectiveCurrency, exchangeRates }
    );
  }, [
    selectedUnitCosts,
    selectedMonth,
    selectedUnit,
    retailSalesData,
    activeTab,
    viewMode,
    costBasis,
    effectiveCurrency,
    exchangeRates,
  ]);

  /** 카드·표가 함께 쓰는 하위 구성 (계정 1차 + 적요 보정) */
  const analysisUnits = useMemo(
    () => (isCorporateUnit ? [...CORPORATE_BUSINESS_UNIT_IDS] : [selectedUnit]),
    [isCorporateUnit, selectedUnit]
  );
  const subLevels = useMemo(
    () => buildSubLevels(analysisData, costBasis, activeTab, analysisUnits),
    [analysisData, costBasis, activeTab, analysisUnits]
  );
  const estimatedCategories = useMemo(
    () => new Set(Object.keys(analysisData?.metadata?.추정월 ?? {})),
    [analysisData]
  );

  /** 계정별 분석 — 카드(대분류 표)와 같은 순서·같은 기준 */
  const analysisRows = useMemo(() => {
    if (!analysisData || !selectedMonth) return [];
    const prevPeriod = previousYearPeriod(period);
    const periodAmountOf = (monthly: MonthlyAmounts) =>
      periodCny(fromMonthly(monthly), period);

    const categories =
      costBasis === '재무식'
        ? getSortedFinancialCategories(analysisCategoryData, selectedMonth, false, periodAmountOf)
        : getSortedCategories(
            analysisCategoryData,
            selectedMonth,
            false,
            categorySortSide(activeTab),
            periodAmountOf
          );

    const units = isCorporateUnit ? [...CORPORATE_BUSINESS_UNIT_IDS] : [selectedUnit];
    const officeSeries = isCorporateUnit
      ? buildCorporateOfficeHeadcountByMonth(headcountData)
      : headcountData?.[selectedUnit] ?? null;
    const storeSeries = isCorporateUnit
      ? buildCorporateStoreHeadcountByMonth(storeHeadcountData)
      : storeHeadcountData?.[selectedUnit] ?? null;

    return buildAccountAnalysis({
      data: analysisData,
      costBasis,
      activeTab,
      units,
      isCorporate: isCorporateUnit,
      categories,
      period,
      prevPeriod,
      currency: effectiveCurrency,
      exchangeRates,
      headcount: {
        office: {
          curr: headcountForPeriod(officeSeries, period),
          prev: headcountForPeriod(officeSeries, prevPeriod),
        },
        store: {
          curr: headcountForPeriod(storeSeries, period),
          prev: headcountForPeriod(storeSeries, prevPeriod),
        },
      },
    });
  }, [
    analysisData,
    analysisCategoryData,
    selectedMonth,
    period,
    costBasis,
    activeTab,
    isCorporateUnit,
    selectedUnit,
    headcountData,
    storeHeadcountData,
    effectiveCurrency,
    exchangeRates,
  ]);

  // 로딩 상태
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-gray-600">데이터를 불러오는 중...</p>
        </div>
      </div>
    );
  }
  
  // 에러 상태
  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center max-w-md p-8 bg-white rounded-lg shadow-lg">
          <svg
            className="w-16 h-16 mx-auto mb-4 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h2 className="text-xl font-bold text-gray-800 mb-2">데이터 로드 오류</h2>
          <p className="text-gray-600 mb-4">{error}</p>
          <div className="bg-gray-50 p-4 rounded-lg text-left text-sm">
            <p className="font-semibold mb-2">해결 방법:</p>
            <ol className="list-decimal list-inside space-y-1 text-gray-600">
              <li>비용 CSV 파일을 <code className="bg-gray-200 px-1 rounded">비용파일/</code> 폴더에 배치</li>
              <li><code className="bg-gray-200 px-1 rounded">python scripts\preprocess.py</code> 실행</li>
              <li>페이지 새로고침</li>
            </ol>
          </div>
        </div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 헤더 */}
      <DashboardHeader
        months={mergedMonths}
        selectedMonth={selectedMonth}
        viewMode={viewMode}
        onMonthChange={setSelectedMonth}
        onViewModeChange={setViewMode}
        disabledViewModes={disabledViewModes}
        costBasis={costBasis}
        onCostBasisChange={handleCostBasisChange}
        currency={currency}
        onCurrencyChange={setCurrency}
        onOpenRateTable={() => setRateTableOpen(true)}
        appliedRate={appliedRate}
        appliedRateLabel={rateColumnLabel}
      />

      <ExchangeRateTable
        open={rateTableOpen}
        onClose={() => setRateTableOpen(false)}
        data={exchangeRates}
        onSaved={setExchangeRates}
        highlightMonth={selectedMonth}
        highlightColumn={rateColumnLabel}
        months={mergedMonths}
      />
      
      {/* 사업부 카드 그리드 */}
      <div className="max-w-[min(100vw,2400px)] mx-auto px-2 py-6 flex flex-col gap-5">
        {/*
          위: 카드(고정 폭) + 계정별 분석 영역(남는 폭 전부).
          아래: KPI·월별 계정 추이·막대 차트를 전체 폭으로.
          좁은 화면에서는 세로로 쌓아 글자가 넘치지 않게 한다.
        */}
        <div className="flex flex-col lg:flex-row gap-5 items-stretch">
          {/* 사업부 카드 — 제목 드롭다운으로 법인/브랜드 전환 */}
          {(() => {
            const isCorporate = selectedUnit === CORPORATE_RETAIL_UNIT;
            const buIds = [...CORPORATE_BUSINESS_UNIT_IDS];
            const meta = BUSINESS_UNITS.find(b => b.id === selectedUnit);

            const cardData = selectedUnitCosts;

            if (!cardData) {
              return (
                <div className="w-full lg:w-[24rem] xl:w-[27rem] shrink-0 bg-white rounded-2xl shadow-md border border-gray-200 p-6">
                  <h2 className="text-xl font-bold text-gray-800 mb-2">{selectedUnit}</h2>
                  <p className="text-gray-500">데이터가 없습니다.</p>
                </div>
              );
            }

            /** 법인은 6개 사업부 합산, 그 외는 해당 사업부 값 */
            const sumHeadcount = (
              source: typeof headcountData,
              excludeManagement: boolean
            ) => {
              const result: { [month: string]: number } = {};
              buIds
                .filter(buId => !(excludeManagement && buId === '경영지원'))
                .forEach(buId => {
                  const series = source?.[buId];
                  if (!series) return;
                  Object.keys(series).forEach(month => {
                    result[month] = (result[month] || 0) + series[month];
                  });
                });
              return Object.keys(result).length > 0 ? result : null;
            };

            const officeSeries = isCorporate
              ? sumHeadcount(headcountData, false)
              : headcountData?.[selectedUnit] ?? null;
            const storeSeries = isCorporate
              ? sumHeadcount(storeHeadcountData, true)
              : storeHeadcountData?.[selectedUnit] ?? null;

            return (
              <div className="w-full lg:w-[24rem] xl:w-[27rem] shrink-0">
              <BusinessUnitCard
                key={selectedUnit}
                id={selectedUnit}
                name={isCorporate ? CORPORATE_RETAIL_UNIT : meta?.name ?? selectedUnit}
                color={isCorporate ? 'navy' : meta?.color ?? 'gray'}
                data={cardData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
                officeHeadcount={officeSeries?.[selectedMonth] ?? null}
                storeHeadcount={storeSeries?.[selectedMonth] ?? null}
                officeHeadcountData={officeSeries}
                storeHeadcountData={storeSeries}
                retailSales={getRetailSales(selectedUnit, period.endMonth)}
                retailSalesData={getRetailSalesData(selectedUnit)}
                retailChannels={getRetailChannels(selectedUnit)}
                retailMetrics={getRetailMetrics(selectedUnit)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                costBasis={costBasis}
                unitOptions={UNIT_OPTIONS}
                onUnitChange={setSelectedUnit}
                currency={effectiveCurrency}
                exchangeRates={exchangeRates}
                salarySubExpanded={salarySubExpanded}
                onSalarySubExpandedChange={setSalarySubExpanded}
                welfareSubExpanded={welfareSubExpanded}
                onWelfareSubExpandedChange={setWelfareSubExpanded}
                subLevels={subLevels}
                estimatedCategories={estimatedCategories}
              />
              </div>
            );
          })()}

          {/* 카드 우측 — 계정별 분석 (적요 기반 구성 증감) */}
          <AccountAnalysisPanel
            rows={analysisRows}
            unitName={
              selectedUnit === CORPORATE_RETAIL_UNIT
                ? '법인'
                : BUSINESS_UNITS.find(b => b.id === selectedUnit)?.name ?? selectedUnit
            }
            currency={effectiveCurrency}
            periodLabel={viewMode}
            fxNote={
              effectiveCurrency === 'KRW'
                ? `환율효과 = 당년 위안 × (당년 ${rateColumnLabel} − 전년 ${rateColumnLabel}). 구성·브랜드 증감은 전년 환율 기준(환율효과 제외)입니다.`
                : null
            }
          />
        </div>

        {/* 카드 아래 — KPI 3종 → 월별 계정 표 → 월별 추이 차트 (카드와 같은 사업부·탭·기준) */}
        {(() => {
          const unitName =
            selectedUnit === CORPORATE_RETAIL_UNIT
              ? '법인'
              : BUSINESS_UNITS.find(b => b.id === selectedUnit)?.name ?? selectedUnit;
          const activeCostSide =
            costBasis === '재무식' || activeTab === '전체' ? undefined : activeTab;

            return (
              <div className="w-full min-w-0 flex flex-col gap-5">
                {kpiMetrics && (
                  <KpiHighlightStrip
                    metrics={kpiMetrics}
                    viewMode={viewMode}
                    retailLoading={retailLoading}
                    currency={effectiveCurrency}
                    title={`${unitName} KPI`}
                    activeCostSide={activeCostSide}
                  />
                )}
                <MonthlyAccountMatrixTable
                  costs={selectedUnitCosts}
                  unitName={unitName}
                  selectedMonth={selectedMonth}
                  activeTab={activeTab}
                  costBasis={costBasis}
                  currency={effectiveCurrency}
                  exchangeRates={exchangeRates}
                  availableMonths={data.metadata.months}
                  subLevels={subLevels}
                  estimatedCategories={estimatedCategories}
                />
                {chartMonths.length > 0 && (
                  <MonthlyCostTrendChart
                    categoryData={chartCategoryData}
                    months={chartMonths}
                    costType={activeTab}
                    onCostTypeChange={setActiveTab}
                    showTotalTab
                    showSideSummary={false}
                    costBasis={costBasis}
                    currency={effectiveCurrency}
                    highlightMonthKey={selectedMonth}
                    legendSelected={isCorporateUnit ? chartLegendSelected : undefined}
                    onLegendSelectedChange={
                      isCorporateUnit ? setChartLegendSelected : undefined
                    }
                  />
                )}
                {showSalarySubKpiStrip && salarySubKpiCards.length > 0 && (
                  <CorporateSalarySubKpiStrip
                    cards={salarySubKpiCards}
                    costType={activeTab as '직접비' | '영업비' | '전체'}
                  />
                )}
              </div>
            );
        })()}
      </div>
    </div>
  );
}
