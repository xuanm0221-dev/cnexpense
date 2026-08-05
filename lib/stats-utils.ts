/**
 * 통계 분석 유틸리티 함수
 */

/**
 * 피어슨 상관계수 계산
 * @param x X 변수 배열
 * @param y Y 변수 배열
 * @returns 상관계수 r (-1 ~ 1)
 */
export function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) {
    return 0;
  }

  const n = x.length;
  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumX2 = x.reduce((sum, val) => sum + val * val, 0);
  const sumY2 = y.reduce((sum, val) => sum + val * val, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * 단순 선형회귀 계산: y = α + βx
 * @param x X 변수 배열 (독립변수)
 * @param y Y 변수 배열 (종속변수)
 * @returns 회귀 계수 및 통계량
 */
export function calculateLinearRegression(
  x: number[],
  y: number[]
): {
  alpha: number; // 절편
  beta: number; // 기울기
  rSquared: number; // 결정계수
} {
  if (x.length !== y.length || x.length < 2) {
    return { alpha: 0, beta: 0, rSquared: 0 };
  }

  const n = x.length;
  const sumX = x.reduce((sum, val) => sum + val, 0);
  const sumY = y.reduce((sum, val) => sum + val, 0);
  const sumXY = x.reduce((sum, val, i) => sum + val * y[i], 0);
  const sumX2 = x.reduce((sum, val) => sum + val * val, 0);

  const meanX = sumX / n;
  const meanY = sumY / n;

  // 기울기 (β) 계산
  const beta = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);

  // 절편 (α) 계산
  const alpha = meanY - beta * meanX;

  // R² (결정계수) 계산
  const yPredicted = x.map((xi) => alpha + beta * xi);
  const ssTotal = y.reduce((sum, yi) => sum + Math.pow(yi - meanY, 2), 0);
  const ssResidual = y.reduce(
    (sum, yi, i) => sum + Math.pow(yi - yPredicted[i], 2),
    0
  );
  const rSquared = ssTotal === 0 ? 0 : 1 - ssResidual / ssTotal;

  return {
    alpha,
    beta,
    rSquared: Math.max(0, Math.min(1, rSquared)), // 0~1 범위로 제한
  };
}

/**
 * 회귀선 예측값 계산
 * @param x X 값
 * @param alpha 절편
 * @param beta 기울기
 * @returns 예측된 Y 값
 */
export function predictY(x: number, alpha: number, beta: number): number {
  return alpha + beta * x;
}

/**
 * 증감률 계산
 * @param current 현재 값
 * @param previous 이전 값
 * @returns 증감률 (%) 또는 null
 */
export function calculateChangeRate(
  current: number,
  previous: number | null
): number | null {
  if (previous === null || previous === 0) {
    return null;
  }
  return ((current - previous) / Math.abs(previous)) * 100;
}

/**
 * 자동 해석 문구 생성
 * @param r 상관계수
 * @param beta β 계수
 * @param rSquared R²
 * @returns 해석 문구
 */
export function generateInterpretation(
  r: number,
  beta: number,
  rSquared: number
): string {
  let correlation: string;
  if (r > 0.7) {
    correlation = "강한 양의 상관관계";
  } else if (r > 0.4) {
    correlation = "중간 정도의 양의 상관관계";
  } else if (r > 0.1) {
    correlation = "약한 양의 상관관계";
  } else if (r > -0.1) {
    correlation = "상관관계가 거의 없음";
  } else {
    correlation = "음의 상관관계";
  }

  const betaText =
    beta > 0
      ? `광고비 1단위 증가 시 매출은 약 ${beta.toFixed(2)}배 증가`
      : `광고비 증가가 매출에 부정적 영향`;

  return `광고비와 매출 간 상관계수는 ${r.toFixed(
    2
  )}로, ${correlation}를 보이고 있습니다. ${betaText}하며, 광고비가 매출 변동의 ${(
    rSquared * 100
  ).toFixed(1)}%를 설명합니다.`;
}

