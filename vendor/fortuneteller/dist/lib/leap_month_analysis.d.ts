/**
 * 윤달 출생자 특수 분석 시스템
 * 윤달은 음력 달 사이에 끼어드는 특수한 달로, 명리학에서 독특한 의미를 가짐
 */
import type { SajuData, WuXing, HeavenlyStem, EarthlyBranch } from '../types/index.js';
export interface LeapMonthAnalysis {
    isLeapMonth: boolean;
    specialCharacteristics: string[];
    elementAdjustments: {
        element: WuXing;
        originalStrength: number;
        adjustedStrength: number;
        reason: string;
    }[];
    lifePathInterpretation: string;
    recommendations: string[];
    warnings: string[];
}
/**
 * 윤달 출생자 종합 분석
 */
export declare function analyzeLeapMonthBirth(sajuData: SajuData): LeapMonthAnalysis | null;
/**
 * 윤달 지장간 세력 보정
 * 윤달의 지장간은 일반 달보다 세력이 약함
 */
export declare function applyLeapMonthJiJangGanAdjustment(_branch: EarthlyBranch, isLeapMonth: boolean, originalStrength: {
    primary: {
        stem: HeavenlyStem;
        strength: number;
    };
    secondary?: {
        stem: HeavenlyStem;
        strength: number;
    };
    residual?: {
        stem: HeavenlyStem;
        strength: number;
    };
}): {
    primary: {
        stem: HeavenlyStem;
        strength: number;
    };
    secondary?: {
        stem: HeavenlyStem;
        strength: number;
    };
    residual?: {
        stem: HeavenlyStem;
        strength: number;
    };
};
