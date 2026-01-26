#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
비용 데이터 전처리 스크립트
월별 CSV 파일을 읽어서 마스터와 조인하고, 집계된 JSON 파일을 생성합니다.
"""

import pandas as pd
import json
import os
import glob
from datetime import datetime
from pathlib import Path

# 경로 설정
BASE_DIR = Path(__file__).parent.parent
COST_FILES_DIR = BASE_DIR.parent / "비용파일"  # 상위 폴더의 비용파일 참조
HEADCOUNT_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/사무실인원수")
HEADCOUNT_STORE_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/매장인원수")
MASTERS_DIR = BASE_DIR / "data" / "masters"
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "aggregated-costs.json"
HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "headcount.json"
STORE_HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "store-headcount.json"

# 분석 대상 사업부 (마스터 파일과 정확히 일치해야 함)
TARGET_BUSINESS_UNITS = ["경영지원", "MLB", "MLB KIDS", "Discovery", "Duvetica", "SUPRA"]


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
    
    return cost_center_master, account_master


def load_cost_files():
    """비용 CSV 파일들을 동적으로 로드"""
    print(f"\n[2/8] 비용 파일 로드 중... (경로: {COST_FILES_DIR})")
    
    # YY.MM.csv 패턴의 파일 찾기
    csv_files = glob.glob(str(COST_FILES_DIR / "*.csv"))
    
    if not csv_files:
        print(f"[경고] 비용 파일을 찾을 수 없습니다: {COST_FILES_DIR}")
        return pd.DataFrame(), []
    
    all_data = []
    months = []
    
    for file_path in sorted(csv_files):
        filename = os.path.basename(file_path)
        # YY.MM.csv 형식에서 연월 추출
        if '.' in filename:
            try:
                parts = filename.replace('.csv', '').split('.')
                if len(parts) == 2:
                    yy, mm = parts
                    # 20YY-MM 형식으로 변환
                    year = f"20{yy}"
                    month = mm.zfill(2)
                    year_month = f"{year}-{month}"
                    
                    # CSV 읽기
                    df = pd.read_csv(file_path, encoding='utf-8-sig', dtype=str)
                    df.columns = df.columns.str.strip()
                    
                    # 연월 컬럼 추가
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


def join_with_masters(df, cost_center_master, account_master):
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
        print(f"     미매칭 코스트센터: {', '.join(map(str, unique_cc[:10]))}")
    
    # 2. 계정과목 마스터 조인
    df = df.merge(
        account_master[['G/L 계정', '대분류', '중준류', '설명']],
        left_on='G/L 계정',
        right_on='G/L 계정',
        how='left'
    )
    
    # 조인 실패 로그
    no_account = df[df['대분류'].isna()]
    if len(no_account) > 0:
        print(f"  [주의] 계정과목 조인 실패: {len(no_account)}건")
        unique_gl = no_account['G/L 계정'].unique()
        print(f"     미매칭 G/L 계정: {', '.join(map(str, unique_gl[:10]))}")
    
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
    
    print(f"  - 필터링 완료: {initial_count}건 -> {len(df)}건")
    
    # 사업부별 건수
    for bu in TARGET_BUSINESS_UNITS:
        bu_count = len(df[df['사업부'] == bu])
        print(f"     - {bu}: {bu_count:,}건")
    
    return df


def aggregate_data(df):
    """데이터 집계"""
    print("\n[6/8] 데이터 집계 중...")
    
    # 영업/직접 컬럼명 확인 및 정규화
    if '영업/직접' in df.columns:
        cost_type_col = '영업/직접'
    else:
        cost_type_col = '영업비/직접비'  # 대체 컬럼명
    
    # 영업/직접 값 정규화 (영업 → 영업비, 직접 → 직접비)
    df[cost_type_col] = df[cost_type_col].replace({'영업': '영업비', '직접': '직접비'})
    
    # 그룹별 집계
    grouped = df.groupby(['연월', '사업부', cost_type_col, '대분류']).agg({
        '금액(전표 통화)': 'sum'
    }).reset_index()
    
    grouped.columns = ['연월', '사업부', '비용구분', '대분류', '금액']
    
    print(f"  - 집계 완료: {len(grouped)}개 그룹")
    
    return grouped


def convert_to_hierarchical_json(aggregated_df, months):
    """계층적 JSON 구조로 변환"""
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
    
    print(f"  - JSON 변환 완료")
    
    return result


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
                                headcount_data[mapped_bu][month_key] = headcount
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
        # 사업부 이름 매핑 (CSV의 사업부 -> 시스템의 사업부 ID)
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
                        # 매핑되지 않은 사업부는 로그만 남기고 스킵 (경영지원 등)
                        if len(headcount_data) == 0:  # 첫 데이터 행에서만 경고
                            print(f"  [주의] 매핑되지 않은 사업부 (경영지원 제외): '{business_unit}'")
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
                                headcount_data[mapped_bu][month_key] = headcount
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
    print("=" * 60)
    print("F&F CHINA 비용 데이터 전처리 시작")
    print("=" * 60)
    
    try:
        # 1. 마스터 파일 로드
        cost_center_master, account_master = load_master_files()
        
        # 2. 비용 파일 로드
        cost_df, months = load_cost_files()
        
        if not cost_df.empty:
            # 3. 데이터 정제
            cost_df = clean_and_filter_data(cost_df)
            
            # 4. 마스터 조인
            cost_df = join_with_masters(cost_df, cost_center_master, account_master)
            
            # 5. 분석 대상 필터링
            cost_df = filter_target_business_units(cost_df)
            
            # 6. 집계
            aggregated_df = aggregate_data(cost_df)
            
            # 7. JSON 변환
            json_data = convert_to_hierarchical_json(aggregated_df, months)
            
            # 8. 파일 저장
            save_json(json_data, OUTPUT_FILE)
            
            print("\n" + "=" * 60)
            print("비용 데이터 전처리 완료!")
            print("=" * 60)
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
