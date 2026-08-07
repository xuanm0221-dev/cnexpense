'use client';

/**
 * F&F 중국 법인 비용 구조 및 운영 효율성 분석 보고서
 *
 * 디자인은 cn-report 의 CostStructureReportModal 을 그대로 옮겼다 —
 * navy 헤더 + 번호 섹션 + 좌측 컬러 바 서브섹션 + KPI 카드 + 단계별 제안 + 결론 블록.
 *
 * 다만 원본에는 "물류·창고비 −10.1%", "출고 TO C +89%", "AI 식별시스템·OMS 재투입" 같은
 * **문장이 코드에 박혀** 있었다. 그건 cn-report 데이터 기준이라 비용(SAP) 화면에 그대로 쓰면
 * 사실과 달라진다. 그래서 서술은 전부 `/api/cost-report` 가 계산해 준 것만 그린다.
 */

import { useEffect, useState } from 'react';
import type { CostType } from '@/lib/types';

interface Lv1Row {
  cost_lv1: string;
  amount: number;
  amountPy: number;
  yoy: number | null;
  note: string;
}

interface AdBrandRow {
  brand: string;
  amount: number;
  amountPy: number;
  yoy: number | null;
}

interface DriverItem {
  item: string;
  kind: string;
  amount: number;
  amountPy: number;
  isNew: boolean;
}

interface CategoryDrivers {
  category: string;
  top: DriverItem[];
  ended: { item: string; amountPy: number }[];
}

interface CostReport {
  year: number;
  month: number;
  costType: CostType;
  kpi: {
    sales: number;
    salesPy: number;
    salesYoy: number | null;
    expense: number;
    expensePy: number;
    expenseYoy: number | null;
    ratioCy: number | null;
    ratioPy: number | null;
    headcount: number;
  };
  lv1: Lv1Row[];
  adByBrand: AdBrandRow[];
  labor: {
    perCapita: number | null;
    perCapitaPy: number | null;
    yoy: number | null;
    category: string;
  };
  adEff: {
    roi: number;
    roas: number;
    correlation: number;
    grade: string;
    optimalRange: string;
    optimalRoas: number;
    months: number;
  } | null;
  commentary: {
    overview: string;
    costNote: string;
    adEff: string;
    categories: string[];
    labor: string;
    conclusion: string;
  };
  /** 적요에서 뽑은 '무엇에 썼나' — 광고비·지급수수료만 */
  drivers?: CategoryDrivers[];
  salesError: string | null;
  error?: string;
}

const fK = (v?: number | null) => (v == null ? '-' : `${Math.round(v / 1000).toLocaleString()}K`);
const fM = (v?: number | null) =>
  v == null ? '-' : `${Math.round(v / 1_000_000).toLocaleString()}M`;
const fP = (v?: number | null) => (v == null ? '-' : `${Math.round(v)}%`);
const fP1 = (v?: number | null) => (v == null ? '-' : `${v.toFixed(1)}%`);
const fPp = (cy?: number | null, py?: number | null) =>
  cy == null || py == null ? '-' : `${cy - py >= 0 ? '+' : ''}${(cy - py).toFixed(1)}%p`;

/** 서브섹션 색 — 순서대로 돌려쓴다 (대분류 개수가 데이터마다 다르므로) */
const SUB_TONES = ['blue', 'amber', 'slate', 'emerald'] as const;
const SUB_ICONS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];

