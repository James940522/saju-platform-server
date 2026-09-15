/**
 * 운세 분석 로직
 */
import type { SajuData, PartialSajuData, FortuneAnalysis, FortuneAnalysisType, DailyFortune } from '../types/index.js';
import { analyzeWuXingBalance } from '../data/wuxing.js';
/**
 * 사주를 기반으로 운세 분석
 */
export declare function analyzeFortune(sajuData: SajuData, analysisType: FortuneAnalysisType, _targetDate?: string): FortuneAnalysis;
/**
 * 재물운 분석
 */
export declare function analyzeWealthFortune(sajuData: PartialSajuData, balance?: ReturnType<typeof analyzeWuXingBalance>): FortuneAnalysis;
/**
 * 일일 운세 생성
 */
export declare function getDailyFortune(sajuData: SajuData, date: string): DailyFortune;
