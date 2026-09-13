# 무료 재물운 랭킹

2026-09-12. Backend 첫 AI 풀이 기능이며 Frontend 화면 연동을 완료했다. 배포 기본값은 비활성화이고, 현재 로컬 `.env`에서는 사용자의 연동 요청에 따라 활성화했다. 합성 데이터의 실제 Kie 호출을 1회 검증했으며 해석 품질의 종합 평가는 별도로 필요하다.

## 범위와 처리 흐름

개인 상세 사주(2,100원), 재물운 랭킹(무료), 전생 관계(2명, 990원), 취업 운세(무료에서 유료 상세로 확장) 중 **재물운 랭킹만 구현**한다. 향후 상품마다 전용 프롬프트와 출력 schema를 두며 이번 구현에 다른 상품의 에이전트나 범용 orchestration을 미리 만들지 않는다.

```text
참여자별 이름·생년월일·출생시간 입력
→ 기존 프로필 생성 API에서 검증·만세력 계산·불변 차트 저장
→ chartIds로 재물운 랭킹 요청
→ 활성 계정·차트 소유권·참여자 중복 검사
→ 선택적 KASI 음양력 대조(불일치 시 중단)
→ 이름·생년월일 원문을 제외한 원국·십성·오행·지장간·삼합 구성
→ 재물운 전용 프롬프트로 Kie 한 번 호출
→ 전체 참여자·근거 참조·문장/단락 길이 검증
→ 소유권 및 계정 상태 재확인 → 결과 반환
```

로그인이 필요하다. 2~5명은 기존 서버 상품 카탈로그와 같은 초기 한도다. 동명이인은 허용하며 `chartId`로 구분한다. 같은 차트 또는 같은 프로필의 서로 다른 과거 차트를 중복 참여자로 넣을 수 없다. 새 인원수 정책이 필요하면 요청/응답 schema와 상품 카탈로그를 함께 변경한다.

현재 프로필 생성 계약의 양력/음력, 윤달, 시간 미상, `luckCycleGender`를 그대로 사용한다. 대운 기준 성별은 기존 만세력 입력에 필요하지만 이번 AI 입력에서는 제외한다. 계산기나 만세력 정책을 변경하지 않는다. 기존 입력 검증과 절기 경계 오류를 그대로 따른다.

## API

참여자마다 `POST /v1/saju-profiles`를 호출하거나 기존 프로필의 차트를 선택한다. 신규 참여자 입력 예:

```json
{
  "displayName": "홍길동",
  "relationType": "friend",
  "birth": {
    "calendarType": "solar",
    "isLeapMonth": false,
    "date": { "year": 1992, "month": 10, "day": 24 },
    "time": { "precision": "exact", "hour": 5, "minute": 30 },
    "luckCycleGender": "male"
  }
}
```

각 응답의 `data.chart.id`를 모아서 호출한다. UUID는 아래 예시 값 대신 실제 반환된 ID를 사용한다.

```http
POST /v1/readings/wealth-ranking
Authorization: Bearer <access_token>
Content-Type: application/json
```

```json
{
  "chartIds": [
    "067410a4-7bed-4901-ab62-faf700827f4a",
    "167410a4-7bed-4901-ab62-faf700827f4a"
  ]
}
```

세 가지 출력의 매핑:

| 사용자 요구 | 응답 필드 | 보장 |
| --- | --- | --- |
| output1: n명 순위 | `data.ranking[].rank`, `chartId`, `displayName` | 1~n 오름차순, 참여자당 정확히 한 번 |
| output2: 개인 재물운세 한 문장 | `data.ranking[].fortune` | 한국어 한 문장 지시, 최대 140자, 문장 부호·줄바꿈·길이 검증 |
| output3: 순위 산출 근거 | `data.rationale` | 최대 한 단락, 600자, 전체 참여자 비교 지시 |

산출 근거의 “최대 단락”은 **최대 한 단락**으로 해석했다. 근거 본문은 “1위 참여자”, “2위 참여자”처럼 순위로 사람을 지칭한다. 서버가 AI의 임시 식별자를 실제 순위로 치환한다. 임의의 이름 문자열이 생성 본문에 명령이나 문법으로 삽입되지 않는다.

