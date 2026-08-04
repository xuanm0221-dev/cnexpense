import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // STATIC_EXPORT=1 일 때만 정적 산출물(out/) 생성 — DCS AI Quick Dashboard 배포용.
  // 평소 개발/로컬에서는 API 라우트(환율 저장 등)를 그대로 쓴다.
  // Quick Dashboard 는 /server/quick-dashboard/<slug> 서브패스로 서빙되므로
  // 자산 경로(_next/…)에 그 접두어가 붙어야 한다. 안 붙이면 JS 404 → 로딩 화면에서 멈춘다.
  ...(process.env.STATIC_EXPORT === '1'
    ? {
        output: 'export' as const,
        basePath: process.env.STATIC_BASE_PATH || undefined,
        assetPrefix: process.env.STATIC_BASE_PATH || undefined,
      }
    : {}),
  // snowflake-sdk → OpenTelemetry 등: 서버에 번들링하면 vendor-chunks 누락 오류가 날 수 있음
  serverExternalPackages: ["snowflake-sdk", "@opentelemetry/api"],
};

export default nextConfig;
