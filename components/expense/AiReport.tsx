'use client';

/**
 * AI 보고서
 *
 * 마크업·색은 cn-report 가 내려준 실제 보고서(AI보고서_2026년_실적_6월.html)에서 그대로 옮겼다.
 * 클래스·그라데이션·배지 색까지 원본과 같은 값을 쓴다. 숫자와 문장만 실데이터로 채운다.
 */

import { useEffect, useState } from 'react';
import type {
  AiReport as AiReportData,
  CategoryRow,
  DetailRow,
  PeriodFigures,
  ReportMode,
} from '@/lib/ai-report-builder';
import type { CostType } from '@/lib/types';

const k = (v: number | null | undefined) =>
  v == null ? '-' : `${Math.round(v / 1000).toLocaleString()}K`;
const pct = (v: number | null | undefined) =>
  v == null ? '-' : `${Math.round(v).toLocaleString()}%`;
const pct1 = (v: number | null | undefined) => (v == null ? '-' : `${v.toFixed(1)}%`);
const pct2 = (v: number | null | undefined) => (v == null ? '-' : `${v.toFixed(2)}%`);
const pp = (v: number | null | undefined, digits = 2) =>
  v == null ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}%p`;

/** YoY 배지 — 원본: 좋으면 green, 나쁘면 red, 중립이면 gray */
function YoyBadge({ value, tone }: { value: string; tone: 'good' | 'bad' | 'flat' }) {
  const cls =
    tone === 'bad'
      ? 'bg-red-100 text-red-700'
      : tone === 'good'
        ? 'bg-green-100 text-green-700'
        : 'bg-gray-100 text-gray-600';
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${cls}`}>{value}</span>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="text-[14px] font-bold text-[#1E3A5F] mb-3 mt-6 pl-2"
      style={{ borderLeft: '3px solid #6366F1' }}
    >
      {children}
    </h2>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[12px] border border-[#E5E7EB] px-5 py-4 mb-4">{children}</div>
  );
}

/** KPI 카드 한 줄 (라벨 / 값 / 배지) */
function KpiLine({
  label,
  value,
  badge,
  badgeTone,
  muted,
}: {
  label: string;
  value: string;
  badge?: string;
  badgeTone?: 'good' | 'bad' | 'flat';
  muted?: boolean;
}) {
  return (
    <div className="mt-1 flex items-baseline gap-2">
      <span className="w-[78px] text-[11.5px] text-slate-500 shrink-0">{label}</span>
      <span className="text-[14.5px] font-bold text-slate-900 leading-tight">{value}</span>
      {badge &&
        (muted ? (
          <span className="text-[12px] text-slate-500">{badge}</span>
        ) : (
          <YoyBadge value={badge} tone={badgeTone ?? 'flat'} />
        ))}
    </div>
  );
}

