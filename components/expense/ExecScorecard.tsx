'use client';

/**
 * Executive Scorecard · 종합 관리 평가
 *
 * cn-report 의 디자인을 그대로 옮겼다 — 브라운·오렌지 그라데이션 헤더, 크림색 본문,
 * 좌 원형 게이지 / 중 4개 가중 바(+증가 주도 항목) / 우 등급 범례, 진단 배너, 접이식 계산 근거.
 * 내용은 `/api/exec-scorecard` 실데이터.
 *
 * 비용(SAP) 에 원천이 없는 차원(수익성·운영건강)은 점수를 지어내지 않고 `–` 로 두며,
 * 가중치는 산출 가능한 차원만으로 재정규화한다.
 */

import { useEffect, useState } from 'react';
import type { CostType } from '@/lib/types';

interface Driver {
  item: string;
  diff: number;
  yoy: number | null;
  weight: number | null;
  weightPy: number | null;
  share: number | null;
}

interface Dimension {
  key: string;
  label: string;
  weight: number;
  available: boolean;
  score: number | null;
  sub: string;
  calc?: string | null;
  drivers?: Driver[];
  unavailableReason?: string;
}

interface Scorecard {
  biz: string;
  year: number;
  month: number;
  costType: CostType;
  total: number | null;
  grade?: string;
  tone?: 'good' | 'warn' | 'bad';
  verdict?: string;
  partial: boolean;
  dimensions: Dimension[];
  weightSum: number;
  salesError: string | null;
  error?: string;
}

/** 점수 → 색 (65+ 파랑, 50~64 앰버, <50 빨강) */
const colorOf = (s: number | null) =>
  s == null ? '#9ca3af' : s >= 65 ? '#2563eb' : s >= 50 ? '#d97706' : '#dc2626';

/** 등급 기준 — API 의 gradeOf 와 같은 컷 */
const GRADES = [
  { g: 'A', range: '80+', label: '양호', col: '#2563eb' },
  { g: 'B', range: '65~79', label: '안정', col: '#2563eb' },
  { g: 'C', range: '50~64', label: '주의', col: '#d97706' },
  { g: 'D', range: '35~49', label: '경보', col: '#dc2626' },
  { g: 'F', range: '0~34', label: '위험', col: '#dc2626' },
];

const bizLabel = (b: string) => (b === '법인' ? '법인 전체' : b);

