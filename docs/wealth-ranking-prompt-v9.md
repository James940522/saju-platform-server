# 재물운 v9 프롬프트 적용과 롤백

이번 변경은 프롬프트 본문과 선택 설정만 바꾼다. 입력 데이터, `ranking / rationale / comparisonTitle` 출력 계약, 파싱과 검증, 모델, 최대 5분 제한은 유지한다. HTML·강조 필드는 추가하지 않는다.

## 편집과 선택

| 목적 | 파일 |
| --- | --- |
| 새 v9 본문 편집 | `src/config/prompts/wealth-ranking-v9.prompt.ts` |
| 기존 v8 본문 보존 | `src/config/prompts/wealth-ranking-v8.prompt.ts` |
| 사용할 버전 선택 | `src/config/reading-prompts.config.ts` |

v9는 역할 → 입력 설명 → 판단 규칙 → 작성 규칙 → 출력 키별 규칙 → 금지 규칙 → 완성된 JSON 예시 순서다. 예시는 2명이며 실제 요청의 모든 참여자를 포함하도록 지시한다. 시간 미상·조건부 일간·근거 소유권·동등한 원국의 표시 순서 정책도 유지한다.

서버 호출부는 기존처럼 `readingPrompts['wealth-ranking']`을 읽는다. 본문과 버전을 함께 선택하므로 생성 결과의 `promptVersion`도 일치한다. 새로운 문구를 검증 없이 계속 같은 버전으로 덮어쓰기보다 의미 있는 변경은 별도 버전으로 보존한다.

## 롤백

`reading-prompts.config.ts`의 한 곳을 변경한다.

```ts
const ACTIVE_WEALTH_RANKING_PROMPT: keyof typeof wealthRankingPromptVersions =
  'v8';
```

v9를 다시 쓰려면 같은 값을 `'v9'`로 변경한다. 개발 서버는 watch 재시작 완료를 확인하며, 운영에서는 빌드 후 재시작한다. 시작 로그 `wealth_ranking_provider_configured.promptVersion`에서 활성 버전을 확인한다.

롤백은 이후 실행되는 풀이에 적용한다. 이미 저장한 풀이를 삭제하거나 재생성하지 않는다. 진행 중인 작업이 있을 때는 가능하면 완료 후 재시작한다.

## 호환성과 확인

API·DB 스키마 변경과 마이그레이션은 없다. 프론트엔드 변경도 필요 없다. 기존 v8 문자열 본문은 내용 변경 없이 옮겨 보존한다.

정적 검증에서는 예시 JSON이 현재 출력 스키마 및 참여자·근거 매핑을 통과하는지, v8 본문이 원본과 같은지, 실제 요청 빌더가 선택된 버전을 사용하는지 확인한다. 기존 lint·단위·e2e·build 검사를 실행한다. 실제 Kie 재호출을 포함하지 않으므로 JSON 성공률이나 처리 시간 개선을 보장하는 검증은 아니다.

검증 결과: lint, 단위 테스트 261개, e2e 99개, build 통과. v8 본문 동일성, 예시 JSON의 출력 스키마·참여자·근거 연결, 활성 v9 요청 연결, 기존 5명 입력 데이터 불변을 확인했다.

구조와 예시를 추가해 동일한 5명 요청은 31,500 → 32,429 bytes다. 이번 변경은 입력 축약이나 속도 개선 적용이 아니며, 증가분은 약 2.9%다. 외부 AI 호출 없이 로컬 요청 빌더로 측정했다.
