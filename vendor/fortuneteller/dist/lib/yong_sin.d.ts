/**
 * 용신(用神) 선정 시스템
 * 사주의 불균형을 조절하고 운을 개선하는 핵심 오행 분석
 */
import type { SajuData, WuXing } from '../types/index.js';
export interface YongSinAnalysis {
    primaryYongSin: WuXing;
    secondaryYongSin?: WuXing;
    xiSin: WuXing[];
    jiSin: WuXing[];
    chouSin: WuXing[];
    dayMasterStrength: 'very_strong' | 'strong' | 'medium' | 'weak' | 'very_weak';
    reasoning: string;
    leapMonthAnalysis?: {
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
    };
    recommendations: {
        colors: string[];
        directions: string[];
        careers: string[];
        activities: string[];
        cautions: string[];
    };
}
/**
 * 용신 선정 메인 함수
 */
export declare function selectYongSin(sajuData: SajuData): YongSinAnalysis;
/**
 * 용신 기반 조언 텍스트 생성 (윤달 분석 포함)
 */
export declare function generateYongSinAdvice(yongSin: YongSinAnalysis): string[];
