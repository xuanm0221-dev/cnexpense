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
import re
import glob
from datetime import datetime
from pathlib import Path

# 경로 설정
BASE_DIR = Path(__file__).parent.parent
COST_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/비용파일")
HEADCOUNT_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/사무실인원수")
HEADCOUNT_STORE_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/매장인원수")
ADJUSTMENT_FILES_DIR = Path("D:/로컬파일/비용대시보드파일/조정분개")
# 원장에 없는 금액을 사람이 채워 넣는 곳 (연월·사업부·G/L 계정·금액·비고)
MANUAL_ADJUST_DIR = Path("D:/로컬파일/비용대시보드파일/수기보정")
# 거래처(BP) 마스터 — 장부의 '상계 계정' 과 같은 코드 체계
BP_MASTER_FILE = Path("D:/로컬파일/비용대시보드파일/BP.XLSX")
# 마스터는 **로컬 원천 폴더 한 곳**에서만 읽는다 (비용파일·조정분개와 같은 폴더).
# 리포에는 사본을 두지 않는다 — 두 곳에 있으면 어느 쪽이 정본인지 헷갈린다.
MASTERS_DIR = Path("D:/로컬파일/비용대시보드파일")


def master_path(name):
    """마스터 파일 경로. 없으면 어디에 둬야 하는지 알려주고 중단한다."""
    p = MASTERS_DIR / name
    if not p.exists():
        raise FileNotFoundError(
            f"마스터 파일이 없습니다: {p} — 이 폴더에 '{name}' 을 두세요."
        )
    return p
OUTPUT_DIR = BASE_DIR / "data" / "processed"
OUTPUT_FILE = OUTPUT_DIR / "aggregated-costs.json"
ANALYSIS_OUTPUT_FILE = OUTPUT_DIR / "account-analysis.json"
HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "headcount.json"
STORE_HEADCOUNT_OUTPUT_FILE = OUTPUT_DIR / "store-headcount.json"
PLAN_OUTPUT_FILE = OUTPUT_DIR / "plan.json"

# 계획(예산) 파일 — **영업비 기준** 계획이다. 직접비 계획은 없으므로 화면에서도
# 관리식·누적(YTD)·영업비 탭일 때만 계획 컬럼을 붙인다.
# 사업부·대분류 명칭이 관리식 마스터와 다르다 (cn-report 체계).
# 숫자가 아니라 **이름 대응**이라 규칙으로 둔다. 여기 없는 이름은 미매핑으로 남겨 로그에 찍는다.
PLAN_FILE = Path("D:/로컬파일/비용대시보드파일/계획/2026년비용_plan.csv")
PLAN_UNIT_MAP = {
    'MLB': 'MLB',
    'KIDS': 'MLB KIDS',
    'DISCOVERY': 'Discovery',
    '공통': '경영지원',
}
PLAN_CATEGORY_MAP = {
    '인건비': '급여',
    '복리후생비': '복리비',
    # 아래는 계획서 명칭 = 관리식 대분류 명칭
    '광고비': '광고비',
    '수주회': '수주회',
    '출장비': '출장비',
    '지급수수료': '지급수수료',
    '임차료': '임차료',
    '감가상각비': '감가상각비',
    '세금과공과': '세금과공과',
    '기타': '기타',
    # 계획서의 IT수수료는 관리식에서 지급수수료에 포함돼 있다 (사용자 확인)
    'IT수수료': '지급수수료',
    # 관리식 대분류에 대응이 없는 것 — 계획 총액에는 들어가지만 대분류 비교에서는 빠진다
    '차량렌트비': None,
}

# 분석 대상 사업부 (마스터 파일과 정확히 일치해야 함)
TARGET_BUSINESS_UNITS = ["경영지원", "MLB", "MLB KIDS", "Discovery", "Duvetica", "SUPRA"]

# 포함 기준은 계정과목맵핑.csv 의 `관리` / `재무` 컬럼 값이 '사용' 인지로 판단한다.
#   관리 X : 관리식에서 제외 (예: 대리상지원금 3개 계정)
#   재무 X : 재무식에서 제외 (예: 96030101/96030103/96030105 관리회계 조정계정)
# 두 기준의 포함 계정이 다르므로 관리식·재무식 총액은 서로 다르다.
USE_FLAG = "사용"
FINANCIAL_EXCLUDED = "__제외__"

# 대리상지원금/보조금 대분류. 이 중 4로 시작하는 계정은 코스트센터가 브랜드를 못 준다
# (41xxx = 코스트센터 공란, 43xxx = CNF00000 Common). 브랜드는 장부 '자재'(SAP 자재코드)
# 첫 글자로 판단한다 — 자재가 비어 있으면 '사업 영역 내역' 으로 넘어간다.
AGENCY_CATEGORY = '대리상지원금'

# 영업비에서만 '기타' 하위로 내리는 대분류 (직접비는 건드리지 않는다)
RELOCATED_OPS_CATEGORY = '물류비'
RELOCATE_INTO = '기타'
MATERIAL_COL = '자재'
MATERIAL_BRAND_PREFIX = {
    'I': 'MLB KIDS',
    'M': 'MLB',
    'X': 'Discovery',
}

# IFRS 조정분개를 귀속시킬 사업부 (조정분개 파일에 브랜드 구분이 없음)
ADJUSTMENT_BUSINESS_UNIT = "MLB"
# 조정분개 시트명
ADJUSTMENT_SHEET = "调整分录"
# 재무식 하위 분해에서 조정분개를 표시할 라벨
ADJUSTMENT_PKG_LABEL = "조정"


# ────────────────────────────────────────────────────────────────────────────
# 하위 레벨(구성) — 1차는 G/L 계정, 필요한 곳만 적요로 보정
#
# (a) LEGACY_GL_REMAP — 과거에 한 계정으로 뭉쳐 있던 것을 적요로 **현행 계정 체계**에 매핑.
#     예: 25년 광고비의 65%가 '광고선전비_MKT광고' 한 계정. 26년은 의류/ACC/브랜딩/
#     캠페인/리테일링으로 신설되어 그대로 두면 전년비가 전부 깨진다.
#     품목 키워드가 있으면 품목 계정 우선 (26년 실제 계정 부여와 동일: SHOES CAMPAIGN → ACC).
#     규칙에 안 걸린 잔액은 '(구)<계정> 미분류'로 남겨 추정 범위를 눈으로 확인할 수 있게 한다.
#
# (b) TEXT_SPLIT — 계정 하나에 성격이 섞여 있어 적요로 더 쪼개야 하는 것.
#     예: 급여 '인건비'는 기본급·성과급·Red Pack이 한 계정, 수주회는 계정이 1개뿐.
#
# 매칭 대상: 적요 + G/L 계정 설명 + 코스트센터명. 위에서부터 먼저 맞는 규칙을 쓴다.
# ────────────────────────────────────────────────────────────────────────────
LEGACY_GL_REMAP = {
    # 광고비는 적요에 프로젝트 코드가 남아 있고, 번호대가 계정을 결정한다.
    #   A/ML(성인) 1xx=브랜딩 · 2xx=상품(의류/ACC) · 3xx=리테일링
    # 품목 키워드가 있으면 품목 계정이 우선 ('SHOES CAMPAIGN' → ACC, 26년 실제 부여와 동일).
    ('광고비', '광고선전비_MKT광고'): [
        ('마케팅 홍보비-ACC', r'SHOES|Shoes|shoes|Shose|SHOSE|\bCAP\b|\bCap\b|BEANI|Beani|신발|모자'),
        ('마케팅홍보비_APP', r'\bDJ\b|\bWJ\b|T-?[Ss]hirt|TSHIRT|bottom|BOTTOM|Vintage|Coopers|LINER|Hot Summer|KCKP|APPAREL|의류'),
        ('마케팅 홍보비-브랜딩', r'\b(?:A|ML|MLB)\d{2}-1\d{2}\b'),
        ('마케팅 홍보비-리테일링', r'\b[A-Z]{1,3}\d{2}-3\d{2}\b|OOH|Mall Ads|In ?[Ss]tore|in ?store|[Ss]tore [Oo]pening|GWP|门店|直营'),
        ('마케팅홍보비_APP', r'\b(?:A|ML|MLB)\d{2}-2\d{2}\b'),
        ('마케팅 홍보비-기타', r'KOL|明星|粉丝|客服'),
        ('마케팅 홍보비-브랜딩', r'代言|艺人|\bBE\b|ENDO|Endorser|Ambassador|Influenc|PR Agency|Media Agency|Social Agency|\bSEM\b|Shooting|宣传'),
        ('마케팅 홍보비-캠페인', r'CAMPAIGN|CAMPAIN|Campaign|campaign|Comms|MEDIA FEE|Starry|小红书|达人|Set-?up|\bQ[1-4]\b|WINTER|SUMMER|SPRING|NEW YEAR'),
        ('마케팅 홍보비-캠페인', r'KIDS|Kids|DISCOVERY|Discovery|\bDX\b|\bMK\b'),
    ],
    ('복리비', '복리후생비_복리'): [
        ('복리후생비_회사 대규모 단합(워크숍) 복지', r'年会|团建|拓展'),
        ('복리후생비_근속(기념일) 복지', r'周年|纪念|근속'),
        ('복리후생비_야외활동', r'outing|OUTING|Outing|户外|野外'),
        ('복리후생비_명절복지', r'端午|中秋|春节|新年|开门红包|生日|节日|38节|圣诞'),
        ('복리후생비_기타복지', r'工服|福利|유니폼'),
    ],
}

# 계정이 매체별로 잘게 나뉘어 있어 오히려 안 보이는 것 — 매체 단위로 묶는다.
# (BP 조인으로 확인: 차오지투이지앤·TMALL광고비의 거래처가 阿里妈妈 = 티몰 광고)
GL_GROUP = {
    ('광고비', '광고선전비_차오지투이지앤'): '티몰 광고비',   # 万相台/超级推荐
    ('광고비', '광고선전비_핀샤오바오'): '티몰 광고비',       # 品销宝
    ('광고비', '광고선전비_TMALL광고비'): '티몰 광고비',
    ('광고비', '광고선전비_쮜화산'): '티몰 광고비',           # 聚划算
    ('광고비', '광고선전비_타오바오커'): '타오바오 광고비',    # 淘宝客
    ('광고비', '광고선전비_틱톡_마이크로폰'): '틱톡 광고비',   # 抖音
    ('광고비', '광고선전비_경준통 투입'): 'JD 광고비',        # 京准通

    # 플랫폼수수료 — 계정명이 곧 플랫폼. 支付宝(Alipay)는 티몰 결제망이라 티몰로 묶는다.
    ('플랫폼수수료', '지급수수료_Alipay 플랫폼사용료'): '티몰',
    ('플랫폼수수료', '지급수수료_Alipay 운송보험'): '티몰',
    ('플랫폼수수료', '지급수수료_Alipay 공제수수료'): '티몰',
    ('플랫폼수수료', '지급수수료_Alipay 포인트수수료'): '티몰',
    ('플랫폼수수료', '지급수수료_Alipay 보증금서비스'): '티몰',
    ('플랫폼수수료', '지급수수료_Alipay TMALL'): '티몰',
    ('플랫폼수수료', '지급수수료_수수료공제_틱톡'): '틱톡',
    ('플랫폼수수료', '지급수수료_틱톡_보험인수'): '틱톡',
    ('플랫폼수수료', '지급수수료_틱톡_다방송수수료'): '틱톡',
    ('플랫폼수수료', '지급수수료_틱톡 공제'): '틱톡',
    ('플랫폼수수료', '지급수수료_틱톡'): '틱톡',
    ('플랫폼수수료', '지급수수료_JD 수수료 공제'): 'JD',
    ('플랫폼수수료', '지급수수료_JD 보험인수'): 'JD',
    ('플랫폼수수료', '지급수수료_JD 거래서비스요금'): 'JD',
    ('플랫폼수수료', '지급수수료_JD 징또우'): 'JD',
    ('플랫폼수수료', '지급수수료_JD'): 'JD',
    ('플랫폼수수료', '지급수수료_위쳇몰'): '위챗',
    ('플랫폼수수료', '플랫폼수수료(조정)'): 'VIP',   # 唯品会 JITX Platform ADJ

    # 장부에서 보조금을 지급수수료 차감으로 잡은 것 —
    # 조정분개의 '정부보조금'과 같은 항목이라 한 줄로 합친다 (대분류 무관)
    ('*', '잡이익_보조금'): '정부보조금',   # = SUBSIDY_LABEL (아래 조정분개 라벨과 동일)
}

