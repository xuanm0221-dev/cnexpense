import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // STATIC_EXPORT=1 일 때만 정적 산출물(out/) 생성 — DCS AI Quick Dashboard 배포용.
  // 평소 개발/로컬에서는 API 라우트(환율 저장 등)를 그대로 쓴다.
  ...(process.env.STATIC_EXPORT === '1' ? { output: 'export' as const } : {}),
  // snowflake-sdk → OpenTelemetry 등: 서버에 번들링하면 vendor-chunks 누락 오류가 날 수 있음
  serverExternalPackages: ["snowflake-sdk", "@opentelemetry/api"],
};

export default nextConfig;
