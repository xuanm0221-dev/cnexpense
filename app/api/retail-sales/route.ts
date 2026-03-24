/**
 * 리테일 매출 데이터 API Route
 * Snowflake에서 리테일 매출 데이터를 조회합니다.
 */

import { NextRequest, NextResponse } from 'next/server';
import snowflake from 'snowflake-sdk';

// 브랜드 코드 매핑
const BRAND_MAPPING: { [code: string]: string } = {
  'M': 'MLB',
  'I': 'MLB KIDS',
  'X': 'Discovery',
  'V': 'Duvetica',
  'W': 'SUPRA',
};

// Snowflake 연결 설정
function getSnowflakeConnection() {
  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USER!,
    password: process.env.SNOWFLAKE_PASSWORD!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    database: process.env.SNOWFLAKE_DATABASE!,
    schema: process.env.SNOWFLAKE_SCHEMA!,
    role: process.env.SNOWFLAKE_ROLE!,
  });
}

// Snowflake 쿼리 실행
function executeQuery(connection: snowflake.Connection, query: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText: query,
      complete: (err: any, stmt: any, rows: any[] | undefined) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows || []);
        }
      },
    });
  });
}

// 월의 시작일과 종료일 계산 (month는 1~12, JS Date는 month 0~11)
function getMonthRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${month.toString().padStart(2, '0')}-01`;
  const lastDay = new Date(year, month, 0).getDate(); // month월의 마지막 날
  const end = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
  return { start, end };
}

// YTD 범위 계산 (1월부터 해당월까지)
function getYTDRange(year: number, month: number): { start: string; end: string } {
  const start = `${year}-01-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${month.toString().padStart(2, '0')}-${lastDay.toString().padStart(2, '0')}`;
  return { start, end };
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const month = searchParams.get('month'); // "2025-12" 형식
    const ytd = searchParams.get('ytd') === 'true';

    if (!month) {
      return NextResponse.json(
        { error: 'month 파라미터가 필요합니다.' },
        { status: 400 }
      );
    }

    const [year, monthNum] = month.split('-').map(Number);
    const prevYear = year - 1;
    
    // 현재 월 날짜 범위 계산
    const currentRange = ytd 
      ? getYTDRange(year, monthNum)
      : getMonthRange(year, monthNum);
    
    // 전년 동월 날짜 범위 계산 (YoY용)
    const prevRange = ytd
      ? getYTDRange(prevYear, monthNum)
      : getMonthRange(prevYear, monthNum);

    // Snowflake 연결
    const connection = getSnowflakeConnection();
    
    await new Promise<void>((resolve, reject) => {
      connection.connect((err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    // 테이블 참조 (env로 오버라이드 가능, chn.dw_sale = DB.CHN 스키마 또는 CHN 스키마)
    const tableRef = process.env.SNOWFLAKE_RETAIL_TABLE || 'chn.dw_sale';

    // 현재 월 데이터 조회
    const currentQuery = `
      SELECT 
        brd_cd,
        SUM(sale_amt) as total_sales
      FROM ${tableRef}
      WHERE sale_dt >= '${currentRange.start}' 
        AND sale_dt <= '${currentRange.end}'
        AND brd_cd IN ('M', 'I', 'X', 'V', 'W')
      GROUP BY brd_cd
    `;

    // 전년 동월 데이터 조회
    const prevQuery = `
      SELECT 
        brd_cd,
        SUM(sale_amt) as total_sales
      FROM ${tableRef}
      WHERE sale_dt >= '${prevRange.start}' 
        AND sale_dt <= '${prevRange.end}'
        AND brd_cd IN ('M', 'I', 'X', 'V', 'W')
      GROUP BY brd_cd
    `;

    // 두 쿼리 병렬 실행
    const [currentRows, prevRows] = await Promise.all([
      executeQuery(connection, currentQuery),
      executeQuery(connection, prevQuery),
    ]);

    // 결과를 사업부별로 그룹화
    const currentResult: { [businessUnit: string]: number } = {};
    const prevResult: { [businessUnit: string]: number } = {};
    
    currentRows.forEach((row: any) => {
      const brandCode = row.BRD_CD || row.brd_cd;
      const salesAmount = parseFloat(row.TOTAL_SALES || row.total_sales || 0);
      const businessUnit = BRAND_MAPPING[brandCode];
      
      if (businessUnit) {
        if (!currentResult[businessUnit]) {
          currentResult[businessUnit] = 0;
        }
        currentResult[businessUnit] += salesAmount;
      }
    });

    prevRows.forEach((row: any) => {
      const brandCode = row.BRD_CD || row.brd_cd;
      const salesAmount = parseFloat(row.TOTAL_SALES || row.total_sales || 0);
      const businessUnit = BRAND_MAPPING[brandCode];
      
      if (businessUnit) {
        if (!prevResult[businessUnit]) {
          prevResult[businessUnit] = 0;
        }
        prevResult[businessUnit] += salesAmount;
      }
    });

    // 연결 종료
    connection.destroy((err: any) => {
      if (err) {
        console.error('[리테일매출] Snowflake 연결 종료 오류:', err);
      }
    });

    // 월별 데이터 형식으로 변환 (현재 월 + 전년 동월)
    const monthlyData: { [businessUnit: string]: { [month: string]: number } } = {};
    const prevMonth = `${prevYear}-${monthNum.toString().padStart(2, '0')}`;
    
    Object.keys(currentResult).forEach(businessUnit => {
      monthlyData[businessUnit] = {
        [month]: Math.round(currentResult[businessUnit])
      };
    });

    // 전년 데이터도 추가
    Object.keys(prevResult).forEach(businessUnit => {
      if (!monthlyData[businessUnit]) {
        monthlyData[businessUnit] = {};
      }
      monthlyData[businessUnit][prevMonth] = Math.round(prevResult[businessUnit]);
    });

    return NextResponse.json(monthlyData);

  } catch (error: any) {
    console.error('[리테일매출] Snowflake 쿼리 오류:', error);
    return NextResponse.json(
      { error: '리테일 매출 데이터 조회 실패', details: error.message },
      { status: 500 }
    );
  }
}