/**
 * ROAS (Return on Ad Spend) 계산
 * @param sales 매출
 * @param adSpend 광고비
 * @returns ROAS 값
 */
export function calculateROAS(sales: number, adSpend: number): number {
  if (adSpend === 0) return 0;
  return sales / adSpend;
}

/**
 * ROI (Return on Investment) 계산
 * @param sales 매출
 * @param adSpend 광고비
 * @returns ROI (%)
 */
export function calculateROI(sales: number, adSpend: number): number {
  if (adSpend === 0) return 0;
  return ((sales - adSpend) / adSpend) * 100;
}

export interface EfficiencyGrade {
  grade: "A" | "B" | "C" | "D";
  color: string;
  bgColor: string;
  reason: string;
  action: string;
}

/**
 * 광고 효율 등급 계산
 * @param r 상관계수
 * @param avgROAS 평균 ROAS
 * @returns 효율 등급 정보
 */
export function calculateEfficiencyGrade(
  r: number,
  avgROAS: number
): EfficiencyGrade {
  if (r > 0.7 && avgROAS > 5) {
    return {
      grade: "A",
      color: "#ffffff",
      bgColor: "#10b981",
      reason: "상관계수(r) 0.7 초과, 평균 ROAS 5 초과로 광고-매출 연계가 매우 양호합니다.",
      action: "광고 효율이 매우 우수합니다. 광고비 확대를 고려하세요.",
    };
  } else if (r > 0.5 && avgROAS > 3) {
    return {
      grade: "B",
      color: "#ffffff",
      bgColor: "#3b82f6",
      reason: "상관계수(r) 0.5 초과, 평균 ROAS 3 초과로 광고 효율이 양호합니다.",
      action: "광고 효율이 양호합니다. 현재 전략을 유지하세요.",
    };
  } else if (r > 0.3 && avgROAS > 1) {
    return {
      grade: "C",
      color: "#000000",
      bgColor: "#fbbf24",
      reason: "상관계수(r) 0.3 초과, 평균 ROAS 1 초과이나 개선 여지가 있습니다.",
      action: "광고 효율이 보통입니다. 타겟팅 최적화를 검토하세요.",
    };
  } else {
    const rLow = r <= 0.3;
    const roasLow = avgROAS <= 1;
    let reason: string;
    if (rLow && roasLow) {
      reason = "상관계수(r) 0.3 이하이고 평균 ROAS가 1 미만입니다.";
    } else if (rLow) {
      reason =
        "광고비-매출 상관계수(r)가 0.3 이하로, 광고 효과가 데이터상 뚜렷하지 않습니다.";
    } else {
      reason = "평균 ROAS가 1 미만으로, 광고비 대비 매출이 부족합니다.";
    }
    return {
      grade: "D",
      color: "#ffffff",
      bgColor: "#ef4444",
      reason,
      action:
        "상관 개선: 타겟팅·채널·노출 구조 재검토. ROAS 개선: 비효율 채널 축소, 전환율·랜딩 개선. 이후 데이터로 재측정 권장.",
    };
  }
}

export interface OptimalRange {
  range: string;
  avgROAS: number;
  count: number;
  recommendation: string;
}

/**
 * 최적 광고비 구간 분석
 * @param data 광고비-매출 데이터 배열
 * @returns 구간별 ROAS 및 최적 구간
 */
