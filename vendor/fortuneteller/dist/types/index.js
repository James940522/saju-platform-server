/**
 * 사주팔자 관련 타입 정의
 */
// 에러 타입
export class SajuError extends Error {
    constructor(message) {
        super(message);
        this.name = 'SajuError';
    }
}
// 해석 유파 관련 타입
export * from './interpretation.js';
