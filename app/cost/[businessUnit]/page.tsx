'use client';

/**
 * 사업부별 상세 대시보드
 */

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import CostDetailHeader from '@/components/CostDetailHeader';
import CorporateDetailKpiCard from '@/components/CorporateDetailKpiCard';
import CorporateSalarySubKpiStrip from '@/components/CorporateSalarySubKpiStrip';
import MonthlyCostTrendChart from '@/components/MonthlyCostTrendChart';
import ExpenseAccountHierarchyTable from '@/components/ExpenseAccountHierarchyTable';
import { getSortedCategoriesForMonths } from '@/lib/calculations';
import {
  buildCorporateOfficeHeadcountByMonth,
  buildCorporateStoreHeadcountByMonth,
  sumCorporateOfficeHeadcountSnapshot,
  sumCorporateStoreHeadcountSnapshot,
} from '@/lib/corporate-headcount';
import { buildSalarySubKpiCardModel } from '@/lib/salary-sub-kpi';
import {
  BUSINESS_UNITS,
  CostBasis,
  CostData,
  HeadcountData,
  RetailSalesResponse,
  StoreHeadcountData,
  ViewMode,
} from '@/lib/types';
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
import { mergeCorporateBusinessUnitCosts, isCorporateBusinessUnitSlug } from '@/lib/corporate-cost-merge';
import {
  buildDetailKpiMetrics,
  detailPageRetailKpiMode,
} from '@/lib/detail-corporate-kpi';
import {
  loadCostData,
  isDataEmpty,
  loadHeadcountData,
  loadExchangeRates,
  loadRetailSales,
  loadStoreHeadcountData,
  toRetailSalesData,
} from '@/lib/data-loader';
import { getDetailChartRollingMonths } from '@/lib/rolling-months';

type CostSide = '직접비' | '영업비';