export function findOptimalAdSpendRange(
  data: Array<{ adSpend: number; sales: number }>
): {
  ranges: Array<{ range: string; avgROAS: number; count: number }>;
  optimal: OptimalRange;
} {
  if (data.length === 0) {
    return {
      ranges: [],
      optimal: {
        range: "N/A",
        avgROAS: 0,
        count: 0,
        recommendation: "데이터가 부족합니다.",
      },
    };
  }

  // 광고비 범위 계산
  const adSpends = data.map((d) => d.adSpend);
  const minAdSpend = Math.min(...adSpends);
  const maxAdSpend = Math.max(...adSpends);
  const range = maxAdSpend - minAdSpend;

  // 구간 개수 (최대 5개)
  const numRanges = Math.min(5, data.length);
  const rangeSize = range / numRanges;

  // 구간별 데이터 분류
  const ranges: Array<{ range: string; avgROAS: number; count: number }> = [];

  for (let i = 0; i < numRanges; i++) {
    const rangeMin = minAdSpend + rangeSize * i;
    const rangeMax = minAdSpend + rangeSize * (i + 1);

    const dataInRange = data.filter(
      (d) =>
        d.adSpend >= rangeMin &&
        (i === numRanges - 1 ? d.adSpend <= rangeMax : d.adSpend < rangeMax)
    );

    if (dataInRange.length > 0) {
      const avgROAS =
        dataInRange.reduce((sum, d) => sum + calculateROAS(d.sales, d.adSpend), 0) /
        dataInRange.length;

      ranges.push({
        range: `${(rangeMin / 1000).toFixed(0)}-${(rangeMax / 1000).toFixed(0)}K`,
        avgROAS,
        count: dataInRange.length,
      });
    }
  }

  // 최적 구간 찾기
  const optimal =
    ranges.length > 0
      ? ranges.reduce((best, current) =>
          current.avgROAS > best.avgROAS ? current : best
        )
      : { range: "N/A", avgROAS: 0, count: 0 };

  return {
    ranges,
    optimal: {
      ...optimal,
      recommendation:
        optimal.avgROAS > 0
          ? `광고비를 ${optimal.range} 구간에서 집행할 때 효율이 가장 높습니다 (ROAS: ${optimal.avgROAS.toFixed(
              2
            )}).`
          : "데이터가 부족하여 최적 구간을 계산할 수 없습니다.",
    },
  };
}

export interface SaturationAnalysis {
  hasSaturation: boolean;
  saturationAdSpend: number | null;
  message: string;
}

/**
 * 광고 포화점 분석
 * @param data 광고비-매출 데이터 배열
 * @returns 포화 여부 및 포화점
 */
export function detectSaturationPoint(
  data: Array<{ adSpend: number; sales: number }>
): SaturationAnalysis {
  if (data.length < 4) {
    return {
      hasSaturation: false,
      saturationAdSpend: null,
      message: "포화점 분석을 위한 데이터가 부족합니다.",
    };
  }

  // 광고비 기준으로 정렬
  const sorted = [...data].sort((a, b) => a.adSpend - b.adSpend);

  // 하위 25%와 상위 25% 분리
  const quartileSize = Math.floor(sorted.length / 4);
  const bottomQuartile = sorted.slice(0, quartileSize);
  const topQuartile = sorted.slice(-quartileSize);

  // 각 구간의 평균 ROAS 계산
  const bottomROAS =
    bottomQuartile.reduce((sum, d) => sum + calculateROAS(d.sales, d.adSpend), 0) /
    bottomQuartile.length;
  const topROAS =
    topQuartile.reduce((sum, d) => sum + calculateROAS(d.sales, d.adSpend), 0) /
    topQuartile.length;

  // 상위 ROAS가 하위보다 30% 이상 낮으면 포화 신호
  if (topROAS < bottomROAS * 0.7) {
    return {
      hasSaturation: true,
      saturationAdSpend: topQuartile[0].adSpend,
      message: `광고비가 ${(topQuartile[0].adSpend / 1000).toFixed(
        0
      )}K를 초과하면 효율이 급격히 감소합니다. 추가 증액보다는 타겟팅 최적화를 권장합니다.`,
    };
  }

  return {
    hasSaturation: false,
    saturationAdSpend: null,
    message: "현재 광고비 수준에서 포화 신호는 감지되지 않았습니다.",
  };
}

/**
 * 종합 인사이트 생성
 * @param correlation 상관계수
 * @param avgROAS 평균 ROAS
 * @param avgROI 평균 ROI
 * @param efficiencyGrade 효율 등급
 * @param optimalRange 최적 구간
 * @param saturation 포화 분석
 * @returns 인사이트 목록
 */
