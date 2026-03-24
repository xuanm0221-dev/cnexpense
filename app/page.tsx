'use client';

/**
 * 홈 대시보드 페이지
 */

import { useState, useEffect, useMemo } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import BusinessUnitCard from '@/components/BusinessUnitCard';
import { CostData, ViewMode, CostType, BUSINESS_UNITS, HeadcountData, StoreHeadcountData, RetailSalesData } from '@/lib/types';
import { loadCostData, isDataEmpty, loadHeadcountData, loadStoreHeadcountData, loadRetailSalesData } from '@/lib/data-loader';

export default function HomePage() {
  const [data, setData] = useState<CostData | null>(null);
  const [headcountData, setHeadcountData] = useState<HeadcountData | null>(null);
  const [storeHeadcountData, setStoreHeadcountData] = useState<StoreHeadcountData | null>(null);
  const [retailSalesData, setRetailSalesData] = useState<RetailSalesData | null>(null);
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
  
  // 데이터 로드 (초기 로드)
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const [costData, headcount, storeHeadcount] = await Promise.all([
          loadCostData(),
          loadHeadcountData(),
          loadStoreHeadcountData(),
        ]);
        
        if (isDataEmpty(costData)) {
          setError('비용 데이터가 없습니다. Python 전처리 스크립트를 실행해주세요.');
          return;
        }
        
        setData(costData);
        setHeadcountData(headcount);
        setStoreHeadcountData(storeHeadcount);
        
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

  // 리테일 매출 데이터 로드 (selectedMonth, viewMode 변경 시)
  useEffect(() => {
    if (!selectedMonth) return;
    
    async function fetchRetailSales() {
      try {
        const retailSales = await loadRetailSalesData(selectedMonth, viewMode);
        setRetailSalesData(retailSales);
      } catch (err) {
        console.error('리테일 매출 데이터 로드 실패:', err);
        setRetailSalesData(null);
      }
    }
    
    fetchRetailSales();
  }, [selectedMonth, viewMode]);
  
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
      />
      
      {/* 사업부 카드 그리드 */}
      <div className="max-w-[1920px] mx-auto px-2 py-6">
        {/* 토글 버튼 */}
        <div className="flex justify-end mb-4">
          <button
            onClick={() => setShowOtherBU(!showOtherBU)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium text-gray-700"
          >
            {showOtherBU ? '기타 사업부 숨기기 ▲' : '기타 사업부 보기 ▼'}
          </button>
        </div>
        
        <div className={`grid ${showOtherBU ? 'grid-cols-7' : 'grid-cols-5'} gap-6`}>
          {/* 법인 카드 (6개 합계) */}
          {(() => {
            // 6개 사업부 합계 계산
            const corporateData: any = { 직접비: {}, 영업비: {} };
            const buIds = ['MLB', 'MLB KIDS', 'Discovery', '경영지원', 'Duvetica', 'SUPRA'];
            
            buIds.forEach(buId => {
              const buData = data.data[buId];
              if (buData) {
                // 직접비 합산
                for (const category in buData.직접비) {
                  if (!corporateData.직접비[category]) {
                    corporateData.직접비[category] = {};
                  }
                  for (const month in buData.직접비[category]) {
                    corporateData.직접비[category][month] = 
                      (corporateData.직접비[category][month] || 0) + buData.직접비[category][month];
                  }
                }
                // 영업비 합산
                for (const category in buData.영업비) {
                  if (!corporateData.영업비[category]) {
                    corporateData.영업비[category] = {};
                  }
                  for (const month in buData.영업비[category]) {
                    corporateData.영업비[category][month] = 
                      (corporateData.영업비[category][month] || 0) + buData.영업비[category][month];
                  }
                }
              }
            });
            
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
            
            // 법인 리테일 매출 합산 (모든 브랜드 합계, 경영지원 제외)
            const corporateRetailSales = (() => {
              let total = 0;
              let hasData = false;
              buIds.filter(buId => buId !== '경영지원').forEach(buId => {
                const sales = getRetailSales(buId, selectedMonth);
                if (sales !== null) {
                  total += sales;
                  hasData = true;
                }
              });
              return hasData ? total : null;
            })();
            
            // 법인 리테일 매출 전체 데이터 (YoY 계산용, 경영지원 제외)
            const corporateRetailSalesData = (() => {
              const result: { [month: string]: number } = {};
              buIds.filter(buId => buId !== '경영지원').forEach(buId => {
                const buData = getRetailSalesData(buId);
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
                data={corporateData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
                officeHeadcount={corporateOfficeHeadcount}
                storeHeadcount={corporateStoreHeadcount}
                officeHeadcountData={corporateOfficeHeadcountData}
                storeHeadcountData={corporateStoreHeadcountData}
                retailSales={corporateRetailSales}
                retailSalesData={corporateRetailSalesData}
                activeTab={activeTab}
                onTabChange={setActiveTab}
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
                retailSales={getRetailSales(bu.id, selectedMonth)}
                retailSalesData={getRetailSalesData(bu.id)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
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
                retailSales={getRetailSales(bu.id, selectedMonth)}
                retailSalesData={getRetailSalesData(bu.id)}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
