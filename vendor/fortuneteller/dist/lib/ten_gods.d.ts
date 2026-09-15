/**
 * 십성(十星) 계산 및 해석 로직
 * 일간(日干)을 기준으로 다른 천간·지지와의 관계를 10가지로 분류
 */
import type { HeavenlyStem, TenGod, PartialSajuData, TenGodInterpretation } from '../types/index.js';
/**
 * 십성 데이터 (이름, 한자, 의미)
 */
export interface TenGodData {
    name: TenGod;
    hanja: string;
    category: 'self' | 'output' | 'wealth' | 'power' | 'resource';
    meaning: string[];
    represents: string[];
}
export declare const TEN_GODS_DATA: Record<TenGod, TenGodData>;
/**
 * 일간과 대상 천간을 비교하여 십성 판단
 */
export declare function calculateTenGod(dayStem: HeavenlyStem, targetStem: HeavenlyStem): TenGod;
/**
 * 사주 전체의 십성 분포 계산 (지장간 세력 반영)
 */
export declare function calculateTenGodsDistribution(sajuData: PartialSajuData): Record<TenGod, number>;
/**
 * 십성 목록 생성 (사주 8자 각각의 십성)
 */
export declare function generateTenGodsList(sajuData: PartialSajuData): TenGod[];
/**
 * 십성별 의미 해석 (연속적 범위 반영)
 */
export declare function interpretTenGod(tenGod: TenGod, count: number): TenGodInterpretation;
/**
 * 사주의 모든 십성 해석
 */
export declare function interpretAllTenGods(distribution: Record<TenGod, number>): TenGodInterpretation[];
