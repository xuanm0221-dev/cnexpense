"use client";

import { Card, CardContent } from "@/components/ui/card";
import { formatK, formatM, formatPercent, formatPercentPoint } from "@/lib/expense-utils";

interface KpiCardProps {
  title: string;
  value: string | number | null;
  unit?: string;
  yoy?: number | null;
  yoyLabel?: string;
  changeAmount?: number | null;
  description?: string | React.ReactNode;
  previousValue?: string | number | null;
  secondLine?: string | null;
  className?: string;
  detailItems?: { label: string; value: string }[];
  variant?: "default" | "success" | "warning" | "info";
  icon?: string;
}

const VARIANT_STYLE: Record<string, { bg: string; border: string; accent: string }> = {
  default: { bg: "bg-white", border: "border-gray-200", accent: "text-gray-700" },
  success: { bg: "bg-emerald-50/50", border: "border-emerald-200", accent: "text-emerald-700" },
  warning: { bg: "bg-rose-50/50", border: "border-rose-200", accent: "text-rose-700" },
  info: { bg: "bg-blue-50/50", border: "border-blue-200", accent: "text-blue-700" },
};

export function KpiCard({
  title,
  value,
  unit,
  yoy,
  yoyLabel = "전년동월대비",
  changeAmount,
  description,
  previousValue,
  secondLine,
  className,
  detailItems,
  variant = "default",
  icon,
}: KpiCardProps) {
  const lang = "ko";
  const vs = VARIANT_STYLE[variant] || VARIANT_STYLE.default;
  const displayValue =
    typeof value === "number" 
      ? (unit === "K" 
          ? formatK(value, title === "인당 비용" ? 1 : 0)
          : unit === "M"
          ? formatM(value, 0)
          : (title.includes("비용률") || title.includes("费用率"))
            ? formatPercent(value, 1)
            : (title === "공통비용 YOY" || title === "법인비용 YOY")
            ? formatPercent(value, 0)
            : value.toLocaleString("ko-KR")) 
      : value || "-";

  // YOY가 percentage point인지 확인 (매출대비 비용률의 경우)
  const isPercentagePoint = yoy !== null && yoy !== undefined && Math.abs(yoy) < 10 && (title.includes("비용률") || title.includes("费用率"));

  // 네이비 색상 (navy blue)
  const navyColor = "#001f3f"; // 또는 "#1e3a8a"
  
  // KPI 카드 (detailItems 없음) — 캡쳐 양식 (variant + icon)
  if (!detailItems || detailItems.length === 0) {
    return (
      <Card className={`${className} relative overflow-hidden ${vs.bg} ${vs.border}`}>
        <CardContent className="p-3 sm:p-4">
          {/* 한 줄: [icon] 제목 + 메인 숫자 + (전년 X) + 알약 배지 */}
          <div className="flex items-baseline gap-2 mb-1">
            {icon && <span className="text-[14px]">{icon}</span>}
            <div className="text-[14px] font-semibold text-gray-700">{title}</div>
            <div className="text-[14px] font-extrabold text-navy">{displayValue}</div>
            {previousValue !== null && previousValue !== undefined && (
              <span className="text-[10px] text-gray-400">
                (전년 {typeof previousValue === "number"
                  ? ((title.includes("비용률") || title.includes("费用率"))
                      ? formatPercent(previousValue, 1)
                      : unit === "K"
                        ? formatK(previousValue, title === "인당 비용" ? 1 : 0)
                        : unit === "M"
                        ? formatM(previousValue, 0)
                        : previousValue.toLocaleString("ko-KR"))
                  : previousValue})
              </span>
            )}
            {yoy !== null && yoy !== undefined && (
              <span
                className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ml-auto ${
                  (isPercentagePoint && yoy > 0) || (!isPercentagePoint && yoy >= 100)
                    ? "bg-red-100 text-red-600"
                    : "bg-emerald-100 text-emerald-700"
                }`}
              >
                {isPercentagePoint ? formatPercentPoint(yoy) : formatPercent(yoy, 0)}
              </span>
            )}
          </div>
          {/* secondLine 만 별도 줄 (있을 때만) */}
          {secondLine != null && secondLine !== "" && (
            <div className={`text-[10px] ${vs.accent}`}>{secondLine}</div>
          )}
          {description && (
            <div className="text-[10px] text-gray-500 mt-1 whitespace-pre-line">{description}</div>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${className} relative overflow-hidden`} style={{ borderColor: navyColor, borderWidth: "1px" }}>
      {/* 왼쪽 네이비 세로선 */}
      <div className="absolute left-0 top-0 bottom-0 w-1" style={{ backgroundColor: navyColor }}></div>
      
      <CardContent className="p-3 pl-4 sm:p-4 sm:pl-5">
        {detailItems && detailItems.length > 0 ? (
          // 좌우 분할 레이아웃
          <div className="grid grid-cols-[1fr_auto] gap-4">
            {/* 좌측: 기본 정보 */}
            <div>
              {/* 제목 + 메인 금액 + YoY 한 줄 */}
              <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
                <div className="text-[14px] font-medium" style={{ color: navyColor }}>{title}</div>
                <div className="font-bold text-[14px]" style={{ color: navyColor }}>{displayValue}</div>
                {yoy !== null && yoy !== undefined && (
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ml-auto ${
                      (isPercentagePoint && yoy > 0) || (!isPercentagePoint && yoy >= 100)
                        ? "bg-red-100 text-red-600"
                        : "bg-blue-100 text-blue-600"
                    }`}
                  >
                    {isPercentagePoint ? formatPercentPoint(yoy) : formatPercent(yoy, 0)}
                  </span>
                )}
              </div>

              {/* 전년도 값 / YOY 라벨 또는 secondLine (좌측만) */}
              <div className="flex items-start justify-between gap-2 sm:gap-3">
                {secondLine != null && secondLine !== "" ? (
                  <div className="text-[10px] sm:text-[10px] text-gray-500">{secondLine}</div>
                ) : (
                  <>
                    {previousValue !== null && previousValue !== undefined && (
                      <div className="text-[10px] sm:text-[10px] text-gray-500">
                        {"전년"} {typeof previousValue === "number" 
                          ? ((title.includes("비용률") || title.includes("费用率"))
                              ? formatPercent(previousValue, 1)
                              : unit === "K" 
                                ? formatK(previousValue, title === "인당 비용" ? 1 : 0)
                                : unit === "M"
                                ? formatM(previousValue, 0)
                                : previousValue.toLocaleString("ko-KR"))
                          : previousValue}
                      </div>
                    )}
                    {yoy !== null && yoy !== undefined && (
                      <div className="text-[10px] sm:text-[10px] text-gray-500 pt-0.5 sm:pt-1 text-right">
                        {yoyLabel}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* 우측: 상세 항목 (글씨 1.5배) */}
            <div className="flex flex-col justify-center space-y-0.5 text-[11px] sm:text-[11px] text-gray-600">
              {detailItems.map((item, idx) => (
                <div key={idx} className="flex justify-between gap-3">
                  <span>{item.label}</span>
                  <span className="font-medium whitespace-nowrap">{item.value}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          // 기존 수직 레이아웃
          <>
            {/* 제목 + 메인 금액 + (전년 X) + YoY 한 줄 */}
            <div className="flex items-center gap-2 mb-1.5 sm:mb-2">
              <div className="text-[14px] font-medium" style={{ color: navyColor }}>{title}</div>
              <div className="font-bold text-[14px]" style={{ color: navyColor }}>{displayValue}</div>
              {previousValue !== null && previousValue !== undefined && (
                <span className="text-[10px] text-gray-400">
                  (전년 {typeof previousValue === "number"
                    ? ((title.includes("비용률") || title.includes("费用率"))
                        ? formatPercent(previousValue, 1)
                        : unit === "K"
                          ? formatK(previousValue, title === "인당 비용" ? 1 : 0)
                          : unit === "M"
                          ? formatM(previousValue, 0)
                          : previousValue.toLocaleString("ko-KR"))
                    : previousValue})
                </span>
              )}
              {yoy !== null && yoy !== undefined && (
                <span
                  className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ml-auto ${
                    (isPercentagePoint && yoy > 0) || (!isPercentagePoint && yoy >= 100)
                      ? "bg-red-100 text-red-600"
                      : "bg-blue-100 text-blue-600"
                  }`}
                >
                  {isPercentagePoint ? formatPercentPoint(yoy) : formatPercent(yoy, 0)}
                </span>
              )}
            </div>

            {/* secondLine 만 표시 (전년 X / yoyLabel 은 위 줄에 통합돼서 제거) */}
            {secondLine != null && secondLine !== "" && (
              <div className="text-[10px] text-gray-500">{secondLine}</div>
            )}

            {/* 설명 텍스트 */}
            {description && (
              <div className="text-[10px] sm:text-[10px] text-gray-500 mt-1.5 sm:mt-2">{description}</div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

