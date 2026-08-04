/**
 * 리테일 매출 스냅샷 생성 — 정적 배포(Quick Dashboard)용
 *
 * 개발 서버의 /api/retail-sales 를 월별로 호출해 결과를 하나의 JSON으로 굽는다.
 * API 로직(Snowflake 쿼리·채널 분해)을 그대로 재사용하므로 화면 값과 어긋날 일이 없다.
 *
 * 사용법:
 *   1) 개발 서버 실행:  npm run dev            (다른 포트면 -p 3100)
 *   2) 이 스크립트 실행: node scripts/fetch-retail-sales.mjs [baseUrl]
 *        예) node scripts/fetch-retail-sales.mjs http://localhost:3100
 *
 * 결과: data/processed/retail-sales.json  { "2026-06": {…응답…}, … }
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COST_FILE = path.join(ROOT, 'data', 'processed', 'aggregated-costs.json');
const OUT_FILE = path.join(ROOT, 'data', 'processed', 'retail-sales.json');
const BASE_URL = (process.argv[2] ?? 'http://localhost:3000').replace(/\/$/, '');

const months = JSON.parse(readFileSync(COST_FILE, 'utf8')).metadata.months;
if (!months?.length) {
  console.error('[리테일] 비용 데이터에 월 목록이 없습니다. preprocess.py 를 먼저 실행하세요.');
  process.exit(1);
}

console.log(`[리테일] ${BASE_URL} 에서 ${months.length}개월 조회 (${months[0]} ~ ${months.at(-1)})`);

const out = {};
let failed = 0;

for (const month of months) {
  const url = `${BASE_URL}/api/retail-sales?month=${month}`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    out[month] = data;
    const corp = data?.units?.['법인']?.month?.sale ?? 0;
    console.log(`  - ${month}  법인 당월 ${Math.round(corp / 1000).toLocaleString()}K`);
  } catch (e) {
    failed += 1;
    console.error(`  [실패] ${month}: ${e.message}`);
  }
}

if (Object.keys(out).length === 0) {
  console.error('[리테일] 받은 데이터가 없습니다. 개발 서버가 떠 있는지 확인하세요.');
  process.exit(1);
}

writeFileSync(OUT_FILE, JSON.stringify(out), 'utf8');
const kb = (Buffer.byteLength(JSON.stringify(out)) / 1024).toFixed(0);
console.log(`\n[리테일] 저장 완료: ${OUT_FILE} (${Object.keys(out).length}개월, ${kb} KB)`);
if (failed) console.log(`[리테일] 실패 ${failed}개월 — 해당 월은 화면에서 '—' 로 표시됩니다.`);