export default function BusinessUnitDetailPage() {
  const params = useParams();
  const rawParam = params.businessUnit as string;
  const decodedId = decodeURIComponent(rawParam);

  const buMeta = useMemo(
    () => BUSINESS_UNITS.find(u => u.id === decodedId || u.name === decodedId),
    [decodedId]
  );
  const buKey = buMeta?.id ?? decodedId;

  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [costType, setCostType] = useState<CostSide>('영업비');
  // 홈 대시보드와 동일한 조회 컨트롤
  const [viewMode, setViewMode] = useState<ViewMode>('당월');
  const [costBasis, setCostBasis] = useState<CostBasis>('관리식');
  const [currency, setCurrency] = useState<Currency>('CNY');
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateData | null>(null);
  const [rateTableOpen, setRateTableOpen] = useState(false);
  const [showPrevYearAmount, setShowPrevYearAmount] = useState(false);
  const [retailResponse, setRetailResponse] = useState<RetailSalesResponse | null>(null);
  const [retailLoading, setRetailLoading] = useState(false);
  const [headcountData, setHeadcountData] = useState<HeadcountData | null>(null);
  const [storeHeadcountData, setStoreHeadcountData] = useState<StoreHeadcountData | null>(null);
  const [chartLegendSelected, setChartLegendSelected] = useState<Set<string>>(() => new Set());

  const isCorporate = isCorporateBusinessUnitSlug(buKey);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        const [costData, headcount, storeHc, rates] = await Promise.all([
          loadCostData(),
          loadHeadcountData(),
          loadStoreHeadcountData(),
          loadExchangeRates(),
        ]);
        if (cancelled) return;
        if (isDataEmpty(costData)) {
          setError('비용 데이터가 없습니다. Python 전처리 스크립트를 실행해주세요.');
          setData(null);
          return;
        }
        setData(costData);
        setHeadcountData(headcount);
        setStoreHeadcountData(storeHc);
        setExchangeRates(rates);
        const months = costData.metadata.months;
        if (months.length > 0) {
          setSelectedMonth(prev => prev || months[months.length - 1]);
        }
        setError(null);
      } catch (e) {
        console.error(e);
        if (!cancelled) setError('데이터를 불러오는 중 오류가 발생했습니다.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedMonth) return;
    let cancelled = false;
    async function fetchRetail() {
      setRetailLoading(true);
      try {
        // 당월·YTD가 한 응답에 함께 오므로 호출 1회
        const retail = await loadRetailSales(selectedMonth);
        if (cancelled) return;
        setRetailResponse(retail);
      } catch (e) {
        console.error(e);
        if (!cancelled) setRetailResponse(null);
      } finally {
        if (!cancelled) setRetailLoading(false);
      }
    }
    fetchRetail();
    return () => {
      cancelled = true;
    };
  }, [selectedMonth]);

  const retailMonth = useMemo(
    () => toRetailSalesData(retailResponse, '당월'),
    [retailResponse]
  );
  const retailYtd = useMemo(
    () => toRetailSalesData(retailResponse, '누적(YTD)'),
    [retailResponse]
  );

  const buCosts = useMemo(() => {
    if (!data) return undefined;
    if (isCorporateBusinessUnitSlug(buKey)) {
      return mergeCorporateBusinessUnitCosts(data.data);
    }
    return data.data[buKey];
  }, [data, buKey]);
  const monthsForChart = useMemo(
    () => (selectedMonth ? getDetailChartRollingMonths(selectedMonth) : []),
    [selectedMonth]
  );

  const isFinancial = costBasis === '재무식';

  /** 표에 쓸 원본(위안) 데이터 — 재무식이면 연결계정과목 */
  const categoryData = useMemo(() => {
    if (!buCosts) return {};
    if (isFinancial) return buCosts.재무식 ?? {};
    return costType === '직접비' ? buCosts.직접비 : buCosts.영업비;
  }, [buCosts, costType, isFinancial]);

  /** 차트용 — 원화면 각 달의 월평균 환율로 환산한 사본 */
  const chartCategoryData = useMemo(
    () =>
      isFinancial && currency === 'KRW'
        ? convertCategoryDataToKrw(categoryData, exchangeRates)
        : categoryData,
    [categoryData, isFinancial, currency, exchangeRates]
  );

  const period = useMemo(
    () => buildPeriod(selectedMonth, viewMode),
    [selectedMonth, viewMode]
  );

  const rateColumnLabel: '월평균' | '기간평균' =
    viewMode === '당월' ? '월평균' : '기간평균';
  const appliedRate = useMemo(
    () => rateForMonth(exchangeRates, period.endMonth, rateColumnLabel),
    [exchangeRates, period.endMonth, rateColumnLabel]
  );
  const effectiveCurrency: Currency = isFinancial ? currency : 'CNY';
  const monthOptionsAll = data?.metadata.months ?? [];
  const disabledViewModes = useMemo(
    () =>
      VIEW_MODES.filter(
        mode =>
          isQuarterView(mode) &&
          !periodHasData(buildPeriod(selectedMonth, mode), monthOptionsAll)
      ),
    [selectedMonth, monthOptionsAll]
  );

  const legendCostType = isFinancial ? undefined : costType;
  const categoryLegendKey = useMemo(
    () => getSortedCategoriesForMonths(chartCategoryData, monthsForChart, legendCostType).join('|'),
    [chartCategoryData, monthsForChart, legendCostType]
  );

  useLayoutEffect(() => {
    if (!isCorporate) return;
    const cats = getSortedCategoriesForMonths(chartCategoryData, monthsForChart, legendCostType);
    setChartLegendSelected(new Set(cats));
  }, [isCorporate, categoryLegendKey, chartCategoryData, monthsForChart, legendCostType]);

  const glByCategory = useMemo(() => {
    if (isFinancial) return buCosts?.재무식GL설명;
    if (!buCosts?.대분류별GL설명) return undefined;
    return costType === '직접비'
      ? buCosts.대분류별GL설명.직접비
      : buCosts.대분류별GL설명.영업비;
  }, [buCosts, costType, isFinancial]);

  const displayName = isCorporateBusinessUnitSlug(decodedId)
    ? '법인'
    : (buMeta?.name ?? decodedId);

  const detailKpiMetrics = useMemo(() => {
    if (!buCosts || !selectedMonth) return null;
    return buildDetailKpiMetrics(
      buCosts,
      retailMonth,
      retailYtd,
      selectedMonth,
      detailPageRetailKpiMode(buKey),
      isFinancial ? undefined : costType,
      { viewMode, costBasis, currency: effectiveCurrency, exchangeRates }
    );
  }, [
    buCosts,
    buKey,
    selectedMonth,
    retailMonth,
    retailYtd,
    costType,
    viewMode,
    costBasis,
    isFinancial,
    effectiveCurrency,
    exchangeRates,
  ]);

  const salarySubKpiCards = useMemo(() => {
    if (!isCorporate || !data || !buCosts || !selectedMonth) return [];
    const corpOffice = buildCorporateOfficeHeadcountByMonth(headcountData);
    const corpStore = buildCorporateStoreHeadcountByMonth(storeHeadcountData);
    const corpOfficeSnap = sumCorporateOfficeHeadcountSnapshot(headcountData, selectedMonth);
    const corpStoreSnap = sumCorporateStoreHeadcountSnapshot(storeHeadcountData, selectedMonth);

    const cards = [
      buildSalarySubKpiCardModel(
        '법인 전체',
        buCosts,
        costType,
        selectedMonth,
        corpOfficeSnap,
        corpStoreSnap,
        corpOffice,
        corpStore
      ),
    ];

    for (const buId of ['MLB', 'MLB KIDS', 'Discovery'] as const) {
      const unit = data.data[buId];
      if (!unit) continue;
      const o = headcountData?.[buId] ?? null;
      const s = storeHeadcountData?.[buId] ?? null;
      const oSnap = o?.[selectedMonth] ?? null;
      const sSnap = s?.[selectedMonth] ?? null;
      cards.push(
        buildSalarySubKpiCardModel(
          buId,
          unit,
          costType,
          selectedMonth,
          oSnap,
          sSnap,
          o,
          s
        )
      );
    }

    return cards;
  }, [
    isCorporate,
    data,
    buCosts,
    selectedMonth,
    costType,
    headcountData,
    storeHeadcountData,
  ]);

  const showSalarySubKpiStrip =
    isCorporate &&
    chartLegendSelected.size === 1 &&
    chartLegendSelected.has('급여');

  const kpiTitle = isCorporate ? '법인 KPI' : `${displayName} KPI`;
  const kpiAriaLabel = isCorporate
    ? `법인 KPI: 비용·매출대비는 차트 ${costType} 기준, 판매매출은 리테일 5개 브랜드 합산(탭과 무관)`
    : buKey === '경영지원'
      ? `${displayName} KPI: 비용·매출대비는 차트 ${costType} 기준, 판매매출은 리테일 5개 브랜드 합산(탭과 무관, 홈 경영지원과 동일)`
      : `${displayName} KPI: 비용·매출대비는 차트 ${costType} 기준, 판매매출은 ${displayName} 브랜드 리테일(탭과 무관)`;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-600">불러오는 중…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-red-600">{error}</p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  if (!buCosts) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
        <div className="max-w-md text-center space-y-4">
          <p className="text-gray-700">
            사업부 <span className="font-semibold">{displayName}</span> 데이터를 찾을 수 없습니다.
          </p>
          <Link
            href="/"
            className="inline-block px-4 py-2 rounded-lg bg-gray-900 text-white text-sm"
          >
            홈으로
          </Link>
        </div>
      </div>
    );
  }

  const monthOptions = data?.metadata.months ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <CostDetailHeader
        decodedBusinessUnitParam={decodedId}
        months={monthOptions}
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        disabledViewModes={disabledViewModes}
        costBasis={costBasis}
        onCostBasisChange={setCostBasis}
        currency={currency}
        onCurrencyChange={setCurrency}
        onOpenRateTable={() => setRateTableOpen(true)}
        appliedRate={appliedRate}
        appliedRateLabel={rateColumnLabel}
        showPrevYearAmount={showPrevYearAmount}
        onTogglePrevYearAmount={() => setShowPrevYearAmount(v => !v)}
      />

      <ExchangeRateTable
        open={rateTableOpen}
        onClose={() => setRateTableOpen(false)}
        data={exchangeRates}
        onSaved={setExchangeRates}
        highlightMonth={period.endMonth}
        highlightColumn={rateColumnLabel}
        months={monthOptions}
      />

      <main className="max-w-[min(100vw,2880px)] mx-auto px-4 py-6">
        {detailKpiMetrics && (
          <CorporateDetailKpiCard
            metrics={detailKpiMetrics}
            retailLoading={retailLoading}
            title={kpiTitle}
            activeCostSide={isFinancial ? undefined : costType}
            ariaLabel={kpiAriaLabel}
            currency={effectiveCurrency}
            periodLabel={viewMode === '누적(YTD)' ? '당월' : viewMode}
          />
        )}
        {showSalarySubKpiStrip && (
          <CorporateSalarySubKpiStrip cards={salarySubKpiCards} costType={costType} />
        )}
        {monthsForChart.length > 0 && (
          <MonthlyCostTrendChart
            categoryData={chartCategoryData}
            months={monthsForChart}
            costType={costType}
            onCostTypeChange={setCostType}
            costBasis={costBasis}
            currency={effectiveCurrency}
            highlightMonthKey={selectedMonth}
            legendSelected={isCorporate ? chartLegendSelected : undefined}
            onLegendSelectedChange={isCorporate ? setChartLegendSelected : undefined}
          />
        )}
        {selectedMonth && (
          <ExpenseAccountHierarchyTable
            title={`${displayName} 비용 계정 상세 분석`}
            categoryData={categoryData}
            glByCategory={glByCategory}
            selectedMonth={selectedMonth}
            costSide={costType}
            costBasis={costBasis}
            viewMode={viewMode}
            currency={effectiveCurrency}
            exchangeRates={exchangeRates}
          />
        )}
      </main>
    </div>
  );
}
