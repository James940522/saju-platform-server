/**
 * 신살(神殺) 체계
 * 사주에 나타나는 특수한 길흉신
 */
import type { SajuData, SinSal, SinSalInfo } from '../types/index.js';
/**
 * 신살 정보 데이터
 */
export declare const SIN_SAL_DATA: Record<SinSal, Omit<SinSalInfo, 'sinSal'>>;
/**
 * 사주에서 신살 찾기
 */
export declare function findSinSals(sajuData: SajuData): SinSal[];
/**
 * 신살 정보 조회
 */
export declare function getSinSalInfo(sinSal: SinSal): SinSalInfo;
/**
 * 신살 기반 특수 해석
 */
export declare function interpretBySinSal(sinSals: SinSal[]): {
    warnings: string[];
    blessings: string[];
    specialAdvice: string[];
};
/**
 * 모든 신살 정보 가져오기
 */
export declare function getAllSinSalInfo(sinSals: SinSal[]): SinSalInfo[];