function KpiCard({
  title,
  border,
  bg,
  titleColor,
  children,
}: {
  title: string;
  border: string;
  bg: string;
  titleColor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`border ${border} ${bg} rounded-2xl px-4 py-2.5 flex flex-col shadow-sm`}>
      <div className={`text-[12.5px] font-semibold tracking-wide uppercase ${titleColor}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

/** ② 스코어 등급별 색 — 원본 보고서 값 그대로 */
const GRADE_TONE: Record<string, { border: string; bg: string; fg: string }> = {
  A: { border: 'rgb(167, 243, 208)', bg: 'rgb(240, 253, 244)', fg: 'rgb(21, 128, 61)' },
  B: { border: 'rgb(191, 219, 254)', bg: 'rgb(239, 246, 255)', fg: 'rgb(3, 105, 161)' },
  C: { border: 'rgb(253, 230, 138)', bg: 'rgb(255, 251, 235)', fg: 'rgb(180, 83, 9)' },
  D: { border: 'rgb(254, 202, 202)', bg: 'rgb(254, 242, 242)', fg: 'rgb(185, 28, 28)' },
};

/** ② 항목별 바 색 — 원본 보고서 값 그대로 */
const ITEM_COLOR: Record<string, string> = {
  추세: 'rgb(21, 128, 61)',
  수준: 'rgb(3, 105, 161)',
  광고비율: 'rgb(180, 83, 9)',
  계획집행: 'rgb(124, 58, 237)',
};

/** 매출 YoY 는 높을수록 좋고, 비용 YoY 는 낮을수록 좋다 */
const salesTone = (yoy: number | null) => (yoy == null ? 'flat' : yoy >= 100 ? 'good' : 'bad');

// ── 상세 분석 표 (원본 `rpt-detail-tbl`) ──────────────────────────
// 컬럼 그룹 배경: 당월 #EFF6FF · YTD #F0FDF4 · 계획 #FEFCE8 · 판정 #F9FAFB
const G_MONTH = 'rgb(239, 246, 255)';
const G_YTD = 'rgb(240, 253, 244)';
const G_PLAN = 'rgb(254, 252, 232)';
const G_VERDICT = 'rgb(249, 250, 251)';
const SEP = '2px solid rgb(209, 213, 219)';

function DetailTable({ rows }: { rows: DetailRow[] }) {
  if (rows.length === 0) return null;
  const num = (v: number | null, percent?: boolean) =>
    v == null ? '-' : percent ? `${v.toFixed(2)}%` : Math.round(v / 1000).toLocaleString();
  const p = (v: number | null) => (v == null ? '-' : `${Math.round(v)}%`);

  const th = (label: string, bg: string, sep = false) => (
    <th
      key={label + bg + String(sep)}
      className="text-[12px] font-semibold px-2.5 py-1.5 whitespace-nowrap"
      style={{
        background: bg,
        color: '#475569',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        borderRight: '1px solid #E2E8F0',
        borderLeft: sep ? SEP : undefined,
      }}
    >
      {label}
    </th>
  );
  const td = (v: React.ReactNode, bg: string, sep = false, align: 'left' | 'right' = 'right') => (
    <td
      className="text-[13px] px-2.5 py-1.5 whitespace-nowrap"
      style={{
        background: bg,
        color: '#334155',
        textAlign: align,
        borderBottom: '1px solid #EEF2F6',
        borderRight: '1px solid #EEF2F6',
        borderLeft: sep ? SEP : undefined,
      }}
    >
      {v}
    </td>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
        <thead>
          <tr>
            <th style={{ background: '#F8FAFC', padding: '6px 10px' }} />
            <th
              colSpan={3}
              style={{ fontSize: '10.5px', fontWeight: 700, padding: '6px 10px', textAlign: 'center', letterSpacing: '0.02em', background: G_MONTH, color: 'rgb(29, 78, 216)' }}
            >
              당월
            </th>
            <th
              colSpan={3}
              style={{ fontSize: '10.5px', fontWeight: 700, padding: '6px 10px', textAlign: 'center', letterSpacing: '0.02em', background: 'rgb(236, 253, 245)', color: 'rgb(4, 120, 87)' }}
            >
              YTD 누적
            </th>
            <th
              colSpan={4}
              style={{ fontSize: '10.5px', fontWeight: 700, padding: '6px 10px', textAlign: 'center', letterSpacing: '0.02em', background: 'rgb(255, 251, 235)', color: 'rgb(180, 83, 9)' }}
            >
              계획 대비
            </th>
            <th style={{ background: '#F8FAFC', padding: '6px 10px', borderLeft: '2px solid rgb(203, 213, 225)' }} />
          </tr>
          <tr>
            {th('항목', '#F8FAFC')}
            {th('당월(전년)K', G_MONTH, true)}
            {th('당월(당년)K', G_MONTH)}
            {th('당월YOY', G_MONTH)}
            {th('YTD(전년)K', G_YTD, true)}
            {th('YTD(당년)K', G_YTD)}
            {th('YTDYOY', G_YTD)}
            {th('YTD계획K', G_PLAN, true)}
            {th('계획비%', G_PLAN)}
            {th('사용률%', G_PLAN)}
            {th('연간계획K', G_PLAN)}
            {th('최종판정', G_VERDICT, true)}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.label}>
              <td
                className="text-[13px] px-2.5 py-1.5"
                style={{ borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', textAlign: 'left' }}
              >
                <strong className="font-semibold text-slate-900">{r.label}</strong>
              </td>
              {td(num(r.monthPy, r.isPercent), G_MONTH, true)}
              {td(num(r.monthCy, r.isPercent), G_MONTH)}
              {td(p(r.monthYoy), G_MONTH)}
              {td(num(r.ytdPy, r.isPercent), G_YTD, true)}
              {td(num(r.ytdCy, r.isPercent), G_YTD)}
              {td(p(r.ytdYoy), G_YTD)}
              {td(num(r.planYtd), G_PLAN, true)}
              {td(p(r.planPct), G_PLAN)}
              {td(p(r.usagePct), G_PLAN)}
              {td(num(r.planYear), G_PLAN)}
              {td(
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                  {r.verdict}
                </span>,
                G_VERDICT,
                true,
                'left'
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[13.5px] font-semibold text-slate-700 mt-4 mb-1.5">{children}</h3>;
}
function SubSubTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="text-[13px] font-semibold text-slate-700 mt-3 mb-1 tracking-tight">{children}</h4>
  );
}

export interface AiReportProps {
  year: number;
  month: number;
  mode: ReportMode;
  costType: CostType;
}

export default function AiReport({ year, month, mode, costType }: AiReportProps) {
  const [d, setD] = useState<AiReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ year: String(year), month: String(month), mode, costType });
    fetch(`/api/ai-report?${qs}`)
      .then(r => r.json())
      .then(j => {
        if (!alive) return;
        if (j.error) setError(j.error);
        else setD(j);
      })
      .catch(e => alive && setError(e?.message ?? '보고서를 불러오지 못했습니다.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [year, month, mode, costType]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
        보고서를 생성하는 중입니다…
      </div>
    );
  }
  if (error || !d) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-rose-600">
        {error ?? '보고서 데이터가 없습니다.'}
      </div>
    );
  }

  const { meta, topSummary: ts, execSummary, scoreCards, checkpoints, corporate, units, categories, natures, adByBrand,
    driverGroups, risks, adEfficiency, natureByUnit, perCapitaRows, laborDetail, adDetail,
    corpDetail, categoryDetail, efficiency, insights, notes } = d;
  const cyt = corporate.ytd;
  const cmo = corporate.monthly;

  const perCapita = (f: PeriodFigures) => (f.headcount ? f.sales / f.headcount : null);

  return (
    // 원본 보고서는 A4 출력용이라 컨테이너가 1100px 고정이었는데, 여기서는 패널 안에
    // 들어가므로 폭을 꽉 채운다 (고정 폭이면 좌우가 비어 보인다).
    <div className="flex-1 overflow-y-auto bg-[#F3F4F6] text-[#374151]">
      <div className="w-full p-4">
        {/* ── 헤더 ── */}
        <div
          className="mb-3 rounded-xl px-5 py-3.5 flex items-center justify-between text-white"
          style={{ background: 'linear-gradient(135deg, rgb(30, 58, 95) 0%, rgb(67, 56, 202) 100%)' }}
        >
          <div>
            <div className="text-[15.5px] font-bold tracking-tight">
              F&amp;F CHINA 비용 적정성 검토
            </div>
            <div className="text-[11.5px] mt-0.5 opacity-80">
              {meta.periodLabel} <span className="opacity-60">|</span> {meta.costType}{' '}
              <span className="opacity-60">|</span> {meta.ratioFormula}
            </div>
          </div>
          <div className="text-[11px] opacity-60">
            생성 {new Date(meta.generatedAt).toLocaleDateString('ko-KR')}
          </div>
        </div>

        {notes.length > 0 && (
          <div className="mb-3 space-y-1">
            {notes.map((n, i) => (
              <div
                key={i}
                className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5"
              >
                {n}
              </div>
            ))}
          </div>
        )}

        {/* ── 상단 3카드 ── */}
        <div className="mb-3 grid grid-cols-1 lg:grid-cols-3 gap-2.5">
          <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
            <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">📊 YTD 전체 총평 · 해석</div>
            <div className="text-[12px] leading-[1.65] text-slate-700">
              <div>
                법인 누적 비용률 (리테일매출 대비) YoY{' '}
                <b className="text-slate-900">{pp(ts.ratioDeltaPp)}</b> ·{' '}
                <b style={{ color: ts.verdict === '전반적 악화' ? 'rgb(185, 28, 28)' : 'rgb(4, 120, 87)' }}>
                  {ts.verdict}
                </b>
              </div>
              {ts.leadNature && (
                <div className="mt-0.5">
                  주도 분류 → <b>{ts.leadNature.nature}</b>{' '}
                  <span className="text-slate-500">({pp(ts.leadNature.deltaPp)})</span>
                </div>
              )}
              {ts.biggestMover && (
                <div className="mt-1.5 px-2 py-1 bg-white border-l-2 border-rose-500 rounded-r text-[11.5px]">
                  💡 가장 큰 변동 브랜드: <b>{ts.biggestMover.unit}</b>{' '}
                  <span className="text-rose-700 font-semibold">({pp(ts.biggestMover.deltaPp)})</span>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
            <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">🔍 YTD 주목 브랜드 · 동인</div>
            <div className="space-y-1.5">
              {ts.worst && (
                <div className="bg-rose-50 border-l-2 border-rose-600 rounded-r px-2 py-1.5">
                  <div className="text-[12px]">
                    <b className="text-rose-700">⚠ 주의: {ts.worst.unit}</b> 비용률{' '}
                    <b>{pct1(ts.worst.ytd.ratio)}</b>{' '}
                    <span className="text-slate-400">(전년 {pct1(ts.worst.ytd.ratioPy)})</span>{' '}
                    <b className="text-rose-700">{pp(ts.worst.contribPp)}</b>
                  </div>
                </div>
              )}
              {ts.best && (
                <div className="bg-emerald-50 border-l-2 border-emerald-600 rounded-r px-2 py-1.5">
                  <div className="text-[12px]">
                    <b className="text-emerald-700">✅ 우수: {ts.best.unit}</b> 비용률{' '}
                    <b>{pct1(ts.best.ytd.ratio)}</b>{' '}
                    <span className="text-slate-400">(전년 {pct1(ts.best.ytd.ratioPy)})</span>{' '}
                    <b className="text-emerald-700">{pp(ts.best.contribPp)}</b>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg p-3 bg-[#F8FAFF] border border-[#E0E7FF]">
            <div className="text-[11px] font-bold text-[#4338CA] mb-1.5">
              📌 YTD 주요 비용 변동 원인 TOP 3
            </div>
            <div className="text-[12px] leading-[1.7] space-y-0.5">
              {ts.top3.map((t, i) => (
                <div key={`${t.unit}-${t.category}`} className="flex items-baseline gap-1.5">
                  <span>{['🥇', '🥈', '🥉'][i]}</span>
                  <span>
                    <b>{t.unit}</b> {t.category}{' '}
                    <b className={t.deltaPp >= 0 ? 'text-rose-700' : 'text-emerald-700'}>
                      {t.deltaPp >= 0 ? '▲' : '▼'} {Math.abs(t.deltaPp).toFixed(2)}%p
                    </b>{' '}
                    <span className="text-slate-400">({k(t.amount)})</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── EXECUTIVE SUMMARY ── */}
        {execSummary.length > 0 && (
          <div className="mb-5 rounded-2xl overflow-hidden border border-purple-200 shadow-sm">
            <div className="flex items-center justify-between bg-gradient-to-r from-purple-700 to-indigo-600 px-5 py-3.5">
              <span className="text-white font-bold text-[13px] tracking-[0.18em]">
                EXECUTIVE SUMMARY
              </span>
              <span className="text-purple-100 text-[12px]">{meta.title}</span>
            </div>
            <div className="bg-purple-50 px-5 py-3 space-y-1.5">
              {execSummary.map((s, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2.5 text-[13.5px] text-slate-700 leading-[1.6]"
                >
                  <span className="text-purple-600 font-bold flex-shrink-0 mt-px">▸</span>
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ① KPI 카드 ── */}
        <div
          className="grid gap-2 mb-5 items-stretch"
          style={{ gridTemplateColumns: '0.85fr 0.85fr 1.15fr 1.25fr 1.05fr' }}
        >
          <KpiCard title="판매매출" border="border-blue-200" bg="bg-blue-50/60" titleColor="text-blue-600">
            <KpiLine label="(당월)" value={k(cmo.sales)} badge={pct(cmo.salesYoy)} badgeTone={salesTone(cmo.salesYoy)} />
            <KpiLine label="(YTD누적)" value={k(cyt.sales)} badge={pct(cyt.salesYoy)} badgeTone={salesTone(cyt.salesYoy)} />
          </KpiCard>

          <KpiCard title="총비용" border="border-orange-200" bg="bg-orange-50/60" titleColor="text-orange-600">
            <KpiLine label="(당월)" value={k(cmo.expense)} badge={pct(cmo.expenseYoy)} badgeTone="flat" />
            <KpiLine label="(YTD누적)" value={k(cyt.expense)} badge={pct(cyt.expenseYoy)} badgeTone="flat" />
          </KpiCard>

          <KpiCard title="비용률" border="border-emerald-200" bg="bg-emerald-50/60" titleColor="text-emerald-600">
            <KpiLine label="(당월)" value={`당월 ${pct2(cmo.ratio)}`} badge={pp(cmo.ratioDelta, 2)} muted />
            <KpiLine label="(YTD누적)" value={`YTD ${pct2(cyt.ratio)}`} badge={pp(cyt.ratioDelta, 2)} muted />
            <div className="mt-0.5 pl-[86px] text-[11.5px] font-semibold text-slate-500">
              {cyt.ratioDelta == null ? '-' : cyt.ratioDelta > 0 ? '악화(YTD 기준)' : '개선(YTD 기준)'}
            </div>
          </KpiCard>

          <KpiCard title="인원" border="border-violet-200" bg="bg-violet-50/60" titleColor="text-violet-600">
            <KpiLine
              label="(기말)"
              value={`${cyt.headcount.toLocaleString()}명`}
              badge={`${cyt.headcount - cyt.headcountPy >= 0 ? '+' : ''}${(cyt.headcount - cyt.headcountPy).toLocaleString()}명`}
              muted
            />
            <KpiLine
              label="(인당매출)"
              value={`YTD ${k(perCapita(cyt))}`}
              badge={
                perCapita(cyt) != null && perCapita({ ...cyt, sales: cyt.salesPy, headcount: cyt.headcountPy })
                  ? pct((perCapita(cyt)! / (cyt.salesPy / cyt.headcountPy)) * 100)
                  : '-'
              }
              badgeTone="good"
            />
          </KpiCard>

          <KpiCard title="광고비" border="border-rose-200" bg="bg-rose-50/60" titleColor="text-rose-600">
            {adByBrand
              .filter(a => a.amount !== 0)
              .slice(0, 3)
              .map(a => (
                <KpiLine
                  key={a.unit}
                  label={a.unit}
                  value={k(a.amount)}
                  badge={pct(a.yoy)}
                  badgeTone={(a.yoy ?? 100) > 100 ? 'bad' : 'good'}
                />
              ))}
          </KpiCard>
        </div>

        {/* ── ② 종합 스코어 ── */}
        {scoreCards.length > 0 && (
          <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
            <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
              ② 사업부별 YTD 비용 효율 종합 스코어
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
              {scoreCards.map(sc => {
                const t = GRADE_TONE[sc.grade];
                return (
                  <div
                    key={sc.unit}
                    className="rounded-xl p-3"
                    style={{ border: `2px solid ${t.border}`, background: t.bg }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="text-[13px] font-bold text-slate-900">{sc.unit}</span>
                    </div>
                    <div className="mt-1.5 flex items-baseline gap-1.5">
                      <span className="font-black leading-none" style={{ fontSize: 36, color: t.fg }}>
                        {sc.grade}
                      </span>
                      <span className="text-[12px] font-bold" style={{ color: t.fg }}>
                        {sc.label}
                      </span>
                    </div>
                    <div className="text-[10.5px] text-slate-500 mt-0.5">
                      종합 {sc.total}점 / 100점
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {sc.items.map(it => {
                        const col = ITEM_COLOR[it.key];
                        return (
                          <div key={it.key}>
                            <div className="flex justify-between text-[10px] text-slate-500">
                              <span>{it.key}</span>
                              <span className="font-semibold" style={{ color: col }}>
                                {it.score}점
                              </span>
                            </div>
                            <div
                              className="rounded-[3px] h-1 overflow-hidden"
                              style={{ background: 'rgb(229, 231, 235)' }}
                            >
                              <div
                                className="h-1"
                                style={{
                                  width: `${(it.score / it.max) * 100}%`,
                                  background: col,
                                  borderRadius: 3,
                                }}
                              />
                            </div>
                            <div className="text-[9.5px] text-slate-400 mt-0.5 truncate">
                              {it.note}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <div
                      className="mt-2 pt-1.5 border-t text-[11px]"
                      style={{ borderColor: t.border }}
                    >
                      총비용률 <strong className="text-slate-900">{pct2(sc.ratio)}</strong>{' '}
                      <span
                        className="font-semibold"
                        style={{ color: (sc.ratioDelta ?? 0) > 0 ? '#B91C1C' : '#047857' }}
                      >
                        {pp(sc.ratioDelta)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── ③ 체크포인트 ── */}
        {checkpoints.length > 0 && (
          <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
            <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
              ③ 사업부별 YTD 체크포인트 — 지금 바로 확인해야 할 것
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-2.5">
              {checkpoints.map(cp => (
                <div
                  key={cp.unit}
                  className="rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2.5"
                >
                  <div className="text-[13px] font-bold text-slate-900 border-b-2 border-[#E5E7EB] pb-1 mb-1">
                    {cp.unit} {cp.signal}
                  </div>
                  <div className="space-y-1.5 mt-1">
                    {cp.items.map((it, i) => (
                      <div
                        key={i}
                        className="rounded-[7px] px-2 py-1.5"
                        style={
                          it.tone === 'flat'
                            ? { border: '1px solid rgb(229, 231, 235)', background: 'rgb(250, 250, 250)' }
                            : { border: '1px solid rgb(191, 219, 254)', background: 'rgb(239, 246, 255)' }
                        }
                      >
                        <div className="text-[11.5px] font-semibold text-slate-900 leading-snug">
                          {it.icon} {it.title}
                          <span className="font-semibold"> {it.delta}</span>
                        </div>
                        <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                          {it.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── ④ 사업부별 현황 ── */}
        <SectionTitle>④ 사업부별 YTD 비용 현황 한눈에 보기</SectionTitle>
        <Card>
          <div className="overflow-x-auto">
            <table
              className="w-full"
              style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}
            >
              <thead>
                <tr>
                  {['사업부', '매출(K)', '총비용(K)', '비용 YoY', '총비용률', '전년', 'YoY', '광고비율', '최대 변동 항목', '신호'].map(
                    (h, i) => (
                      <th
                        key={h}
                        className="text-[12px] font-semibold text-[#4B5563] bg-[#F9FAFB] px-2 py-[5px] whitespace-nowrap border border-[#E5E7EB]"
                        style={{ textAlign: i === 0 || i === 8 ? 'left' : 'center' }}
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {units.map(u => {
                  const ad = adByBrand.find(a => a.unit === u.unit);
                  const worse = (u.ytd.ratioDelta ?? 0) > 0;
                  return (
                    <tr key={u.unit}>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-left font-bold text-slate-900">
                        {u.unit}
                      </td>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{k(u.ytd.sales)}</td>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{k(u.ytd.expense)}</td>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{pct(u.ytd.expenseYoy)}</td>
                      <td className="text-[13px] px-2 py-1 border border-[#E5E7EB] text-right font-bold whitespace-nowrap">{pct2(u.ytd.ratio)}</td>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right text-slate-400 whitespace-nowrap">{pct2(u.ytd.ratioPy)}</td>
                      <td className={`text-[12px] px-2 py-1 border border-[#E5E7EB] text-right font-bold whitespace-nowrap ${worse ? 'text-rose-700' : 'text-emerald-700'}`}>
                        {pp(u.ytd.ratioDelta)}
                      </td>
                      <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{pct1(ad?.adRatio)}</td>
                      <td className="text-[11px] px-2 py-1 border border-[#E5E7EB] text-left text-slate-600">
                        {u.maxItem
                          ? `${u.maxItem.category} ${pp(u.maxItem.deltaPp)} (${k(u.maxItem.amount)})`
                          : '-'}
                      </td>
                      <td className="text-[15px] px-2 py-1 border border-[#E5E7EB] text-center">
                        {u.ytd.ratioDelta == null ? '–' : worse ? '🔴' : '🟢'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── ⑤ 변동 원인 ── */}
        {driverGroups.length > 0 && (
          <>
            <SectionTitle>⑤ YTD 비용 변동 원인 분석 — 왜 늘었나 / 왜 줄었나</SectionTitle>
            <Card>
              <div className="columns-1 lg:columns-2 gap-3 [column-fill:balance]">
                {driverGroups.map(g => (
                  <div
                    key={g.unit}
                    className={`border rounded-lg p-3 mb-3 break-inside-avoid ${
                      g.verdict === '악화'
                        ? 'bg-rose-50 border-rose-200'
                        : g.verdict === '개선'
                          ? 'bg-emerald-50 border-emerald-200'
                          : g.verdict === '매출효과'
                            ? 'bg-cyan-50 border-cyan-200'
                            : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className="text-[13.5px] font-bold text-slate-900">{g.unit}</span>
                      <span className="text-[15px]">
                        {g.verdict === '악화' ? '🔴' : g.verdict === '개선' ? '🟢' : g.verdict === '매출효과' ? '💧' : '🟡'}
                      </span>
                      <span className="ml-auto text-[11px] text-slate-600">
                        총비용률 <b className="text-slate-900 text-[12.5px]">{pct2(g.ratio)}</b>{' '}
                        <b className={(g.ratioDelta ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}>
                          {pp(g.ratioDelta)}
                        </b>
                      </span>
                    </div>

                    {g.up.length > 0 && (
                      <>
                        <div className="text-[10.5px] font-bold text-rose-700 mt-2 mb-1.5">📈 상승 원인</div>
                        <div className="space-y-1.5">
                          {g.up.map(it => (
                            <div key={it.category} className="bg-white/70 rounded px-2 py-1.5 border border-rose-100">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-[12px] font-semibold text-slate-900">{it.category}</span>
                                <span className="text-[10.5px] text-slate-400 whitespace-nowrap">
                                  {k(it.amountPy)} → {k(it.amount)}
                                </span>
                                <span className="text-[12px] font-bold text-rose-700 whitespace-nowrap">+{k(it.delta)}</span>
                                <span className="text-[10.5px] text-slate-500 whitespace-nowrap">{pct(it.yoy)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {g.down.length > 0 && (
                      <>
                        <div className="text-[10.5px] font-bold text-emerald-700 mt-2 mb-1.5">📉 하락 요인</div>
                        <div className="space-y-1.5">
                          {g.down.map(it => (
                            <div key={it.category} className="bg-white/70 rounded px-2 py-1.5 border border-emerald-100">
                              <div className="flex items-baseline gap-2 flex-wrap">
                                <span className="text-[12px] font-semibold text-slate-900">{it.category}</span>
                                <span className="text-[10.5px] text-slate-400 whitespace-nowrap">
                                  {k(it.amountPy)} → {k(it.amount)}
                                </span>
                                <span className="text-[12px] font-bold text-emerald-700 whitespace-nowrap">
                                  △{k(Math.abs(it.delta))}
                                </span>
                                <span className="text-[10.5px] text-slate-500 whitespace-nowrap">{pct(it.yoy)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {g.up.length === 0 && g.down.length === 0 && (
                      <div className="mt-2 px-2 py-2 bg-white/60 rounded border border-slate-200">
                        <div className="text-[11.5px] font-semibold text-slate-700">▸ 현황: 비용 구조 안정적</div>
                        <div className="text-[10.5px] text-slate-500 mt-0.5 leading-snug">
                          전년 대비 의미 있는 대분류 단위 변동 없음.
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ── ⑥ 비용 항목별 YTD 상세 ── */}
        <SectionTitle>⑥ 비용 항목별 YTD 상세</SectionTitle>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  {['대분류', '성격', '당기(K)', '전년(K)', '증감(K)', 'YoY', '비중', '비용률 기여'].map((h, i) => (
                    <th
                      key={h}
                      className="text-[12px] font-semibold text-[#4B5563] bg-[#F9FAFB] px-2 py-[5px] whitespace-nowrap border border-[#E5E7EB]"
                      style={{ textAlign: i <= 1 ? 'left' : 'center' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {categories.map((c: CategoryRow) => (
                  <tr key={c.category}>
                    <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-left font-bold text-slate-900">{c.category}</td>
                    <td className="text-[11px] px-2 py-1 border border-[#E5E7EB] text-left text-slate-500">{c.nature}</td>
                    <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{k(c.amount)}</td>
                    <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right text-slate-400 whitespace-nowrap">{k(c.amountPy)}</td>
                    <td className={`text-[12px] px-2 py-1 border border-[#E5E7EB] text-right font-bold whitespace-nowrap ${c.delta > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {c.delta > 0 ? '+' : c.delta < 0 ? '△' : ''}
                      {k(Math.abs(c.delta))}
                    </td>
                    <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{pct(c.yoy)}</td>
                    <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right text-slate-500 whitespace-nowrap">{pct1(c.share)}</td>
                    <td className={`text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap ${(c.deltaPp ?? 0) > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                      {pp(c.deltaPp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── ⑦ 비용 구조 (고정 / 준고정 / 변동) ── */}
        {natures.length > 0 && (
          <>
            <SectionTitle>⑦ YTD 비용 구조 (고정 / 준고정 / 변동)</SectionTitle>
            <Card>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {natures.map(n => (
                  <div key={n.nature} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                    <div className="text-[12px] font-bold text-[#1E3A5F]">{n.nature}</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-[16px] font-extrabold text-slate-900">{k(n.amount)}</span>
                      <YoyBadge value={pct(n.yoy)} tone={(n.yoy ?? 100) > 100 ? 'bad' : 'good'} />
                    </div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      비중 {pct1(n.share)} · 비용률 기여 {pp(n.deltaPp)}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ── 점검 항목 ── */}
        {risks.length > 0 && (
          <>
            <SectionTitle>⑧ 점검 항목 — 전년 대비 급증</SectionTitle>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full" style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                  <thead>
                    <tr>
                      {['', '사업부', '대분류', '금액(K)', 'YoY', '확인 사항'].map((h, i) => (
                        <th
                          key={i}
                          className="text-[12px] font-semibold text-[#4B5563] bg-[#F9FAFB] px-2 py-[5px] whitespace-nowrap border border-[#E5E7EB]"
                          style={{ textAlign: i === 5 ? 'left' : 'center' }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {risks.map((r, i) => (
                      <tr key={`${r.unit}-${r.category}-${i}`}>
                        <td className="text-[14px] px-2 py-1 border border-[#E5E7EB] text-center">
                          {r.level === '높음' ? '🔴' : '🟡'}
                        </td>
                        <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-left font-bold text-slate-900">{r.unit}</td>
                        <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-left">{r.category}</td>
                        <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right whitespace-nowrap">{k(r.amount)}</td>
                        <td className="text-[12px] px-2 py-1 border border-[#E5E7EB] text-right font-bold text-rose-700 whitespace-nowrap">{pct(r.yoy)}</td>
                        <td className="text-[11px] px-2 py-1 border border-[#E5E7EB] text-left text-slate-600">{r.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}

        {/* ── 광고 효율 ── */}
        {adEfficiency && (
          <>
            <SectionTitle>⑨ 광고 집행 효율</SectionTitle>
            <Card>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                {[
                  { label: 'ROI', value: `${Math.round(adEfficiency.roi).toLocaleString()}%` },
                  { label: '평균 ROAS', value: adEfficiency.roas.toFixed(2) },
                  { label: '효율 등급', value: adEfficiency.grade },
                  { label: '광고비↔매출 상관', value: adEfficiency.correlation.toFixed(2) },
                  { label: '최적 집행구간', value: adEfficiency.optimalRange },
                ].map(x => (
                  <div key={x.label} className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
                    <div className="text-[11px] text-slate-500">{x.label}</div>
                    <div className="text-[15px] font-extrabold text-slate-900 mt-0.5">{x.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10.5px] text-slate-500">
                월별 광고비·매출이 모두 있는 {adEfficiency.months}개월 기준.
              </div>
            </Card>
          </>
        )}

        {/* ── ⑦ 사업부별 비용 구조 ── */}
        {natureByUnit.length > 0 && (
          <div className="mb-3 rounded-xl border border-[#E5E7EB] bg-white px-4 py-3">
            <div className="text-[13px] font-bold text-[#1E3A5F] border-l-[3px] border-[#6366F1] pl-2 mb-2.5">
              ⑦ 사업부별 YTD 비용 구조 (고정 / 준고정 / 변동)
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[12px]" style={{ borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
                <thead>
                  <tr className="bg-[#F9FAFB] text-[11px] text-[#4B5563]">
                    <th className="border border-[#E5E7EB] px-2 py-1.5 text-left">사업부</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5">분류</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5">당해K</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5">전년K</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5">YoY</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5">구성비</th>
                    <th className="border border-[#E5E7EB] px-2 py-1.5 text-left min-w-[260px]">구조 분석 · 액션</th>
                  </tr>
                </thead>
                <tbody>
                  {natureByUnit.map((n, i) => (
                    <tr key={`${n.unit}-${n.nature}`}>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-left font-bold text-slate-900">
                        {i === 0 || natureByUnit[i - 1].unit !== n.unit ? n.unit : ''}
                      </td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-center">{n.nature}</td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-right whitespace-nowrap">{k(n.amount)}</td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-right text-slate-400 whitespace-nowrap">{k(n.amountPy)}</td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-right whitespace-nowrap">{pct(n.yoy)}</td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-right text-slate-500 whitespace-nowrap">{pct1(n.share)}</td>
                      <td className="border border-[#E5E7EB] px-2 py-1 text-left text-[11px] text-slate-600">{n.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── 상세 분석 A / B ── */}
        {(perCapitaRows.length > 0 || laborDetail.length > 0 || adDetail.length > 0) && (
          <Card>
            {perCapitaRows.length > 0 && (
              <>
                <SubTitle>A. 인건비 분석</SubTitle>
                <SubSubTitle>A-1. 인당 인건비 분석</SubSubTitle>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
                    <thead>
                      <tr>
                        <th className="text-[12px] font-semibold px-2.5 py-1.5 text-left" style={{ background: '#F8FAFC', color: '#475569', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0' }}>구분</th>
                        {[['전년 인당(K)', true], ['당년 인당(K)', false], ['전년비(K)', false]].map(([lab, sep]) => (
                          <th key={String(lab)} className="text-[12px] font-semibold px-2.5 py-1.5 whitespace-nowrap" style={{ background: G_MONTH, color: '#475569', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0', borderLeft: sep ? SEP : undefined }}>{lab}</th>
                        ))}
                        {[['YOY', true], ['분석', false]].map(([lab, sep]) => (
                          <th key={String(lab)} className="text-[12px] font-semibold px-2.5 py-1.5 whitespace-nowrap" style={{ background: G_YTD, color: '#475569', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0', borderLeft: sep ? SEP : undefined }}>{lab}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {perCapitaRows.map(r => (
                        <tr key={r.label}>
                          <td className="text-[13px] px-2.5 py-1.5" style={{ borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>
                            <strong className="font-semibold text-slate-900">{r.label}</strong>
                          </td>
                          <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', borderLeft: SEP }}>{r.py == null ? '-' : r.py.toFixed(1)}</td>
                          <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{r.cy == null ? '-' : r.cy.toFixed(1)}</td>
                          <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{r.diff == null ? '-' : `${r.diff >= 0 ? '+' : ''}${r.diff.toFixed(1)}`}</td>
                          <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_YTD, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', borderLeft: SEP }}>{pct(r.yoy)}</td>
                          <td className="text-[12px] px-2.5 py-1.5 text-left text-slate-600" style={{ background: G_YTD, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{r.note}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {laborDetail.length > 0 && (
              <>
                <SubSubTitle>A-2. 인건비 총액 분석</SubSubTitle>
                <DetailTable rows={laborDetail} />
              </>
            )}

            {adDetail.length > 0 && (
              <>
                <SubTitle>B. 광고비 분석 (사업부별)</SubTitle>
                <DetailTable rows={adDetail} />
              </>
            )}
          </Card>
        )}

        {/* ── 상세 분석 A / B / C ── */}
        <Card>
          <SubTitle>A. 전사 비용률 분석</SubTitle>
          <DetailTable rows={corpDetail} />

          <SubTitle>B. 비용 항목별 YTD 상세 분석</SubTitle>
          <DetailTable rows={categoryDetail} />

          <SubTitle>C. 사업부별 효율성 비교 요약</SubTitle>
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full" style={{ borderCollapse: 'separate', borderSpacing: 0, fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr>
                  <th className="text-[12px] font-semibold px-2.5 py-1.5 text-left" style={{ background: '#F8FAFC', color: '#475569', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0' }}>사업부</th>
                  {[['YTD매출K', G_MONTH, true], ['YTD매출YOY', G_MONTH, false], ['YTD비용K', G_MONTH, false],
                    ['YTD비용YOY', G_YTD, true], ['비용률', G_YTD, false], ['전년비용률', G_YTD, false],
                    ['인원(기말/평균)', G_PLAN, true], ['인당매출K', G_PLAN, false], ['판정', G_PLAN, false]].map(([lab, bg, sep]) => (
                    <th key={String(lab)} className="text-[12px] font-semibold px-2.5 py-1.5 whitespace-nowrap" style={{ background: bg as string, color: '#475569', borderTop: '1px solid #E2E8F0', borderBottom: '1px solid #E2E8F0', borderRight: '1px solid #E2E8F0', borderLeft: sep ? SEP : undefined }}>{lab}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {efficiency.map(e => (
                  <tr key={e.unit}>
                    <td className="text-[13px] px-2.5 py-1.5" style={{ borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>
                      <strong className="font-semibold text-slate-900">{e.unit}</strong>
                    </td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', borderLeft: SEP }}>{k(e.sales)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{pct(e.salesYoy)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_MONTH, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{k(e.expense)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_YTD, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', borderLeft: SEP }}>{pct(e.expenseYoy)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right font-bold" style={{ background: G_YTD, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{pct2(e.ratio)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right text-slate-400" style={{ background: G_YTD, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{pct2(e.ratioPy)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_PLAN, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6', borderLeft: SEP }}>{e.headcountEnd}명/{e.headcountAvg}명</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-right" style={{ background: G_PLAN, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>{k(e.salesPerHead)}</td>
                    <td className="text-[13px] px-2.5 py-1.5 text-left" style={{ background: G_PLAN, borderBottom: '1px solid #EEF2F6', borderRight: '1px solid #EEF2F6' }}>
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                        {e.verdict}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* ── Key Insight ── */}
        {insights.length > 0 && (
          <div className="flex items-start gap-4 bg-slate-900 text-slate-100 px-5 py-3 rounded-2xl shadow-sm">
            <span className="font-semibold text-[11.5px] tracking-[0.18em] uppercase whitespace-nowrap pt-0.5 shrink-0 text-indigo-300">
              Key Insight
            </span>
            <ul className="text-[13.5px] leading-[1.55] text-slate-100/95 space-y-1">
              {insights.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
