import { type ClassValue, clsx } from "clsx";

// tailwind-merge 없이 clsx 만 사용 (cn-report 환경)
export function cn(...inputs: ClassValue[]) {
  return clsx(inputs);
}

export function formatK(value: number | null | undefined, decimals: number = 0): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "-";
  }
  if (value === 0) {
    return "0";
  }
  const divided = value / 1000;
  if (decimals === 0) {
    return `${divided.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}K`;
  }
  // 소수점이 있는 경우 천 단위 구분 기호 처리
  const parts = divided.toFixed(decimals).split(".");
  const integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${integerPart}.${parts[1]}K`;
}

/** 구간 문자열에 천 단위 콤마 적용 (예: 9361-11014K → 9,361-11,014K) */
export function formatRangeWithCommas(range: string): string {
  if (!range || range === "N/A") return range;
  const match = range.match(/^(\d+)-(\d+)K$/);
  if (!match) return range;
  const [, a, b] = match;
  const fmt = (n: string) => Number(n).toLocaleString("en-US");
  return `${fmt(a)}-${fmt(b)}K`;
}

/** 백만 단위 포맷 (축/요약용, 겹침 방지) */
export function formatM(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "-";
  }
  if (value === 0) {
    return "0";
  }
  const divided = value / 1_000_000;
  const d = Math.abs(divided) >= 1 ? (decimals === 0 ? 0 : 1) : Math.max(1, decimals);
  const s = divided.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${s}M`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "-";
  }
  return value.toLocaleString("ko-KR");
}

export function formatPercent(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "-";
  }
  if (decimals === 0) {
    // 소수점 없이 표시하고 천 단위 구분 기호 추가
    return `${Math.round(value).toLocaleString("ko-KR")}%`;
  }
  return `${value.toFixed(decimals)}%`;
}

export function formatPercentPoint(value: number | null | undefined, decimals: number = 1): string {
  if (value === null || value === undefined || isNaN(value)) {
    return "-";
  }
  if (value < 0) {
    return `△${Math.abs(value).toFixed(decimals)}%p`;
  }
  return `+${value.toFixed(decimals)}%p`;
}

export function calculateYOY(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null || previous === 0 || isNaN(current) || isNaN(previous)) {
    return null;
  }
  // YOY 계산: 당년 / 전년 * 100 (예: 당년 68 / 전년 100 = 68%)
  return (current / previous) * 100;
}

