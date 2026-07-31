#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
비용 데이터 전처리 스크립트
월별 CSV 파일을 읽어서 마스터와 조인하고, 집계된 JSON 파일을 생성합니다.

실행 모드:
  - 기본(증분): 새로 추가된 월만 처리 후 기존 JSON과 병합
  - --full: 전체 기간 다시 처리 (로직/마스터 변경 시 사용)
"""

import argparse
import numpy as np
import pandas as pd
import json
import os
import glob
from datetime import datetime
from pathlib import Path

# 경로 설정
BASE_DIR = Path(__file__).parent.parent
COST_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/비용파일")
HEADCOUNT_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/사무실인원수")
HEADCOUNT_STORE_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/매장인원수")
ADJUSTMENT_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/조정분개")
MASTERS_DIR = BASE_DIR / "data" / "masters"
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "aggregated-costs.json"
HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "headcount.json"
STORE_HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "store-headcount.json"

# 분석 대상 사업부 (마스터 파일과 정확히 일치해야 함)
TARGET_BUSINESS_UNITS = ["경영지원", "MLB", "MLB KIDS", "Discovery", "Duvetica", "SUPRA"]

# 포함 기준은 계정과목맵핑.csv 의 `관리` / `재무` 컬럼 값이 '사용' 인지로 판단한다.
#   관리 X : 관리식에서 제외 (예: 대리상지원금 3개 계정)
#   재무 X : 재무식에서 제외 (예: 96030101/96030103/96030105 관리회계 조정계정)
# 두 기준의 포함 계정이 다르므로 관리식·재무식 총액은 서로 다르다.
USE_FLAG = "사용"
FINANCIAL_EXCLUDED = "__제외__"

# IFRS 조정분개를 귀속시킬 사업부 (조정분개 파일에 브랜드 구분이 없음)
ADJUSTMENT_BUSINESS_UNIT = "MLB"
# 조정분개 시트명
ADJUSTMENT_SHEET = "调整分录"


def load_master_files():
    """마스터 파일 로드"""
    print("[1/8] 마스터 파일 로드 중...")
    
    # 코스트센터 마스터
    cost_center_master = pd.read_csv(
        MASTERS_DIR / "코스트센터마스터.csv",
        encoding='utf-8-sig',
        dtype=str
    )
    # 컬럼명 정리
    cost_center_master.columns = cost_center_master.columns.str.strip()
    
    # 계정과목 마스터
    account_master = pd.read_csv(
        MASTERS_DIR / "계정과목마스터.csv",
        encoding='utf-8-sig',
        dtype=str
    )
    # 컬럼명 정리
    account_master.columns = account_master.columns.str.strip()

    print(f"  - 코스트센터 마스터: {len(cost_center_master)}건")
    print(f"  - 계정과목 마스터: {len(account_master)}건")

    # 계정과목 맵핑 (재무식) — sap code(=G/L 계정) → 연결계정과목
    account_mapping = load_account_mapping()

    return cost_center_master, account_master, account_mapping


def load_account_mapping():
    """재무식 맵핑 로드: sap code → 연결계정과목 (없으면 None)"""
    path = MASTERS_DIR / "계정과목맵핑.csv"
    if not path.exists():
        print(f"  [주의] 계정과목맵핑.csv 없음 — 재무식 집계 스킵 ({path})")
        return None

    df = pd.read_csv(path, encoding='utf-8-sig', dtype=str)
    df.columns = df.columns.str.strip()

    required = {'sap code', '연결계정과목'}
    if not required.issubset(df.columns):
        print(f"  [주의] 계정과목맵핑.csv 컬럼 부족: {list(df.columns)} — 재무식 집계 스킵")
        return None

    df['sap code'] = df['sap code'].fillna('').astype(str).str.strip()
    df['연결계정과목'] = df['연결계정과목'].fillna('').astype(str).str.strip()
    if 'pkg code' in df.columns:
        df['pkg code'] = df['pkg code'].fillna('').astype(str).str.strip()
    else:
        df['pkg code'] = ''

    # 관리 / 재무 사용 여부 (컬럼이 없으면 전부 사용으로 간주 — 구 파일 호환)
    for col in ('관리', '재무'):
        if col in df.columns:
            df[col] = df[col].fillna('').astype(str).str.strip()
        else:
            df[col] = USE_FLAG
            print(f"  [주의] 계정과목맵핑.csv 에 '{col}' 컬럼 없음 — 전체 포함으로 처리")

    mgmt_excluded = sorted(
        c for c in df.loc[df['관리'] != USE_FLAG, 'sap code'] if c
    )
    fin_excluded = sorted(
        c for c in df.loc[df['재무'] != USE_FLAG, 'sap code'] if c
    )
    if mgmt_excluded:
        print(f"  - 관리식 제외 계정 {len(mgmt_excluded)}건: {', '.join(mgmt_excluded)}")
    if fin_excluded:
        print(f"  - 재무식 제외 계정 {len(fin_excluded)}건: {', '.join(fin_excluded)}")

    # 재무 미사용 또는 연결계정과목 미기재 → 재무식 집계에서 제외
    df.loc[
        (df['재무'] != USE_FLAG) | (df['연결계정과목'] == ''), '연결계정과목'
    ] = FINANCIAL_EXCLUDED

    # 장부(G/L) 조인용: sap code → 연결계정과목 + 관리식 포함 여부
    by_sap = (
        df[df['sap code'] != '']
        .loc[:, ['sap code', '연결계정과목', '관리']]
        .drop_duplicates(subset=['sap code'])
        .rename(columns={'관리': '_관리플래그'})
    )
    # 조정분개 조인용: pkg code → 연결계정과목 (sap code 없는 행 포함)
    by_pkg = {
        r['pkg code']: r['연결계정과목']
        for _, r in df.iterrows()
        if r['pkg code'] and r['연결계정과목'] != FINANCIAL_EXCLUDED
    }

    n_link = by_sap.loc[by_sap['연결계정과목'] != FINANCIAL_EXCLUDED, '연결계정과목'].nunique()
    print(
        f"  - 계정과목 맵핑: sap {len(by_sap)}건 / pkg {len(by_pkg)}종, "
        f"연결계정과목 {n_link}종"
    )

    return {'by_sap': by_sap, 'by_pkg': by_pkg}


def load_existing_json():
    """기존 aggregated-costs.json 로드 (없으면 None)"""
    if not OUTPUT_FILE.exists():
        return None
    try:
        with open(OUTPUT_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return None


def _parse_csv_months(csv_files):
    """파일 목록에서 (파일경로, 연월) 리스트 추출.

    파일명은 `YY.MM`(26.02) 또는 `YYYY.MM`(2026.02) 모두 허용.
    확장자는 무관 (.csv / .xlsx 등).
    """
    result = []
    for file_path in sorted(csv_files):
        filename = os.path.basename(file_path)
        if '.' not in filename:
            continue
        try:
            parts = os.path.splitext(filename)[0].split('.')
            if len(parts) != 2:
                continue
            yy, mm = parts[0].strip(), parts[1].strip()
            if len(yy) == 4:
                year = yy               # 2026.02.csv
            elif len(yy) == 2:
                year = f"20{yy}"        # 26.02.csv
            else:
                print(f"  [건너뜀] 파일명 연도 형식 오류: {filename}")
                continue
            month_num = int(mm)
            if not 1 <= month_num <= 12:
                print(f"  [건너뜀] 파일명 월 범위 오류: {filename}")
                continue
            result.append((file_path, f"{year}-{month_num:02d}"))
        except Exception:
            print(f"  [건너뜀] 파일명 파싱 실패: {filename}")
    return result


def load_cost_files(existing_months=None):
    """비용 CSV 파일들을 동적으로 로드
    
    existing_months: 증분 모드일 때 이미 처리된 월 목록. None이면 전체 로드.
    """
    if existing_months is not None:
        print(f"\n[2/8] 비용 파일 로드 중 (증분)... (경로: {COST_FILES_DIR})")
    else:
        print(f"\n[2/8] 비용 파일 로드 중... (경로: {COST_FILES_DIR})")
    
    csv_files = glob.glob(str(COST_FILES_DIR / "*.csv"))
    
    if not csv_files:
        print(f"[경고] 비용 파일을 찾을 수 없습니다: {COST_FILES_DIR}")
        return pd.DataFrame(), []
    
    parsed = _parse_csv_months(csv_files)
    
    # 증분 모드: 새 월만 필터링
    if existing_months is not None:
        existing_set = set(existing_months)
        parsed = [(fp, ym) for fp, ym in parsed if ym not in existing_set]
        if not parsed:
            print("  [증분] 추가할 새 월이 없습니다.")
            return pd.DataFrame(), []
        print(f"  [증분] 새로 처리할 월: {sorted(set(ym for _, ym in parsed))}")
    
    all_data = []
    months = []
    
    for file_path, year_month in parsed:
        filename = os.path.basename(file_path)
        try:
            df = pd.read_csv(file_path, encoding='utf-8-sig', dtype=str)
            df.columns = df.columns.str.strip()
            df['연월'] = year_month
            all_data.append(df)
            months.append(year_month)
            print(f"  - {filename} -> {year_month} ({len(df)}건)")
        except Exception as e:
            print(f"  [실패] {filename} 로드 실패: {e}")
    
    if not all_data:
        print("[경고] 로드된 비용 데이터가 없습니다.")
        return pd.DataFrame(), []
    
    # 모든 데이터 결합
    combined_df = pd.concat(all_data, ignore_index=True)
    print(f"\n  총 {len(combined_df)}건의 비용 데이터 로드 완료")
    print(f"  기간: {min(months)} ~ {max(months)}")
    
    return combined_df, sorted(months)


def clean_and_filter_data(df):
    """데이터 정제 및 필터링"""
    print("\n[3/8] 데이터 정제 중...")
    
    initial_count = len(df)
    
    # 1. 전표 유형 = 'CO' 제거
    if '전표 유형' in df.columns:
        co_count = len(df[df['전표 유형'] == 'CO'])
        df = df[df['전표 유형'] != 'CO']
        print(f"  - 전표 유형='CO' 제거: {co_count}건")
    
    # 2. 금액 컬럼 숫자로 변환
    if '금액(전표 통화)' in df.columns:
        df['금액(전표 통화)'] = pd.to_numeric(
            df['금액(전표 통화)'].str.replace(',', ''), 
            errors='coerce'
        )
        # 금액이 0이거나 NaN인 행 제거
        df = df[df['금액(전표 통화)'].notna()]
        df = df[df['금액(전표 통화)'] != 0]
    
    print(f"  - 정제 완료: {initial_count}건 -> {len(df)}건")
    
    return df


def join_with_masters(df, cost_center_master, account_master, account_mapping=None):
    """마스터 파일과 조인"""
    print("\n[4/8] 마스터 조인 중...")
    
    # 1. 코스트센터 마스터 조인
    df = df.merge(
        cost_center_master[[
            '코스트 센터', '사업부', '부서명', '코스트센터명', 
            '영업/직접', '본사/매장'
        ]],
        left_on='코스트 센터',
        right_on='코스트 센터',
        how='left'
    )
    
    # 조인 실패 로그
    no_cost_center = df[df['사업부'].isna()]
    if len(no_cost_center) > 0:
        print(f"  [주의] 코스트센터 조인 실패: {len(no_cost_center)}건")
        unique_cc = no_cost_center['코스트 센터'].unique()
        print(f"     미매칭 코스트센터 전체: {', '.join(map(str, unique_cc))}")
    
    # 코스트센터 미매칭 + G/L 96030101 → 사업 영역 내역으로 fallback (직접비, 임차료)
    BUSINESS_AREA_MAPPING = {
        'MLB': 'MLB', 'MLB KIDS': 'MLB KIDS', 'Discovery': 'Discovery', 'DISCOVERY': 'Discovery',
        'Duvetica': 'Duvetica', 'DUVETICA': 'Duvetica', 'SUPRA': 'SUPRA', '경영지원': '경영지원',
    }
    FALLBACK_ACCOUNTS = ['96030101']
    BUSINESS_AREA_COL = '사업 영역 내역'
    
    no_cc = df['사업부'].isna()
    is_fallback = df['G/L 계정'].astype(str).str.strip().isin(FALLBACK_ACCOUNTS)
    need_fallback = no_cc & is_fallback
    
    if need_fallback.any() and BUSINESS_AREA_COL in df.columns:
        def _map_bu(val):
            v = str(val).strip() if pd.notna(val) else ''
            return BUSINESS_AREA_MAPPING.get(v) or BUSINESS_AREA_MAPPING.get(v.upper())
        mapped = df.loc[need_fallback, BUSINESS_AREA_COL].apply(_map_bu)
        df.loc[need_fallback, '사업부'] = mapped
        # 96030101 = 직접비
        filled = need_fallback & df['사업부'].notna()
        df.loc[filled, '영업/직접'] = '직접비'
        if filled.sum() > 0:
            print(f"  [Fallback] 96030101: 사업 영역 내역으로 {filled.sum()}건 사업부 보정 (직접비)")
    
    # 2. 계정과목 마스터 조인 (직접/영업: 집계 시 코스트센터보다 우선)
    acc_cols = ['G/L 계정', '대분류', '중분류', '설명']
    if '직접/영업' in account_master.columns:
        acc_cols.append('직접/영업')
    df = df.merge(
        account_master[acc_cols],
        left_on='G/L 계정',
        right_on='G/L 계정',
        how='left'
    )
    
    # 조인 실패 로그
    no_account = df[df['대분류'].isna()]
    if len(no_account) > 0:
        print(f"  [주의] 계정과목 조인 실패: {len(no_account)}건")
        unique_gl = no_account['G/L 계정'].unique()
        print(f"     미매칭 G/L 계정 전체: {', '.join(map(str, unique_gl))}")

    # 3. 계정과목 맵핑 조인 (재무식: 연결계정과목)
    if account_mapping is not None:
        df['_gl_key'] = df['G/L 계정'].astype(str).str.strip()
        df = df.merge(
            account_mapping['by_sap'],
            left_on='_gl_key',
            right_on='sap code',
            how='left'
        )
        df = df.drop(columns=['_gl_key', 'sap code'], errors='ignore')

        df['_관리포함'] = df['_관리플래그'].fillna(USE_FLAG).astype(str).str.strip() == USE_FLAG
        df = df.drop(columns=['_관리플래그'], errors='ignore')

        no_link = df[df['연결계정과목'].isna()]
        if len(no_link) > 0:
            unique_gl = no_link['G/L 계정'].astype(str).str.strip().unique()
            print(f"  [주의] 재무식 맵핑 실패: {len(no_link)}건 → 재무식에서 제외")
            print(f"     미매칭 G/L 계정: {', '.join(map(str, unique_gl))}")
        df['연결계정과목'] = df['연결계정과목'].fillna(FINANCIAL_EXCLUDED)

    print(f"  - 조인 완료")

    return df


def filter_target_business_units(df):
    """분석 대상 사업부만 필터링"""
    print(f"\n[5/8] 분석 대상 사업부 필터링: {', '.join(TARGET_BUSINESS_UNITS)}")
    
    initial_count = len(df)
    
    # 사업부 값이 있고, 대분류 값이 있는 데이터만
    df = df[df['사업부'].notna()]
    df = df[df['대분류'].notna()]
    df = df[df['사업부'].isin(TARGET_BUSINESS_UNITS)]
    
    # 영업/직접: '영업','직접'만 포함, 'X'(배분계정,조정계정) 무조건 제외
    if '영업/직접' in df.columns:
        valid_cost_type = ['영업', '직접', '직접비']  # 직접비=fallback(96030101)용
        before_x = len(df)
        df = df[df['영업/직접'].isin(valid_cost_type)]
        x_excluded = before_x - len(df)
        if x_excluded > 0:
            print(f"  - 영업/직접 'X' 제외: {x_excluded}건")
    
    print(f"  - 필터링 완료: {initial_count}건 -> {len(df)}건")
    
    # 사업부별 건수
    for bu in TARGET_BUSINESS_UNITS:
        bu_count = len(df[df['사업부'] == bu])
        print(f"     - {bu}: {bu_count:,}건")
    
    return df


def _assign_salary_sub_bucket(row):
    """G/L 계정 설명·텍스트 기준 급여 중분류 (우선순위: 퇴직 → 노무비 → 인건비+키워드)"""
    gl = str(row.get('G/L 계정 설명', '') or '').strip()
    text = str(row.get('텍스트', '') or '')
    if gl == '퇴직급여':
        return '퇴직급여'
    if gl == '노무비':
        return '외주/PT'
    if gl == '인건비':
        if '董事长' in text:
            return 'Red Pack'
        if '奖金' in text:
            return '성과급'
        if '工资' in text:
            return '기본급'
    return None


def aggregate_salary_subcategories(df):
    """대분류=급여만, aggregate_data와 동일한 직접/영업 부여 후 G/L·텍스트로 중분류. 잔액=미정."""
    if df.empty:
        return None
    if 'G/L 계정 설명' not in df.columns or '텍스트' not in df.columns:
        print("  [주의] 급여중분류: G/L 계정 설명 또는 텍스트 컬럼 없음 — 스킵")
        return None
    # --- aggregate_data()와 동일한 직접/영업 구분 (기존 로직 복제, 이후에만 중분류 적용) ---
    if '영업/직접' in df.columns:
        cc_col = '영업/직접'
    else:
        cc_col = '영업비/직접비'
    cc_norm = df[cc_col].replace({'영업': '영업비', '직접': '직접비'})
    df = df.copy()
    if '직접/영업' in df.columns:
        acc_stripped = df['직접/영업'].fillna('').astype(str).str.strip()
        is_ob = acc_stripped.isin(['영업', '영업비'])
        is_db = acc_stripped.isin(['직접', '직접비'])
        df['_집계비용구분'] = np.where(is_ob, '영업비', np.where(is_db, '직접비', cc_norm))
    else:
        df['_집계비용구분'] = cc_norm
    # --- 여기부터 급여 중분류(추가) ---
    salary = df[df['대분류'] == '급여'].copy()
    if salary.empty:
        return None
    salary['_sb'] = salary.apply(_assign_salary_sub_bucket, axis=1)
    known = salary[salary['_sb'].notna()]
    if known.empty:
        known_sums = pd.Series(dtype='float64')
    else:
        known_sums = known.groupby(['연월', '사업부', '_집계비용구분'])['금액(전표 통화)'].sum()
    total_by = salary.groupby(['연월', '사업부', '_집계비용구분'])['금액(전표 통화)'].sum()
    nested = {
        bu: {"직접비": {}, "영업비": {}}
        for bu in TARGET_BUSINESS_UNITS
    }
    if not known.empty:
        g = known.groupby(['연월', '사업부', '_집계비용구분', '_sb'])['금액(전표 통화)'].sum()
        for key, amt in g.items():
            ym, bu, ct_raw, label = key
            if bu not in nested:
                continue
            ct = '직접비' if ct_raw == '직접비' else '영업비'
            if label not in nested[bu][ct]:
                nested[bu][ct][label] = {}
            nested[bu][ct][label][ym] = int(amt)
    for key, tot in total_by.items():
        ym, bu, ct_raw = key
        if bu not in nested:
            continue
        ct = '직접비' if ct_raw == '직접비' else '영업비'
        t = int(tot)
        try:
            sk = int(known_sums[key]) if key in known_sums.index else 0
        except (TypeError, KeyError):
            sk = 0
        rem = t - sk
        if rem != 0:
            if '미정' not in nested[bu][ct]:
                nested[bu][ct]['미정'] = {}
            nested[bu][ct]['미정'][ym] = nested[bu][ct]['미정'].get(ym, 0) + rem
    return nested


WELFARE_INSURANCE_GLS = frozenset({
    '복리후생비_공적금',
    '복리후생비_사회보험',
    '복리후생비_직영점사회보험및공적금',
})
WELFARE_EXPAT_GL = '복리후생비_외국인직원복리'
WELFARE_GL_PREFIX = '복리후생비_'


def _assign_welfare_l2_bucket(gl_raw):
    gl = str(gl_raw or '').strip()
    if gl in WELFARE_INSURANCE_GLS:
        return '보험/공적금'
    if gl == WELFARE_EXPAT_GL:
        return '주재원'
    return '현지직원'


def _welfare_local_display_label(gl_raw):
    gl = str(gl_raw or '').strip()
    if gl.startswith(WELFARE_GL_PREFIX):
        rest = gl[len(WELFARE_GL_PREFIX):]
        return rest if rest else '기타'
    return gl if gl else '기타'


def aggregate_welfare_subcategories(df):
    """대분류=복리비만, aggregate_data와 동일 직접/영업 구분 후 G/L 기준 L2·L3(현지직원만 세부)."""
    if df.empty:
        return None
    if 'G/L 계정 설명' not in df.columns:
        print("  [주의] 복리중분류: G/L 계정 설명 컬럼 없음 — 스킵")
        return None
    if '영업/직접' in df.columns:
        cc_col = '영업/직접'
    else:
        cc_col = '영업비/직접비'
    cc_norm = df[cc_col].replace({'영업': '영업비', '직접': '직접비'})
    df = df.copy()
    if '직접/영업' in df.columns:
        acc_stripped = df['직접/영업'].fillna('').astype(str).str.strip()
        is_ob = acc_stripped.isin(['영업', '영업비'])
        is_db = acc_stripped.isin(['직접', '직접비'])
        df['_집계비용구분'] = np.where(is_ob, '영업비', np.where(is_db, '직접비', cc_norm))
    else:
        df['_집계비용구분'] = cc_norm

    welfare = df[df['대분류'] == '복리비'].copy()
    if welfare.empty:
        return None

    welfare['_wl2'] = welfare['G/L 계정 설명'].map(_assign_welfare_l2_bucket)
    welfare['_wl3'] = welfare.apply(
        lambda r: _welfare_local_display_label(r['G/L 계정 설명'])
        if r['_wl2'] == '현지직원' else None,
        axis=1,
    )

    nested = {
        bu: {
            "직접비": {"중분류": {}, "현지직원세부": {}},
            "영업비": {"중분류": {}, "현지직원세부": {}},
        }
        for bu in TARGET_BUSINESS_UNITS
    }

    g2 = welfare.groupby(['연월', '사업부', '_집계비용구분', '_wl2'])['금액(전표 통화)'].sum()
    for key, amt in g2.items():
        ym, bu, ct_raw, l2 = key
        if bu not in nested:
            continue
        ct = '직접비' if ct_raw == '직접비' else '영업비'
        if l2 not in nested[bu][ct]['중분류']:
            nested[bu][ct]['중분류'][l2] = {}
        nested[bu][ct]['중분류'][l2][ym] = int(amt)

    local_only = welfare[welfare['_wl2'] == '현지직원']
    if not local_only.empty:
        g3 = local_only.groupby(
            ['연월', '사업부', '_집계비용구분', '_wl3']
        )['금액(전표 통화)'].sum()
        for key, amt in g3.items():
            ym, bu, ct_raw, l3 = key
            if bu not in nested:
                continue
            ct = '직접비' if ct_raw == '직접비' else '영업비'
            if l3 not in nested[bu][ct]['현지직원세부']:
                nested[bu][ct]['현지직원세부'][l3] = {}
            nested[bu][ct]['현지직원세부'][l3][ym] = int(amt)

    out = {}
    for bu in TARGET_BUSINESS_UNITS:
        has_any = False
        for ct in ('직접비', '영업비'):
            if nested[bu][ct]['중분류'] or nested[bu][ct]['현지직원세부']:
                has_any = True
                break
        if has_any:
            out[bu] = nested[bu]
    return out if out else None


def aggregate_data(df):
    """데이터 집계"""
    print("\n[6/8] 데이터 집계 중...")
    
    # 코스트센터 기준 (기존): 영업/직접 → 영업비/직접비
    if '영업/직접' in df.columns:
        cc_col = '영업/직접'
    else:
        cc_col = '영업비/직접비'
    cc_norm = df[cc_col].replace({'영업': '영업비', '직접': '직접비'})
    
    # 계정 직접/영업: 코스트센터와 동일 표기(영업·직접). 구 마스터(영업비·직접비)도 호환.
    # 값이 있으면 코스트센터 무시, 비어 있으면 cc_norm
    df = df.copy()
    if '직접/영업' in df.columns:
        acc_stripped = df['직접/영업'].fillna('').astype(str).str.strip()
        is_ob = acc_stripped.isin(['영업', '영업비'])
        is_db = acc_stripped.isin(['직접', '직접비'])
        df['_집계비용구분'] = np.where(is_ob, '영업비', np.where(is_db, '직접비', cc_norm))
    else:
        df['_집계비용구분'] = cc_norm
    
    # 그룹별 집계
    grouped = df.groupby(['연월', '사업부', '_집계비용구분', '대분류']).agg({
        '금액(전표 통화)': 'sum'
    }).reset_index()
    
    grouped.columns = ['연월', '사업부', '비용구분', '대분류', '금액']
    
    print(f"  - 집계 완료: {len(grouped)}개 그룹")
    
    return grouped


def load_adjustment_entries(pkg_map):
    """
    IFRS 조정분개 로드 (재무식 전용).

    파일: D:/로컬파일/비용대시보드파일/조정분개/YY.MM.xlsx (분기말 기준), 시트 `调整分录`
      - C열 = pkg code, G열 = PL 차변, H열 = PL 대변  → 비용 = 차변 − 대변 (CNY)
      - pkg code 가 맵핑에 있는 계정만 사용 (= 영업이익 위 계정만 자동 선별)
      - 금액은 **분기 누적**이므로 직전 분기 파일과 차분해서 해당 분기말 월에 넣는다
        (26.03 → 3월, 26.06 = 26.06−26.03 → 6월)

    반환: {연월: {연결계정과목: 금액}}
    """
    if not pkg_map:
        return {}
    if not ADJUSTMENT_FILES_DIR.exists():
        print(f"  [주의] 조정분개 폴더 없음 — 스킵 ({ADJUSTMENT_FILES_DIR})")
        return {}

    files = _parse_csv_months(
        [str(p) for p in ADJUSTMENT_FILES_DIR.glob("*.xlsx") if not p.name.startswith("~$")]
    )
    if not files:
        print(f"  [주의] 조정분개 파일 없음 ({ADJUSTMENT_FILES_DIR})")
        return {}

    # 누적 금액: {연월: {연결계정과목: 누적금액}}
    cumulative = {}
    for file_path, year_month in sorted(files, key=lambda x: x[1]):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(file_path, data_only=True)
            ws = wb[ADJUSTMENT_SHEET] if ADJUSTMENT_SHEET in wb.sheetnames else wb.worksheets[0]
        except Exception as e:
            print(f"  [실패] 조정분개 로드 실패 {os.path.basename(file_path)}: {e}")
            continue

        totals = {}
        used = skipped = 0
        for row in range(1, ws.max_row + 1):
            code = ws.cell(row, 3).value          # C: pkg code
            debit = ws.cell(row, 7).value         # G: PL 차변
            credit = ws.cell(row, 8).value        # H: PL 대변
            debit = debit if isinstance(debit, (int, float)) else 0
            credit = credit if isinstance(credit, (int, float)) else 0
            if debit == 0 and credit == 0:
                continue
            if isinstance(code, (int, float)):
                code_str = str(int(code))
            else:
                code_str = str(code or '').strip()
            link = pkg_map.get(code_str)
            if not link:
                skipped += 1
                continue
            totals[link] = totals.get(link, 0) + (debit - credit)
            used += 1

        cumulative[year_month] = totals
        print(
            f"  - 조정분개 {os.path.basename(file_path)} → {year_month}: "
            f"{used}행 반영 / {skipped}행 제외(pkg code 미매핑), 합계 {sum(totals.values()):,.0f} 위안"
        )

    # 연도별로 누적 → 증분 변환
    monthly = {}
    by_year = {}
    for ym in cumulative:
        by_year.setdefault(ym.split('-')[0], []).append(ym)

    for year, months in by_year.items():
        prev = {}
        for ym in sorted(months):
            curr = cumulative[ym]
            delta = {}
            for k in set(curr) | set(prev):
                v = curr.get(k, 0) - prev.get(k, 0)
                if v:
                    delta[k] = v
            if delta:
                monthly[ym] = delta
            prev = curr

    return monthly


def apply_adjustments(financial_df, adjustments, allowed_months=None):
    """조정분개를 재무식 집계에 더한다 (전액 ADJUSTMENT_BUSINESS_UNIT 귀속).

    allowed_months: 증분 모드에서 이번에 처리한 월만 반영 (지정 시).
      지정하지 않으면(=--full) 전체 반영.
      증분 모드에서 이 제한이 없으면, 이번에 처리하지 않은 분기말 월의 재무식 값이
      '조정분개만' 있는 값으로 덮어써져 장부 금액이 사라진다.
    """
    if not adjustments:
        return financial_df

    rows = []
    for ym, by_link in adjustments.items():
        if allowed_months is not None and ym not in allowed_months:
            continue
        for link, amount in by_link.items():
            rows.append(
                {'연월': ym, '사업부': ADJUSTMENT_BUSINESS_UNIT, '연결계정과목': link, '금액': amount}
            )
    if not rows:
        return financial_df

    merged = pd.concat([financial_df, pd.DataFrame(rows)], ignore_index=True)
    merged = merged.groupby(['연월', '사업부', '연결계정과목'], as_index=False)['금액'].sum()
    print(f"  - 조정분개 반영: {len(rows)}건 → 사업부 '{ADJUSTMENT_BUSINESS_UNIT}'")
    return merged


def apply_adjustments_gl(financial_gl_df, adjustments, allowed_months=None):
    """조정분개를 재무식 드릴다운에도 '[IFRS 조정분개]' 라벨로 추가"""
    if not adjustments:
        return financial_gl_df

    rows = []
    for ym, by_link in adjustments.items():
        if allowed_months is not None and ym not in allowed_months:
            continue
        for link, amount in by_link.items():
            rows.append({
                '연월': ym,
                '사업부': ADJUSTMENT_BUSINESS_UNIT,
                '연결계정과목': link,
                'gl설명': '[IFRS 조정분개]',
                '금액': amount,
            })
    if not rows:
        return financial_gl_df
    merged = pd.concat([financial_gl_df, pd.DataFrame(rows)], ignore_index=True)
    return merged.groupby(
        ['연월', '사업부', '연결계정과목', 'gl설명'], as_index=False
    )['금액'].sum()


def aggregate_financial_data(df):
    """
    재무식 집계 — **직접비/영업비 구분 없이** 연결계정과목 기준.
    반환: 연월, 사업부, 연결계정과목, 금액
    """
    empty_cols = ['연월', '사업부', '연결계정과목', '금액']
    if df.empty or '연결계정과목' not in df.columns:
        if not df.empty:
            print("  [주의] 재무식: 연결계정과목 컬럼 없음 — 스킵")
        return pd.DataFrame(columns=empty_cols)

    d = df[df['연결계정과목'] != FINANCIAL_EXCLUDED]
    excluded = df[df['연결계정과목'] == FINANCIAL_EXCLUDED]['금액(전표 통화)'].sum()
    if excluded:
        print(f"  - 재무식 제외 금액(연결계정과목 미지정): {excluded:,.0f} 위안 — 관리식 총액과의 차이")

    grouped = d.groupby(['연월', '사업부', '연결계정과목']).agg({
        '금액(전표 통화)': 'sum'
    }).reset_index()
    grouped.columns = empty_cols

    print(f"  - 재무식(연결계정과목) 집계 완료: {len(grouped)}개 그룹")
    return grouped


def aggregate_financial_gl(df):
    """
    재무식 드릴다운 — 연결계정과목 × G/L 계정 설명별 월별 집계 (직접/영업 구분 없음).
    반환: 연월, 사업부, 연결계정과목, gl설명, 금액
    """
    empty_cols = ['연월', '사업부', '연결계정과목', 'gl설명', '금액']
    if df.empty or '연결계정과목' not in df.columns or 'G/L 계정 설명' not in df.columns:
        return pd.DataFrame(columns=empty_cols)

    d = df[df['연결계정과목'] != FINANCIAL_EXCLUDED].copy()
    d['_gl'] = d['G/L 계정 설명'].fillna('').astype(str).str.strip()
    d.loc[d['_gl'] == '', '_gl'] = '(미지정)'

    grouped = d.groupby(
        ['연월', '사업부', '연결계정과목', '_gl'], observed=False
    ).agg({'금액(전표 통화)': 'sum'}).reset_index()
    grouped.columns = empty_cols

    print(f"  - 재무식 G/L 집계 완료: {len(grouped)}개 그룹")
    return grouped


def aggregate_gl_by_category(df):
    """
    aggregate_data()와 동일한 직접/영업 구분으로 대분류·G/L 계정 설명별 월별 집계.
    반환: 연월, 사업부, 비용구분, 대분류, gl설명, 금액
    """
    if df.empty:
        return pd.DataFrame(
            columns=['연월', '사업부', '비용구분', '대분류', 'gl설명', '금액']
        )
    if 'G/L 계정 설명' not in df.columns:
        print("  [주의] 대분류별GL설명: G/L 계정 설명 컬럼 없음 — 스킵")
        return pd.DataFrame(
            columns=['연월', '사업부', '비용구분', '대분류', 'gl설명', '금액']
        )

    if '영업/직접' in df.columns:
        cc_col = '영업/직접'
    else:
        cc_col = '영업비/직접비'
    cc_norm = df[cc_col].replace({'영업': '영업비', '직접': '직접비'})

    d = df.copy()
    if '직접/영업' in d.columns:
        acc_stripped = d['직접/영업'].fillna('').astype(str).str.strip()
        is_ob = acc_stripped.isin(['영업', '영업비'])
        is_db = acc_stripped.isin(['직접', '직접비'])
        d['_집계비용구분'] = np.where(is_ob, '영업비', np.where(is_db, '직접비', cc_norm))
    else:
        d['_집계비용구분'] = cc_norm

    d['_gl'] = d['G/L 계정 설명'].fillna('').astype(str).str.strip()
    d.loc[d['_gl'] == '', '_gl'] = '(미지정)'

    grouped = d.groupby(
        ['연월', '사업부', '_집계비용구분', '대분류', '_gl'],
        observed=False,
    ).agg({'금액(전표 통화)': 'sum'}).reset_index()
    grouped.columns = ['연월', '사업부', '비용구분', '대분류', 'gl설명', '금액']

    print(f"  - G/L·대분류 집계 완료: {len(grouped)}개 그룹")
    return grouped


def convert_to_hierarchical_json(
    aggregated_df,
    months,
    salary_breakdown=None,
    welfare_breakdown=None,
    gl_aggregated_df=None,
    financial_df=None,
    financial_gl_df=None,
):
    """계층적 JSON 변환. salary_breakdown / welfare_breakdown: 중분류 집계 결과."""
    print("\n[7/8] JSON 변환 중...")
    
    result = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "months": months,
            "businessUnits": TARGET_BUSINESS_UNITS
        },
        "data": {}
    }
    
    # 사업부별로 데이터 구성
    for bu in TARGET_BUSINESS_UNITS:
        bu_data = aggregated_df[aggregated_df['사업부'] == bu]
        
        result["data"][bu] = {
            "직접비": {},
            "영업비": {}
        }
        
        # 비용구분별로 데이터 구성
        for cost_type in ['직접비', '영업비']:
            cost_data = bu_data[bu_data['비용구분'] == cost_type]
            
            # 대분류별로 데이터 구성
            categories = cost_data['대분류'].unique()
            for category in categories:
                cat_data = cost_data[cost_data['대분류'] == category]
                
                # 월별 금액 딕셔너리 생성
                monthly_amounts = {}
                for _, row in cat_data.iterrows():
                    month = row['연월']
                    amount = int(row['금액'])  # 위안 단위, 정수로 변환
                    monthly_amounts[month] = amount
                
                result["data"][bu][cost_type][category] = monthly_amounts
        
        if salary_breakdown and bu in salary_breakdown:
            result["data"][bu]["급여중분류"] = salary_breakdown[bu]
        if welfare_breakdown and bu in welfare_breakdown:
            result["data"][bu]["복리중분류"] = welfare_breakdown[bu]

        gl_bucket = {"직접비": {}, "영업비": {}}
        if gl_aggregated_df is not None and not gl_aggregated_df.empty:
            bu_gl = gl_aggregated_df[gl_aggregated_df['사업부'] == bu]
            for _, row in bu_gl.iterrows():
                ct = row['비용구분']
                if ct not in ('직접비', '영업비'):
                    continue
                category = row['대분류']
                gl_label = row['gl설명']
                month = row['연월']
                amount = int(row['금액'])
                if category not in gl_bucket[ct]:
                    gl_bucket[ct][category] = {}
                if gl_label not in gl_bucket[ct][category]:
                    gl_bucket[ct][category][gl_label] = {}
                gl_bucket[ct][category][gl_label][month] = amount
        result["data"][bu]["대분류별GL설명"] = gl_bucket

        # 재무식 (연결계정과목 기준, 직접/영업 구분 없음)
        if financial_df is not None and not financial_df.empty:
            fin_bucket = {}
            bu_fin = financial_df[financial_df['사업부'] == bu]
            for _, row in bu_fin.iterrows():
                category = row['연결계정과목']
                if category not in fin_bucket:
                    fin_bucket[category] = {}
                fin_bucket[category][row['연월']] = int(round(row['금액']))
            result["data"][bu]["재무식"] = fin_bucket

        if financial_gl_df is not None and not financial_gl_df.empty:
            fin_gl_bucket = {}
            bu_fin_gl = financial_gl_df[financial_gl_df['사업부'] == bu]
            for _, row in bu_fin_gl.iterrows():
                category = row['연결계정과목']
                gl_label = row['gl설명']
                if category not in fin_gl_bucket:
                    fin_gl_bucket[category] = {}
                if gl_label not in fin_gl_bucket[category]:
                    fin_gl_bucket[category][gl_label] = {}
                fin_gl_bucket[category][gl_label][row['연월']] = int(round(row['금액']))
            result["data"][bu]["재무식GL설명"] = fin_gl_bucket

    print(f"  - JSON 변환 완료")

    return result


def merge_json(existing, new_data):
    """기존 JSON에 새 데이터 병합 (월별 금액만 추가/덮어쓰기)"""
    for bu in TARGET_BUSINESS_UNITS:
        if bu not in existing.get("data", {}):
            existing["data"][bu] = {"직접비": {}, "영업비": {}}
        for cost_type in ["직접비", "영업비"]:
            if cost_type not in existing["data"][bu]:
                existing["data"][bu][cost_type] = {}
            for category, monthly_amounts in new_data.get("data", {}).get(bu, {}).get(cost_type, {}).items():
                if category not in existing["data"][bu][cost_type]:
                    existing["data"][bu][cost_type][category] = {}
                for month, amount in monthly_amounts.items():
                    existing["data"][bu][cost_type][category][month] = amount
        new_sub = new_data.get("data", {}).get(bu, {}).get("급여중분류")
        if new_sub:
            if "급여중분류" not in existing["data"][bu]:
                existing["data"][bu]["급여중분류"] = {"직접비": {}, "영업비": {}}
            for ct in ["직접비", "영업비"]:
                if ct not in existing["data"][bu]["급여중분류"]:
                    existing["data"][bu]["급여중분류"][ct] = {}
                for label, monthly_amounts in new_sub.get(ct, {}).items():
                    if label not in existing["data"][bu]["급여중분류"][ct]:
                        existing["data"][bu]["급여중분류"][ct][label] = {}
                    for month, amount in monthly_amounts.items():
                        existing["data"][bu]["급여중분류"][ct][label][month] = amount
        new_wel = new_data.get("data", {}).get(bu, {}).get("복리중분류")
        if new_wel:
            if "복리중분류" not in existing["data"][bu]:
                existing["data"][bu]["복리중분류"] = {
                    "직접비": {"중분류": {}, "현지직원세부": {}},
                    "영업비": {"중분류": {}, "현지직원세부": {}},
                }
            for ct in ["직접비", "영업비"]:
                ew = existing["data"][bu]["복리중분류"]
                if ct not in ew:
                    ew[ct] = {"중분류": {}, "현지직원세부": {}}
                nw = new_wel.get(ct, {})
                for bucket in ["중분류", "현지직원세부"]:
                    if bucket not in ew[ct]:
                        ew[ct][bucket] = {}
                    for label, monthly_amounts in nw.get(bucket, {}).items():
                        if label not in ew[ct][bucket]:
                            ew[ct][bucket][label] = {}
                        for month, amount in monthly_amounts.items():
                            ew[ct][bucket][label][month] = amount
        new_gl = new_data.get("data", {}).get(bu, {}).get("대분류별GL설명")
        if new_gl:
            if "대분류별GL설명" not in existing["data"][bu]:
                existing["data"][bu]["대분류별GL설명"] = {"직접비": {}, "영업비": {}}
            eg = existing["data"][bu]["대분류별GL설명"]
            for ct in ["직접비", "영업비"]:
                if ct not in eg:
                    eg[ct] = {}
                for category, gl_map in (new_gl.get(ct) or {}).items():
                    if category not in eg[ct]:
                        eg[ct][category] = {}
                    for gl_label, monthly_amounts in gl_map.items():
                        if gl_label not in eg[ct][category]:
                            eg[ct][category][gl_label] = {}
                        for month, amount in monthly_amounts.items():
                            eg[ct][category][gl_label][month] = amount
        # 재무식 (연결계정과목)
        new_fin = new_data.get("data", {}).get(bu, {}).get("재무식")
        if new_fin:
            if "재무식" not in existing["data"][bu]:
                existing["data"][bu]["재무식"] = {}
            ef = existing["data"][bu]["재무식"]
            for category, monthly_amounts in new_fin.items():
                if category not in ef:
                    ef[category] = {}
                for month, amount in monthly_amounts.items():
                    ef[category][month] = amount
        new_fin_gl = new_data.get("data", {}).get(bu, {}).get("재무식GL설명")
        if new_fin_gl:
            if "재무식GL설명" not in existing["data"][bu]:
                existing["data"][bu]["재무식GL설명"] = {}
            efg = existing["data"][bu]["재무식GL설명"]
            for category, gl_map in new_fin_gl.items():
                if category not in efg:
                    efg[category] = {}
                for gl_label, monthly_amounts in gl_map.items():
                    if gl_label not in efg[category]:
                        efg[category][gl_label] = {}
                    for month, amount in monthly_amounts.items():
                        efg[category][gl_label][month] = amount
    return existing


def save_json(data, output_path):
    """JSON 파일 저장"""
    print(f"\n[8/8] JSON 저장 중: {output_path}")
    
    # 출력 디렉토리 생성
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    
    # 파일 크기 확인
    file_size = output_path.stat().st_size
    print(f"  - 저장 완료: {file_size:,} bytes ({file_size / 1024:.1f} KB)")


def preprocess_headcount():
    """인원수 CSV 파일 전처리"""
    print("\n" + "=" * 60)
    print("F&F CHINA 인원수 데이터 전처리 시작")
    print("=" * 60)
    
    try:
        # 사업부 이름 매핑 (CSV의 사업부 -> 시스템의 사업부 ID)
        business_unit_mapping = {
            '경영지원': '경영지원',
            'MLB': 'MLB',
            'MLB KIDS': 'MLB KIDS',
            'DISCOVER': 'Discovery',
            'DISCOVERY': 'Discovery',
            'DUVETICA': 'Duvetica',
            'SUPRA': 'SUPRA',
        }
        
        print(f"\n[1/4] 인원수 파일 로드 중... (경로: {HEADCOUNT_FILES_DIR})")
        
        # 연도별 파일 찾기 (2024.csv, 2025.csv, 2026.csv 등)
        csv_files = glob.glob(str(HEADCOUNT_FILES_DIR / "*.csv"))
        
        if not csv_files:
            print(f"[경고] 인원수 파일을 찾을 수 없습니다: {HEADCOUNT_FILES_DIR}")
            return
        
        # 연도별로 파일 정렬
        year_files = {}
        for file_path in sorted(csv_files):
            filename = os.path.basename(file_path)
            # YYYY.csv 형식에서 연도 추출
            if filename.endswith('.csv'):
                try:
                    year = int(filename.replace('.csv', ''))
                    year_files[year] = file_path
                    print(f"  - {filename} (연도: {year})")
                except ValueError:
                    print(f"  [건너뜀] 파일명 형식이 올바르지 않습니다: {filename}")
        
        if not year_files:
            print("[경고] 로드된 인원수 파일이 없습니다.")
            return
        
        print(f"\n[2/4] CSV 파일 파싱 중...")
        
        headcount_data = {}
        years = sorted(year_files.keys())
        
        for year in years:
            file_path = year_files[year]
            try:
                # CSV 읽기 (UTF-8 BOM 처리)
                df = pd.read_csv(file_path, encoding='utf-8-sig', dtype=str)
                df.columns = df.columns.str.strip()
                
                # 사업부 컬럼 확인
                if '사업부' not in df.columns:
                    print(f"  [경고] {year}년 파일에 '사업부' 컬럼이 없습니다. 컬럼: {list(df.columns)}")
                    continue
                
                # 월 컬럼 찾기 (1월~12월)
                month_columns = {}
                for col in df.columns:
                    col_trimmed = col.strip()
                    # "1월", "2월" 형식 매칭
                    if col_trimmed.endswith('월'):
                        try:
                            month_num = int(col_trimmed.replace('월', ''))
                            if 1 <= month_num <= 12:
                                month_key = f"{year}-{month_num:02d}"
                                month_columns[month_key] = col
                        except ValueError:
                            pass
                
                if not month_columns:
                    print(f"  [경고] {year}년 파일에서 월 컬럼을 찾을 수 없습니다.")
                    continue
                
                print(f"  - {year}년: {len(month_columns)}개 월 컬럼 발견")
                
                # 데이터 행 처리
                for _, row in df.iterrows():
                    business_unit = str(row['사업부']).strip()
                    
                    if not business_unit or business_unit == 'nan':
                        continue
                    
                    # 사업부 매핑
                    mapped_bu = business_unit_mapping.get(business_unit)
                    if not mapped_bu:
                        # 대소문자 무시 매칭 시도
                        upper_bu = business_unit.upper()
                        mapped_bu = business_unit_mapping.get(upper_bu)
                        if not mapped_bu:
                            # 공백 정규화 후 매칭
                            normalized_bu = ' '.join(upper_bu.split())
                            mapped_bu = business_unit_mapping.get(normalized_bu)
                    
                    if not mapped_bu:
                        # 매핑되지 않은 사업부는 로그만 남기고 스킵
                        if len(headcount_data) == 0:  # 첫 데이터 행에서만 경고
                            print(f"  [주의] 매핑되지 않은 사업부: '{business_unit}'")
                        continue
                    
                    # 사업부별 데이터 초기화
                    if mapped_bu not in headcount_data:
                        headcount_data[mapped_bu] = {}
                    
                    # 월별 인원수 저장
                    for month_key, col_name in month_columns.items():
                        value = str(row[col_name]).strip()
                        
                        # 빈 값 처리
                        if value == '' or value == '-' or value == 'nan' or value.lower() == 'n/a':
                            continue
                        
                        try:
                            # 숫자 추출 (쉼표, 공백 제거)
                            clean_value = value.replace(',', '').replace(' ', '')
                            headcount = int(float(clean_value))  # float으로 먼저 변환 후 int (소수점 처리)
                            
                            if headcount >= 0:
                                # 사업부당 여러 행(부서별)이 있으면 합산
                                headcount_data[mapped_bu][month_key] = headcount_data[mapped_bu].get(month_key, 0) + headcount
                        except (ValueError, TypeError):
                            # 파싱 실패는 무시
                            pass
                
                print(f"  - {year}년 처리 완료")
                
            except Exception as e:
                print(f"  [실패] {year}년 파일 처리 실패: {e}")
                import traceback
                traceback.print_exc()
        
        if not headcount_data:
            print("[경고] 처리된 인원수 데이터가 없습니다.")
            return
        
        print(f"\n[3/4] JSON 변환 중...")
        
        # 최종 JSON 구조
        result = {
            "metadata": {
                "generatedAt": datetime.now().isoformat(),
                "years": years,
                "businessUnits": list(headcount_data.keys())
            },
            "data": headcount_data
        }
        
        # 사업부별 월 수 확인
        for bu in headcount_data.keys():
            month_count = len(headcount_data[bu])
            print(f"  - {bu}: {month_count}개 월 데이터")
        
        print(f"\n[4/4] JSON 저장 중: {HEADCOUNT_OUTPUT_FILE}")
        save_json(result, HEADCOUNT_OUTPUT_FILE)
        
        print("\n" + "=" * 60)
        print("인원수 데이터 전처리 완료!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n인원수 데이터 전처리 오류 발생: {e}")
        import traceback
        traceback.print_exc()


def preprocess_store_headcount():
    """매장 인원수 CSV 파일 전처리"""
    print("\n" + "=" * 60)
    print("F&F CHINA 매장 인원수 데이터 전처리 시작")
    print("=" * 60)
    
    try:
        # 사업부 이름 매핑 (CSV의 사업부/브랜드 -> 시스템의 사업부 ID)
        # 경영지원 제외 (매장이 아니므로)
        business_unit_mapping = {
            'MLB': 'MLB',
            'MLB KIDS': 'MLB KIDS',
            'DISCOVER': 'Discovery',
            'DISCOVERY': 'Discovery',
            'DUVETICA': 'Duvetica',
            'SUPRA': 'SUPRA',
        }
        
        print(f"\n[1/4] 매장 인원수 파일 로드 중... (경로: {HEADCOUNT_STORE_FILES_DIR})")
        
        # 연도별 파일 찾기 (2024.csv, 2025.csv, 2026.csv 등)
        csv_files = glob.glob(str(HEADCOUNT_STORE_FILES_DIR / "*.csv"))
        
        if not csv_files:
            print(f"[경고] 매장 인원수 파일을 찾을 수 없습니다: {HEADCOUNT_STORE_FILES_DIR}")
            return
        
        # 연도별로 파일 정렬
        year_files = {}
        for file_path in sorted(csv_files):
            filename = os.path.basename(file_path)
            # YYYY.csv 형식에서 연도 추출
            if filename.endswith('.csv'):
                try:
                    year = int(filename.replace('.csv', ''))
                    year_files[year] = file_path
                    print(f"  - {filename} (연도: {year})")
                except ValueError:
                    print(f"  [건너뜀] 파일명 형식이 올바르지 않습니다: {filename}")
        
        if not year_files:
            print("[경고] 로드된 매장 인원수 파일이 없습니다.")
            return
        
        print(f"\n[2/4] CSV 파일 파싱 중...")
        
        headcount_data = {}
        years = sorted(year_files.keys())
        
        for year in years:
            file_path = year_files[year]
            try:
                # CSV 읽기 (UTF-8 BOM 처리)
                df = pd.read_csv(file_path, encoding='utf-8-sig', dtype=str)
                df.columns = df.columns.str.strip()
                
                # 사업부/브랜드 컬럼 확인 (사업부 우선, 없으면 브랜드)
                bu_col = '사업부' if '사업부' in df.columns else ('브랜드' if '브랜드' in df.columns else None)
                if not bu_col:
                    print(f"  [경고] {year}년 파일에 '사업부' 또는 '브랜드' 컬럼이 없습니다. 컬럼: {list(df.columns)}")
                    continue
                
                # 월 컬럼 찾기 (1월~12월)
                month_columns = {}
                for col in df.columns:
                    col_trimmed = col.strip()
                    # "1월", "2월" 형식 매칭
                    if col_trimmed.endswith('월'):
                        try:
                            month_num = int(col_trimmed.replace('월', ''))
                            if 1 <= month_num <= 12:
                                month_key = f"{year}-{month_num:02d}"
                                month_columns[month_key] = col
                        except ValueError:
                            pass
                
                if not month_columns:
                    print(f"  [경고] {year}년 파일에서 월 컬럼을 찾을 수 없습니다.")
                    continue
                
                print(f"  - {year}년: {len(month_columns)}개 월 컬럼 발견 (사업부컬럼: {bu_col})")
                
                # 데이터 행 처리
                for _, row in df.iterrows():
                    business_unit = str(row[bu_col]).strip()
                    
                    if not business_unit or business_unit == 'nan':
                        continue
                    
                    # 사업부 매핑
                    mapped_bu = business_unit_mapping.get(business_unit)
                    if not mapped_bu:
                        # 대소문자 무시 매칭 시도
                        upper_bu = business_unit.upper()
                        mapped_bu = business_unit_mapping.get(upper_bu)
                        if not mapped_bu:
                            # 공백 정규화 후 매칭
                            normalized_bu = ' '.join(upper_bu.split())
                            mapped_bu = business_unit_mapping.get(normalized_bu)
                    
                    if not mapped_bu:
                        # 매핑되지 않은 사업부는 로그만 남기고 스킵 (경영지원 등)
                        if len(headcount_data) == 0:  # 첫 데이터 행에서만 경고
                            print(f"  [주의] 매핑되지 않은 사업부 (경영지원 제외): '{business_unit}'")
                        continue
                    
                    # 사업부별 데이터 초기화
                    if mapped_bu not in headcount_data:
                        headcount_data[mapped_bu] = {}
                    
                    # 월별 인원수 저장 (사업부당 여러 행이 있으면 합산)
                    for month_key, col_name in month_columns.items():
                        value = str(row[col_name]).strip()
                        
                        # 빈 값 처리
                        if value == '' or value == '-' or value == 'nan' or value.lower() == 'n/a':
                            continue
                        
                        try:
                            # 숫자 추출 (쉼표, 공백 제거)
                            clean_value = value.replace(',', '').replace(' ', '')
                            headcount = int(float(clean_value))  # float으로 먼저 변환 후 int (소수점 처리)
                            
                            if headcount >= 0:
                                # 사업부당 여러 행(부서별)이 있으면 합산
                                headcount_data[mapped_bu][month_key] = headcount_data[mapped_bu].get(month_key, 0) + headcount
                        except (ValueError, TypeError):
                            # 파싱 실패는 무시
                            pass
                
                print(f"  - {year}년 처리 완료")
                
            except Exception as e:
                print(f"  [실패] {year}년 파일 처리 실패: {e}")
                import traceback
                traceback.print_exc()
        
        if not headcount_data:
            print("[경고] 처리된 매장 인원수 데이터가 없습니다.")
            return
        
        print(f"\n[3/4] JSON 변환 중...")
        
        # 최종 JSON 구조
        result = {
            "metadata": {
                "generatedAt": datetime.now().isoformat(),
                "years": years,
                "businessUnits": list(headcount_data.keys())
            },
            "data": headcount_data
        }
        
        # 사업부별 월 수 확인
        for bu in headcount_data.keys():
            month_count = len(headcount_data[bu])
            print(f"  - {bu}: {month_count}개 월 데이터")
        
        print(f"\n[4/4] JSON 저장 중: {STORE_HEADCOUNT_OUTPUT_FILE}")
        save_json(result, STORE_HEADCOUNT_OUTPUT_FILE)
        
        print("\n" + "=" * 60)
        print("매장 인원수 데이터 전처리 완료!")
        print("=" * 60)
        
    except Exception as e:
        print(f"\n매장 인원수 데이터 전처리 오류 발생: {e}")
        import traceback
        traceback.print_exc()


def main():
    """메인 실행 함수"""
    parser = argparse.ArgumentParser(description='비용 데이터 전처리')
    parser.add_argument('--full', action='store_true', help='전체 기간 다시 처리 (로직/마스터 변경 시)')
    args = parser.parse_args()
    is_full = args.full
    
    print("=" * 60)
    if is_full:
        print("F&F CHINA 비용 데이터 전처리 [전체 기간]")
    else:
        print("F&F CHINA 비용 데이터 전처리 [증분]")
    print("=" * 60)
    
    try:
        # 1. 마스터 파일 로드
        cost_center_master, account_master, account_mapping = load_master_files()
        
        existing_months = None
        existing_json = None
        if not is_full:
            existing_json = load_existing_json()
            if existing_json and "metadata" in existing_json and "months" in existing_json["metadata"]:
                existing_months = existing_json["metadata"]["months"]
                print(f"\n  [증분] 기존 데이터 월 수: {len(existing_months)}개")
        
        # 2. 비용 파일 로드 (증분 시 새 월만)
        cost_df, months = load_cost_files(existing_months)
        
        if not cost_df.empty:
            # 3. 데이터 정제
            cost_df = clean_and_filter_data(cost_df)
            
            # 4. 마스터 조인
            cost_df = join_with_masters(
                cost_df, cost_center_master, account_master, account_mapping
            )

            # 5. 분석 대상 필터링
            cost_df = filter_target_business_units(cost_df)

            # 6. 집계
            # 관리식은 맵핑의 `관리`='사용' 계정만 (예: 대리상지원금 제외)
            if '_관리포함' in cost_df.columns:
                mgmt_df = cost_df[cost_df['_관리포함']]
                dropped = len(cost_df) - len(mgmt_df)
                if dropped:
                    amt = cost_df.loc[~cost_df['_관리포함'], '금액(전표 통화)'].sum()
                    print(f"  - 관리식 제외: {dropped:,}건 / {amt:,.0f} 위안")
            else:
                mgmt_df = cost_df

            aggregated_df = aggregate_data(mgmt_df)
            gl_aggregated_df = aggregate_gl_by_category(mgmt_df)
            salary_breakdown = aggregate_salary_subcategories(mgmt_df)
            welfare_breakdown = aggregate_welfare_subcategories(mgmt_df)
            financial_df = aggregate_financial_data(cost_df)
            financial_gl_df = aggregate_financial_gl(cost_df)

            # IFRS 조정분개 (재무식 전용) — 분기 누적 파일을 증분으로 변환해 반영
            adjustments = load_adjustment_entries(
                account_mapping['by_pkg'] if account_mapping else None
            )
            # 증분 모드는 이번에 처리한 월만 (전체 반영은 --full 에서)
            allowed = None if is_full else set(months)
            if not is_full and adjustments:
                skipped = sorted(set(adjustments) - set(months))
                if skipped:
                    print(f"  [증분] 조정분개 미반영 월: {skipped} — 변경 시 --full 실행 필요")
            financial_df = apply_adjustments(financial_df, adjustments, allowed)
            financial_gl_df = apply_adjustments_gl(financial_gl_df, adjustments, allowed)

            # 7. JSON 변환
            new_json = convert_to_hierarchical_json(
                aggregated_df,
                months,
                salary_breakdown,
                welfare_breakdown,
                gl_aggregated_df,
                financial_df,
                financial_gl_df,
            )
            
            # 8. 병합 후 저장 (증분 모드면 기존 + 새 데이터)
            if not is_full and existing_json:
                merged_months = sorted(set((existing_json.get("metadata", {}).get("months", []) or []) + months))
                merged_json = merge_json(existing_json.copy(), new_json)
                merged_json["metadata"]["months"] = merged_months
                merged_json["metadata"]["generatedAt"] = datetime.now().isoformat()
                save_json(merged_json, OUTPUT_FILE)
            else:
                save_json(new_json, OUTPUT_FILE)
            
            print("\n" + "=" * 60)
            print("비용 데이터 전처리 완료!")
            print("=" * 60)
        else:
            if not is_full and existing_json:
                print("\n[증분] 추가할 새 월이 없습니다. 기존 데이터 유지.")
            else:
                print("\n[경고] 비용 파일이 없습니다. 비용 데이터 전처리를 건너뜁니다.")
        
        # 인원수 데이터 전처리 (비용 데이터와 독립적으로 실행)
        preprocess_headcount()  # 사무실 인원수
        preprocess_store_headcount()  # 매장 인원수
        
        print(f"\n다음 단계:")
        print(f"   1. git add {OUTPUT_FILE.relative_to(BASE_DIR)} {HEADCOUNT_OUTPUT_FILE.relative_to(BASE_DIR)} {STORE_HEADCOUNT_OUTPUT_FILE.relative_to(BASE_DIR)}")
        print(f"   2. git commit -m 'Update: 비용 및 인원수 데이터 업데이트'")
        print(f"   3. git push origin main")
        print(f"   4. Vercel 자동 배포 확인")
        
    except Exception as e:
        print(f"\n오류 발생: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    main()
