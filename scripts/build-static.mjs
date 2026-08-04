/**
 * 정적 산출물 빌드 — DCS AI Quick Dashboard 배포용
 *
 * Next.js 는 `output: 'export'` 와 API 라우트를 같이 쓸 수 없어서,
 * 빌드 동안만 app/api 를 잠시 옮겨두고 끝나면 되돌린다.
 * (로컬 개발은 API 라우트를 그대로 쓰므로 파일을 지우면 안 된다)
 *
 * 사용법: node scripts/build-static.mjs   →  out/ 생성
 */

import { existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'app', 'api');
const PARKED = path.join(ROOT, 'app', '_api.disabled');

if (existsSync(PARKED)) {
  console.error(`[정적빌드] 이전 빌드가 비정상 종료된 흔적: ${PARKED}\n먼저 app/api 로 되돌려주세요.`);
  process.exit(1);
}

let moved = false;
try {
  if (existsSync(API_DIR)) {
    renameSync(API_DIR, PARKED);
    moved = true;
    console.log('[정적빌드] app/api 잠시 비활성화');
  }

  const res = spawnSync('npx', ['next', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, STATIC_EXPORT: '1' },
  });
  if (res.status !== 0) process.exitCode = res.status ?? 1;
} finally {
  if (moved && existsSync(PARKED)) {
    renameSync(PARKED, API_DIR);
    console.log('[정적빌드] app/api 복구');
  }
}

if (!process.exitCode) {
  console.log('\n[정적빌드] 완료 → out/  (Quick Dashboard 에 이 폴더를 업로드)');
}
