/**
 * 리테일 매출 정합성 검증 — (mei)리테일 스킬 §7-4 / §10-9 체크리스트
 *
 *   node scripts/verify-retail.js [YYYY-MM]
 *
 * 확인 항목
 *  1) 브랜드별  4채널 합 + 미지정 = 단순 SUM(sale_amt)   ← shop_fr 중복 JOIN 부풀림 검출
 *  2) DW_SALE 에 실제 존재하는 brd_cd 목록               ← 브랜드 코드 매핑 누락 검출
 *  3) 법인(5브랜드 합) 및 채널 구성비
 */

const fs = require('fs');
const path = require('path');
const snowflake = require('snowflake-sdk');

snowflake.configure({ logLevel: 'ERROR' });

const ROOT = path.resolve(__dirname, '..');
const BRAND_MAP = { M: 'MLB', I: 'MLB KIDS', X: 'Discovery', V: 'Duvetica', W: 'SUPRA' };

/** .env.local 파서 — 개인키(PEM)처럼 따옴표로 감싼 여러 줄 값도 처리 */
function loadEnv() {
  const env = {};
  const text = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const re = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=[ \t]*("(?:[^"\\]|\\[\s\S])*"|'[^']*'|[^\r\n]*)/gm;
  let m;
  while ((m = re.exec(text)) !== null) {
    let v = m[2].trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length > 1) ||
      (v.startsWith("'") && v.endsWith("'") && v.length > 1)
    ) {
      v = v.slice(1, -1);
    }
    env[m[1]] = v;
  }
  return env;
}

function lastDay(year, month) {
  return String(new Date(year, month, 0).getDate()).padStart(2, '0');
}

const CHANNEL_SQL = `
WITH shop_fr AS (
  SELECT shop_id, MAX(fr_or_cls) AS fr_or_cls
  FROM FNF.CHN.DW_SHOP_WH_DETAIL
  GROUP BY shop_id
),
labeled AS (
  SELECT a.brd_cd,
    CASE
      WHEN m.anlys_onoff_cls_nm IS NULL                                          THEN '미지정'
      WHEN m.anlys_onoff_cls_nm = 'Offline' AND COALESCE(d.fr_or_cls,'') = 'FR'   THEN '대리상(OFF)'
      WHEN m.anlys_onoff_cls_nm = 'Offline' AND COALESCE(d.fr_or_cls,'') != 'FR'  THEN '직영(OFF)'
      WHEN m.anlys_onoff_cls_nm = 'Online'  AND COALESCE(d.fr_or_cls,'') = 'FR'   THEN '대리상(ON)'
      WHEN m.anlys_onoff_cls_nm = 'Online'  AND COALESCE(d.fr_or_cls,'') != 'FR'  THEN '직영(ON)'
      ELSE '미지정'
    END AS channel,
    a.sale_amt, a.tag_amt
  FROM FNF.CHN.DW_SALE a
  LEFT JOIN FNF.CHN.MST_SHOP_ALL m ON a.shop_id = m.shop_id
  LEFT JOIN shop_fr d              ON a.shop_id = d.shop_id
  WHERE a.sale_dt BETWEEN ? AND ?
)
SELECT brd_cd, channel, SUM(sale_amt) AS sale_amt, SUM(tag_amt) AS tag_amt
FROM labeled
GROUP BY brd_cd, channel
`;

const CONTROL_SQL = `
SELECT brd_cd, SUM(sale_amt) AS sale_amt, SUM(tag_amt) AS tag_amt
FROM FNF.CHN.DW_SALE
WHERE sale_dt BETWEEN ? AND ?
GROUP BY brd_cd
`;

function run(conn, sqlText, binds) {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText,
      binds,
      complete: (err, _stmt, rows) => (err ? reject(err) : resolve(rows || [])),
    });
  });
}

const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v ?? '0');
  return Number.isFinite(n) ? n : 0;
};
const K = (v) => Math.round(v / 1000).toLocaleString('en-US') + 'K';

