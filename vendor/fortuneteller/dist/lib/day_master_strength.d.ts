/**
 * 일간(日干) 강약 판단 시스템
 * 사주의 가장 중요한 분석 요소인 일간의 강약을 종합적으로 판단
 */
import type { SajuData } from '../types/index.js';
/**
 * 일간 강약 종합 분석
 *
 * 판단 요소:
 * 1. 월령 득실 (40%) - 가장 중요
 * 2. 비겁(比劫) 개수 (25%) - 같은 오행이 일간을 돕는 정도
 * 3. 인성(印星) 개수 (20%) - 일간을 생하는 오행
 * 4. 재관식상 개수 (15%) - 일간을 설기하는 오행
 */
export declare function analyzeDayMasterStrength(sajuData: SajuData): {
    level: 'very_strong' | 'strong' | 'medium' | 'weak' | 'very_weak';
    score: number;
    analysis: string;
};
/**
 * 일간 강약에 따른 용신(用神) 추천
 */
export declare function recommendYongSin(dayMasterStrength: 'very_strong' | 'strong' | 'medium' | 'weak' | 'very_weak'): {
    yongSin: string[];
    advice: string;
};
