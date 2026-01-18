'use client';

/**
 * 홈 대시보드 페이지
 */

import { useState, useEffect } from 'react';
import DashboardHeader from '@/components/DashboardHeader';
import BusinessUnitCard from '@/components/BusinessUnitCard';
import { CostData, ViewMode, BUSINESS_UNITS } from '@/lib/types';
import { loadCostData, isDataEmpty } from '@/lib/data-loader';

export default function HomePage() {
  const [data, setData] = useState<CostData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 선택된 월 (기본값: 가장 최근 월)
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  
  // 뷰 모드 (당월 / 누적(YTD))
  const [viewMode, setViewMode] = useState<ViewMode>('당월');
  
  // 기타 사업부 표시 여부 (Duvetica, SUPRA)
  const [showOtherBU, setShowOtherBU] = useState<boolean>(false);
  
  // 데이터 로드
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const costData = await loadCostData();
        
        if (isDataEmpty(costData)) {
          setError('비용 데이터가 없습니다. Python 전처리 스크립트를 실행해주세요.');
          return;
        }
        
        setData(costData);
        
        // 가장 최근 월을 기본값으로 설정
        const months = costData.metadata.months;
        if (months.length > 0) {
          setSelectedMonth(months[months.length - 1]);
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
        months={data.metadata.months}
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
            
            return (
              <BusinessUnitCard
                key="법인"
                id="법인"
                name="법인"
                color="purple"
                data={corporateData}
                selectedMonth={selectedMonth}
                viewMode={viewMode}
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
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