TEXT_SPLIT = {
    ('급여', '인건비'): [
        ('Red Pack', r'董事长'),
        ('성과급', r'奖金|年终|성과급'),
        ('기본급', r'工资|薪酬'),
    ],
    ('수주회', '광고비_수주회'): [
        ('수주회_행사운영(장소·식음)', r'酒店|餐饮|场地|会场|短租'),
        ('수주회_진열·연출물', r'陈列|道具|物料|装饰|模特|氛围'),
        ('수주회_유니폼', r'工服|服装'),
        ('수주회_국제운송', r'DHL|FEDEX|快递|关税'),
        ('수주회_시스템', r'系统|订货系统|开发'),
        ('수주회_행사 일괄(계상)', r'TRADESHOW|tradeshow|Tradeshow|订货会|\bTS\b'),
    ],
    # TP수수료는 플랫폼 단위로 합친다 (변동/매출연동 구분 없이 티몰·틱톡)
    ('TP수수료', '지급수수료_TP변동수수료'): [
        ('틱톡', r'抖音|Douyin|DOUYIN|틱톡'),
        ('티몰', r'天猫|TMALL|Tmall|TP运营费|TP佣金'),
        ('TP 기타', r'.'),
    ],
    ('TP수수료', '지급수수료_TP매출연동수수료'): [
        ('틱톡', r'抖音|Douyin|DOUYIN'),
        ('티몰', r'天猫|TMALL|Tmall|销售佣金'),
        ('TP 기타', r'.'),
    ],
}

# 거래처가 서비스 종류를 사실상 결정하는 대분류 — BP를 적요보다 먼저 본다.
# 지급수수료는 전용 분기(_fee_sublevel)가 계정·적요로 처리하므로 여기서 뺐다.
LEGACY_BP_FIRST: set[str] = set()

# TP 대행사 → 플랫폼. 적요에 天猫/抖音 표기가 없는 건은 대행사가 곧 플랫폼이다.
BP_PLATFORM_RULES = [
    ('티몰', r'思禾朴冶|古星'),
    ('틱톡', r'博观瑞思|祈飞'),
]
_BP_PLATFORM_COMPILED = None


def _bp_platform(bp_name):
    global _BP_PLATFORM_COMPILED
    if not bp_name:
        return None
    if _BP_PLATFORM_COMPILED is None:
        import re
        _BP_PLATFORM_COMPILED = [(n, re.compile(p)) for n, p in BP_PLATFORM_RULES]
    for name, rx in _BP_PLATFORM_COMPILED:
        if rx.search(bp_name):
            return name
    return None

_BP_MASTER = None
_LEGACY_COMPILED = None


def _load_bp_master():
    """BP.XLSX → 코드·거래처명·구분 (없으면 None)"""
    global _BP_MASTER
    if _BP_MASTER is not None:
        return _BP_MASTER if len(_BP_MASTER) else None
    if not BP_MASTER_FILE.exists():
        print(f"  [주의] BP 마스터 없음 — 거래처 보정 스킵 ({BP_MASTER_FILE})")
        _BP_MASTER = pd.DataFrame()
        return None
    try:
        bp = pd.read_excel(BP_MASTER_FILE, dtype=str)
    except Exception as e:
        print(f"  [실패] BP 마스터 로드 실패: {e}")
        _BP_MASTER = pd.DataFrame()
        return None
    bp.columns = [str(c).strip() for c in bp.columns]
    bp = bp.rename(columns={'BP': '_bp코드', 'BP name': '_bp명', '구분': '_bp구분'})
    for c in ('_bp코드', '_bp명', '_bp구분'):
        if c not in bp.columns:
            bp[c] = ''
        bp[c] = bp[c].fillna('').astype(str).str.strip()
    bp = bp[bp['_bp코드'] != ''].drop_duplicates(subset=['_bp코드'])
    _BP_MASTER = bp[['_bp코드', '_bp명', '_bp구분']]
    print(f"  - BP 마스터: {len(_BP_MASTER)}건")
    return _BP_MASTER


def build_bp_account_map(df):
    """26년(최신 연도) 실적에서 (대분류, 거래처) → 계정 지배 관계를 학습.

    한 거래처가 특정 계정에 80% 이상 몰릴 때만 채택한다. 하드코딩이 아니라
    매 실행마다 최신 데이터에서 다시 배우므로 거래처가 바뀌어도 따라간다.
    """
    if df.empty or '_bp명' not in df.columns:
        return {}

    latest_year = df['연월'].str[:4].max()
    work = df[(df['연월'].str[:4] == latest_year) & (df['_bp명'] != '')].copy()
    if work.empty:
        return {}
    work['_gl'] = work['G/L 계정 설명'].fillna('').astype(str).str.strip()

    # legacy(뭉친) 계정 자체는 학습에서 제외 — 현행 계정 체계만 배운다
    legacy_gls = {gl for (_, gl) in LEGACY_GL_REMAP}
    work = work[~work['_gl'].isin(legacy_gls)]
    work['_amt'] = work['금액(전표 통화)'].abs()

    out = {}
    grouped = work.groupby(['대분류', '_bp명', '_gl'])['_amt'].sum().reset_index()
    for (cat, bp), g in grouped.groupby(['대분류', '_bp명']):
        total = g['_amt'].sum()
        if total <= 0:
            continue
        top = g.loc[g['_amt'].idxmax()]
        if top['_amt'] / total >= 0.8:
            out[(cat, bp)] = top['_gl']
    print(f"  - BP→계정 학습({latest_year}년): {len(out)}쌍")
    return out
_SPLIT_COMPILED = None


def _legacy_rules():
    global _LEGACY_COMPILED
    if _LEGACY_COMPILED is None:
        import re
        _LEGACY_COMPILED = {
            k: [(name, re.compile(pat)) for name, pat in rules]
            for k, rules in LEGACY_GL_REMAP.items()
        }
    return _LEGACY_COMPILED


def _split_rules():
    global _SPLIT_COMPILED
    if _SPLIT_COMPILED is None:
        import re
        _SPLIT_COMPILED = {
            k: [(name, re.compile(pat)) for name, pat in rules]
            for k, rules in TEXT_SPLIT.items()
        }
    return _SPLIT_COMPILED


# ────────────────────────────────────────────────────────────────────────────
# 지급수수료 — IT / 비IT 구분
#
# 계획·실적 파일에서 사람이 `지급수수료` 와 `IT수수료` 로 나눠 관리하는데, 관리식 대분류는
# 둘을 합친 `지급수수료` 하나다. 그래서 **하위 레벨(구성)에 그 구분을 담는다.**
# 대분류 총액은 그대로고, 무엇이 IT인지가 한눈에 보인다.
#
# 사람이 쓰는 기준을 원장에서 역산했다 (2026년 실적 파일과 금액 대사).
#   ① 계정으로 결정 — 18개 계정 중 14개는 계정만 보면 IT 여부가 갈린다
#   ② 나머지 4개만 적요를 본다 — SAP·Snowflake·OMS 처럼 단서가 적요에 남아 있다
# 2026년 1~6월 기준 사람 분류와 96% 일치, 미분류 0.4%.
# ────────────────────────────────────────────────────────────────────────────
FEE_CATEGORY = '지급수수료'
#: 구성 라벨의 계층 구분자 — 화면에서 이 기호로 잘라 2단 트리로 그린다
SUB_LEVEL_SEP = ' › '
FEE_IT = 'IT수수료'
FEE_NON_IT = '지급수수료'
FEE_ETC = '기타'

#: 계정만으로 결정되는 것 — G/L 계정 설명 → (IT 여부, 중분류)
FEE_ACCOUNT_CLASS = {
    '지급수수료_데이터 운영 서비스비': (True, '데이터 구매·운영'),
    '지급수수료_AI 관련 서비스비': (True, 'AI 시스템'),
    '지급수수료_소프트웨어사용료': (True, '사무실 소프트웨어'),
    '지급수수료_직영매장 서비스비-IT': (True, '시스템 유지보수'),
    '지급수수료_감사서비스비': (False, '재무·감사'),
    '지급수수료_위조상품 구매 서비스비': (False, '법무'),
    '지급수수료_채용 서비스비': (False, '인사'),
    '지급수수료_법률자문비': (False, '법무'),
    '보험료': (False, '보험'),
    '지급수수료_부가가치 서비스비': (False, 'Supply Chain'),
    '지급수수료_직영매장 서비스비-INT': (False, '인테리어·개발'),
    '지급수수료_직영매장 서비스비-기타': (False, '매장 서비스'),
    '지급수수료_온라인매장 서비스비': (False, '매장 서비스'),
    '지급수수료_일반': (False, FEE_ETC),
}

#: 계정이 섞여 있는 것(연간유지보수·신규개발·기타자문·구 지급용역료)만 적요로 본다.
#: 비IT 를 먼저 걸러야 한다 — 물류·법무 건에도 시스템 단어가 섞여 나온다.
FEE_NON_IT_RULES = [
    ('Supply Chain', r'搬仓|宝尊|盘点|销毁|退仓|全盘|仓库|顺丰|QAQC|VAS|RFID|MSP|存货损失'),
    ('재무·감사', r'审计|年审|税务|Tax|BAPA|会计|감사|IC相关|翻译|汇算清缴'),
    ('법무', r'法律|律师|法务|商标|专利|监测|WOLTERS|威科先行|案元|样品采买'),
    ('인사', r'招聘|채용|残疾|장애인|HR|猎头'),
    ('인테리어·개발', r'形象|SHOWROOM|VMD|金型|模具|陈列|店铺设计|门店设计|道具|打样|设计服务费|设计费|CAMPAIGN|拆除|复原|整改'),
    ('리테일 교육', r'一点知识|学习软件|培训|교육|巡店验收'),
    ('상품 개발', r'部分开发|开发决算|模特|FITTING'),
    ('보험', r'保险|보험'),
    ('매장 서비스', r'联营|门店|直营|开店|专柜|撤柜'),
    ('Office Service', r'保洁|清洗|清洁|办公室维护|空气治理|短信|贴纸|采购数量'),
    ('품질검사', r'送检|检测费用|检验|质检|GB检测'),
    ('시장조사', r'调研|U&A|消费者'),
]

FEE_IT_RULES = [
    ('CN SAP', r'SAP'),
    ('Snowflake', r'SNOWFLKE|SNOWFLAKE|数仓'),
    ('OMS', r'OMS'),
    ('CRM', r'CRM'),
    ('RMS 반품 시스템', r'RMS'),
    ('OA·자동화', r'OA|OA系统|OA&|钉钉|泛微'),
    ('AI 시스템', r'Claude|GPT|AI|知衣|打标|识别系统|商品标签'),
    ('Data Server', r'阿里云|云资源|aws|anchnet|NAS|服务器|数据库|迁移|负载均衡|cloud storage|存储'),
    ('사무실 소프트웨어', r'MS ?OFFICE|OFFICE ?365|ADOBE|VPN|POLYCOM|视频会议|LICENSE'),
    ('시스템 유지보수', r'BOS|读写分离|运维|系统维护|报表定制|移动报表|订货系统|DX_|伯俊|大麦系统|系统货位|万店掌|系统开发|采购系统|申报提交系统'),
    ('보안·인증', r'SSL|防火墙|杀毒|病毒|深信服|보안|网安|漏洞|扫描排查'),
    ('데이터 구매·운영', r'DBEI|辰月|数据引擎|情报通|任拓|季度服务费|竞品数据|原始数据|数据地址|数据采购'),
    ('온라인스토어 개발', r'开店服务费|建站|小程序|一次性实施费用|店项目'),
    # 사무실 IT 인프라 — 25년에 L38 이전하며 발생 (弱电=약전/네트워크 배선)
    ('사무실 IT 인프라', r'IT装修|IT弱电|弱电|无线2.5|线路优化|扩容'),
]

