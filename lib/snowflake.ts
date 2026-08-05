/**
 * Snowflake 연결 공용 모듈 — 여러 API 라우트가 같은 접속·질의 코드를 쓰지 않도록 한 곳에 모았다.
 *
 * 인증은 다른 F&F 대시보드와 동일한 **key-pair(JWT)** 방식.
 * 서비스 계정(SVC_ORG_FPA) + 개인키를 쓴다. 아이디/비밀번호 방식은 폐지됐다.
 */

import snowflake from 'snowflake-sdk';

export function getSnowflakeConnection(): snowflake.Connection {
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

export function executeQuery(
  connection: snowflake.Connection,
  sqlText: string,
  binds: (string | number)[]
): Promise<any[]> {
  return new Promise((resolve, reject) => {
    connection.execute({
      sqlText,
      binds: binds as snowflake.Binds,
      complete: (err: any, _stmt: any, rows: any[] | undefined) => {
        if (err) reject(err);
        else resolve(rows || []);
      },
    });
  });
}

/**
 * 연결 → 질의 → 정리까지 한 번에. 라우트마다 connect/destroy 를 반복하지 않게 한다.
 * destroy 실패는 응답을 막을 이유가 없으므로 로그만 남긴다.
 */
export async function querySnowflake(
  sqlText: string,
  binds: (string | number)[] = []
): Promise<any[]> {
  const connection = getSnowflakeConnection();
  try {
    await new Promise<void>((resolve, reject) => {
      connection.connect((err: any) => (err ? reject(err) : resolve()));
    });
    return await executeQuery(connection, sqlText, binds);
  } finally {
    connection.destroy((err: any) => {
      if (err) console.error('[snowflake] 연결 해제 실패:', err.message);
    });
  }
}