추가 필드는 `productCode: "wealth-ranking"`, `schemaVersion: 1`, `promptVersion`, UTC `generatedAt`, `notice`다. 참여자별 `quality`와 `warnings`는 저장된 차트에서 복사하며 AI가 생성하지 않는다. 응답은 `{ code: 200, message, data }`, 모든 결과 및 오류는 `Cache-Control: no-store`다.

## 비교 기준과 검증 범위

전용 프롬프트는 `src/modules/readings/infrastructure/wealth-ranking.prompt.ts`, 버전은 `wealth-ranking-v2`이다. 자료 조합과 KASI 설정은 [사주 풀이 데이터 조합 문서](./saju-reading-data-combination.md)를 따른다. 프롬프트를 변경해 해석 정책이 달라지면 버전도 올린다.

- 정재·편재의 관리/기회 활용, 식신·상관의 생산/표현, 비겁·관성·인성의 협업/관리/학습 맥락을 원국의 위치와 함께 비교한다.
- 점수 계수나 확률을 임의로 만들지 않는다. AI가 그룹 내 상대 순서를 해석하므로 새 요청의 결과가 동일하다고 보장하지 않는다.
- 일간·원국·십성·단순 오행 개수와 지장간별 십성·완성된 삼합 구성, 공식 달력 대조 상태를 전달한다. 지장간 세력이나 합화 성립을 단정하지 않는다. 이름, 출생정보 원문, 성별, 계정/차트 ID, 대운은 전달하지 않는다. 원국도 개인과 관련된 파생 데이터이므로 운영 개인정보 처리 범위에서 다룬다.
- 신강신약·용신·격국 등 미구현 판정과 특정 기간 예측은 금지한다. `judgments`와 `periodContext`는 명시적으로 null이다.
- 시간이 없으면 시주 관련 사실 자체를 만들지 않으며 이를 감점 이유로 쓰지 않게 한다. 계산 불확실성은 응답의 `quality`와 `warnings`에 남긴다.
- 같은 원국 사실은 동등한 성향이며 서버의 고정된 임시 식별자 순서로 표시하게 한다. 이 경우 역순 출력은 검증 실패다. 점수 차이나 우열을 보장하는 순위가 아니다.
- 모델은 참여자마다 실제 입력에 존재하는 근거 ID 1~4개를 반환해야 하며, 최소 하나는 원국 facts에서 선택한다. 지장간·삼합 구성의 근거 ID도 검증한다. 다른 사람의 근거, 존재하지 않는 시주, 중복·누락된 참여자와 문장/단락 위반을 서버에서 거절한다. 근거 ID는 내부 검증용이며 공개 응답에는 넣지 않는다.

이 검증은 **구조와 근거 참조의 유효성**을 확인한다. 문장이 명리적으로 타당한지, 참조한 사실을 정확히 설명했는지, 동일 그룹을 반복 호출했을 때 품질이 일관적인지는 실제 모델 평가가 필요하다. 오락용 해석이며 실제 자산·수익률·경제적 성공을 측정하지 않는다.

## Provider 및 활성화

