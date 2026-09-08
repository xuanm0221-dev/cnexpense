/**
 * 리테일 매출 스냅샷 갱신
 *
 * 비용 데이터(aggregated-costs.json)의 월 목록을 기준으로, **아직 없는 달만**
 * /api/retail-sales 로 받아 retail-sales.json 에 합친다.
 * API 로직(Snowflake 쿼리·채널 분해)을 그대로 재사용하므로 화면 값과 어긋날 일이 없다.
 *
 * 서버가 안 떠 있으면 직접 띄웠다가 끝나면 내린다. 그래서 이것만 돌리면 된다:
 *   npm run data:retail
 *
 * 옵션
 *   --all              이미 있는 달도 전부 다시 받는다
 *   --base=<url>       이미 떠 있는 서버를 쓴다 (예: http://localhost:3000)
 *   --fresh            떠 있는 서버를 무시하고 전용 서버를 띄운다
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COST_FILE = path.join(ROOT, 'data', 'processed', 'aggregated-costs.json');
const OUT_FILE = path.join(ROOT, 'data', 'processed', 'retail-sales.json');

const args = process.argv.slice(2);
const refetchAll = args.includes('--all');
const forceFresh = args.includes('--fresh');
const baseArg = args.find(a => a.startsWith('--base='))?.slice(7)
  ?? args.find(a => a.startsWith('http'));

const months = JSON.parse(readFileSync(COST_FILE, 'utf8')).metadata?.months;
if (!months?.length) {
  console.error('[리테일] 비용 데이터에 월 목록이 없습니다. preprocess.py 를 먼저 실행하세요.');
  process.exit(1);
}

// 기존 파일은 유지한다. 통째로 덮어쓰면 한 달 실패에 전체가 날아간다.
const out = existsSync(OUT_FILE) ? JSON.parse(readFileSync(OUT_FILE, 'utf8')) : {};
const todo = refetchAll ? months : months.filter(m => !out[m]);

if (todo.length === 0) {
  const have = Object.keys(out).sort();
  console.log(`[리테일] 이미 최신입니다 — ${have.at(-1)} 까지 ${have.length}개월. 다시 받으려면 --all`);
  process.exit(0);
}

const ping = (base, month) =>
  fetch(`${base}/api/retail-sales?month=${month}`, { signal: AbortSignal.timeout(5000) })
    .then(r => r.ok)
    .catch(() => false);

const freePort = (from) => new Promise((resolve) => {
  const srv = net.createServer();
  srv.listen(from, '127.0.0.1', () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
  srv.on('error', () => resolve(freePort(from + 1)));
});

/** 서버를 확보한다. 이미 떠 있으면 그걸 쓰고, 아니면 띄운다 (끝나면 내림) */
async function ensureServer() {
  const probe = forceFresh ? [] : baseArg ? [baseArg] : ['http://localhost:3000', 'http://localhost:3001'];
  for (const base of probe) {
    if (await ping(base, months[0])) {
      console.log(`[리테일] 떠 있는 서버 사용: ${base}`);
      return { base, stop: () => {} };
    }
  }
  if (baseArg && !forceFresh) {
    console.error(`[리테일] ${baseArg} 에 연결할 수 없습니다.`);
    process.exit(1);
  }

  const port = await freePort(3100);
  const base = `http://localhost:${port}`;
  console.log(`[리테일] 서버가 없어 직접 띄웁니다 (포트 ${port})...`);
  // shell 에 인자 배열을 같이 넘기면 Node 가 경고를 낸다 — 한 문장으로 준다
  const child = spawn(`npx next dev -p ${port}`, {
    cwd: ROOT, shell: true, stdio: 'ignore', windowsHide: true,
  });

  const stop = () => {
    // next dev 는 실제 서버가 자식 프로세스라 부모만 죽이면 포트가 남는다
    if (process.platform === 'win32') {
      spawn(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore', shell: true });
    } else {
      try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
    }
  };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (await ping(base, months[0])) {
      console.log('[리테일] 서버 준비 완료');
      return { base, stop };
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  stop();
  console.error('[리테일] 서버가 3분 안에 뜨지 않았습니다.');
  process.exit(1);
}

const { base, stop } = await ensureServer();
console.log(`[리테일] ${todo.length}개월 조회 (${todo[0]} ~ ${todo.at(-1)})`);

let failed = 0;
for (const month of todo) {
  try {
    const res = await fetch(`${base}/api/retail-sales?month=${month}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (data?.error) throw new Error(data.error);
    out[month] = data;
    const corp = data?.units?.['법인']?.mtd?.sale ?? 0;
    console.log(`  - ${month}  법인 당월 ${Math.round(corp / 1000).toLocaleString()}K`);
  } catch (e) {
    failed += 1;
    console.error(`  [실패] ${month}: ${e.message}`);
  }
}

const body = JSON.stringify(out);
writeFileSync(OUT_FILE, body, 'utf8');
const kept = Object.keys(out).sort();
console.log(`\n[리테일] 저장 완료: ${kept.at(-1)} 까지 ${kept.length}개월 (${(Buffer.byteLength(body) / 1024).toFixed(0)} KB)`);
if (failed) console.log(`[리테일] 실패 ${failed}개월 — 해당 월은 화면에서 '—' 로 표시됩니다.`);
stop();
