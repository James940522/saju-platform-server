/**
 * 사주팔자 관련 타입 정의
 */
export type CalendarType = 'solar' | 'lunar';
export type Gender = 'male' | 'female';
export type HeavenlyStem = '갑' | '을' | '병' | '정' | '무' | '기' | '경' | '신' | '임' | '계';
export type EarthlyBranch = '자' | '축' | '인' | '묘' | '진' | '사' | '오' | '미' | '신' | '유' | '술' | '해';
export type WuXing = '목' | '화' | '토' | '금' | '수';
export type YinYang = '음' | '양';
export type TenGod = '비견' | '겁재' | '식신' | '상관' | '편재' | '정재' | '편관' | '정관' | '편인' | '정인';
export interface Pillar {
    stem: HeavenlyStem;
    branch: EarthlyBranch;
    stemElement: WuXing;
    branchElement: WuXing;
    yinYang: YinYang;
}
export type PartialSajuData = Omit<SajuData, 'hour' | 'jiJangGan'> & {
    hour: Pillar | null;
    jiJangGan?: Omit<NonNullable<SajuData['jiJangGan']>, 'hour'> & {
        hour?: NonNullable<SajuData['jiJangGan']>['hour'];
    };
};
export interface SajuPillars {
    year: Pillar;
    month: Pillar;
    day: Pillar;
    hour: Pillar;
}
export interface SajuData {
    birthDate: string;
    birthTime: string;
    /** 경도 보정에 사용한 시군구명 (longitude_table 키). 미입력 시 서울 */
    birthCity: string;
    calendar: CalendarType;
    isLeapMonth: boolean;
    gender: Gender;
    year: Pillar;
    month: Pillar;
    day: Pillar;
    hour: Pillar;
    wuxingCount: Record<WuXing, number>;
    tenGods: TenGod[];
    tenGodsDistribution?: Record<TenGod, number>;
    sinSals?: SinSal[];
    branchRelations?: {
        samHap?: {
            type: string | null;
            element: WuXing | null;
        };
        samHyeong?: string[];
        yukHae?: [EarthlyBranch, EarthlyBranch][];
        summary?: string;
    };
    jiJangGan?: {
        year: {
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
        month: {
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
        day: {
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
        hour: {
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
    };
    wolRyeong?: {
        isDeukRyeong: boolean;
        reason: string;
        strength: 'strong' | 'medium' | 'weak';
    };
    dayMasterStrength?: {
        level: 'very_strong' | 'strong' | 'medium' | 'weak' | 'very_weak';
        score: number;
        analysis: string;
    };
    gyeokGuk?: {
        gyeokGuk: string;
        name: string;
        hanja: string;
        description: string;
    };
    yongSin?: {
        primaryYongSin: WuXing;
        secondaryYongSin?: WuXing;
        reasoning: string;
    };
    specialMarks?: string[];
    dominantElements?: WuXing[];
    weakElements?: WuXing[];
}
export interface TenGodInterpretation {
    tenGod: TenGod;
    count: number;
    intensity: 'very_strong' | 'strong' | 'moderate' | 'weak' | 'very_weak';
    strengths: string[];
    weaknesses: string[];
    advice: string[];
}
export type SinSal = 'cheon_eul_gwi_in' | 'cheon_deok_gwi_in' | 'wol_deok_gwi_in' | 'mun_chang_gwi_in' | 'hak_dang_gwi_in' | 'geum_yeo_rok' | 'hwa_gae_sal' | 'yang_in_sal' | 'do_hwa_sal' | 'baek_ho_sal' | 'yeok_ma_sal' | 'gwa_suk_sal' | 'gong_mang' | 'won_jin_sal' | 'gwi_mun_gwan_sal';
export interface SinSalInfo {
    sinSal: SinSal;
    name: string;
    hanja: string;
    type: 'lucky' | 'unlucky' | 'neutral';
    description: string;
    effects: string[];
    advice: string[];
}
export type FortuneAnalysisType = 'general' | 'career' | 'wealth' | 'health' | 'love';
export interface FortuneAnalysis {
    type: FortuneAnalysisType;
    targetDate?: string;
    score: number;
    summary: string;
    details: {
        positive: string[];
        negative: string[];
        advice: string[];
    };
    luckyElements?: {
        colors?: string[];
        directions?: string[];
        numbers?: number[];
    };
}
export interface CompatibilityAnalysis {
    compatibilityScore: number;
    summary: string;
    strengths: string[];
    weaknesses: string[];
    advice: string[];
    elementHarmony: {
        harmony: number;
        description: string;
    };
}
export interface DailyFortune {
    date: string;
    overallLuck: number;
    wealthLuck: number;
    careerLuck: number;
    healthLuck: number;
    loveLuck: number;
    luckyColor: string;
    luckyDirection: string;
    advice: string;
}
export interface CalendarConversion {
    originalDate: string;
    originalCalendar: CalendarType;
    convertedDate: string;
    convertedCalendar: CalendarType;
    isLeapMonth?: boolean;
    solarTerm?: string;
}
export type SolarTerm = '입춘' | '우수' | '경칩' | '춘분' | '청명' | '곡우' | '입하' | '소만' | '망종' | '하지' | '소서' | '대서' | '입추' | '처서' | '백로' | '추분' | '한로' | '상강' | '입동' | '소설' | '대설' | '동지' | '소한' | '대한';
export declare class SajuError extends Error {
    constructor(message: string);
}
export * from './interpretation.js';
