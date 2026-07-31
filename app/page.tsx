'use client';

/**
 * 홈 대시보드 페이지
 */

import { useState, useEffect, useMemo } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import BusinessUnitCard from '@/components/BusinessUnitCard';
import { CostBasis, CostData, ViewMode, CostType, BUSINESS_UNITS, HeadcountData, StoreHeadcountData, RetailSalesResponse } from '@/lib/types';
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
  retailChannelsFor,
  retailMetricsFor,
  toRetailSalesData,
} from '@/lib/data-loader';

export default function HomePage() {
  const [data, setData] = useState<CostData | null>(null);
  const [headcountData, setHeadcountData] = useState<HeadcountData | null>(null);
  const [storeHeadcountData, setStoreHeadcountData] = useState<StoreHeadcountData | null>(null);
  const [retailResponse, setRetailResponse] = useState<RetailSalesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 선택된 월 (기본값: 가장 최근 월)
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  
  // 뷰 모드 (당월 / 누적(YTD))
  const [viewMode, setViewMode] = useState<ViewMode>('당월');
  
  // 기타 사업부 표시 여부 (Duvetica, SUPRA)
  const [showOtherBU, setShowOtherBU] = useState<boolean>(false);
  
  // 직접비/영업비/전체 탭 (모든 카드 동기화)
  const [activeTab, setActiveTab] = useState<CostType>('전체');

  // 집계 기준: 관리식(기본) / 재무식(연결계정과목)
  const [costBasis, setCostBasis] = useState<CostBasis>('관리식');

  // 통화 (재무식에서만 노출) + 환율표
  const [currency, setCurrency] = useState<Currency>('CNY');
  const [retailBaseResponse, setRetailBaseResponse] = useState<RetailSalesResponse | null>(null);
  const [exchangeRates, setExchangeRates] = useState<ExchangeRateData | null>(null);
  const [rateTableOpen, setRateTableOpen] = useState(false);

  // 재무식 표의 전년 금액 컬럼 (기본 숨김)
  const [showPrevYearAmount, setShowPrevYearAmount] = useState(false);

  // 급여·복리비 중분류 토글 (모든 카드 동기화)
  const [salarySubExpanded, setSalarySubExpanded] = useState(false);
  const [welfareSubExpanded, setWelfareSubExpanded] = useState(false);
  
  // 데이터 로드 (초기 로드)
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [costData, headcount, storeHeadcount, rates] = await Promise.all([
          loadCostData(),
          loadHeadcountData(),
          loadStoreHeadcountData(),
          loadExchangeRates(),
        ]);

        if (isDataEmpty(costData)) {
          setError('비용 데이터가 없습니다. Python 전처리 스크립트를 실행해주세요.');
          return;
        }

        setData(costData);
        setHeadcountData(headcount);
        setStoreHeadcountData(storeHeadcount);
        setExchangeRates(rates);
        
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
        showOtherBU={showOtherBU}
        onToggleOtherBU={() => setShowOtherBU(!showOtherBU)}
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
        highlightMonth={selectedMonth}
        highlightColumn={rateColumnLabel}
        months={mergedMonths}
      />
      
      {/* 사업부 카드 그리드 */}
      <div className="max-w-[min(100vw,2400px)] mx-auto px-2 py-6">
        <div className={`grid ${showOtherBU ? 'grid-cols-7' : 'grid-cols-5'} gap-5`}>
          {/* 법인 카드 (6개 합계) */}
          {(() => {
            const buIds = [...CORPORATE_BUSINESS_UNIT_IDS];
            const corporateCardData = mergeCorporateBusinessUnitCosts(data.data);

            // 법인 사무실 인원수 합산 (모든 사업부 포함)
            const corporateOfficeHeadcount = (() => {
              let total = 0;
              let hasData = false;
              buIds.forEach(buId => {
                const hc = getOfficeHeadcount(buId, selectedMonth);
                if (hc !== null) {
                  total += hc;
                  hasData = true;
                }
              });
              return hasData ? total : null;
            })();
            
            // 법인 매장 인원수 합산 (경영지원 제외)
            const corporateStoreHeadcount = (() => {
              let total = 0;
              let hasData = false;
              buIds.filter(buId => buId !== '경영지원').forEach(buId => {
                const hc = getStoreHeadcount(buId, selectedMonth);
                if (hc !== null) {
                  total += hc;
                  hasData = true;
                }
              });
              return hasData ? total : null;
            })();
            
            // 법인 사무실 인원수 전체 데이터 (YoY 계산용)
            const corporateOfficeHeadcountData = (() => {
              const result: { [month: string]: number } = {};
              buIds.forEach(buId => {
                const buData = headcountData?.[buId];
                if (buData) {
                  Object.keys(buData).forEach(month => {
                    result[month] = (result[month] || 0) + buData[month];
                  });
                }
              });
              return Object.keys(result).length > 0 ? result : null;
            })();
            
            // 법인 매장 인원수 전체 데이터 (YoY 계산용, 경영지원 제외)
            const corporateStoreHeadcountData = (() => {
              const result: { [month: string]: number } = {};
              buIds.filter(buId => buId !== '경영지원').forEach(buId => {
                const buData = storeHeadcountData?.[buId];
                if (buData) {
                  Object.keys(buData).forEach(month => {
                    result[month] = (result[month] || 0) + buData[month];
                  });
                }
              });
              return Object.keys(result).length > 0 ? result : null;
            })();

            return (
              <BusinessUnitCard
                key="법인"
                id="법인"
                name="법인"
                color="purple"
                data={corporateCardData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
                officeHeadcount={corporateOfficeHeadcount}
                storeHeadcount={corporateStoreHeadcount}
                officeHeadcountData={corporateOfficeHeadcountData}
                storeHeadcountData={corporateStoreHeadcountData}
                retailSales={getRetailSales(CORPORATE_RETAIL_UNIT, period.endMonth)}
                retailSalesData={getRetailSalesData(CORPORATE_RETAIL_UNIT)}
                retailChannels={getRetailChannels(CORPORATE_RETAIL_UNIT)}
                retailMetrics={getRetailMetrics(CORPORATE_RETAIL_UNIT)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                costBasis={costBasis}
                currency={effectiveCurrency}
                exchangeRates={exchangeRates}
                showPrevYearAmount={showPrevYearAmount}
                salarySubExpanded={salarySubExpanded}
                onSalarySubExpandedChange={setSalarySubExpanded}
                welfareSubExpanded={welfareSubExpanded}
                onWelfareSubExpandedChange={setWelfareSubExpanded}
              />
            );
          })()}
          
          {/* 주요 사업부 */}
          {['MLB', 'MLB KIDS', 'Discovery', '경영지원'].map(buId => {
            const bu = BUSINESS_UNITS.find(b => b.id === buId);
            if (!bu) return null;
            
            const buData = data.data[bu.id];
            
            if (!buData) {
              return (
                <div
                  key={bu.id}
                  className="bg-white rounded-xl shadow-md border border-gray-200 p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-2">{bu.name}</h2>
                  <p className="text-gray-500">데이터가 없습니다.</p>
                </div>
              );
            }
            
            return (
              <BusinessUnitCard
                key={bu.id}
                id={bu.id}
                name={bu.name}
                color={bu.color}
                data={buData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
                officeHeadcount={getOfficeHeadcount(bu.id, selectedMonth)}
                storeHeadcount={getStoreHeadcount(bu.id, selectedMonth)}
                officeHeadcountData={headcountData?.[bu.id] || null}
                storeHeadcountData={storeHeadcountData?.[bu.id] || null}
                retailSales={getRetailSales(bu.id, period.endMonth)}
                retailSalesData={getRetailSalesData(bu.id)}
                retailChannels={getRetailChannels(bu.id)}
                retailMetrics={getRetailMetrics(bu.id)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                costBasis={costBasis}
                currency={effectiveCurrency}
                exchangeRates={exchangeRates}
                showPrevYearAmount={showPrevYearAmount}
                salarySubExpanded={salarySubExpanded}
                onSalarySubExpandedChange={setSalarySubExpanded}
                welfareSubExpanded={welfareSubExpanded}
                onWelfareSubExpandedChange={setWelfareSubExpanded}
              />
            );
          })}
          
          {/* 기타 사업부 (토글) */}
          {showOtherBU && ['Duvetica', 'SUPRA'].map(buId => {
            const bu = BUSINESS_UNITS.find(b => b.id === buId);
            if (!bu) return null;
            
            const buData = data.data[bu.id];
            
            if (!buData) {
              return (
                <div
                  key={bu.id}
                  className="bg-white rounded-xl shadow-md border border-gray-200 p-6"
                >
                  <h2 className="text-xl font-bold text-gray-800 mb-2">{bu.name}</h2>
                  <p className="text-gray-500">데이터가 없습니다.</p>
                </div>
              );
            }
            
            return (
              <BusinessUnitCard
                key={bu.id}
                id={bu.id}
                name={bu.name}
                color={bu.color}
                data={buData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
                officeHeadcount={getOfficeHeadcount(bu.id, selectedMonth)}
                storeHeadcount={getStoreHeadcount(bu.id, selectedMonth)}
                officeHeadcountData={headcountData?.[bu.id] || null}
                storeHeadcountData={storeHeadcountData?.[bu.id] || null}
                retailSales={getRetailSales(bu.id, period.endMonth)}
                retailSalesData={getRetailSalesData(bu.id)}
                retailChannels={getRetailChannels(bu.id)}
                retailMetrics={getRetailMetrics(bu.id)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
                costBasis={costBasis}
                currency={effectiveCurrency}
                exchangeRates={exchangeRates}
                showPrevYearAmount={showPrevYearAmount}
                salarySubExpanded={salarySubExpanded}
                onSalarySubExpandedChange={setSalarySubExpanded}
                welfareSubExpanded={welfareSubExpanded}
                onWelfareSubExpandedChange={setWelfareSubExpanded}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
