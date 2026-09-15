/**
 * 오행(五行) 데이터
 * 목, 화, 토, 금, 수의 상생상극 관계
 */
import type { WuXing } from '../types/index.js';
export interface WuXingData {
    name: WuXing;
    hanja: string;
    color: string[];
    direction: string;
    season: string;
    personality: string[];
}
export declare const WUXING_DATA: Record<WuXing, WuXingData>;
/**
 * 오행 상생 관계 (生)
 * 木生火 (목생화): 나무가 불을 낳는다
 * 火生土 (화생토): 불이 흙을 낳는다
 * 土生金 (토생금): 흙이 금을 낳는다
 * 金生水 (금생수): 금이 물을 낳는다
 * 水生木 (수생목): 물이 나무를 낳는다
 */
export declare const WUXING_GENERATION: Record<WuXing, WuXing>;
/**
 * 오행 상극 관계 (克)
 * 木克土 (목극토): 나무가 흙을 이긴다
 * 土克水 (토극수): 흙이 물을 이긴다
 * 水克火 (수극화): 물이 불을 이긴다
 * 火克金 (화극금): 불이 금을 이긴다
 * 金克木 (금극목): 금이 나무를 이긴다
 */
export declare const WUXING_DESTRUCTION: Record<WuXing, WuXing>;
/**
 * 두 오행이 상생 관계인지 확인
 */
export declare function isGenerating(from: WuXing, to: WuXing): boolean;
/**
 * 두 오행이 상극 관계인지 확인
 */
export declare function isDestroying(from: WuXing, to: WuXing): boolean;
/**
 * 두 오행의 관계 분석
 */
export declare function analyzeWuXingRelation(from: WuXing, to: WuXing): 'same' | 'generation' | 'destruction' | 'neutral';
/**
 * 오행의 강약 계산
 * 여러 오행의 개수를 받아서 강한 오행과 약한 오행을 판단
 */
export declare function analyzeWuXingBalance(counts: Record<WuXing, number>): {
    strong: WuXing[];
    weak: WuXing[];
    balanced: boolean;
};
/**
 * 두 오행 간의 상호작용 분석 (문자열 설명)
 */
export declare function analyzeElementInteraction(from: WuXing, to: WuXing): string;
/**
 * 특정 오행을 생(生)하는 오행 반환
 */
export declare function getGeneratingElement(element: WuXing): WuXing;
/**
 * 특정 오행이 생(生)하는 오행 반환
 */
export declare function getGeneratedElement(element: WuXing): WuXing;
/**
 * 특정 오행을 극(克)하는 오행 반환
 */
export declare function getControllingElement(element: WuXing): WuXing;
/**
 * 특정 오행이 극(克)하는 오행 반환
 */
export declare function getControlledElement(element: WuXing): WuXing;
/**
 * 특정 오행을 설(洩)하는 오행 반환 (생하는 대상)
 */
export declare function getWeakeningElement(element: WuXing): WuXing;