export function generateComprehensiveInsights(
  correlation: number,
  avgROAS: number,
  avgROI: number,
  efficiencyGrade: EfficiencyGrade,
  optimalRange: OptimalRange,
  saturation: SaturationAnalysis
): string[] {
  const insights: string[] = [];

  // 상관관계 기반 인사이트
  if (correlation > 0.7) {
    insights.push("✅ 광고 집행이 매출 증대에 매우 효과적입니다.");
  } else if (correlation > 0.4) {
    insights.push("광고 집행이 매출 증대에 긍정적 영향을 미치고 있습니다.");
  } else if (correlation < 0.1) {
    insights.push(
      "⚠️ 광고와 매출 간 상관성이 낮습니다. 광고 전략 재검토가 필요합니다."
    );
  }

  // ROAS 기반 인사이트
  if (avgROAS > 5) {
    insights.push(
      `💰 평균 ROAS ${avgROAS.toFixed(
        2
      )}로, 광고비 1원당 ${avgROAS.toFixed(2)}원의 매출을 창출하고 있습니다.`
    );
  } else if (avgROAS > 3) {
    insights.push(
      `평균 ROAS ${avgROAS.toFixed(2)}로, 광고 효율이 양호한 수준입니다.`
    );
  } else if (avgROAS < 1) {
    insights.push(
      "⚠️ ROAS가 1 미만입니다. 광고비가 매출을 초과하고 있어 즉각적인 개선이 필요합니다."
    );
  }

  // ROI 기반 인사이트
  if (avgROI > 100) {
    insights.push(
      `📈 평균 ROI ${avgROI.toFixed(0)}%로, 광고 투자 대비 수익이 우수합니다.`
    );
  } else if (avgROI < 0) {
    insights.push(
      `⚠️ 평균 ROI가 음수입니다. 광고 집행으로 인한 손실이 발생하고 있습니다.`
    );
  }

  // 최적 구간 인사이트
  if (optimalRange.avgROAS > 0) {
    insights.push(`💡 ${optimalRange.recommendation}`);
  }

  // 포화점 인사이트
  if (saturation.hasSaturation) {
    insights.push(`⚠️ ${saturation.message}`);
  } else {
    insights.push("✅ 광고비 증액 여지가 있습니다.");
  }

  // 등급별 액션
  insights.push(`🎯 ${efficiencyGrade.action}`);

  return insights;
}

// --- 시차 효과 (Lag) 분석 ---

export interface LagCorrelationResult {
  lag0: number;
  lag1: number;
  lag2: number;
}

/**
 * 광고비 t월 vs 매출 t, t+1, t+2월 상관계수
 * @param data 월별 광고비-매출 (month 오름차순 가정)
 */
export function computeLagCorrelation(
  data: Array<{ adSpend: number; sales: number }>
): LagCorrelationResult {
  const n = data.length;
  const adSpends = data.map((d) => d.adSpend);
  const sales = data.map((d) => d.sales);

  const lag0 =
    n >= 2 ? calculateCorrelation(adSpends, sales) : 0;

  const lag1Pairs = n >= 3 ? n - 1 : 0;
  const ad1 = lag1Pairs ? adSpends.slice(0, -1) : [];
  const sales1 = lag1Pairs ? sales.slice(1) : [];
  const lag1 = lag1Pairs ? calculateCorrelation(ad1, sales1) : 0;

  const lag2Pairs = n >= 4 ? n - 2 : 0;
  const ad2 = lag2Pairs ? adSpends.slice(0, -2) : [];
  const sales2 = lag2Pairs ? sales.slice(2) : [];
  const lag2 = lag2Pairs ? calculateCorrelation(ad2, sales2) : 0;

  return { lag0, lag1, lag2 };
}