(async () => {
  const env = loadEnv();
  const ym = process.argv[2] || '2025-12';
  if (!/^\d{4}-\d{2}$/.test(ym)) {
    console.error('사용법: node scripts/verify-retail.js YYYY-MM');
    process.exit(1);
  }
  const [year, month] = ym.split('-').map(Number);
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = `${year}-${String(month).padStart(2, '0')}-${lastDay(year, month)}`;

  const privateKey = env.SNOWFLAKE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  if (!privateKey) {
    console.error('SNOWFLAKE_PRIVATE_KEY 가 .env.local 에 없습니다. (key-pair 인증 필요)');
    process.exit(1);
  }
  const conn = snowflake.createConnection({
    account: env.SNOWFLAKE_ACCOUNT,
    username: env.SNOWFLAKE_USERNAME,
    warehouse: env.SNOWFLAKE_WAREHOUSE,
    database: env.SNOWFLAKE_DATABASE,
    schema: env.SNOWFLAKE_SCHEMA,
    role: env.SNOWFLAKE_ROLE,
    authenticator: 'SNOWFLAKE_JWT',
    privateKey,
  });

  await new Promise((res, rej) => conn.connect((e) => (e ? rej(e) : res())));

  const [chRows, ctlRows] = await Promise.all([
    run(conn, CHANNEL_SQL, [start, end]),
    run(conn, CONTROL_SQL, [start, end]),
  ]);

  const pick = (row, key) => row[key.toUpperCase()] ?? row[key];

  // 브랜드별 채널 집계
  const byBrand = new Map();
  for (const r of chRows) {
    const brd = String(pick(r, 'brd_cd') ?? '').trim();
    if (!byBrand.has(brd)) byBrand.set(brd, new Map());
    byBrand.get(brd).set(String(pick(r, 'channel')), num(pick(r, 'sale_amt')));
  }
  const control = new Map(
    ctlRows.map((r) => [String(pick(r, 'brd_cd') ?? '').trim(), num(pick(r, 'sale_amt'))])
  );

  console.log(`\n=== 리테일 정합성 검증 · ${ym} (${start} ~ ${end}) ===\n`);

  let allMatch = true;
  let corporate = 0;
  const corporateByChannel = new Map();

  for (const [brd, ctlSale] of [...control.entries()].sort((a, b) => b[1] - a[1])) {
    const unit = BRAND_MAP[brd];
    const channels = byBrand.get(brd) ?? new Map();
    const sum = [...channels.values()].reduce((a, b) => a + b, 0);
    const diff = sum - ctlSale;
    const ok = Math.abs(diff) < 1;
    if (!ok) allMatch = false;

    console.log(
      `${(unit ?? `(미매핑 ${brd})`).padEnd(12)} 단순합계 ${K(ctlSale).padStart(12)}` +
        `   채널합 ${K(sum).padStart(12)}   ${ok ? 'OK' : `불일치 ${K(diff)}`}`
    );
    for (const [ch, v] of channels) {
      const share = ctlSale !== 0 ? ((v / ctlSale) * 100).toFixed(1) : '—';
      console.log(`   ${ch.padEnd(12)} ${K(v).padStart(12)}  (${share}%)`);
      if (unit) corporateByChannel.set(ch, (corporateByChannel.get(ch) ?? 0) + v);
    }
    if (unit) corporate += ctlSale;
    console.log('');
  }

  console.log(`법인(5브랜드 합)  ${K(corporate)}`);
  for (const [ch, v] of corporateByChannel) {
    const share = corporate !== 0 ? ((v / corporate) * 100).toFixed(1) : '—';
    console.log(`   ${ch.padEnd(12)} ${K(v).padStart(12)}  (${share}%)`);
  }
  console.log(`경영지원          ${K(corporate)}  (법인 값 재사용)\n`);

  const unmapped = [...control.keys()].filter((b) => !BRAND_MAP[b]);
  if (unmapped.length) {
    console.log(`⚠ 매핑되지 않은 brd_cd: ${unmapped.join(', ')} — 법인 합산에서 제외됨`);
    console.log(`  → lib/retail-brands.ts 의 RETAIL_BRAND_CODE_TO_UNIT 확인 필요\n`);
  }
  console.log(allMatch ? '✅ 모든 브랜드 채널합 = 단순합계' : '❌ 채널합 불일치 — shop_fr 중복 JOIN 의심');

  conn.destroy(() => process.exit(allMatch ? 0 : 1));
})().catch((e) => {
  console.error('실패:', e.message);
  process.exit(1);
});