#: 중분류 → 소분류. 확실한 것만 넣는다 — 규칙에 안 걸리면 중분류에서 끝난다.
#: 2026년 실적 파일의 소분류와 원장 적요를 금액으로 대사해 역산했다.
FEE_SUB_RULES = {
    'CN SAP': [
        ('업그레이드 비용', r'接口开发|升级'),
        ('연간 유지보수비용', r'license|maintenance|维保'),
    ],
    '시스템 유지보수': [
        ('BI', r'BI平台|观数台'),
        ('BOS', r'BOS'),
        ('OA 운영', r'泛微|OA系统运维'),
    ],
    '사무실 소프트웨어': [
        ('MS office', r'MS ?OFFICE|OFFICE ?365'),
        ('Adobe', r'ADOBE'),
        ('VPN', r'VPN'),
        ('영상회의', r'POLYCOM|视频会议'),
    ],
    '재무·감사': [
        ('내부회계 감사비용', r'IC相关'),
        ('폐기 관련 감사비용', r'Fin-?审计|销毁相关'),
        ('폐기관련 세무 컨설팅', r'Fin-?Tax|销毁捐赠'),
        ('계약서번역', r'翻译|汇算清缴'),
        ('Tax', r'税务咨询'),
        ('감사비', r'审计服务费|年审'),
    ],
    '인사': [
        ('장애인 서비스 비용', r'残疾'),
        ('HR Platinum 시스템', r'HR白金'),
        ('사무실 직원 채용비', r'猎头|招聘'),
    ],
    '법무': [
        ('법무 컨설팅 비용', r'法律顾问'),
        ('상표·특허', r'商标|专利'),
        ('온라인 감시 비용', r'监测'),
        ('샘플 구매', r'样品采买|案元'),
    ],
    '인테리어·개발': [
        ('이미지 개발', r'形象开发'),
        ('Showroom', r'SHOWROOM'),
        ('VMD 개발', r'VMD'),
        ('MD금형개발', r'金型|模具'),
    ],
    'Supply Chain': [
        ('창고 이전 비용', r'搬仓'),
        ('재고소각비용', r'销毁'),
        ('재고실사 서비스비용', r'盘点|全盘'),
        ('VAS 수리비용', r'VAS|repair'),
        ('RFID 서비스', r'RFID'),
        ('QA 서비스', r'QAQC'),
    ],
    'AI 시스템': [
        ('AI식별시스템', r'识别系统|打标|商品标签'),
    ],
}

_FEE_SUB_COMPILED = None


def _fee_sub_rules():
    global _FEE_SUB_COMPILED
    if _FEE_SUB_COMPILED is None:
        import re as _re
        _FEE_SUB_COMPILED = {
            mid: [(name, _re.compile(pat, _re.I)) for name, pat in rules]
            for mid, rules in FEE_SUB_RULES.items()
        }
    return _FEE_SUB_COMPILED


_FEE_COMPILED = None


def _fee_rules():
    global _FEE_COMPILED
    if _FEE_COMPILED is None:
        import re as _re
        _FEE_COMPILED = (
            [(n, _re.compile(p, _re.I)) for n, p in FEE_NON_IT_RULES],
            [(n, _re.compile(p, _re.I)) for n, p in FEE_IT_RULES],
        )
    return _FEE_COMPILED


def _fee_sublevel(gl, haystack):
    """지급수수료 구성 라벨 — (라벨, 추정여부)

    계정으로 결정되면 추정이 아니고, 적요로 판단했으면 추정이다.
    """
    def label(is_it, name):
        head = f'{FEE_IT if is_it else FEE_NON_IT}{SUB_LEVEL_SEP}{name}'
        for leaf, rx in _fee_sub_rules().get(name, []):
            if rx.search(haystack):
                return f'{head}{SUB_LEVEL_SEP}{leaf}'
        return head

    fixed = FEE_ACCOUNT_CLASS.get(gl)
    if fixed:
        is_it, name = fixed
        return label(is_it, name), False

    non_it, it = _fee_rules()
    for name, rx in non_it:
        if rx.search(haystack):
            return label(False, name), True
    for name, rx in it:
        if rx.search(haystack):
            return label(True, name), True
    return label(False, FEE_ETC), True


def _resolve_sublevel(category, gl, haystack, bp_name='', bp_map=None):
    """(구성 라벨, 추정여부) — 1차 계정, 필요 시 거래처·적요로 재분류/세분"""
    key = (category, gl)

    grouped = GL_GROUP.get(key) or GL_GROUP.get(('*', gl))
    if grouped:
        return grouped, False

    # 지급수수료는 IT/비IT 로 갈라 보여준다 (계정 우선, 섞인 계정만 적요)
    if category == FEE_CATEGORY:
        return _fee_sublevel(gl, haystack)

    legacy = _legacy_rules().get(key)
    if legacy:
        by_bp = (bp_map or {}).get((category, bp_name)) if bp_name else None
        if by_bp and category in LEGACY_BP_FIRST:
            return by_bp, True
        for name, rx in legacy:
            if rx.search(haystack):
                return name, True
        if by_bp:
            return by_bp, True
        return f'(구){gl} 미분류', True

    split = _split_rules().get(key)
    if split:
        for name, rx in split:
            # 적요에 플랫폼이 명시된 건이 우선. 못 찾았을 때만 대행사(BP)로 판정한다.
            if name == 'TP 기타':
                platform = _bp_platform(bp_name)
                if platform:
                    return platform, False
            if rx.search(haystack):
                return name, False

    return gl, False


ANALYSIS_BUCKET_RULES = {
    '급여': [
        ('매장 인건비', r'인건비_직영점|직영점|门店|店铺'),
        ('상여/성과급', r'奖金|年终|성과급|BONUS|bonus'),
        ('퇴직·이직보상', r'离职|补偿金|退职|퇴직급여'),
        ('외주/파견', r'外包|劳务|派遣|临时工|实习'),
        ('사무실 급여', r'工资|인건비|급여|薪酬'),
    ],
    '복리비': [
        ('사회보험·공적금', r'社保|公积金|社会保险|사회보험|공적금|保险'),
        ('연회·단합·여행', r'年会|outing|OUTING|团建|周年|旅游|워크숍|단합'),
        ('주재원·외국인', r'外国人|주재원|外籍|外派'),
        ('기타 복지', r'福利|生日|体检|기타복지|野外|야외'),
    ],
    '광고비': [
        ('틱톡(抖音)', r'抖音|Douyin|DOUYIN|틱톡|TikTok|TIKTOK|tiktok|마이크로폰'),
        ('티몰·타오바오', r'天猫|TMALL|Tmall|tmall|淘宝|万相台|品销宝|超级推荐|차오지투이지앤|핀샤오바오|showmax|SHOWMAX|直通车'),
        ('샤오홍슈(小红书)', r'小红书|샤오홍슈|xiaohongshu'),
        ('JD·기타 플랫폼', r'京东|唯品会|得物|拼多多|快手|\bJD\b'),
        ('APP·자사몰', r'마케팅홍보비_APP|小程序|会员|CRM|\bAPP\b|\bapp\b'),
        ('캠페인·모델', r'CAMPAIGN|campaign|Campaign|캠페인|代言|艺人|明星|拍摄|모델|브랜딩|브랜드'),
        ('오프라인·이벤트', r'EVENT|event|活动|展|팝업|POP|리테일링|门店|快闪'),
    ],
    '수주회': [
        ('행사 운영(장소·식음)', r'酒店|餐饮|场地|会场|호텔|短租'),
        ('진열·연출물', r'陈列|道具|物料|装饰|模特|氛围'),
        ('유니폼', r'工服|유니폼|服装'),
        ('국제운송', r'DHL|FEDEX|快递|국제|关税'),
        ('시스템·기타', r'系统|系統|订货系统|开发'),
        ('행사 일괄(계상)', r'TRADESHOW|tradeshow|Tradeshow|订货会|\bTS\b'),
    ],
    '출장비': [
        ('해외출장', r'海外|국외|해외|国际|국제'),
        ('국내출장', r'国内|국내|携程|机票|酒店|差旅|滴滴'),
    ],
    '물류비': [
        ('분류용역', r'分拣|拣货|분류|\bVAS\b'),
        ('운송·택배', r'运输|运费|快递|배송|顺丰|荣庆|운송'),
        ('창고비', r'仓储|仓库|창고|\b仓\b|仓库사용료'),
    ],
    '임차료': [
        ('IFRS 조정', r'임차료\(조정\)|Rent ADJ'),
        ('판매수수료(백화점 등)', r'판매수수료|联营|扣点|抽成'),
        ('관리비', r'管理费|관리비|物业'),
        ('수도광열', r'수도광열|水电|电费'),
        ('매장·사무실 임차료', r'租金|임차료|租赁|房租'),
    ],
    '플랫폼수수료': [
        ('IFRS 조정', r'Platform ADJ|\(조정\)'),
        ('알리페이·티몰', r'支付宝|Alipay|天猫|退货宝|花呗'),
        ('틱톡(抖音)', r'抖音|틱톡|Douyin'),
        ('웨이핀후이', r'唯品会'),
        ('JD', r'京东|\bJD\b'),
    ],
    'TP수수료': [
        ('틱톡 TP', r'抖音|Douyin|DOUYIN|틱톡'),
        ('티몰 TP', r'天猫|TMALL|Tmall|TP运营费|TP佣金|销售佣金|매출연동'),
    ],
    '지급수수료': [
        ('IT·시스템', r'SAP|license|LICENSE|开发|接口|系统|软件|\bAI\b|OMS|유지보수|阿里云|云资源'),
        ('데이터·운영 서비스', r'数据|DBEI|辰月|데이터'),
        ('물류 부대비용', r'搬仓|盘点|销毁|QAQC|宝尊|顺丰|\b仓\b'),
        ('보험', r'商业保险|保险'),
        ('감사·자문', r'审计|감사|咨询|顾问|자문|税务'),
        ('매장 서비스', r'直营|联营|开店|门店|店铺|매장'),
    ],
    '진열/포장': [
        ('포장재', r'包材|耗材|包装|购物袋|포장'),
        ('매장 연출물', r'道具|模特|海报|陈列|POP|物料'),
    ],
    '감가상각비': [
        ('매장 인테리어', r'인테리어|装修|门店|店'),
        ('소프트웨어·홈페이지', r'소프트웨어|软件|홈페이지'),
        ('기계·비품', r'기계장치|공기구|비품|设备'),
    ],
    '세금과공과': [
        ('부가세 부가분(附加税)', r'附加税'),
        ('인화세(印花税)', r'印花税|인화세'),
    ],
    '대리상지원금': [
        ('인테리어·집기 지원', r'装修|外立面|楼梯|图纸|인테리어'),
        ('판촉 지원', r'CAMPAGIN|CAMPAIGN|DP费用|双节|판촉'),
    ],
    '상표사용료': [
        ('브랜드 상표권', r'商标|상표'),
    ],
    '기타': [
        ('교통·차량', r'滴滴|打车|交通|汽车|租赁|洗车|停车'),
        ('사무용품·소모품', r'办公|科力普|소모품|用品'),
        ('통신비', r'电信|通信|통신|话费'),
        ('접대비', r'茅台|접대|招待|礼品|E卡'),
    ],
}

_ANALYSIS_RULES_COMPILED = None


def _analysis_rules():
    global _ANALYSIS_RULES_COMPILED
    if _ANALYSIS_RULES_COMPILED is None:
        import re
        _ANALYSIS_RULES_COMPILED = {
            cat: [(name, re.compile(pat)) for name, pat in rules]
            for cat, rules in ANALYSIS_BUCKET_RULES.items()
        }
    return _ANALYSIS_RULES_COMPILED


