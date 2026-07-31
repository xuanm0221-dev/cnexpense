/**
 * 환율 저장 API — **로컬 개발 환경 전용**
 *
 * 배포(프로덕션)에서는 항상 403을 반환한다. 즉 배포된 대시보드에서는
 * 누구도 환율을 수정할 수 없고, 화면에서는 읽기 전용 표만 보인다.
 * 환율 갱신 절차: 로컬에서 입력 → data/masters/환율.json 저장 → git commit/push → 재배포
 */

import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import {
  MONTH_KEYS,
  toRateValue,
  type ExchangeRateData,
  type YearRates,
} from '@/lib/exchange-rates';

const RATE_FILE = path.join(process.cwd(), 'data', 'masters', '환율.json');

/**
 * JSON 직렬화 — 월 키를 01~12 순서로 고정.
 * JS 객체는 "10","11","12"처럼 정수로 해석되는 키를 앞으로 정렬해버려서
 * JSON.stringify 로는 1월부터 나오게 할 수 없다. 그래서 직접 문자열을 만든다.
 */
function serializeRateFile(data: ExchangeRateData): string {
  const years = Object.keys(data.rates).sort();
  const yearBlocks = years.map(year => {
    const monthBlocks = MONTH_KEYS.map(mm => {
      const cell = data.rates[year][mm] ?? { 월말: null, 월평균: null, 기간평균: null };
      const fields = (['월말', '월평균', '기간평균'] as const)
        .map(col => `"${col}": ${cell[col] === null ? 'null' : cell[col]}`)
        .join(', ');
      return `      "${mm}": { ${fields} }`;
    }).join(',\n');
    return `    "${year}": {\n${monthBlocks}\n    }`;
  }).join(',\n');

  return (
    '{\n' +
    '  "metadata": ' +
    JSON.stringify(data.metadata, null, 2).replace(/\n/g, '\n  ') +
    ',\n' +
    '  "rates": {\n' +
    yearBlocks +
    '\n  }\n}\n'
  );
}

/** 프로덕션 빌드에서는 쓰기 금지 */
function isEditable(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function GET() {
  try {
    const raw = await fs.readFile(RATE_FILE, 'utf-8');
    const data = JSON.parse(raw) as ExchangeRateData;
    return NextResponse.json({ ...data, editable: isEditable() });
  } catch (error: any) {
    return NextResponse.json(
      { error: '환율 파일을 읽을 수 없습니다.', details: error?.message },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  if (!isEditable()) {
    return NextResponse.json(
      { error: '배포 환경에서는 환율을 수정할 수 없습니다.' },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const incoming = body?.rates;
    if (!incoming || typeof incoming !== 'object') {
      return NextResponse.json({ error: 'rates 형식이 올바르지 않습니다.' }, { status: 400 });
    }

    const existingRaw = await fs.readFile(RATE_FILE, 'utf-8').catch(() => '{}');
    const existing = JSON.parse(existingRaw) as Partial<ExchangeRateData>;

    /**
     * 기존 값 위에 **병합**한다 (통째로 교체하지 않음).
     * 페이로드에 없는 연도·월은 그대로 유지 → 부분 전송이 기존 환율을 지우지 않는다.
     */
    const rates: Record<string, YearRates> = {};
    for (const year of Object.keys(existing.rates ?? {})) {
      rates[year] = { ...(existing.rates?.[year] as YearRates) };
    }

    for (const year of Object.keys(incoming)) {
      if (!/^\d{4}$/.test(year)) continue;
      const yearRates: YearRates = { ...(rates[year] ?? {}) };
      for (const mm of MONTH_KEYS) {
        const cell = incoming[year]?.[mm];
        if (cell === undefined) continue; // 전송되지 않은 월은 유지
        yearRates[mm] = {
          월말: toRateValue(cell.월말),
          월평균: toRateValue(cell.월평균),
          기간평균: toRateValue(cell.기간평균),
        };
      }
      rates[year] = yearRates;
    }

    // 연도 오름차순 정렬
    const sorted: Record<string, YearRates> = {};
    for (const year of Object.keys(rates).sort()) {
      const yearRates: YearRates = {};
      for (const mm of MONTH_KEYS) {
        yearRates[mm] = rates[year][mm] ?? { 월말: null, 월평균: null, 기간평균: null };
      }
      sorted[year] = yearRates;
    }

    const next: ExchangeRateData = {
      metadata: {
        unit: existing.metadata?.unit ?? 'KRW per 1 CNY',
        note: existing.metadata?.note,
        updatedAt: new Date().toISOString(),
      },
      rates: sorted,
    };

    await fs.writeFile(RATE_FILE, serializeRateFile(next), 'utf-8');

    return NextResponse.json({ ok: true, updatedAt: next.metadata.updatedAt });
  } catch (error: any) {
    console.error('[환율] 저장 실패:', error);
    return NextResponse.json(
      { error: '환율 저장 실패', details: error?.message },
      { status: 500 }
    );
  }
}
