import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // snowflake-sdk → OpenTelemetry 등: 서버에 번들링하면 vendor-chunks 누락 오류가 날 수 있음
  serverExternalPackages: ["snowflake-sdk", "@opentelemetry/api"],
};

export default nextConfig;