function Gauge({ score, grade }: { score: number; grade: string }) {
  const r = 42;
  const C = 2 * Math.PI * r;
  const col = colorOf(score);
  const dash = (C * Math.max(0, Math.min(100, score))) / 100;
  return (
    <svg viewBox="0 0 100 100" className="w-[128px] h-[128px]" role="img" aria-label={`총점 ${score}점 ${grade}등급`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="#e5e7eb" strokeWidth="9" />
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke={col}
        strokeWidth="9"
        strokeLinecap="round"
        strokeDasharray={`${dash} ${C}`}
        transform="rotate(-90 50 50)"
      />
      <text x="50" y="49" textAnchor="middle" fontSize="30" fontWeight="800" fill="#1f2937">
        {score}
      </text>
      <text x="50" y="66" textAnchor="middle" fontSize="13" fontWeight="800" fill={col}>
        {grade}
      </text>
    </svg>
  );
}

export interface ExecScorecardProps {
  biz: string;
  year: number;
  month: number;
  costType: CostType;
}

export default function ExecScorecard({ biz, year, month, costType }: ExecScorecardProps) {
  const [data, setData] = useState<Scorecard | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let alive = true;
    setData(null);
    setErr('');
    const qs = new URLSearchParams({ biz, year: String(year), month: String(month), costType });
    fetch(`/api/exec-scorecard?${qs}`)
      .then(r => r.json())
      .then((d: Scorecard) => {
        if (!alive) return;
        if (d.error) setErr(d.error);
        else setData(d);
      })
      .catch(e => alive && setErr(e?.message ?? '평가를 불러오지 못했습니다.'));
    return () => {
      alive = false;
    };
  }, [biz, year, month, costType]);

  return (
    <div className="flex-1 overflow-y-auto p-4" data-section="exec-scorecard">
      {/* 헤더 배너 — 브라운·오렌지 그라데이션 */}
      <div
        className="rounded-t-lg px-5 py-3 flex items-baseline gap-3 flex-wrap"
        style={{ background: 'linear-gradient(90deg,#6b3410 0%,#a5551a 55%,#c26a1e 100%)' }}
      >
        <span className="text-white font-extrabold text-[16px] tracking-tight">
          Executive Scorecard <span className="font-bold text-white/85">· 종합 관리 평가</span>
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-white/20 px-2.5 py-0.5 text-white text-[11px] font-bold backdrop-blur-sm">
          {bizLabel(biz)} 기준
        </span>
        <span className="text-white/80 italic text-[11px]">
          「매출 성장 / 수익성 / 비용 관리 / 운영 건강」 4개 차원 종합 · YTD 누적 기준
        </span>
        <span className="ml-auto text-white/70 text-[10px] not-italic">
          {year}년 {month}월 · {costType}
        </span>
      </div>

      {/* 본문 */}
      <div className="border border-t-0 border-amber-200/70 rounded-b-lg bg-[#fdf9ef] p-4">
        {err && (
          <div className="text-[12px] text-red-700 bg-red-50 border border-red-200 rounded p-3">
            평가 산출 오류: {err}
          </div>
        )}
        {!data && !err && (
          <div className="text-[12px] text-gray-400 animate-pulse text-center py-10">
            종합 평가 산출 중...
          </div>
        )}
        {data && data.total == null && (
          <div className="text-[12px] text-gray-500 text-center py-10">
            산출 가능한 평가 차원이 없습니다.
            {data.salesError && ` (매출 조회 실패: ${data.salesError})`}
          </div>
        )}
        {data && data.total != null && (
          <>
            <div className="flex flex-col md:flex-row gap-5 items-center md:items-stretch">
              {/* 좌: 게이지 */}
              <div className="flex flex-col items-center justify-center px-2 md:border-r md:border-amber-200/70 md:pr-6 shrink-0">
                <div className="text-[10px] font-bold tracking-[0.2em] text-amber-800/80 mb-1">
                  YTD · ~{data.month}월 누적
                </div>
                <Gauge score={data.total} grade={data.grade ?? '-'} />
                {data.partial && (
                  <div className="mt-1 text-[9px] text-amber-700/80 text-center leading-tight">
                    ※ 가중치 합 {data.weightSum}점
                    <br />
                    기준 재정규화
                  </div>
                )}
              </div>

              {/* 중: 4개 차원 가중 바 */}
              <div className="flex-1 w-full flex flex-col justify-center gap-3 py-1">
                {data.dimensions.map(d => {
                  const na = d.score == null;
                  const col = colorOf(d.score);
                  return (
                    <div key={d.key} className="flex items-center gap-3">
                      <div className="w-56 shrink-0">
                        <div className="leading-tight">
                          <span
                            className={`text-[12px] font-bold ${na ? 'text-gray-400' : 'text-gray-800'}`}
                          >
                            {d.label}
                          </span>
                          <span className="ml-1 text-[10px] font-semibold text-gray-400">
                            {d.weight}%
                          </span>
                        </div>
                        <div className="text-[9px] text-gray-500 leading-tight">
                          {d.available ? d.sub : d.unavailableReason}
                        </div>
                        {/* 증가 주도 항목 — 비중 → 전년비 → 증가분 기여도 순 */}
                        {d.drivers && d.drivers.length > 0 && (
                          <div className="mt-1 space-y-0.5">
                            {d.drivers.map(v => (
                              <div key={v.item} className="text-[8.5px] leading-tight">
                                <span className="text-gray-400">└</span>{' '}
                                <b className="text-gray-800">{v.item}</b>{' '}
                                <span className="text-gray-400">비중 </span>
                                <b className="text-slate-900">
                                  {v.weight != null ? `${v.weight.toFixed(1)}%` : '-'}
                                </b>
                                {v.weightPy != null && (
                                  <span className="text-gray-400">
                                    {' '}
                                    (전년 {v.weightPy.toFixed(1)}%)
                                  </span>
                                )}
                                <span className="text-gray-300"> · </span>
                                <span className="text-rose-600 font-semibold">
                                  {v.yoy != null ? `${Math.round(v.yoy)}%` : '-'}
                                </span>
                                {v.share != null && (
                                  <span className="text-gray-500">
                                    {' '}
                                    · 증가분의 <b>{Math.round(v.share)}%</b>
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex-1 h-2.5 bg-gray-200 rounded-full overflow-hidden">
                        {!na && (
                          <div
                            className="h-full rounded-full transition-all"
                            style={{ width: `${Math.max(2, d.score!)}%`, background: col }}
                          />
                        )}
                      </div>
                      <div
                        className="w-8 text-right text-[15px] font-extrabold"
                        style={{ color: col }}
                      >
                        {na ? '–' : Math.round(d.score!)}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* 우: 등급 기준 */}
              <div className="w-full md:w-[168px] shrink-0 md:border-l md:border-amber-200/70 md:pl-4 flex flex-col justify-center">
                <div className="text-[9px] font-bold text-amber-800/80 mb-1.5 tracking-wide">
                  등급 기준{' '}
                  <span className="text-gray-400 font-normal">
                    · 총점 {data.total}점 → {data.grade}
                  </span>
                </div>
                <div className="space-y-1">
                  {GRADES.map(gr => {
                    const active = gr.g === data.grade;
                    return (
                      <div
                        key={gr.g}
                        className={`flex items-center gap-2 rounded px-1.5 py-0.5 text-[10px] border ${
                          active ? 'bg-white shadow-sm' : 'border-transparent'
                        }`}
                        style={active ? { borderColor: gr.col } : undefined}
                      >
                        <span className="font-extrabold w-3 text-center" style={{ color: gr.col }}>
                          {gr.g}
                        </span>
                        <span className="text-gray-400 w-11 tabular-nums text-[9px]">
                          {gr.range}
                        </span>
                        <span
                          className={active ? 'font-bold' : 'text-gray-500'}
                          style={active ? { color: gr.col } : undefined}
                        >
                          {gr.label}
                        </span>
                        {active && (
                          <span className="ml-auto text-[9px] font-bold" style={{ color: gr.col }}>
                            ◀
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* 진단 배너 */}
            <div
              className={`mt-3 rounded-lg px-4 py-2.5 text-center text-[12px] font-semibold border ${
                data.tone === 'good'
                  ? 'bg-green-50/70 border-green-200 text-green-800'
                  : data.tone === 'warn'
                    ? 'bg-amber-50/80 border-amber-200 text-amber-800'
                    : 'bg-red-50/70 border-red-200 text-red-700'
              }`}
            >
              <span className="font-bold">{bizLabel(data.biz)}</span> · {data.verdict}
            </div>

            {/* 산출 제외 차원 안내 */}
            {data.partial && (
              <p className="mt-2 text-[10px] text-amber-800/90 bg-amber-50/70 border border-amber-200 rounded px-3 py-1.5">
                {data.dimensions
                  .filter(d => !d.available)
                  .map(d => d.label)
                  .join(' · ')}{' '}
                차원은 이 대시보드에 원천 데이터가 없어 점수에서 제외했습니다. 값을 임의로 채우지
                않고 가중치를 재정규화했습니다.
              </p>
            )}

            {/* 계산 근거 (접이식) */}
            {data.dimensions.some(d => d.calc) && (
              <details className="mt-2 group">
                <summary className="cursor-pointer select-none text-[11px] font-bold text-amber-800/90 hover:text-amber-900 list-none flex items-center gap-1">
                  <span className="transition-transform group-open:rotate-90">▶</span> 계산 근거 보기{' '}
                  <span className="font-normal text-gray-400">· 실제 숫자로 검증 (K위안)</span>
                </summary>
                <div className="mt-2 grid grid-cols-1 md:grid-cols-2 gap-2">
                  {data.dimensions
                    .filter(d => d.calc)
                    .map(d => (
                      <div
                        key={d.key}
                        className="rounded-md border border-amber-200/70 bg-white/70 px-3 py-2"
                      >
                        <div className="text-[11px] font-bold text-gray-700 mb-0.5">
                          {d.label}{' '}
                          <span className="text-gray-400 font-normal">{d.weight}%</span>
                        </div>
                        <pre className="text-[10px] leading-relaxed text-gray-600 font-mono whitespace-pre-wrap m-0">
                          {d.calc}
                        </pre>
                      </div>
                    ))}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </div>
  );
}
