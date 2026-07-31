/**
 * 리테일 매출 API — (mei)리테일 스킬 §10 (RetailKpiCard / retail-kpi) 정의 준수
 *
 * - 출처: FNF.CHN.DW_SALE + MST_SHOP_ALL(ON/OFF) + DW_SHOP_WH_DETAIL(FR/OR)
 * - `shop_fr` CTE (MAX(fr_or_cls) GROUP BY shop_id) 필수 — DW_SHOP_WH_DETAIL은 SHOP_ID가
 *   중복 가능해 직접 JOIN하면 매출이 N배 부풀려짐 (스킬 §10-4)
 * - 5채널: 직영(OFF) / 직영(ON) / 대리상(OFF) / 대리상(ON) / 미지정
 *   미지정(anlys_onoff_cls_nm IS NULL)도 합계에 포함 → 4채널 합 + 미지정 = 전체 (스킬 §10-3)
 * - sale_amt = 실판 매출(V+), tag_amt = Tag가 매출, 할인율 = (1 - 실판/Tag) × 100
 * - 한 번의 쿼리로 당월(MTD) · 누적(YTD) × 당년 · 전년을 모두 집계 (스킬 §10-5)
 * - 브랜드별 + 법인(5브랜드 합) + 경영지원(자체 매출 없음 → 법인 값 재사용)
 */

import { NextRequest, NextResponse } from 'next/server';
import snowflake from 'snowflake-sdk';
import {
  CORPORATE_RETAIL_UNIT,
  MANAGEMENT_SUPPORT_UNIT,
  RETAIL_BRAND_CODE_TO_UNIT,
  RETAIL_BRAND_IDS,
  RETAIL_CHANNELS,
} from '@/lib/retail-brands';
import type {
  RetailChannelMetrics,
  RetailRangeMetrics,
  RetailSalesResponse,
  RetailUnitMetrics,
} from '@/lib/types';

/** 채널 분류 CASE — 스킬 §10-3 그대로 */
const CHANNEL_CASE = `
    CASE
      WHEN m.anlys_onoff_cls_nm IS NULL                                            THEN '미지정'
      WHEN m.anlys_onoff_cls_nm = 'Offline' AND COALESCE(d.fr_or_cls, '') = 'FR'    THEN '대리상(OFF)'
      WHEN m.anlys_onoff_cls_nm = 'Offline' AND COALESCE(d.fr_or_cls, '') != 'FR'   THEN '직영(OFF)'
      WHEN m.anlys_onoff_cls_nm = 'Online'  AND COALESCE(d.fr_or_cls, '') = 'FR'    THEN '대리상(ON)'
      WHEN m.anlys_onoff_cls_nm = 'Online'  AND COALESCE(d.fr_or_cls, '') != 'FR'   THEN '직영(ON)'
      ELSE                                                                              '미지정'
    END`;

/**
 * 브랜드 × 채널 × (MTD/YTD) × (당년/전년) 단일 쿼리.
 * bind 18개: 스캔범위 2 + (당월·전년동월·YTD·전년YTD) × (sale, tag) × 2 = 16
 */
const SQL = `
WITH shop_fr AS (
  SELECT shop_id, MAX(fr_or_cls) AS fr_or_cls
  FROM FNF.CHN.DW_SHOP_WH_DETAIL
  GROUP BY shop_id
),
labeled AS (
  SELECT
    a.brd_cd,${CHANNEL_CASE} AS channel,
    a.sale_dt,
    a.sale_amt,
    a.tag_amt
  FROM FNF.CHN.DW_SALE a
  LEFT JOIN FNF.CHN.MST_SHOP_ALL m ON a.shop_id = m.shop_id
  LEFT JOIN shop_fr d              ON a.shop_id = d.shop_id
  WHERE a.sale_dt BETWEEN ? AND ?
)
SELECT
  brd_cd,
  channel,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN sale_amt ELSE 0 END) AS mtd_sale_cy,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN tag_amt  ELSE 0 END) AS mtd_tag_cy,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN sale_amt ELSE 0 END) AS mtd_sale_py,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN tag_amt  ELSE 0 END) AS mtd_tag_py,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN sale_amt ELSE 0 END) AS ytd_sale_cy,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN tag_amt  ELSE 0 END) AS ytd_tag_cy,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN sale_amt ELSE 0 END) AS ytd_sale_py,
  SUM(CASE WHEN sale_dt BETWEEN ? AND ? THEN tag_amt  ELSE 0 END) AS ytd_tag_py
FROM labeled
GROUP BY brd_cd, channel
`;

/**
 * Snowflake 연결 — 다른 F&F 대시보드와 동일한 **key-pair(JWT) 인증**.
 * 서비스 계정(SVC_ORG_FPA) + 개인키를 사용한다. 아이디/비밀번호 방식은 폐지됨.
 */