function Section({
  idx,
  title,
  children,
}: {
  idx: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b-2 border-navy/30">
        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-navy text-white text-[11px] font-extrabold">
          {idx}
        </span>
        <h3 className="text-[14px] font-extrabold text-navy">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function SubSection({
  icon,
  title,
  subtitle,
  tone,
  children,
}: {
  icon: string;
  title: string;
  subtitle: string;
  tone: (typeof SUB_TONES)[number];
  children: React.ReactNode;
}) {
  const toneCls = {
    blue: 'border-blue-400 bg-blue-50/40',
    amber: 'border-amber-400 bg-amber-50/40',
    slate: 'border-slate-400 bg-slate-50/40',
    emerald: 'border-emerald-400 bg-emerald-50/40',
  }[tone];
  const titleTone = {
    blue: 'text-blue-900',
    amber: 'text-amber-900',
    slate: 'text-slate-900',
    emerald: 'text-emerald-900',
  }[tone];
  return (
    <div className={`border-l-4 ${toneCls} pl-3 pr-2 py-2.5 mb-3 rounded-r`}>
      <div className="flex items-baseline gap-1.5 mb-1.5">
        <span className="text-[14px] font-extrabold">{icon}</span>
        <span className={`text-[12.5px] font-extrabold ${titleTone}`}>{title}</span>
      </div>
      <div className="text-[11px] text-gray-600 mb-2 italic">— {subtitle}</div>
      {children}
    </div>
  );
}

function Phase({
  label,
  tone,
  children,
}: {
  label: string;
  tone: 'blue' | 'emerald';
  children: React.ReactNode;
}) {
  const toneCls =
    tone === 'blue'
      ? 'bg-blue-100 text-blue-900 border-blue-300'
      : 'bg-emerald-100 text-emerald-900 border-emerald-300';
  return (
    <div className="mb-3">
      <div
        className={`inline-block text-[10.5px] font-extrabold px-2.5 py-1 rounded mb-2 border ${toneCls}`}
      >
        [{label}]
      </div>
      <div className="space-y-1 pl-2">{children}</div>
    </div>
  );
}

function Bullet({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex gap-2 text-[12px] ${className || ''}`}>
      <span className="text-navy mt-0.5">•</span>
      <span className="flex-1">{children}</span>
    </div>
  );
}

function Kpi({
  label,
  value,
  yoy,
  sub,
  tone,
}: {
  label: string;
  value: string;
  yoy: string;
  sub: string;
  tone: 'up' | 'warn' | 'alert';
}) {
  const styles = {
    up: {
      card: 'border-emerald-300 bg-gradient-to-br from-emerald-50 to-emerald-100/60',
      label: 'text-emerald-700',
      value: 'text-emerald-900',
      yoy: 'text-white bg-emerald-600',
      sub: 'text-emerald-700/80',
      accent: '📈',
    },
    warn: {
      card: 'border-amber-300 bg-gradient-to-br from-amber-50 to-amber-100/60',
      label: 'text-amber-700',
      value: 'text-amber-900',
      yoy: 'text-white bg-amber-600',
      sub: 'text-amber-700/80',
      accent: '⚠️',
    },
    alert: {
      card: 'border-rose-300 bg-gradient-to-br from-rose-50 to-rose-100/60',
      label: 'text-rose-700',
      value: 'text-rose-900',
      yoy: 'text-white bg-rose-600',
      sub: 'text-rose-700/80',
      accent: '🔥',
    },
  }[tone];
  return (
    <div className={`border-2 ${styles.card} rounded-lg p-3 shadow-sm relative overflow-hidden`}>
      <div className="absolute top-2 right-2 text-[16px] opacity-60">{styles.accent}</div>
      <div className={`text-[10px] font-bold uppercase tracking-wider ${styles.label}`}>{label}</div>
      <div className="flex items-baseline gap-2 mt-1.5">
        <div className={`text-[20px] font-extrabold ${styles.value}`}>{value}</div>
        <div className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded shadow-sm ${styles.yoy}`}>
          {yoy}
        </div>
      </div>
      <div className={`text-[10px] mt-1 font-medium ${styles.sub}`}>{sub}</div>
    </div>
  );
}

export interface CostStructureReportProps {
  year: number;
  month: number;
  costType: CostType;
}

export default function CostStructureReport({ year, month, costType }: CostStructureReportProps) {
  const [d, setD] = useState<CostReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetch(`/api/cost-report?year=${year}&month=${month}&costType=${encodeURIComponent(costType)}`)
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
  }, [year, month, costType]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center min-h-[12rem] text-sm text-slate-400">
        보고서를 산출하는 중입니다…
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

  const top = d.lv1.slice(0, d.commentary.categories.length);

  return (
    <div className="flex-1 overflow-y-auto bg-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gradient-to-r from-navy to-blue-900 text-white px-5 py-3 border-b-2 border-amber-400">
        <div className="text-[10px] font-semibold tracking-widest text-amber-300 uppercase">
          심층 보고서
        </div>
        <h2 className="text-base font-extrabold mt-0.5">
          F&amp;F 중국 법인 비용 구조 및 운영 효율성 분석
        </h2>
        <div className="text-[11px] text-blue-100 mt-0.5">
          {d.year}년 {d.month}월 기준 · YTD 누적 · {d.costType}
        </div>
      </div>

      {/* Body */}
      <div className="p-5 text-[12px] text-gray-800 leading-relaxed">
        {d.salesError && (
          <p className="mb-4 text-[11px] text-amber-800 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
            매출 조회에 실패해 매출 관련 지표(비용률·광고 효율)는 비어 있습니다. — {d.salesError}
          </p>
        )}

        <Section idx="1" title="전사 경영 지표 및 수익성 현황 (KPI Review)">
          <p className="text-gray-700 mb-3">
            {d.year}년 {d.month}월 누적(YTD) 기준. {d.commentary.overview}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mb-3">
            <Kpi
              label="판매매출"
              value={fM(d.kpi.sales)}
              yoy={fP(d.kpi.salesYoy)}
              sub={`전년 동기 ${fM(d.kpi.salesPy)}`}
              tone="up"
            />
            <Kpi
              label={`총비용 집행 (${d.costType})`}
              value={fK(d.kpi.expense)}
              yoy={fP(d.kpi.expenseYoy)}
              sub={`전년 동기 ${fK(d.kpi.expensePy)}`}
              tone="warn"
            />
            <Kpi
              label="매출 대비 비용률"
              value={fP1(d.kpi.ratioCy)}
              yoy={fPp(d.kpi.ratioCy, d.kpi.ratioPy)}
              sub={`전년 ${fP1(d.kpi.ratioPy)}`}
              tone="alert"
            />
          </div>
          <p className="text-[11px] text-gray-600 bg-amber-50 border-l-4 border-amber-400 px-3 py-2 rounded">
            ※ {d.commentary.costNote}
          </p>
        </Section>

        {/*
          항목이 여러 개인데 각 카드 내용은 두세 줄이라, 세로로만 쌓으면 오른쪽이 통째로 빈다.
          넓은 화면에서는 2열로 흘려 채운다. `break-inside-avoid` 로 카드가 열 사이에서
          잘리지 않게 한다.
        */}
        <Section idx="2" title="주요 항목별 심층 분석 및 효율 진단">
          <div className="columns-1 xl:columns-2 gap-3 [column-fill:balance]">
            {top.map((row, i) => (
              <div key={row.cost_lv1} className="break-inside-avoid">
                <SubSection
                  icon={SUB_ICONS[i] ?? '•'}
                  title={`${row.cost_lv1} (${fK(row.amount)}, YoY ${fP(row.yoy)})`}
                  subtitle={`전년 동기 ${fK(row.amountPy)}`}
                  tone={SUB_TONES[i % SUB_TONES.length]}
                >
                  <div className="space-y-1.5">
                    <Bullet>{d.commentary.categories[i]}</Bullet>
                    {row.cost_lv1 === '광고비' && d.adByBrand.length > 0 && (
                      <Bullet>
                        <b>브랜드별</b>:{' '}
                        {d.adByBrand
                          .filter(b => b.amount !== 0 || b.amountPy !== 0)
                          .map(b => (
                            <span key={b.brand}>
                              <b>{b.brand}</b>({fK(b.amount)}, {fP(b.yoy)}){' '}
                            </span>
                          ))}
                      </Bullet>
                    )}
                    {row.cost_lv1 === '광고비' && (
                      <Bullet>
                        <b>효율 진단</b>: {d.commentary.adEff}
                      </Bullet>
                    )}
                    {/*
                      적요에서 뽑은 실제 집행 건 — 증감률만으로는 '무엇에 썼는지'가 안 보인다.
                      전처리가 광고비·지급수수료만 만들어 주므로 나머지 대분류에는 안 붙는다.
                    */}
                    {(() => {
                      const dr = d.drivers?.find(x => x.category === row.cost_lv1);
                      if (!dr || dr.top.length === 0) return null;
                      return (
                        <>
                          <Bullet>
                            <b>주요 집행</b>:{' '}
                            {dr.top.map((t, di) => (
                              <span key={t.item}>
                                {di > 0 && ' · '}
                                {t.item} <b>{fK(t.amount)}</b>
                                {t.isNew ? (
                                  <span className="text-blue-700"> (신규)</span>
                                ) : (
                                  <span className="text-gray-500"> (전년 {fK(t.amountPy)})</span>
                                )}
                              </span>
                            ))}
                          </Bullet>
                          {dr.ended.length > 0 && (
                            <Bullet className="text-gray-600">
                              <b>전년 대비 종료</b>:{' '}
                              {dr.ended.map(e => `${e.item} ${fK(e.amountPy)}`).join(' · ')}
                            </Bullet>
                          )}
                        </>
                      );
                    })()}
                  </div>
                </SubSection>
              </div>
            ))}
          </div>
        </Section>

        {/* 단기·중기 제안도 나란히 — 각 2~3줄이라 세로로 쌓으면 여백만 늘어난다 */}
        <Section idx="3" title="향후 전략적 관리 방안 제안">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4">
          <Phase label="단기: 효율 최적화" tone="blue">
            {d.adEff ? (
              <Bullet>
                <b>광고 타겟팅 정교화</b>: 효율 등급 상향 위해 최적 집행 구간(
                <b>{d.adEff.optimalRange}</b>, ROAS <b>{d.adEff.optimalRoas.toFixed(2)}</b>) 참고해
                예산 재배분. 현재 광고비↔매출 상관 <b>{d.adEff.correlation.toFixed(2)}</b> (
                {d.adEff.months}개월).
              </Bullet>
            ) : (
              <Bullet>광고비 또는 매출 데이터가 없어 광고 효율 제안을 생성하지 못했습니다.</Bullet>
            )}
            {d.lv1
              .filter(r => r.yoy != null && r.yoy >= 140)
              .slice(0, 2)
              .map(r => (
                <Bullet key={r.cost_lv1}>
                  <b>{r.cost_lv1} 급증 점검</b>: {fK(r.amount)} (전년비 {fP(r.yoy)}) — 일시적 요인
                  여부와 지속성 확인.
                </Bullet>
              ))}
          </Phase>
          <Phase label="중기: 수익성 회복" tone="emerald">
            <Bullet>
              <b>인당 생산성 유지</b>: {d.commentary.labor}
            </Bullet>
            {d.kpi.ratioCy != null && d.kpi.ratioPy != null && (
              <Bullet>
                <b>비용률 마일스톤</b>: 현재 {fP1(d.kpi.ratioCy)} (전년 {fP1(d.kpi.ratioPy)},{' '}
                {fPp(d.kpi.ratioCy, d.kpi.ratioPy)}) — 회복 목표 설정 기준선.
              </Bullet>
            )}
          </Phase>
          </div>
        </Section>

        <div className="mt-6 bg-gradient-to-br from-navy to-blue-800 text-white p-5 rounded-lg">
          <div className="text-[10px] tracking-widest font-semibold text-amber-300 uppercase mb-1">
            결론
          </div>
          <p className="text-[12.5px] leading-relaxed">{d.commentary.conclusion}</p>
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-slate-50 border-t border-slate-200 px-5 py-2.5 text-[10px] text-gray-500 flex justify-between">
        <span>
          기준: {d.year}년 {d.month}월 YTD 누적 · 비용 SAP G/L · 매출 Snowflake (자동 산출)
        </span>
        <span>F&amp;F China Operations Analytics</span>
      </div>
    </div>
  );
}
