/**
 * 지지(地支) 데이터
 * 12개의 지지와 관련 정보
 */
import type { EarthlyBranch, HeavenlyStem, WuXing, YinYang } from '../types/index.js';
export interface EarthlyBranchData {
    korean: EarthlyBranch;
    hanja: string;
    element: WuXing;
    yinYang: YinYang;
    animal: string;
    month: number;
    direction: string;
    index: number;
}
export declare const EARTHLY_BRANCHES: EarthlyBranchData[];
/**
 * 지지 인덱스로 지지 데이터 가져오기
 */
export declare function getEarthlyBranchByIndex(index: number): EarthlyBranchData;
/**
 * 지지 한글명으로 지지 데이터 가져오기
 */
export declare function getEarthlyBranchByKorean(korean: EarthlyBranch): EarthlyBranchData | undefined;
/**
 * 지지 한자로 지지 데이터 가져오기
 */
export declare function getEarthlyBranchByHanja(hanja: string): EarthlyBranchData | undefined;
/**
 * 연도로 띠(지지) 계산하기
 */
export declare function getAnimalSignByYear(year: number): EarthlyBranchData;
/**
 * 삼합(三合) - 3개 지지의 강한 조화 관계
 */
export declare const SAM_HAP: Record<string, {
    branches: EarthlyBranch[];
    element: WuXing;
    name: string;
}>;
/**
 * 삼합 체크 함수
 */
export declare function checkSamHap(branches: EarthlyBranch[]): {
    type: string | null;
    element: WuXing | null;
};
/**
 * 삼형(三刑) - 3개 지지의 형벌 관계
 */
export declare const SAM_HYEONG: Record<string, EarthlyBranch[]>;
/**
 * 삼형 체크 함수
 */
export declare function checkSamHyeong(branches: EarthlyBranch[]): string[];
/**
 * 육해(六害) - 6쌍의 해를 끼치는 관계
 */
export declare const YUK_HAE: [EarthlyBranch, EarthlyBranch][];
/**
 * 육해 체크 함수
 */
export declare function checkYukHae(branches: EarthlyBranch[]): [EarthlyBranch, EarthlyBranch][];
/**
 * 지지 관계 종합 분석
 */
export declare function analyzeBranchRelations(branches: EarthlyBranch[]): {
    samHap: {
        type: string | null;
        element: WuXing | null;
    };
    samHyeong: string[];
    yukHae: [EarthlyBranch, EarthlyBranch][];
    summary: string;
};
/**
 * 지장간(支藏干) - 각 지지 안에 숨어있는 천간들
 */
export declare const JI_JANG_GAN: Record<EarthlyBranch, {
    primary: HeavenlyStem;
    secondary?: HeavenlyStem;
    residual?: HeavenlyStem;
}>;
/**
 * 지장간 추출 - 지지에서 숨은 천간들을 모두 반환
 */
export declare function extractJiJangGan(branch: EarthlyBranch): HeavenlyStem[];
/**
 * 지장간 세력 계산 (절기 기준)
 * 절기에 따라 정기/중기/여기의 강도가 달라짐
 */
export declare function calculateJiJangGanStrength(branch: EarthlyBranch, monthIndex: number): {
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
/**
 * 월령 득실 판단
 * 일간이 월지의 지장간으로부터 생을 받거나 같으면 득령(得令)
 * 극을 받으면 실령(失令)
 */
export declare function checkWolRyeong(dayStem: HeavenlyStem, monthBranch: EarthlyBranch): {
    isDeukRyeong: boolean;
    reason: string;
    strength: 'strong' | 'medium' | 'weak';
};