function getSnowflakeConnection() {
  const privateKey = process.env.SNOWFLAKE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) {
    throw new Error(
      'SNOWFLAKE_PRIVATE_KEY 가 설정되지 않았습니다. .env.local 에 서비스 계정 개인키(PEM)를 넣어주세요.'
    );
  }

  return snowflake.createConnection({
    account: process.env.SNOWFLAKE_ACCOUNT!,
    username: process.env.SNOWFLAKE_USERNAME!,
    warehouse: process.env.SNOWFLAKE_WAREHOUSE!,
    database: process.env.SNOWFLAKE_DATABASE!,
    schema: process.env.SNOWFLAKE_SCHEMA!,
    role: process.env.SNOWFLAKE_ROLE!,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey,
  });
}

function executeQuery(
  connection: snowflake.Connection,
  sqlText: string,
  binds: string[]
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds,
      complete: (err: any, _stmt: any, rows: any[] | undefined) => {
        if (err) reject(err);
        else resolve(rows || []);
      },
    });
  });
}

/** 해당 연·월의 마지막 날 (month는 1~12) */
function lastDayOf(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function firstDayOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** 누적 버킷 — 채널·브랜드·법인 합산에 공통 사용 */
type Bucket = {
  mtdSaleCy: number;
  mtdTagCy: number;
  mtdSalePy: number;
  mtdTagPy: number;
  ytdSaleCy: number;
  ytdTagCy: number;
  ytdSalePy: number;
  ytdTagPy: number;
};

function emptyBucket(): Bucket {
  return {
    mtdSaleCy: 0,
    mtdTagCy: 0,
    mtdSalePy: 0,
    mtdTagPy: 0,
    ytdSaleCy: 0,
    ytdTagCy: 0,
    ytdSalePy: 0,
    ytdTagPy: 0,
  };
}

function addBucket(target: Bucket, src: Bucket): void {
  target.mtdSaleCy += src.mtdSaleCy;
  target.mtdTagCy += src.mtdTagCy;
  target.mtdSalePy += src.mtdSalePy;
  target.mtdTagPy += src.mtdTagPy;
  target.ytdSaleCy += src.ytdSaleCy;
  target.ytdTagCy += src.ytdTagCy;
  target.ytdSalePy += src.ytdSalePy;
  target.ytdTagPy += src.ytdTagPy;
}

function num(v: any): number {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  return Number.isFinite(n) ? n : 0;
}

/** 할인율 = (1 - 실판/Tag) × 100. Tag가 0이면 계산 불가 */
function discountRate(sale: number, tag: number): number | null {
  if (tag <= 0) return null;
  return (1 - sale / tag) * 100;
}

function toRangeMetrics(
  sale: number,
  tag: number,
  pySale: number,
  pyTag: number
): RetailRangeMetrics {
  return {
    sale: Math.round(sale),
    tag: Math.round(tag),
    discountRate: discountRate(sale, tag),
    pySale: Math.round(pySale),
    pyTag: Math.round(pyTag),
    pyDiscountRate: discountRate(pySale, pyTag),
    yoyPct: pySale > 0 ? (sale / pySale) * 100 : null,
  };
}

function toUnitMetrics(
  total: Bucket,
  byChannel: Map<string, Bucket>
): RetailUnitMetrics {
  const channels: RetailChannelMetrics[] = [];
  for (const channel of RETAIL_CHANNELS) {
    const b = byChannel.get(channel);
    if (!b) continue;
    channels.push({
      channel,
      mtd: toRangeMetrics(b.mtdSaleCy, b.mtdTagCy, b.mtdSalePy, b.mtdTagPy),
      ytd: toRangeMetrics(b.ytdSaleCy, b.ytdTagCy, b.ytdSalePy, b.ytdTagPy),
    });
  }
  return {
    mtd: toRangeMetrics(total.mtdSaleCy, total.mtdTagCy, total.mtdSalePy, total.mtdTagPy),
    ytd: toRangeMetrics(total.ytdSaleCy, total.ytdTagCy, total.ytdSalePy, total.ytdTagPy),
    channels,
  };
}

export async function GET(request: NextRequest) {
  const month = request.nextUrl.searchParams.get('month'); // "2026-06"

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json(
      { error: 'month 파라미터가 필요합니다. (형식: YYYY-MM)' },
      { status: 400 }
    );
  }

  const [year, monthNum] = month.split('-').map(Number);
  if (monthNum < 1 || monthNum > 12) {
    return NextResponse.json({ error: 'month 값이 올바르지 않습니다.' }, { status: 400 });
  }
  const prevYear = year - 1;
  const prevMonth = `${prevYear}-${String(monthNum).padStart(2, '0')}`;

  // 당월 / 전년 동월 / YTD / 전년 YTD (월말 모드 — 스킬 §10-8)
  const mtdStart = firstDayOf(year, monthNum);
  const mtdEnd = lastDayOf(year, monthNum);
  const pyMtdStart = firstDayOf(prevYear, monthNum);
  const pyMtdEnd = lastDayOf(prevYear, monthNum);
  const ytdStart = `${year}-01-01`;
  const ytdEnd = mtdEnd;
  const pyYtdStart = `${prevYear}-01-01`;
  const pyYtdEnd = pyMtdEnd;

  const binds = [
    // labeled 스캔 범위 (전년 1/1 ~ 당년 기준월 말일) — 아래 4개 구간을 모두 포함
    pyYtdStart, ytdEnd,
    mtdStart, mtdEnd,       // mtd_sale_cy
    mtdStart, mtdEnd,       // mtd_tag_cy
    pyMtdStart, pyMtdEnd,   // mtd_sale_py
    pyMtdStart, pyMtdEnd,   // mtd_tag_py
    ytdStart, ytdEnd,       // ytd_sale_cy
    ytdStart, ytdEnd,       // ytd_tag_cy
    pyYtdStart, pyYtdEnd,   // ytd_sale_py
    pyYtdStart, pyYtdEnd,   // ytd_tag_py
  ];

  let connection: snowflake.Connection | null = null;

  try {
    connection = getSnowflakeConnection();
    await new Promise<void>((resolve, reject) => {
      connection!.connect((err: any) => (err ? reject(err) : resolve()));
    });

    const rows = await executeQuery(connection, SQL, binds);

    // 브랜드(사업부)별 총합 + 채널별 집계
    const unitTotals = new Map<string, Bucket>();
    const unitChannels = new Map<string, Map<string, Bucket>>();
    const unmapped = new Map<string, number>();

    for (const row of rows) {
      const brdCd = String(row.BRD_CD ?? row.brd_cd ?? '').trim();
      const channel = String(row.CHANNEL ?? row.channel ?? '미지정');
      const bucket: Bucket = {
        mtdSaleCy: num(row.MTD_SALE_CY ?? row.mtd_sale_cy),
        mtdTagCy: num(row.MTD_TAG_CY ?? row.mtd_tag_cy),
        mtdSalePy: num(row.MTD_SALE_PY ?? row.mtd_sale_py),
        mtdTagPy: num(row.MTD_TAG_PY ?? row.mtd_tag_py),
        ytdSaleCy: num(row.YTD_SALE_CY ?? row.ytd_sale_cy),
        ytdTagCy: num(row.YTD_TAG_CY ?? row.ytd_tag_cy),
        ytdSalePy: num(row.YTD_SALE_PY ?? row.ytd_sale_py),
        ytdTagPy: num(row.YTD_TAG_PY ?? row.ytd_tag_py),
      };

      const unit = RETAIL_BRAND_CODE_TO_UNIT[brdCd];
      if (!unit) {
        // 법인 합산 대상(5브랜드) 밖의 코드 — 진단용으로만 노출
        unmapped.set(brdCd, (unmapped.get(brdCd) ?? 0) + bucket.ytdSaleCy);
        continue;
      }

      if (!unitTotals.has(unit)) unitTotals.set(unit, emptyBucket());
      addBucket(unitTotals.get(unit)!, bucket);

      if (!unitChannels.has(unit)) unitChannels.set(unit, new Map());
      const chMap = unitChannels.get(unit)!;
      if (!chMap.has(channel)) chMap.set(channel, emptyBucket());
      addBucket(chMap.get(channel)!, bucket);
    }

    // 법인 = 리테일 5개 브랜드 합산
    const corporateTotal = emptyBucket();
    const corporateChannels = new Map<string, Bucket>();
    for (const brand of RETAIL_BRAND_IDS) {
      const t = unitTotals.get(brand);
      if (t) addBucket(corporateTotal, t);
      const chMap = unitChannels.get(brand);
      if (!chMap) continue;
      for (const [channel, b] of chMap) {
        if (!corporateChannels.has(channel)) corporateChannels.set(channel, emptyBucket());
        addBucket(corporateChannels.get(channel)!, b);
      }
    }

    const units: { [unit: string]: RetailUnitMetrics } = {};
    for (const [unit, total] of unitTotals) {
      units[unit] = toUnitMetrics(total, unitChannels.get(unit) ?? new Map());
    }
    const corporate = toUnitMetrics(corporateTotal, corporateChannels);
    units[CORPORATE_RETAIL_UNIT] = corporate;
    // 경영지원은 자체 브랜드 매출이 없으므로 법인 값을 그대로 사용
    units[MANAGEMENT_SUPPORT_UNIT] = corporate;

    const payload: RetailSalesResponse = {
      month,
      prevMonth,
      units,
      unmappedBrandCodes: [...unmapped.entries()]
        .map(([brdCd, ytdSale]) => ({ brdCd, ytdSale: Math.round(ytdSale) }))
        .filter(x => x.ytdSale !== 0)
        .sort((a, b) => b.ytdSale - a.ytdSale),
      generatedAt: new Date().toISOString(),
    };

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('[리테일매출] Snowflake 쿼리 오류:', error);
    return NextResponse.json(
      { error: '리테일 매출 데이터 조회 실패', details: error?.message ?? String(error) },
      { status: 500 }
    );
  } finally {
    connection?.destroy((err: any) => {
      if (err) console.error('[리테일매출] Snowflake 연결 종료 오류:', err);
    });
  }
}