ANALYSIS_ETC = '기타'


def _assign_analysis_bucket(category, haystack):
    for name, rx in _analysis_rules().get(category, []):
        if rx.search(haystack):
            return name
    return ANALYSIS_ETC


def _analysis_haystack(df):
    """적요 + G/L 계정 설명 + 코스트센터명 (마스터 조인으로 컬럼명이 _x/_y 가 될 수 있음)"""
    def col(*names):
        for n in names:
            if n in df.columns:
                return df[n].fillna('').astype(str)
        return pd.Series([''] * len(df), index=df.index)

    return (
        col('텍스트') + ' ' + col('G/L 계정 설명') + ' ' + col('코스트센터명_x', '코스트센터명')
    )


# ────────────────────────────────────────────────────────────────────────────
# 비용 변동 원인 (적요 기반) — 광고비·지급수수료만
#
# 대분류 증감(%)만으로는 "왜 늘었는지"를 알 수 없다. 원장 적요에는 계약·프로젝트 이름이
# 남아 있어, 전표번호·날짜·회계처리 표기를 걷어내면 '건' 단위로 묶인다.
# 나머지 대분류는 이 수준의 추적이 필요 없다는 판단(사용자 지정)이라 두 개만 만든다.
# ────────────────────────────────────────────────────────────────────────────
DRIVER_CATEGORIES = ('광고비', '지급수수료', 'TP수수료', '플랫폼수수료', '급여')

#: 적요가 아니라 **하위 계정(G/L 계정 설명)** 으로 묶을 대분류.
#: 급여는 적요가 '부서별 상여금' 처럼 조직 단위라 계약·프로젝트가 아니다.
#: 무엇이 늘었는지는 기본급·상여금·사회보험 같은 계정 단위로 보는 게 맞다.
DRIVER_BY_ACCOUNT = ('급여',)
DRIVER_OUTPUT_FILE = OUTPUT_DIR / "cost-drivers.json"
#: 이 금액 미만인 건은 담지 않는다 (월 단위, 위안) — 파일 크기와 노이즈를 함께 줄인다
DRIVER_MIN_AMOUNT = 100_000

#: 적요에서 걷어낼 것 — 남는 문구가 계약·프로젝트 이름이 된다
DRIVER_DROP_PATTERNS = [
    r'单号[：:][A-Za-z]+-?\d+[—\-]*',        # 单号：DGFK-202601150127——
    r'[A-Z]{4}-\d{6,}',                      # DGFK-202601150127
    r'\d{2}\.\d{1,2}월_',                    # 26.1월_
    r'(冲销计提|冲销|计提|预提|摊销)',           # 계상·환입·상각 — 같은 건으로 묶이게 제거
    r'\d{4}[年./\-]\d{1,2}[月./\-]?\d{0,2}日?',  # 날짜
    r'\d{2}Q[1-4]|Q[1-4]',
    # 연도·회차는 건 이름에서 뺀다. 두면 같은 계약이 매년 다른 건으로 잡혀
    # 전부 '신규'가 된다 (예: SAP license 1st year 2026 ↔ 2nd year 2025,
    # 2025년도상여금 ↔ 2024년도상여금).
    r'\d{4}\s*年度|\d{4}\s*年|FY\s*\d{2,4}',
    r'\d+(?:st|nd|rd|th)\s*year',
    r'(?<![A-Za-z])20\d{2}(?![A-Za-z])',
    r'\d{6,}',
]
_DRIVER_DROP = None


#: 적요에 자주 나오는 중국어 용어 → 한국어. 긴 표현부터 치환한다(짧은 게 먼저 먹으면 깨진다).
#: 플랫폼·광고상품 고유명은 통용 표기를 쓴다 (天猫=티몰, 抖音=틱톡, 小红书=샤오홍슈).
DRIVER_TERMS = {
    # 플랫폼·매체
    '万相台无界版': '완샹타이(티몰광고)',
    '万相台': '완샹타이(티몰광고)',
    '品销宝': '핀샤오바오(티몰광고)',
    '小红书达人': '샤오홍슈 인플루언서',
    '小红书': '샤오홍슈',
    '双十一': '광군제(11.11)',
    '天猫': '티몰',
    '抖音': '틱톡',
    '京东': 'JD',
    '唯品会': 'VIP닷컴',
    # 조직·채널
    '电商部': '이커머스팀',
    '鞋服旗舰店': '신발·의류 플래그십',
    '直营门店': '직영매장',
    '门店形象开发费': '매장 이미지 개발비',
    '门店': '매장',
    '专柜': '백화점 매장',
    # 모델·촬영
    '新代言人': '신규 전속모델',
    '男代言人': '남성 전속모델',
    '男生代言人': '남성 전속모델',
    '代言人': '전속모델',
    '艺人宣传费': '연예인 홍보비',
    '艺人': '연예인',
    '拍摄费用': '촬영비',
    '拍摄': '촬영',
    '宣传费': '홍보비',
    # 계약·정산
    '第一期款项付款': '1차 대금',
    '第二期费用': '2차 비용',
    '第三期款项': '3차 대금',
    '第一期款': '1차 대금',
    '第三期款': '3차 대금',
    '第一期': '1차',
    '第二期': '2차',
    '第三期': '3차',
    '第四期': '4차',
    '款项付款': '대금 지급',
    '共计含税': '세금 포함 합계',
    '结算单': '정산서',
    '结算': '정산',
    '收到发票': '세금계산서 수취',
    '合同生效后': '계약 발효 후',
    '物料已交付': '물료 납품 완료',
    '已完成': '완료',
    '尾款': '잔금',
    '暂估': '가계상',
    # 물류·창고 (지급수수료)
    '搬仓服务费': '창고 이전 서비스비',
    '搬仓费用': '창고 이전비',
    '搬仓': '창고 이전',
    '全盘费用': '전수조사비',
    '全盘': '전수조사',
    '盘点服务费': '재고실사 서비스비',
    '盘点': '재고실사',
    '退仓产生的额外费用': '반품입고 추가비용',
    '退仓': '반품입고',
    '第三方销毁费用': '제3자 폐기비',
    '销毁': '폐기',
    '仓库': '창고',
    '顺丰': 'SF익스프레스',
    '宝尊': '바오준(물류사)',
    # 기타 자주 나오는 것
    '广告投放': '광고 집행',
    '广告费': '광고비',
    '推广费': '프로모션비',
    '推广': '프로모션',
    '活动': '이벤트',
    '服务费': '서비스비',
    '开票': '세금계산서 발행',
    '员工商业保险': '임직원 상해보험',
    '拆除复原费用': '철거 원상복구비',
    '云资源续费': '클라우드 자원 갱신',
    # 플랫폼·광고상품 (추가)
    '支付宝': '알리페이',
    '京准通': '징준통(JD광고)',
    '淘宝客': '타오바오커',
    '聚划算': '쥐화솬(티몰)',
    '新榜达人': '신방 인플루언서',
    '达人': '인플루언서',
    '旗舰店': '플래그십스토어',
    '直通车': '즈통처(티몰광고)',
    '超级推荐': '슈퍼추천(티몰광고)',
    # 계약 문구 — 길어서 건 이름을 잡아먹는다. 짧게 줄인다
    '个工作日内乙方开具等额合法有效的发票': '(계약 조건)',
    '个工作日内乙方开具等额合法有': '(계약 조건)',
    '按照合同约定支付': '계약대로 지급',
    '协议生效后': '협약 발효 후',
    '个工作日': '영업일',
    '乙方': '을(계약사)',
    '执行': '실행',
    '许可': '라이선스',
    '音著协': '음악저작권협회',
    '为人民币': '위안화',
    # 업무 표현
    '形象开发': '이미지 개발',
    '决算': '결산',
    '投放': '집행',
    '使用': '사용',
    '返点': '리베이트',
    '发票': '세금계산서',
    # 인건비 관련 (급여 대분류)
    '基本工资': '기본급',
    '工资': '급여',
    '奖金': '상여금',
    '年终奖': '연말상여',
    '社保': '사회보험',
    '公积金': '주택공적금',
    '补偿金': '보상금',
    '离职': '퇴직',
    '加班': '초과근무',
    '外包': '외주',
    '劳务': '용역',
    '派遣': '파견',
    '实习': '인턴',
    # TP·플랫폼 수수료에서 자주 나오는 것
    '运营费': '운영비',
    '手续费': '수수료',
    '佣金': '커미션',
    '技术服务费': '기술서비스비',
    '扣款': '공제',
    '保证金': '보증금',
    '商品': '상품',
    '订单': '주문',
    '退款': '환불',
    '物流': '물류',
    '快递': '택배',
    '仓储': '창고보관',
    '其他': '기타',
    '支付': '지급',
    # 부서명 (급여 적요)
    '数字商务部': '디지털커머스팀',
    '市场部': '마케팅팀',
    '管理部': '관리팀',
    '空间设计': '공간디자인',
    '供应链': '공급망',
    '营业部': '영업팀',
    '销售部': '영업팀',
    '运营部': '운영팀',
    '零售': '리테일',
    '财务': '재무',
    '销售': '판매',
    '奖励': '인센티브',
    '到票': '세금계산서 수취',
    '设计部': '디자인팀',
    '商品部': '상품팀',
    '财务部': '재무팀',
    '人事部': '인사팀',
    # 매장·지명 — 고유명은 영문 표기 (사용자 지정)
    '佛罗伦萨小镇': 'Florence Village',
    '佛罗伦萨': 'Florence',
    '青浦百联': 'Qingpu Bailian',
    '悦荟': 'Yuehui',
    '上海西岸': 'Shanghai West Bund',
    '上海': 'Shanghai',
    '天津': 'Tianjin',
    '北京': 'Beijing',
    '广州': 'Guangzhou',
    '深圳': 'Shenzhen',
    '成都': 'Chengdu',
    '杭州': 'Hangzhou',
    '南京': 'Nanjing',
    '武汉': 'Wuhan',
    '西安': 'Xian',
    '重庆': 'Chongqing',
    '比斯特': 'Bicester',
    '青浦': 'Qingpu',
    '万象城': 'MixC',
    '万达': 'Wanda',
    '银泰': 'Intime',
    '大悦城': 'Joy City',
    # 기업명 (사용자 지정)
    '富柠': 'Funing',
    # 같은 계약인데 해에 따라 표기가 달라지는 것 — 하나로 모은다
    'cnSAP': 'SAP',
    'CN SAP': 'SAP',
    # 인명 — 실명 그대로 두고 역할만 덧붙인다 (사용자 지정)
    '汪苏泷': '汪苏泷(연예인)',
    '章若楠': '章若楠(연예인)',
    # 급여·수수료 표현
    '董事长红包': 'Red Pack',
    '红包': 'Red Pack',
    '扣点': '백화점 수수료',
    '服装': '의류',
    # 채널·매장 (고유명은 음차하지 않고 유형만 옮긴다)
    '微商城': '위챗몰',
    '代运营费用': '대행운영비',
    '代运营费': '대행운영비',
    '代运营': '대행운영',
    '官方旗舰店': '공식 플래그십스토어',
    '退货宝': '반품운임보험(타오바오)',
    '经销商': '대리상',
    '官方': '공식',
    '奥莱': '아울렛',
    '百货': '백화점',
    '广场': '광장',
    '浮动': '변동',
    # 낱글자·조사 — 가장 마지막에 걸리도록 짧게 둔다
    '费用': '비용',
    '合作': '계약',
    '服务': '서비스',
    '项目': '프로젝트',
    '月': '월',
    '年': '년',
    '款': '대금',
    '和': '및',
    '份': '분',
    '年度': '년도',
    '度': '차',
    '元': '위안',
    '店': '매장',
}
_DRIVER_TERMS_SORTED = None


