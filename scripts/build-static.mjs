/**
 * 정적 산출물 빌드 — DCS AI Quick Dashboard 배포용
 *
 * Next.js 는 `output: 'export'` 와 API 라우트를 같이 쓸 수 없어서,
 * 빌드 동안만 app/api 를 잠시 옮겨두고 끝나면 되돌린다.
 * (로컬 개발은 API 라우트를 그대로 쓰므로 파일을 지우면 안 된다)
 *
 * 사용법: node scripts/build-static.mjs [basePath]   →  out/ 생성
 *
 * basePath 는 **기본값이 빈 값**이다. Quick Dashboard 서버가 서빙할 때
 *   <base href="/server/quick-dashboard/<slug>/"> 를 주입하고
 *   자산 경로의 맨 앞 '/' 를 떼어 상대경로로 바꿔주기 때문에,
 * 빌드 쪽에서 basePath 를 또 넣으면 경로가 두 번 붙어 404 가 난다.
 * 다른 호스팅에서 서브패스가 필요할 때만 인자로 넘긴다.
 */

import { existsSync, renameSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = path.join(ROOT, 'app', 'api');
const PARKED = path.join(ROOT, 'app', '_api.disabled');
const BASE_PATH = process.argv[2] ?? '';

if (existsSync(PARKED)) {
  console.error(`[정적빌드] 이전 빌드가 비정상 종료된 흔적: ${PARKED}\n먼저 app/api 로 되돌려주세요.`);
  process.exit(1);
}

let moved = false;
try {
  if (existsSync(API_DIR)) {
    renameSync(API_DIR, PARKED);
    moved = true;
    console.log(`[정적빌드] basePath = ${BASE_PATH || '(루트)'} / app/api 잠시 비활성화`);
  }

  const res = spawnSync('npx', ['next', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, STATIC_EXPORT: '1', STATIC_BASE_PATH: BASE_PATH },
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
