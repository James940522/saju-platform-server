/**
 * 격국(格局) 판단 시스템
 * 사주팔자의 전체적인 패턴과 틀을 분석
 */
import type { SajuData } from '../types/index.js';
export type GyeokGuk = 'jeong_gwan' | 'jeong_jae' | 'sig_sin' | 'jeong_in' | 'sang_gwan' | 'pyeon_in' | 'pyeon_jae' | 'chil_sal' | 'bi_gyeon' | 'geob_jae' | 'jong_wang' | 'jong_sal' | 'jong_jae' | 'balanced';
export interface GyeokGukAnalysis {
    gyeokGuk: GyeokGuk;
    name: string;
    hanja: string;
    description: string;
    personality: string[];
    strengths: string[];
    weaknesses: string[];
    careerPath: string[];
    lifeAdvice: string[];
    compatibility: {
        good: string[];
        bad: string[];
    };
}
/**
 * 격국 판단 메인 함수
 */
export declare function determineGyeokGuk(sajuData: SajuData): GyeokGukAnalysis;
/**
 * 격국 정보 조회
 */
export declare function getGyeokGukInfo(gyeokGuk: GyeokGuk): Omit<GyeokGukAnalysis, 'gyeokGuk'>;
