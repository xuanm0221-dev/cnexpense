import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "F&F CHINA 비용 대시보드",
  description: "FP&A 관점의 월별 비용 데이터 대시보드",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="antialiased bg-gray-50">
        {children}
      </body>
    </html>
  );
}