[Kie Gemini 3.8 Flash 공식 문서](https://docs.kie.ai/market/gemini/gemini-3-8-flash-openai)의 `POST /gemini-3-8-flash-openai/v1/chat/completions`를 기본 모델 경로로 사용한다. Kie의 모델 경로 식별자는 표시 이름과 다르므로 점 대신 하이픈과 `-openai` 접미사를 포함한다. API 원문은 내부 adapter에서 파싱하고 서비스 계약으로 변환한다. SDK/dependency 추가는 없다.

모델 설정은 [src/config/ai-model.config.ts](../src/config/ai-model.config.ts)의 `wealthRanking`에서 직접 수정한다.

```ts
wealthRanking: {
  model: 'gemini-3-8-flash-openai',
  responseFormat: 'prompt_json',
  reasoningEffort: null,
}
```

| 설정 | 의미 |
| --- | --- |
| `model` | Kie `/{model}/v1/chat/completions`에 들어가는 모델 경로 식별자 |
| `responseFormat` | `prompt_json`: 출력 schema를 프롬프트에 포함. `json_schema`: Provider의 `response_format` 사용 |
| `reasoningEffort` | null이면 보내지 않음. 옵션을 지원하는 모델에 한해 `low`, `medium`, `high`로 지정 |

3.8 공식 문서에서 `response_format` 지원을 확인하지 못했으므로 기본값은 `prompt_json`이다. 이 모드는 Provider가 JSON 형태를 강제한다고 보장하지 않으며, 서버의 결과 schema·참여자·근거 검증을 통과한 결과만 반환한다. 문서의 Gemini `candidates` 응답 예시와 기존 `choices` 응답 모두 완성된 텍스트만 파싱하며 thought·tool call은 풀이로 사용하지 않는다.

2.5 Flash로 바꾸려면 `model: 'gemini-2.5-flash'`, `responseFormat: 'json_schema'`, `reasoningEffort: null`로 설정할 수 있다. [2.5 공식 문서](https://docs.kie.ai/market/gemini/gemini-2-5-flash)에 JSON Schema 옵션이 명시되어 있다. 다른 모델은 동일한 chat completions 요청/응답 및 필요한 옵션을 지원하는지 확인한다. Gemini native `streamGenerateContent`, GPT Responses 등 다른 프로토콜은 경로 문자열 변경만으로 지원되지 않는다.

설정은 시작 시 Zod로 검증한다. 변경 후 개발 서버를 재시작하고, 운영 서버에서는 `npm run build` 후 재시작한다. API 키는 이 config 파일에 넣지 않는다.

```dotenv
WEALTH_RANKING_ENABLED=true
KIE_API_KEY=<server_only_key>
WEALTH_RANKING_TIMEOUT_MS=30000
```

활성화 시 키가 없으면 시작에 실패한다. 키를 소스나 클라이언트에 넣지 않는다. 기본값은 비활성화이며 기존 기능의 시작에 AI 키가 필요하지 않다. 비활성 상태의 랭킹 요청은 503이다.

위 설정은 서버 루트 `.env`에서 직접 관리하고 변경 후 서버를 재시작한다.
키 입력 전에는 `KIE_API_KEY=`로 비워 두고 `WEALTH_RANKING_ENABLED=false`를 유지할 수 있다.
`.env`는 Git 추적에서 제외되며 `.env.example`에는 빈 입력란만 제공한다.

비스트리밍·`include_thoughts: false`로 JSON 결과를 한 번 요청한다. JSON 요청 방식은 모델 config를 따르며 최종 출력은 서버가 검증한다. 검색/도구는 사용하지 않는다. 전체 응답 수신까지 기본 30초(설정 범위 1~60초), 응답 본문 64KiB 제한을 적용한다. 잘린 출력, 거절, 잘못된 JSON, Provider 실패는 성공 결과로 대체하지 않는다. 토큰 과금 상한을 보장하는 구현은 아니며 Provider 계정의 비용 제한과 실제 호출 측정이 필요하다.

## 운영 경계 및 오류

이번 결과는 동기 생성 후 응답하며 DB에 저장하지 않는다. 기존 차트 저장만 재사용하므로 신규 migration은 없다. 요청 종료/새로고침 후 결과 재조회, 멱등 응답 cache, 큐·작업 복구는 후속 저장 slice다. 실패나 timeout 후 자동 재호출하지 않으며 수동 재시도는 추가 Provider 호출이 된다. 같은 요청의 결과를 재사용한다고 가정하지 않는다.

프로세스별 사용자당 분당 3회, 사용자 동시 1회, 전체 동시 4회로 제한한다. 검증 실패도 요청 횟수에 포함한다. 다중 인스턴스로 배포할 때 공유 rate limiter 및 계정별 비용 정책을 마련해야 한다. 실행 중 프로세스 재시작을 넘어서는 중복 방지는 제공하지 않는다.

| HTTP | 의미 |
| --- | --- |
| 400 | 인원수·중복 ID·UUID·추가 필드 등 `VALIDATION_ERROR` |
| 401 / 403 | 인증 실패 / 가입 미완료 또는 비활성 계정 |
| 404 | `SAJU_CHART_NOT_FOUND`: 타인·미존재·삭제 상태를 동일하게 처리 |
| 409 | `DUPLICATE_READING_PARTICIPANT`, `READING_IN_PROGRESS` 또는 `SAJU_CALENDAR_MISMATCH` |
| 429 | `RATE_LIMITED`, `Retry-After` 헤더 제공 |
| 502 / 503 / 504 | Provider·출력 실패 / 기능 미설정·동시 한도 / 시간 초과 |

기존 오류 필터에 따라 5xx 응답은 일반 메시지와 `data: null`로 Provider 상세를 숨긴다. 요청 ID만 진단 로그에 남기며 이름·생년월일·키·Provider 본문은 기록하지 않는다.

## 소비자 호환성과 검증

생성 endpoint의 요청·응답 계약은 유지한다. Frontend `/readings/wealth-ranking/start`에서 로그인/프로필 저장 또는 기존 사주 선택 → `chartIds` 요청 → 응답 검증 → 실제 순위·개인 한 문장·근거 표시를 연결했다. API 인증은 기존 Supabase Bearer를 사용하며 Provider 키는 Backend에만 둔다.

상품 목록과 상세의 재물운 `availability`는 `WEALTH_RANKING_ENABLED` 및 API 키 설정에 따라 `active`/`coming_soon`으로 반환한다. Frontend 소개 화면도 서버 상태를 조회한다. 결과 공유 카드 문구는 실제 제공하는 비교 근거로 교체했다. API schema와 DB schema 변경, migration은 없다.

신규 사주 저장은 기존 멱등 키로 재시도하고, 이미 추가한 참여자의 차트를 재사용한다. AI 생성은 자동 재시도하지 않는다. Frontend 요청 제한시간은 70초로 서버의 최대 60초보다 길다. 중복 클릭·동시 저장/생성을 막고, 페이지 이동/계정 변경 시 요청을 취소하며 이전 계정의 결과를 표시하지 않는다. 저장된 사주는 유지되지만 참여자 선택과 랭킹 결과는 새로고침 후 유지하지 않는다. 상세 흐름은 Frontend의 `docs/wealth-ranking-flow.md`에 기록했다.

단위 테스트는 최소·최대 인원, 입력 순서/실명 배제, 시간 미상, 중복/누락, 근거 참조, 문장·단락 제한과 Provider 실패를 확인한다. E2E는 실제 인증 guard·controller·service·schema를 사용하고 외부 토큰 검증/AI/DB 응답만 대체한다. PostgreSQL 소유권 조회 테스트는 기존 저장 integration suite에 추가했다.

```bash
npm run lint
npm test
npm run test:e2e
npm run build
npm exec -- tsc --noEmit
# 격리 테스트 PostgreSQL을 설정한 환경에서:
npm run test:integration
```

2026-09-12, v1 프롬프트 구성에서 등록된 `.env` 키와 Gemini 3.8 Flash 기본 설정으로 합성 참여자 2명의 실제 Kie 호출을 1회 검증했다. HTTP 200, 약 8.4초, 개인 운세 72/69자 및 근거 266자로 출력 계약과 근거 참조 검증을 통과했다. 이 Provider 검증에는 실제 사용자 데이터를 사용하지 않았다. 이는 한 번의 연결 검증으로, 전체 해석 품질이나 반복 생성의 일관성을 보장하지 않는다.

PostgreSQL integration 실행은 아직 검증하지 않았다. 운영 배포 전 합성 fixture로 한국어 품질, 순서 편향, 동일 명식, 시간 미상, 음력/윤달 입력의 결과 품질을 평가하고 Provider 데이터 처리 조건 및 비용 제한을 확인한다.

추가 자료를 반영한 v2의 실제 Kie 호출 검증은 30초·60초 모두 시간 초과로 미완료다. 최신 검증 결과와 KASI 미설정 상태는 [데이터 조합 문서](./saju-reading-data-combination.md#이번-실행-결과)를 따른다.