def _translate_terms(text):
    """적요의 중국어 용어를 한국어로. 긴 표현부터 바꾼다."""
    global _DRIVER_TERMS_SORTED
    if _DRIVER_TERMS_SORTED is None:
        _DRIVER_TERMS_SORTED = sorted(DRIVER_TERMS.items(), key=lambda kv: -len(kv[0]))
    for zh, ko in _DRIVER_TERMS_SORTED:
        if zh in text:
            text = text.replace(zh, ko)
    return text


def _driver_signature(text):
    """적요 → '건' 이름. 전표번호·날짜·회계처리 표기를 걷어낸 뒤 앞부분만 쓴다."""
    global _DRIVER_DROP
    if _DRIVER_DROP is None:
        _DRIVER_DROP = [re.compile(p) for p in DRIVER_DROP_PATTERNS]
    s = text or ''
    for rx in _DRIVER_DROP:
        s = rx.sub(' ', s)
    s = re.sub(r'[，,、。()（）\[\]【】/\|:：—\-_#*]+', ' ', s)
    s = _translate_terms(s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:40] or '(적요 없음)'


def _driver_kind(text):
    """회계 처리 유형 — 실지출인지 계상/환입/상각인지 구분해 표시한다"""
    t = text or ''
    if '冲销' in t:
        return '환입'
    if '摊销' in t:
        return '상각'
    if '计提' in t or '预提' in t:
        return '계상'
    return '지출'


def aggregate_cost_drivers(df):
    """연월·사업부·비용구분·대분류·건 별 금액 (광고비·지급수수료만)"""
    if df.empty or '대분류' not in df.columns:
        return pd.DataFrame(
            columns=['연월', '사업부', '비용구분', '대분류', '건', '유형', '금액']
        )

    d = df[df['대분류'].isin(DRIVER_CATEGORIES)].copy()
    if d.empty:
        return pd.DataFrame(
            columns=['연월', '사업부', '비용구분', '대분류', '건', '유형', '금액']
        )

    cc_col = '영업/직접' if '영업/직접' in d.columns else '영업비/직접비'
    cc_norm = d[cc_col].replace({'영업': '영업비', '직접': '직접비'})
    if '직접/영업' in d.columns:
        acc = d['직접/영업'].fillna('').astype(str).str.strip()
        d['_구분'] = np.where(
            acc.isin(['영업', '영업비']), '영업비',
            np.where(acc.isin(['직접', '직접비']), '직접비', cc_norm),
        )
    else:
        d['_구분'] = cc_norm

    # 계정명·코스트센터명이 섞이면 건 이름이 지저분해진다 → 적요만 쓴다
    text = (
        d['텍스트'].fillna('').astype(str)
        if '텍스트' in d.columns
        else pd.Series([''] * len(d), index=d.index)
    )
    gl = (
        d['G/L 계정 설명'].fillna('').astype(str).str.strip()
        if 'G/L 계정 설명' in d.columns
        else pd.Series([''] * len(d), index=d.index)
    )
    # 급여는 하위 계정으로, 나머지는 적요에서 뽑은 '건' 으로 묶는다
    by_account = d['대분류'].isin(DRIVER_BY_ACCOUNT)
    d['건'] = [
        (_translate_terms(g) or '(계정 없음)') if use_gl else _driver_signature(t)
        for use_gl, g, t in zip(by_account, gl, text)
    ]
    d['유형'] = [_driver_kind(t) for t in text]

    g = d.groupby(
        ['연월', '사업부', '_구분', '대분류', '건', '유형'], as_index=False
    )['금액(전표 통화)'].sum()
    g.columns = ['연월', '사업부', '비용구분', '대분류', '건', '유형', '금액']
    g = g[g['금액'].abs() >= DRIVER_MIN_AMOUNT]
    print(f"  - 변동 원인(적요) 집계: {len(g)}행 ({', '.join(DRIVER_CATEGORIES)})")
    return g


def aggregate_account_analysis(mgmt_df, financial_df_rows):
    """계정별 분석용 집계.

    관리식: 연월·사업부·비용구분·대분류·구성(적요 버킷)
    재무식: 연월·사업부·연결계정과목·구성(=관리식 대분류) — 연결계정과목 안에서
            어떤 관리 대분류가 움직였는지가 가장 읽기 쉬운 분해라 대분류를 그대로 쓴다.
    """
    print("\n[8/8] 계정별 분석(적요 기반) 집계 중...")

    if mgmt_df.empty:
        return pd.DataFrame(), pd.DataFrame()

    df = mgmt_df.copy()
    # aggregate_data() 와 동일한 직접/영업 구분 (계정 마스터 우선, 없으면 코스트센터)
    cc_col = '영업/직접' if '영업/직접' in df.columns else '영업비/직접비'
    cc_norm = df[cc_col].replace({'영업': '영업비', '직접': '직접비'})
    if '직접/영업' in df.columns:
        acc_stripped = df['직접/영업'].fillna('').astype(str).str.strip()
        is_ob = acc_stripped.isin(['영업', '영업비'])
        is_db = acc_stripped.isin(['직접', '직접비'])
        df['_집계비용구분'] = np.where(is_ob, '영업비', np.where(is_db, '직접비', cc_norm))
    else:
        df['_집계비용구분'] = cc_norm

    df['_hay'] = _analysis_haystack(df)
    df['_gl'] = df['G/L 계정 설명'].fillna('').astype(str).str.strip()
    df.loc[df['_gl'] == '', '_gl'] = '(미지정)'

    bp_map = build_bp_account_map(df)
    bp_series = df['_bp명'] if '_bp명' in df.columns else pd.Series([''] * len(df), index=df.index)
    resolved = [
        _resolve_sublevel(c, g, h, b, bp_map)
        for c, g, h, b in zip(df['대분류'], df['_gl'], df['_hay'], bp_series)
    ]
    aggregate_account_analysis.bp_map = bp_map
    df['_bucket'] = [r[0] for r in resolved]
    df['_추정'] = [r[1] for r in resolved]

    mgmt = df.groupby(
        ['연월', '사업부', '_집계비용구분', '대분류', '_bucket'], as_index=False
    )['금액(전표 통화)'].sum()
    mgmt.columns = ['연월', '사업부', '비용구분', '대분류', '구성', '금액']

    # 적요로 현행 계정 체계에 맞춘(=추정) 대분류·월 — 화면에 '추정' 표시용
    est = df[df['_추정']]
    estimated = {}
    for (cat, ym), _ in est.groupby(['대분류', '연월']):
        estimated.setdefault(cat, []).append(ym)
    for cat in estimated:
        estimated[cat] = sorted(estimated[cat])

    unmapped = mgmt[mgmt['구성'].str.startswith('(구)')]['금액'].sum()
    print(
        f"  - 관리식 구성 집계: {len(mgmt)}행 "
        f"(계정 1차 + 적요 보정, 추정 대분류 {list(estimated)}, 미분류 잔액 {unmapped/1e6:.1f}백만)"
    )
    aggregate_account_analysis.estimated = estimated

    fin = financial_df_rows
    if fin is None or fin.empty:
        return mgmt, pd.DataFrame()

    print(f"  - 재무식 구성 집계: {len(fin)}행")
    return mgmt, fin


def aggregate_financial_analysis(df):
    """재무식: 연결계정과목 × 구성(관리식과 동일한 계정 1차 + 적요 보정) 월별 집계.

    연결계정과목만으로는 '인건비'가 한 덩어리라, 사무실 급여·매장 인건비·퇴직급여가
    안 보인다. 관리식과 같은 하위 규칙을 써서 계정 단위로 펼친다.
    """
    if df.empty or '연결계정과목' not in df.columns:
        return pd.DataFrame(columns=['연월', '사업부', '연결계정과목', '구성', '금액'])

    work = df[df['연결계정과목'] != FINANCIAL_EXCLUDED].copy()
    if work.empty:
        return pd.DataFrame(columns=['연월', '사업부', '연결계정과목', '구성', '금액'])

    work['_hay'] = _analysis_haystack(work)
    work['_gl'] = work['G/L 계정 설명'].fillna('').astype(str).str.strip()
    work.loc[work['_gl'] == '', '_gl'] = '(미지정)'
    bp_map = getattr(aggregate_account_analysis, 'bp_map', {})
    bp_series = work['_bp명'] if '_bp명' in work.columns else pd.Series([''] * len(work), index=work.index)
    work['구성'] = [
        _resolve_sublevel(c if isinstance(c, str) else '', g, h, b, bp_map)[0]
        for c, g, h, b in zip(work['대분류'], work['_gl'], work['_hay'], bp_series)
    ]
    grouped = work.groupby(
        ['연월', '사업부', '연결계정과목', '구성'], as_index=False
    )['금액(전표 통화)'].sum()
    grouped.columns = ['연월', '사업부', '연결계정과목', '구성', '금액']
    return grouped


def apply_adjustments_analysis(fin_analysis_df, adjustments, allowed_months=None):
    """재무식 분석에 조정분개를 유형별로 반영 (구성 = '조정(IFRS)' / '조정(보조금)').

    카드·표의 재무식 금액은 조정분개를 포함하므로, 분석에서 빼면 금액이 어긋난다.
    """
    if not adjustments:
        return fin_analysis_df

    by_kind = getattr(load_adjustment_entries, 'by_kind', {})
    rows = []
    for ym, by_key in by_kind.items():
        if allowed_months is not None and ym not in allowed_months:
            continue
        for (link, label), amount in by_key.items():
            rows.append({
                '연월': ym,
                '사업부': ADJUSTMENT_BUSINESS_UNIT,
                '연결계정과목': link,
                '구성': label,
                '금액': amount,
            })
    if not rows:
        return fin_analysis_df

    merged = pd.concat([fin_analysis_df, pd.DataFrame(rows)], ignore_index=True)
    merged = merged.groupby(
        ['연월', '사업부', '연결계정과목', '구성'], as_index=False
    )['금액'].sum()
    print(f"  - 재무식 분석 조정분개 반영: {len(rows)}건")
    return merged


def build_analysis_json(mgmt_rows, fin_rows, months, estimated=None):
    """계정별 분석 JSON — { 관리식: {사업부: {비용구분: {대분류: {구성: {월: 금액}}}}}, 재무식: {...} }

    metadata.추정월: 적요로 현행 계정 체계에 맞춘(=추정) 대분류별 월 목록
    """
    result = {
        'metadata': {
            'generatedAt': datetime.now().isoformat(),
            'months': months,
            '추정월': estimated or {},
        },
        '관리식': {},
        '재무식': {},
    }

    for _, r in mgmt_rows.iterrows():
        node = (
            result['관리식']
            .setdefault(r['사업부'], {})
            .setdefault(r['비용구분'], {})
            .setdefault(r['대분류'], {})
            .setdefault(r['구성'], {})
        )
        node[r['연월']] = round(float(r['금액']), 2)

    if fin_rows is not None and not fin_rows.empty:
        for _, r in fin_rows.iterrows():
            node = (
                result['재무식']
                .setdefault(r['사업부'], {})
                .setdefault(r['연결계정과목'], {})
                .setdefault(r['구성'], {})
            )
            node[r['연월']] = round(float(r['금액']), 2)

    return result


def merge_analysis_json(existing, new_data):
    """월 단위 병합 (증분 모드)"""
    if not existing:
        return new_data

    def deep_merge(dst, src, depth):
        for k, v in src.items():
            if depth == 0:
                dst[k] = v  # 월별 금액 — 덮어쓰기
            else:
                deep_merge(dst.setdefault(k, {}), v, depth - 1)

    for basis, depth in (('관리식', 3), ('재무식', 2)):
        deep_merge(existing.setdefault(basis, {}), new_data.get(basis, {}), depth)

    # 추정월은 대분류별 월 목록 합집합
    est = existing.setdefault('metadata', {}).setdefault('추정월', {})
    for cat, ms in (new_data.get('metadata', {}).get('추정월', {}) or {}).items():
        est[cat] = sorted(set(est.get(cat, [])) | set(ms))

    months = sorted(
        set(existing.get('metadata', {}).get('months', []))
        | set(new_data.get('metadata', {}).get('months', []))
    )
    existing.setdefault('metadata', {})['months'] = months
    existing['metadata']['generatedAt'] = datetime.now().isoformat()
    return existing


