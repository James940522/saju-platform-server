/**
 * 천간(天干) 데이터
 * 10개의 천간과 관련 정보
 */
import type { HeavenlyStem, WuXing, YinYang } from '../types/index.js';
export interface HeavenlyStemData {
    korean: HeavenlyStem;
    hanja: string;
    element: WuXing;
    yinYang: YinYang;
    index: number;
}
export declare const HEAVENLY_STEMS: HeavenlyStemData[];
/**
 * 천간 인덱스로 천간 데이터 가져오기
 */
export declare function getHeavenlyStemByIndex(index: number): HeavenlyStemData;
/**
 * 천간 한글명으로 천간 데이터 가져오기
 */
export declare function getHeavenlyStemByKorean(korean: HeavenlyStem): HeavenlyStemData | undefined;
/**
 * 천간 한자로 천간 데이터 가져오기
 */
export declare function getHeavenlyStemByHanja(hanja: string): HeavenlyStemData | undefined;
