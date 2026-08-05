/**
 * 카드 우측 패널 전환 탭.
 *
 * 탭 자체는 헤더(기준월 옆)에 있고 내용은 우측 패널에 그려지므로, 두 컴포넌트가 같은
 * 값을 봐야 한다. 그래서 여기 한 곳에 둔다.
 */

export const TAB_DEEP = '심층분석';
export const TAB_DELTA = '계정별 증감';
export const TAB_MONTHLY = '월별 비용';

export type PanelTab = typeof TAB_DEEP | typeof TAB_DELTA | typeof TAB_MONTHLY;

/** 표시 순서 */
export const PANEL_TABS: PanelTab[] = [TAB_DEEP, TAB_DELTA, TAB_MONTHLY];