def load_master_files():
    """마스터 파일 로드"""
    print("[1/8] 마스터 파일 로드 중...")
    
    # 코스트센터 마스터
    cost_center_master = pd.read_csv(
        master_path("코스트센터마스터.csv"),
        encoding='utf-8-sig',
        dtype=str
    )
    # 컬럼명 정리
    cost_center_master.columns = cost_center_master.columns.str.strip()
    
    # 계정과목 마스터 — 통합 파일(계정과목master.csv)에서 관리식 컬럼만 사용
    account_master = load_unified_account_master()

    # 계정과목 맵핑 (재무식) — sap code(=G/L 계정) → 연결계정과목
    account_mapping = load_account_mapping()

    return cost_center_master, account_master, account_mapping


ACCOUNT_MASTER_FILE = "계정과목master.csv"


def _read_account_master():
    """계정 통합 마스터 — 관리식(대분류)·재무식(연결계정과목)이 한 파일에 있다."""
    df = pd.read_csv(master_path(ACCOUNT_MASTER_FILE), encoding='utf-8-sig', dtype=str)
    df.columns = df.columns.str.strip()
    return df


def load_unified_account_master():
    """통합 마스터 → 기존 계정과목마스터 형태 (G/L 계정·name·대분류·중분류·설명·직접/영업)"""
    df = _read_account_master()
    out = pd.DataFrame({
        'G/L 계정': df.get('sap code', '').fillna('').astype(str).str.strip(),
        'name': df.get('sap name(CN)', '').fillna('').astype(str).str.strip(),
        '대분류': df.get('대분류'),
        '중분류': df.get('중분류'),
        '설명': df.get('설명'),
        '직접/영업': df.get('직접/영업'),
    })
    # G/L 없는 행(pkg 전용)·대분류 없는 행은 관리식 대상이 아니다
    out = out[(out['G/L 계정'] != '') & out['대분류'].notna()]
    out = out.drop_duplicates(subset=['G/L 계정'], keep='first')
    return out


def load_account_mapping():
    """재무식 맵핑 로드: sap code → 연결계정과목 (통합 마스터에서 읽는다)"""
    path = master_path(ACCOUNT_MASTER_FILE)
    if not path.exists():
        print(f"  [주의] 계정과목맵핑.csv 없음 — 재무식 집계 스킵 ({path})")
        return None

    df = _read_account_master()

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
    # pkg 표시명 — 한글(pkg name(KO)) 우선, 없으면 영문, 그것도 없으면 코드
    for col in ('pkg name(KO)', 'pkg name(EN)', 'pkg name'):
        if col in df.columns:
            df[col] = df[col].fillna('').astype(str).str.strip()
        else:
            df[col] = ''

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

    # pkg 계정과목 표시 라벨 (재무식 하위 분해용)
    df['_pkg라벨'] = df.apply(
        lambda r: (
            r['pkg name(KO)'] or r['pkg name(EN)'] or r['pkg name'] or r['pkg code']
        )
        if r['pkg code']
        else '',
        axis=1,
    )

    # 장부(G/L) 조인용: sap code → 연결계정과목 + pkg 라벨 + 관리식 포함 여부
    by_sap = (
        df[df['sap code'] != '']
        .loc[:, ['sap code', '연결계정과목', '_pkg라벨', '관리']]
        .drop_duplicates(subset=['sap code'])
        .rename(columns={'관리': '_관리플래그'})
    )
    # 조정분개 조인용: pkg code → 연결계정과목 (sap code 없는 행 포함)
    by_pkg = {
        r['pkg code']: (r['연결계정과목'], r['_pkg라벨'])
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


def apply_manual_adjustments(df, months, cost_center_master):
    """
    원장에 없는 금액을 수기 보정 CSV 에서 읽어 **원장 행처럼** 덧붙인다.

    회계 처리가 중간에 바뀌어 과거 기간이 통째로 비는 경우가 있다.
    (예: VIP 플랫폼수수료 — 96030105 계정을 2025-06 에 신설해 그 이전이 없다)
    이런 건 규칙으로 복원할 수 없어 사람이 숫자를 줄 수밖에 없다.

    보정 행을 만들어 원장에 섞으면 대분류·하위레벨·직접/영업·재무식 제외 여부가
    **기존 마스터 조인 로직 그대로** 결정된다. 여기에 분류 규칙을 새로 두지 않는다.

    코스트 센터는 그 계정이 실제로 쓰던 것을 원장에서 찾아 따라간다.
    (조정 전표는 조정계정(-) ↔ 매장(+) 한 쌍인데, 조정계정은 영업/직접이 'X' 라
     집계에서 빠진다. 그래서 집계에 실제로 들어가는 **양수 레그만** 만든다.)
    """
    if not MANUAL_ADJUST_DIR.exists():
        return df

    files = sorted(p for p in MANUAL_ADJUST_DIR.glob("*.csv") if not p.name.startswith("~$"))
    if not files:
        return df

    need = {'연월', '사업부', 'G/L 계정', '금액'}
    parts = []
    for p in files:
        try:
            m = pd.read_csv(p, encoding='utf-8-sig', dtype=str)
        except Exception as e:
            print(f"  [수기보정] {p.name} 읽기 실패 — 스킵: {e}")
            continue
        m.columns = m.columns.str.strip()
        missing = need - set(m.columns)
        if missing:
            print(f"  [수기보정] {p.name} 컬럼 부족 {sorted(missing)} — 스킵")
            continue
        m['출처파일'] = p.name
        parts.append(m)

    if not parts:
        return df

    man = pd.concat(parts, ignore_index=True)
    for c in ('연월', '사업부', 'G/L 계정'):
        man[c] = man[c].fillna('').astype(str).str.strip()
    man['금액'] = pd.to_numeric(man['금액'].astype(str).str.replace(',', ''), errors='coerce')
    man = man[man['금액'].notna() & (man['금액'] != 0)]

    # 이번 실행에서 처리하는 월만 (증분 실행에서 과거 월이 중복으로 붙는 걸 막는다)
    in_scope = man[man['연월'].isin(set(months))]
    skipped = len(man) - len(in_scope)
    if skipped:
        print(f"  [수기보정] 처리 범위 밖 {skipped}행 건너뜀")
    if in_scope.empty:
        return df

    # (G/L, 사업부) → 원장에서 그 계정이 실제로 쓰는 코스트센터 (양수 레그 최빈값)
    amt = pd.to_numeric(df['금액(전표 통화)'].astype(str).str.replace(',', ''), errors='coerce')
    bu_of_cc = dict(
        zip(
            cost_center_master['코스트 센터'].fillna('').astype(str).str.strip(),
            cost_center_master['사업부'].fillna('').astype(str).str.strip(),
        )
    )
    real = df.assign(
        _금액=amt,
        _cc=df['코스트 센터'].fillna('').astype(str).str.strip(),
        _gl=df['G/L 계정'].fillna('').astype(str).str.strip(),
    )
    real = real[(real['_금액'] > 0) & (real['_cc'] != '')]
    real['_bu'] = real['_cc'].map(bu_of_cc)
    cc_pick = (
        real.groupby(['_gl', '_bu'])['_cc']
        .agg(lambda s: s.value_counts().idxmax())
        .to_dict()
    )
    # 하위레벨 규칙(GL_GROUP 등)이 'G/L 계정 설명' 을 보므로 원장에서 같이 가져온다
    gl_desc = (
        df.assign(_gl=df['G/L 계정'].fillna('').astype(str).str.strip())
        .dropna(subset=['G/L 계정 설명'])
        .groupby('_gl')['G/L 계정 설명']
        .agg(lambda s: s.value_counts().idxmax())
        .to_dict()
    )

    made, unresolved = [], []
    for _, r in in_scope.iterrows():
        cc = cc_pick.get((r['G/L 계정'], r['사업부']))
        if not cc:
            unresolved.append((r['연월'], r['사업부'], r['G/L 계정']))
            continue
        made.append({
            '연월': r['연월'],
            '코스트 센터': cc,
            'G/L 계정': r['G/L 계정'],
            # 원장 CSV 는 전부 문자열로 읽힌다. 정제 단계가 .str 로 콤마를 떼므로
            # 숫자로 넣으면 그 행만 NaN 이 되어 조용히 사라진다.
            '금액(전표 통화)': f"{r['금액']:.2f}",
            'G/L 계정 설명': gl_desc.get(r['G/L 계정'], ''),
            '전표 유형': 'SA',
            '텍스트': str(r.get('비고') or '수기보정'),
        })

    if unresolved:
        print(f"  [수기보정] 코스트센터를 못 찾아 제외 {len(unresolved)}행: {unresolved[:4]}")
    if not made:
        return df

    add = pd.DataFrame(made)
    # 금액은 원장 형식(문자열)로 넣었으므로 요약은 숫자 원본에서 낸다
    summary = in_scope[in_scope['G/L 계정'].isin(add['G/L 계정'])]
    print(f"  [수기보정] {len(add)}행 / {summary['금액'].sum():,.0f} 위안 추가 "
          f"({', '.join(p.name for p in files)})")
    for gl, r in summary.groupby('G/L 계정')['금액'].agg(['sum', 'count']).iterrows():
        print(f"     {gl}: {r['sum']:,.0f} ({int(r['count'])}행)")

    return pd.concat([df, add], ignore_index=True)


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
        '패션공통': '경영지원',   # 공통 코스트센터(CNF00000) — 브랜드 구분 없음
    }
    gl_key = df['G/L 계정'].astype(str).str.strip()

    # ── 대리상 4x 계정: 자재코드 첫 글자로 브랜드 배정 ──────────────────────────
    # 코스트센터가 브랜드를 못 알려주는 계정들이다.
    #   41010112/13/14 (대리상지원금)  : 코스트센터 공란
    #   43010108/43030108 (대리상보조금): 코스트센터 CNF00000(Common) = 패션공통
    # 43xxx 는 자재(SAP 자재코드)가 전 건 있고 첫 글자가 브랜드다. 41xxx 는 자재가 비어
    # 있어 아래 사업 영역 내역 fallback 이 받는다. 그래서 자재 → 사업영역 순으로 본다.
    agency_4x = sorted(
        gl for gl in account_master.loc[
            account_master['대분류'].fillna('').astype(str).str.strip() == AGENCY_CATEGORY,
            'G/L 계정',
        ].astype(str).str.strip()
        if gl.startswith('4')
    )
    if agency_4x and MATERIAL_COL in df.columns:
        is_agency = gl_key.isin(agency_4x)
        head = (
            df.loc[is_agency, MATERIAL_COL]
            .fillna('').astype(str).str.strip().str[:1].str.upper()
        )
        brand = head.map(MATERIAL_BRAND_PREFIX)
        hit = brand.notna()
        if hit.any():
            df.loc[brand.index[hit], '사업부'] = brand[hit]
            print(
                f"  [자재] 대리상 4x 계정 {len(agency_4x)}종: 자재코드 첫 글자로 "
                f"{int(hit.sum()):,}건 브랜드 배정 "
                f"({', '.join(f'{k}={v}' for k, v in MATERIAL_BRAND_PREFIX.items())})"
            )
        # 자재가 있는데 매핑에 없는 코드는 조용히 넘기지 않는다 (사업영역 fallback 으로 감)
        unknown = sorted(set(head[~hit & (head != '')]))
        if unknown:
            print(f"  [주의] 자재 첫 글자 미매핑: {', '.join(unknown)} — 사업 영역 내역으로 처리")

    # 코스트센터가 비어 있는 계정 — 사업 영역 내역으로 사업부를 채운다
    FALLBACK_ACCOUNTS = ['96030101'] + agency_4x
    BUSINESS_AREA_COL = '사업 영역 내역'

    no_cc = df['사업부'].isna()
    is_fallback = gl_key.isin(FALLBACK_ACCOUNTS)
    need_fallback = no_cc & is_fallback

    if need_fallback.any() and BUSINESS_AREA_COL in df.columns:
        def _map_bu(val):
            v = str(val).strip() if pd.notna(val) else ''
            return BUSINESS_AREA_MAPPING.get(v) or BUSINESS_AREA_MAPPING.get(v.upper())
        mapped = df.loc[need_fallback, BUSINESS_AREA_COL].apply(_map_bu)
        df.loc[need_fallback, '사업부'] = mapped
        filled = need_fallback & df['사업부'].notna()
        # 96030101(임차료)만 직접비로 고정. 나머지는 계정 마스터의 직접/영업을 따른다
        rent_fb = filled & gl_key.eq('96030101')
        df.loc[rent_fb, '영업/직접'] = '직접비'
        if filled.sum() > 0:
            print(
                f"  [Fallback] 사업 영역 내역으로 {filled.sum():,}건 사업부 보정 "
                f"(96030101 임차료 {int(rent_fb.sum()):,}건은 직접비 고정)"
            )
    
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

    # 2-1. 영업비 물류비 → '기타' 하위로 재배치
    #
    # 영업비 쪽 물류비는 금액이 작아(법인 YTD 0.7백만) 대분류로 두면 표만 길어진다.
    # 대분류를 '기타'로 바꾸면 구성(하위 레벨)에는 계정명이 그대로 남아 계정 단위로 보인다.
    # **직접비 물류비(149백만)는 규모도 성격도 달라 별도 대분류로 그대로 둔다.**
    if '대분류' in df.columns:
        acc_side = (
            df['직접/영업'].fillna('').astype(str).str.strip()
            if '직접/영업' in df.columns
            else pd.Series([''] * len(df), index=df.index)
        )
        cc_side = (
            df['영업/직접'].fillna('').astype(str).str.strip()
            if '영업/직접' in df.columns
            else pd.Series([''] * len(df), index=df.index)
        )
        # 집계와 같은 우선순위: 계정 마스터의 직접/영업이 있으면 그것, 없으면 코스트센터
        side = acc_side.where(acc_side.isin(['영업', '영업비', '직접', '직접비']), cc_side)
        is_ops = side.isin(['영업', '영업비'])
        move = is_ops & df['대분류'].astype(str).str.strip().eq(RELOCATED_OPS_CATEGORY)
        if move.any():
            amount = df.loc[move, '금액(전표 통화)'].sum()
            df.loc[move, '대분류'] = RELOCATE_INTO
            print(
                f"  - 영업비 {RELOCATED_OPS_CATEGORY} → {RELOCATE_INTO} 하위로 재배치: "
                f"{int(move.sum()):,}건 / {amount:,.0f} 위안"
            )

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
        df['_pkg라벨'] = df['_pkg라벨'].fillna('(미지정)').astype(str).str.strip()
        df.loc[df['_pkg라벨'] == '', '_pkg라벨'] = '(미지정)'

        no_link = df[df['연결계정과목'].isna()]
        if len(no_link) > 0:
            unique_gl = no_link['G/L 계정'].astype(str).str.strip().unique()
            print(f"  [주의] 재무식 맵핑 실패: {len(no_link)}건 → 재무식에서 제외")
            print(f"     미매칭 G/L 계정: {', '.join(map(str, unique_gl))}")
        df['연결계정과목'] = df['연결계정과목'].fillna(FINANCIAL_EXCLUDED)

    # 4. 거래처(BP) 조인 — 장부 '상계 계정' = BP 코드
    bp = _load_bp_master()
    if bp is not None and '상계 계정' in df.columns:
        df['_상계'] = df['상계 계정'].fillna('').astype(str).str.strip()
        df = df.merge(bp, left_on='_상계', right_on='_bp코드', how='left')
        df['_bp명'] = df['_bp명'].fillna('').astype(str)
        df['_bp구분'] = df['_bp구분'].fillna('').astype(str)
        df = df.drop(columns=['_상계', '_bp코드'], errors='ignore')
    else:
        df['_bp명'] = ''
        df['_bp구분'] = ''

    print(f"  - 조인 완료")

    return df