export function interpretLagAnalysis(result: LagCorrelationResult): string {
  const { lag0, lag1, lag2 } = result;
  const max = Math.max(lag0, lag1, lag2);
  const min = Math.min(lag0, lag1, lag2);
  if (Math.abs(max) < 0.15 && Math.abs(min) < 0.15) {
    return "시차를 둔 분석에서도 광고비와 매출 간 뚜렷한 선행·후행 효과는 관찰되지 않습니다.";
  }
  if (lag1 > lag0 && lag1 > lag2 && lag1 > 0.2) {
    return "전체 기준에서는 광고비와 매출 간 상관관계가 미미할 수 있으나, 시차 분석 결과 1개월 후행 효과가 관찰됩니다. 당월 광고가 다음 달 매출에 반영되는 패턴을 고려할 수 있습니다.";
  }
  if (lag2 > lag0 && lag2 > lag1 && lag2 > 0.2) {
    return "시차 분석 결과 2개월 후행 효과가 관찰됩니다. 광고 집행 효과가 2개월 후 매출로 이어질 가능성이 있습니다.";
  }
  if (lag0 >= max - 0.05) {
    return "당월 광고비와 당월 매출 간 동행성이 가장 큽니다. 즉시 반응형 매출 비중이 높을 수 있습니다.";
  }
  return "시차별 상관계수가 유사하거나 낮아, 명확한 시차 패턴은 보이지 않습니다.";
}

// --- 광고비 구간별 (하/중/상 25%) 분석 ---

export interface QuartileSegment {
  label: string;
  avgAdSpend: number;
  avgSales: number;
  salesGrowthYoY: number | null;
  count: number;
}

export function computeAdSpendQuartiles(
  data: Array<{
    adSpend: number;
    sales: number;
    salesPrevYear: number | null;
  }>
): QuartileSegment[] {
  if (data.length === 0) return [];
  const sorted = [...data].sort((a, b) => a.adSpend - b.adSpend);
  const n = sorted.length;
  const i25 = Math.floor(n * 0.25);
  const i75 = Math.floor(n * 0.75);
  const p25 = sorted[i25]?.adSpend ?? sorted[0].adSpend;
  const p75 = sorted[i75]?.adSpend ?? sorted[n - 1].adSpend;

  const lower = sorted.filter((d) => d.adSpend <= p25);
  const middle = sorted.filter((d) => d.adSpend > p25 && d.adSpend <= p75);
  const upper = sorted.filter((d) => d.adSpend > p75);

  const toSegment = (
    arr: typeof sorted,
    label: string
  ): QuartileSegment => {
    const avgAdSpend =
      arr.length > 0
        ? arr.reduce((s, d) => s + d.adSpend, 0) / arr.length
        : 0;
    const avgSales =
      arr.length > 0
        ? arr.reduce((s, d) => s + d.sales, 0) / arr.length
        : 0;
    const withPrev = arr.filter((d) => d.salesPrevYear != null && d.salesPrevYear > 0);
    const salesGrowthYoY =
      withPrev.length > 0
        ? (withPrev.reduce((s, d) => s + (d.sales - d.salesPrevYear!) / d.salesPrevYear!, 0) / withPrev.length) * 100
        : null;
    return {
      label,
      avgAdSpend,
      avgSales,
      salesGrowthYoY,
      count: arr.length,
    };
  };

  return [
    toSegment(lower, "하위 25%"),
    toSegment(middle, "중간 50%"),
    toSegment(upper, "상위 25%"),
  ];
}

export function interpretQuartileAnalysis(
  segments: QuartileSegment[]
): string {
  if (segments.length < 3) return "";
  const [lower, middle, upper] = segments;
  const growthLower = lower.salesGrowthYoY ?? 0;
  const growthMiddle = middle.salesGrowthYoY ?? 0;
  const growthUpper = upper.salesGrowthYoY ?? 0;
  const roasLower = lower.avgAdSpend > 0 ? lower.avgSales / lower.avgAdSpend : 0;
  const roasUpper = upper.avgAdSpend > 0 ? upper.avgSales / upper.avgAdSpend : 0;

  if (growthUpper < growthLower && growthUpper < growthMiddle && roasUpper < roasLower) {
    return "광고비 상위 구간에서는 매출 증가 효과가 제한적이며, 중·저집행 구간에서 효율이 상대적으로 높습니다. 과도한 집행 시 한계효용 체감이 있을 수 있습니다.";
  }
  if (growthMiddle > growthLower && growthMiddle > growthUpper) {
    return "중간 집행 구간에서 매출 증대 효과가 가장 크게 나타납니다. 적정 광고비 구간 유지가 권장됩니다.";
  }
  if (growthUpper > growthLower && growthUpper > growthMiddle) {
    return "광고비를 많이 집행한 구간에서 매출 성장률이 높게 나타나, 증액이 매출 증대와 연결되는 패턴이 있습니다.";
  }
  return "구간별 매출·증감률 차이가 뚜렷하지 않습니다. 추가 기간 데이터로 추이를 확인하는 것이 좋습니다.";
}