def filter_target_business_units(df):
    """분석 대상 사업부만 필터링"""
    print(f"\n[5/8] 분석 대상 사업부 필터링: {', '.join(TARGET_BUSINESS_UNITS)}")
    
    initial_count = len(df)
    
    # 사업부 값이 있는 데이터만
    df = df[df['사업부'].notna()]
    df = df[df['사업부'].isin(TARGET_BUSINESS_UNITS)]

    # 관리식(대분류) 또는 재무식(연결계정과목) 중 하나라도 분류되는 행만 유지.
    # 계정과목마스터에 없어도 맵핑에 있으면 재무식에는 들어가야 한다.
    keep_mgmt = df['대분류'].notna()
    if '연결계정과목' in df.columns:
        keep_fin = df['연결계정과목'].notna() & (df['연결계정과목'] != FINANCIAL_EXCLUDED)
    else:
        keep_fin = keep_mgmt
    dropped_both = (~keep_mgmt) & (~keep_fin)
    if dropped_both.any():
        gls = df.loc[dropped_both, 'G/L 계정'].astype(str).str.strip().unique()
        print(f"  - 양쪽 모두 미분류로 제외: {dropped_both.sum()}건 (G/L {', '.join(gls)})")
    fin_only = (~keep_mgmt) & keep_fin
    if fin_only.any():
        gls = df.loc[fin_only, 'G/L 계정'].astype(str).str.strip().unique()
        print(
            f"  - 계정과목마스터 미등재(대분류 없음) → 재무식만 반영: "
            f"{fin_only.sum()}건 / {df.loc[fin_only, '금액(전표 통화)'].sum():,.0f} 위안 "
            f"(G/L {', '.join(gls)})"
        )
    df = df[keep_mgmt | keep_fin]
    
    # 영업/직접: '영업','직접'만 포함, 'X'(배분계정,조정계정) 무조건 제외
    if '영업/직접' in df.columns:
        valid_cost_type = ['영업', '직접', '직접비']  # 직접비=fallback(96030101)용
        before_x = len(df)
        cc_type = df['영업/직접'].fillna('').astype(str).str.strip()
        # 코스트센터가 없는 계정(대리상지원금 등)은 계정 마스터의 직접/영업으로 판단한다
        acc_type = (
            df['직접/영업'].fillna('').astype(str).str.strip()
            if '직접/영업' in df.columns
            else pd.Series([''] * len(df), index=df.index)
        )
        keep_cost_type = cc_type.isin(valid_cost_type) | (
            (cc_type == '') & acc_type.isin(valid_cost_type)
        )
        df = df[keep_cost_type]
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


ADJUSTMENT_KIND_IFRS = '조정(IFRS)'
ADJUSTMENT_KIND_SUBSIDY = '조정(보조금)'
# 보조금을 수수료 차감으로 잡은 장부 계정(잡이익_보조금)과 그것을 되돌리는 조정분개는
# 같은 항목이므로 한 라벨로 묶는다.
SUBSIDY_LABEL = '정부보조금'


def _adjustment_label(pkg_label, kind):
    if kind == ADJUSTMENT_KIND_SUBSIDY and pkg_label == '지급수수료':
        return SUBSIDY_LABEL
    return f'{pkg_label} {kind}'

# 보조금 배분 분개와 같은 묶음 번호에 들어가 있지만 실제로는 별개 분개인 계정.
# (엑셀에서 묶음을 안 나눴을 뿐 — 유형자산 처분손실·잡손익 재분류)
SUBSIDY_EXCLUDED_PKG = {
    '540500',   # Loss on disposal of P.P.E
    '542500',   # Miscellaneous losses
    '531600',   # Miscellaneous income
}


def _adjustment_kind(group_desc):
    """전표 묶음 설명 → 조정 유형.

    정부보조금(补贴调整)은 지급수수료 차감으로 잡아둔 보조금을 비용 계정에 비율 배분해
    다시 차감하는 **계정 간 재배분**이라 성격이 완전히 다르다. 그래서 따로 뗀다.
    装修补贴/返利补贴 는 정부보조금이 아니라 대리상지원금이므로 여기 넣지 않는다.
    """
    desc = group_desc.replace(' ', '')
    if '补贴调整' in desc and '装修' not in desc and '返利' not in desc:
        return ADJUSTMENT_KIND_SUBSIDY
    return ADJUSTMENT_KIND_IFRS


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
    # 조정 유형별 누적: {연월: {유형: {연결계정과목: 누적금액}}}
    cumulative_by_kind = {}
    for file_path, year_month in sorted(files, key=lambda x: x[1]):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(file_path, data_only=True)
            ws = wb[ADJUSTMENT_SHEET] if ADJUSTMENT_SHEET in wb.sheetnames else wb.worksheets[0]
        except Exception as e:
            print(f"  [실패] 조정분개 로드 실패 {os.path.basename(file_path)}: {e}")
            continue

        totals = {}
        by_kind = {}
        used = skipped = 0
        # 전표 묶음은 데이터 행들 뒤에 설명 행(D열 한자)이 붙는 구조 →
        # 설명을 만날 때까지 버퍼에 쌓았다가 한꺼번에 유형을 부여한다.
        buffer = []
        for row in range(1, ws.max_row + 1):
            code = ws.cell(row, 3).value          # C: pkg code
            name = ws.cell(row, 4).value          # D: 계정명 또는 그룹 설명
            debit = ws.cell(row, 7).value         # G: PL 차변
            credit = ws.cell(row, 8).value        # H: PL 대변
            debit = debit if isinstance(debit, (int, float)) else 0
            credit = credit if isinstance(credit, (int, float)) else 0
            if isinstance(code, (int, float)):
                code_str = str(int(code))
            else:
                code_str = str(code or '').strip()
            name_str = str(name or '').strip()

            # 그룹 설명 행: pkg code 자리가 비었거나 'OK'
            if name_str and not code_str.isdigit():
                kind = _adjustment_kind(name_str)
                for link, amount, pkg, pkg_label in buffer:
                    row_kind = kind
                    if kind == ADJUSTMENT_KIND_SUBSIDY and pkg in SUBSIDY_EXCLUDED_PKG:
                        row_kind = ADJUSTMENT_KIND_IFRS
                    key = (link, _adjustment_label(pkg_label, row_kind))
                    by_kind[key] = by_kind.get(key, 0) + amount
                buffer = []
                continue

            if debit == 0 and credit == 0:
                continue
            hit = pkg_map.get(code_str)
            if not hit:
                skipped += 1
                continue
            link = hit[0]
            pkg_label = (hit[1] or '').strip() if len(hit) > 1 else ''
            if not pkg_label or pkg_label == '(미지정)':
                pkg_label = name_str or code_str
            amount = debit - credit
            totals[link] = totals.get(link, 0) + amount
            buffer.append((link, amount, code_str, pkg_label))
            used += 1

        # 설명 행 없이 끝난 잔여 행은 IFRS(나머지)로
        for link, amount, _pkg, pkg_label in buffer:
            key = (link, _adjustment_label(pkg_label, ADJUSTMENT_KIND_IFRS))
            by_kind[key] = by_kind.get(key, 0) + amount

        cumulative[year_month] = totals
        cumulative_by_kind[year_month] = by_kind
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

    # 계정·유형별도 같은 방식으로 누적 → 증분 (키 = (연결계정과목, '계정명 조정(유형)'))
    monthly_by_kind = {}
    for year, months in by_year.items():
        prev = {}
        for ym in sorted(months):
            curr = cumulative_by_kind.get(ym, {})
            delta = {}
            for key in set(curr) | set(prev):
                v = curr.get(key, 0) - prev.get(key, 0)
                if v:
                    delta[key] = v
            if delta:
                monthly_by_kind[ym] = delta
            prev = curr

    load_adjustment_entries.by_kind = monthly_by_kind
    labels = sorted({label for v in monthly_by_kind.values() for _, label in v})
    print(f"  - 조정 구성 {len(labels)}종: {labels[:6]}{' …' if len(labels) > 6 else ''}")
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