// --- 정규화 분석 (광고비 비중 vs 매출 성장률) ---

export function computeNormalizedCorrelation(
  data: Array<{ adSpend: number; sales: number; salesPrevYear: number | null }>
): {
  correlation: number;
  regression: { alpha: number; beta: number; rSquared: number };
  points: Array<{ adShare: number; salesGrowth: number }>;
} {
  const points = data
    .filter((d) => d.sales > 0 && d.salesPrevYear != null && d.salesPrevYear > 0)
    .map((d) => ({
      adShare: d.adSpend / d.sales,
      salesGrowth: ((d.sales - d.salesPrevYear!) / d.salesPrevYear!) * 100,
    }));

  if (points.length < 2) {
    return {
      correlation: 0,
      regression: { alpha: 0, beta: 0, rSquared: 0 },
      points: [],
    };
  }
  const x = points.map((p) => p.adShare);
  const y = points.map((p) => p.salesGrowth);
  const correlation = calculateCorrelation(x, y);
  const regression = calculateLinearRegression(x, y);
  return { correlation, regression, points };
}

export function interpretNormalizedAnalysis(
  correlation: number,
  beta: number,
  rSquared: number
): string {
  if (Math.abs(correlation) < 0.15) {
    return "광고비 비중(광고비/매출)과 매출 성장률 간에는 뚜렷한 선형 관계가 관찰되지 않습니다.";
  }
  if (correlation > 0.3) {
    return `광고비 비중이 높을수록 매출 성장률이 높아지는 경향이 있습니다(상관계수 ${correlation.toFixed(2)}). 비중 확대가 성장과 연결될 수 있습니다.`;
  }
  if (correlation < -0.3) {
    return `광고비 비중이 높을수록 매출 성장률이 낮게 나타납니다(상관계수 ${correlation.toFixed(2)}). 고비중 구간의 효율 재검토가 필요할 수 있습니다.`;
  }
  return "광고비 비중과 매출 성장률 간 관계는 약하거나 불안정합니다.";
}

// --- 브랜드/채널별 분해 해석 ---

export function interpretBrandChannelBreakdown(
  overallR: number,
  byUnit: Array<{ name: string; correlation: number; beta: number }>
): string {
  const best = byUnit.reduce((a, b) => (Math.abs(b.correlation) > Math.abs(a.correlation) ? b : a), byUnit[0]);
  if (!best) return "세부 단위 데이터가 부족합니다.";
  if (Math.abs(best.correlation) > Math.abs(overallR) + 0.1) {
    return `전체 대비 ${best.name}에서 상관계수가 더 높게 나타납니다( r=${best.correlation.toFixed(2)} ). 해당 단위의 광고-매출 연계가 상대적으로 뚜렷합니다.`;
  }
  if (byUnit.some((u) => u.beta > 0 && Math.abs(u.correlation) > 0.3)) {
    const top = byUnit.filter((u) => u.correlation > 0.3).sort((a, b) => b.beta - a.beta)[0];
    if (top) {
      return `${top.name}의 광고비 매출 기여도(β)가 높습니다. 채널/브랜드별 집행 비중 조정 시 참고할 수 있습니다.`;
    }
  }
  return "전체와 세부 단위 간 상관·회귀 패턴이 크게 다르지 않습니다.";
}