def aggregate_financial_pkg(df):
    """
    재무식 하위 분해 — 연결계정과목 × **pkg 계정과목** 별 월별 집계.
    화면에서 연결계정과목을 펼치면 이 pkg 계정들이 하위 행으로 보인다.
    반환: 연월, 사업부, 연결계정과목, pkg, 금액
    """
    empty_cols = ['연월', '사업부', '연결계정과목', 'pkg', '금액']
    if df.empty or '연결계정과목' not in df.columns or '_pkg라벨' not in df.columns:
        return pd.DataFrame(columns=empty_cols)

    d = df[df['연결계정과목'] != FINANCIAL_EXCLUDED]
    grouped = d.groupby(
        ['연월', '사업부', '연결계정과목', '_pkg라벨'], observed=False
    ).agg({'금액(전표 통화)': 'sum'}).reset_index()
    grouped.columns = empty_cols

    print(f"  - 재무식 pkg 집계 완료: {len(grouped)}개 그룹")
    return grouped


def apply_adjustments_pkg(financial_pkg_df, adjustments, allowed_months=None):
    """조정분개를 pkg 분해에 '조정' 행으로 추가"""
    if not adjustments:
        return financial_pkg_df

    rows = []
    for ym, by_link in adjustments.items():
        if allowed_months is not None and ym not in allowed_months:
            continue
        for link, amount in by_link.items():
            rows.append({
                '연월': ym,
                '사업부': ADJUSTMENT_BUSINESS_UNIT,
                '연결계정과목': link,
                'pkg': ADJUSTMENT_PKG_LABEL,
                '금액': amount,
            })
    if not rows:
        return financial_pkg_df
    merged = pd.concat([financial_pkg_df, pd.DataFrame(rows)], ignore_index=True)
    return merged.groupby(
        ['연월', '사업부', '연결계정과목', 'pkg'], as_index=False
    )['금액'].sum()


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
    financial_pkg_df=None,
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

        # 재무식 하위 분해 (연결계정과목 → pkg 계정과목 / 조정)
        if financial_pkg_df is not None and not financial_pkg_df.empty:
            fin_pkg_bucket = {}
            bu_pkg = financial_pkg_df[financial_pkg_df['사업부'] == bu]
            for _, row in bu_pkg.iterrows():
                category = row['연결계정과목']
                pkg = row['pkg']
                if category not in fin_pkg_bucket:
                    fin_pkg_bucket[category] = {}
                if pkg not in fin_pkg_bucket[category]:
                    fin_pkg_bucket[category][pkg] = {}
                fin_pkg_bucket[category][pkg][row['연월']] = int(round(row['금액']))
            result["data"][bu]["재무식PKG"] = fin_pkg_bucket

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
        new_fin_pkg = new_data.get("data", {}).get(bu, {}).get("재무식PKG")
        if new_fin_pkg:
            if "재무식PKG" not in existing["data"][bu]:
                existing["data"][bu]["재무식PKG"] = {}
            efp = existing["data"][bu]["재무식PKG"]
            for category, pkg_map in new_fin_pkg.items():
                if category not in efp:
                    efp[category] = {}
                for pkg, monthly_amounts in pkg_map.items():
                    if pkg not in efp[category]:
                        efp[category][pkg] = {}
                    for month, amount in monthly_amounts.items():
                        efp[category][pkg][month] = amount

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


def process_plan():
    """계획(예산) CSV → plan.json (사업부 → 대분류 → 연월 → 금액)

    계획서는 cn-report 명칭 체계(KIDS·인건비·IT수수료)라 관리식 대분류로 이름을 맞춘다.
    대응이 없는 대분류(차량렌트비)는 사업부 총액에는 넣되 대분류별에서는 빼고,
    `unmappedCategories` 로 남겨 화면이 그 사실을 알 수 있게 한다.
    """
    print("\n" + "=" * 60)
    print("계획(예산) 데이터 전처리")
    print("=" * 60)

    if not PLAN_FILE.exists():
        print(f"  [건너뜀] 계획 파일 없음: {PLAN_FILE}")
        return

    df = pd.read_csv(PLAN_FILE, encoding='utf-8-sig', dtype=str)
    df.columns = [str(c).strip() for c in df.columns]

    month_cols = {}
    annual_col = None
    for c in df.columns:
        m = re.match(r'^(\d{2})년\s*(\d{1,2})월$', c.strip())
        if m:
            month_cols[c] = f"20{m.group(1)}-{int(m.group(2)):02d}"
        elif re.match(r'^(\d{4})년\s*연간$', c.strip()):
            annual_col = c
    if not month_cols:
        print("  [건너뜀] 월 컬럼을 찾지 못했습니다.")
        return
    if annual_col is None:
        print("  [주의] '연간' 컬럼이 없어 월별 합으로 연간을 만듭니다.")

    def num(v):
        if pd.isna(v):
            return 0.0
        try:
            return float(str(v).replace(',', '').strip() or 0)
        except ValueError:
            return 0.0

    data = {}
    totals = {}
    # 연간 계획은 **'연간' 컬럼이 정본**이다.
    # 월별은 배분 계획이라 납부 시점이 몰리는 항목(세금과공과 등)에서 연간과 어긋난다.
    #   예: 세금과공과 연간 17,385,270 vs 월별 합 14,298,002
    # → 연간계획·사용률은 annual, 계획비(YTD 대비)는 월별을 쓴다.
    annual = {}
    annual_totals = {}
    unmapped_units, unmapped_cats = set(), set()

    for _, row in df.iterrows():
        raw_unit = str(row.get('사업부구분', '')).strip()
        raw_cat = str(row.get('대분류', '')).strip()
        unit = PLAN_UNIT_MAP.get(raw_unit)
        if not unit:
            if raw_unit:
                unmapped_units.add(raw_unit)
            continue

        cat = PLAN_CATEGORY_MAP.get(raw_cat, raw_cat if raw_cat in PLAN_CATEGORY_MAP else None)
        if raw_cat not in PLAN_CATEGORY_MAP:
            unmapped_cats.add(raw_cat)
        mapped = PLAN_CATEGORY_MAP.get(raw_cat)

        for col, ym in month_cols.items():
            amount = num(row.get(col))
            if amount == 0:
                continue
            # 사업부 총액은 대응 여부와 무관하게 전부 더한다
            totals.setdefault(unit, {})
            totals[unit][ym] = totals[unit].get(ym, 0.0) + amount
            if mapped:
                data.setdefault(unit, {}).setdefault(mapped, {})
                data[unit][mapped][ym] = data[unit][mapped].get(ym, 0.0) + amount

        year_amount = (
            num(row.get(annual_col))
            if annual_col
            else sum(num(row.get(c)) for c in month_cols)
        )
        if year_amount:
            annual_totals[unit] = annual_totals.get(unit, 0.0) + year_amount
            if mapped:
                annual.setdefault(unit, {})
                annual[unit][mapped] = annual[unit].get(mapped, 0.0) + year_amount

    months = sorted({ym for ymap in totals.values() for ym in ymap})
    result = {
        "metadata": {
            "generatedAt": datetime.now().isoformat(),
            "months": months,
            "businessUnits": sorted(totals.keys()),
            "unmappedCategories": sorted(c for c in unmapped_cats if PLAN_CATEGORY_MAP.get(c) is None),
            "unmappedUnits": sorted(unmapped_units),
        },
        # 월별 배분 (계획비 = YTD 실적 / YTD 계획 에 쓴다)
        "total": {u: {ym: round(v) for ym, v in sorted(m.items())} for u, m in totals.items()},
        "data": {
            u: {c: {ym: round(v) for ym, v in sorted(m.items())} for c, m in cats.items()}
            for u, cats in data.items()
        },
        # 연간 정본 (연간계획·진척률·사용률에 쓴다)
        "annual": {u: {c: round(v) for c, v in cats.items()} for u, cats in annual.items()},
        "annualTotal": {u: round(v) for u, v in annual_totals.items()},
    }

    for u in sorted(totals):
        monthly_sum = sum(totals[u].values())
        year_sum = annual_totals.get(u, 0)
        gap = "" if abs(year_sum - monthly_sum) < 1 else f" (월별 합 {monthly_sum/1e6:,.1f}백만 — 배분 차이)"
        print(f"  - {u}: 대분류 {len(data.get(u, {}))}종 / 연간 {year_sum/1e6:,.1f}백만{gap}")
    if result['metadata']['unmappedCategories']:
        print(f"  [주의] 관리식 대분류에 대응 없음(총액만 반영): {', '.join(result['metadata']['unmappedCategories'])}")

    save_json(result, PLAN_OUTPUT_FILE)


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
            # 2-1. 원장에 없는 금액을 수기 보정으로 채움 (정제 전에 넣어 같은 경로를 타게)
            cost_df = apply_manual_adjustments(cost_df, months, cost_center_master)

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
                # 관리식: 맵핑 `관리`='사용' + 대분류가 있는 행만
                mgmt_df = cost_df[cost_df['_관리포함'] & cost_df['대분류'].notna()]
                dropped = len(cost_df) - len(mgmt_df)
                if dropped:
                    amt = cost_df.loc[~cost_df['_관리포함'], '금액(전표 통화)'].sum()
                    print(f"  - 관리식 제외: {dropped:,}건 / {amt:,.0f} 위안")
            else:
                mgmt_df = cost_df[cost_df['대분류'].notna()]

            aggregated_df = aggregate_data(mgmt_df)
            gl_aggregated_df = aggregate_gl_by_category(mgmt_df)
            salary_breakdown = aggregate_salary_subcategories(mgmt_df)
            welfare_breakdown = aggregate_welfare_subcategories(mgmt_df)
            financial_df = aggregate_financial_data(cost_df)
            financial_gl_df = aggregate_financial_gl(cost_df)
            financial_pkg_df = aggregate_financial_pkg(cost_df)

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
            financial_pkg_df = apply_adjustments_pkg(financial_pkg_df, adjustments, allowed)

            # 7. JSON 변환
            new_json = convert_to_hierarchical_json(
                aggregated_df,
                months,
                salary_breakdown,
                welfare_breakdown,
                gl_aggregated_df,
                financial_df,
                financial_gl_df,
                financial_pkg_df,
            )
            
            # 7-2. 계정별 분석 (적요 기반 구성)
            analysis_mgmt, _ = aggregate_account_analysis(mgmt_df, None)
            analysis_fin = apply_adjustments_analysis(
                aggregate_financial_analysis(cost_df), adjustments, allowed
            )
            analysis_json = build_analysis_json(
                analysis_mgmt,
                analysis_fin,
                months,
                getattr(aggregate_account_analysis, 'estimated', {}),
            )
            if not is_full and ANALYSIS_OUTPUT_FILE.exists():
                try:
                    with open(ANALYSIS_OUTPUT_FILE, 'r', encoding='utf-8') as f:
                        analysis_json = merge_analysis_json(json.load(f), analysis_json)
                except Exception as e:
                    print(f"  [주의] 기존 분석 JSON 병합 실패({e}) — 새로 씁니다")
            save_json(analysis_json, ANALYSIS_OUTPUT_FILE)

            # 7-3. 변동 원인 (적요 기반) — 광고비·지급수수료
            drivers = aggregate_cost_drivers(mgmt_df)
            driver_json = {
                "metadata": {
                    "generatedAt": datetime.now().isoformat(),
                    "months": months,
                    "categories": list(DRIVER_CATEGORIES),
                    "minAmount": DRIVER_MIN_AMOUNT,
                },
                "rows": [
                    {
                        "ym": r["연월"],
                        "unit": r["사업부"],
                        "side": r["비용구분"],
                        "category": r["대분류"],
                        "item": r["건"],
                        "kind": r["유형"],
                        "amount": round(r["금액"]),
                    }
                    for _, r in drivers.iterrows()
                ],
            }
            save_json(driver_json, DRIVER_OUTPUT_FILE)

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
        process_plan()  # 계획(예산)
        
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
