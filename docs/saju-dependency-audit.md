# 만세력 데이터 구조와 외부 의존성 점검

점검일: 2026-09-10. 이 문서는 계산 연결 전의 점검 기록이다. 해당 점검에서는 코드·패키지·DB를 변경하지 않았다. 이후 사용자 요청으로 preview 계산과 UI 표시를 구현했으며 현재 동작은 [미리보기 문서](./saju-chart-preview.md)를 따른다.

## 판단

기본 만세력 계산은 현재 설치된 `manseryeok@2.0.0`을 단일 계산 엔진으로 사용하는 방향이 적절하다. 한국천문연구원(KASI) API를 사용자 요청마다 호출할 필요는 없다. 출시 전 달력·일진·절입 경계 검증에는 KASI 자료를 활용하는 것을 권장한다. 개인 종합 풀이와 콘텐츠별 상세 풀이에는 이 계산 결과 외에 서비스의 해석 규칙과 AI 생성 단계가 필요하다.

## 이미 존재하는 DB와 타입

로컬 Prisma schema와 migration SQL을 읽고, 설정된 PostgreSQL에도 `BEGIN READ ONLY`로 접속해 시스템 스키마와 migration 이력을 확인했다. 사용자 프로필·차트 본문 등 실제 서비스 데이터는 조회하지 않았다.

| 테이블 | 정의 / 실제 생성 | 역할 |
| --- | --- | --- |
| `users` | 모두 확인 | 사용자와 대표 사주 프로필 |
| `user_consents` | 모두 확인 | 약관 종류·버전별 동의 |
| `saju_profiles` | 모두 확인 | 소유자, 이름, 관계, 원본 출생 입력 |
| `saju_charts` | 모두 확인 | 프로필에 연결된 계산 Snapshot과 계산 버전 |
| `_prisma_migrations` | 확인 | 아래 4개 migration 모두 완료, rollback 없음 |

적용된 migration:

- `20260908000000_create_users`
- `20260908090000_add_user_display_name`
- `20260908120000_create_user_consents`
- `20260909180000_create_saju_profiles_and_charts`

주요 저장 타입:

| 항목 | PostgreSQL 타입 |
| --- | --- |
| 프로필·차트·사용자 연결 ID | `UUID` |
| 이름 | `VARCHAR(30)` |
| 관계·달력 종류·시간 정확도·대운 성별 | PostgreSQL enum |
| 출생 연·월·일·시·분 | `SMALLINT`; 시·분은 nullable |
| 윤달 여부 | `BOOLEAN` |
| timezone | `VARCHAR(64)`, 기본 `Asia/Seoul` |
| Snapshot | `JSONB` |
| schemaVersion | `SMALLINT` |
| 엔진·엔진 버전·정책 버전 | `VARCHAR(50)` |
| 입력 해시 | `CHAR(64)` |
| 생성·수정·계산 시각 | `TIMESTAMPTZ(3)` |

`BirthInput`, `BirthTime`, `SajuChartSnapshotV1`, 프로필 생성·수정·조회 응답의 Zod schema와 추론 타입도 이미 정의되어 있다. Snapshot은 원국·십성·일간·오행 개수·공망·대운·정규화된 날짜·quality·warnings를 포함한다. JSONB 본문 구조는 애플리케이션의 Snapshot schema가 담당한다.

한 프로필은 여러 차트를 보관하고 `currentChartId`로 현재 차트를 참조한다. `(profileId, inputHash)` unique index가 있다. AI 리포트·실행 작업·이용권·결제 테이블은 현재 Prisma schema와 확인한 public schema에 없다.

근거: [Prisma schema](../prisma/schema.prisma), [마이그레이션](../prisma/migrations/20260909180000_create_saju_profiles_and_charts/migration.sql), [서버 계약](../src/modules/saju-profiles/saju-profile.contract.ts).

## 설치 시점과 변경 이력 확인

이번 입력 연결 작업 전의 Git `HEAD`에 이미 `"manseryeok": "2.0.0"`이 들어 있으며, 설치된 패키지 메타데이터도 2.0.0이다. 계산기와 프로필 저장 시 계산하는 코드도 기존에 존재했다. 신규 preview endpoint에는 이 계산기를 연결하지 않았다.

제공받은 [CHANGELOG](https://github.com/yhj1024/manseryeok/blob/main/CHANGELOG.md)의 최상단 버전은 2.0.0이다. 주요 내용은 입춘·절기 경계, 음양력 변환·윤달, 서버 timezone에 따른 결과 차이 수정과 진태양시·일 경계 옵션 및 십신·공망·대운 추가다. 라이브러리 문서상 KASI 기반 음력 자료와 절입표를 패키지에 포함하며 실행 중 외부 API를 요구하지 않는다. [README](https://github.com/yhj1024/manseryeok)

문서의 정확도 수치는 제작자의 설명이며 우리 서비스의 전 범위 검증 완료를 뜻하지 않는다. 이번에는 설치본을 직접 실행해 다음 대표 사례를 확인했다.

| 합성 입력 / 검증 사례 | 설치본 결과 |
| --- | --- |
| 양력 2000-01-01 12:00 | 연주 `기묘` |
| 양력 2024-02-04 17:26 / 17:28 | 연주 `계묘` / `갑진` |
| 양력 2024-03-10 23:30 | `midnight`, `jasi`, `splitJasi`에서 문서대로 일주·시주 구분 |
| 음력 1997-01-01 | 양력 1997-02-08, 역변환 일치 |
| 음력 1996-06-01 | 양력 1996-07-16, 역변환 일치 |
| 음력 2023 윤2월 1일 | 양력 2023-03-22, 윤달을 포함한 역변환 일치 |
| 존재하지 않는 양력 날짜 / 시·분 없는 라이브러리 호출 | `RangeError` |

라이브러리의 사주 계산 범위와 음양력 변환 범위는 다르다. 서버는 생년월일에 미래 날짜를 허용하지 않으며, 입력 schema의 상한만 보고 양력 2300년까지 모든 Snapshot 변환을 지원한다고 안내해서는 안 된다.

## 무엇이 추가로 필요한가

| 기능 | manseryeok 설치본 | 추가 필요사항 |
| --- | --- | --- |
| 원국·음양·오행·십성·공망 | 제공 | 서비스 enum과 Snapshot으로 매핑 |
| 음양력·윤달 변환, 절입 시각 | 제공 | 기준 자료와 대표 경계 사례 검증 |
| 대운 | 성별 지정 시 제공 | 서비스의 대운 시작 나이·시간 미상 표시 정책 |
| 시간 미상 | 시·분 없는 직접 호출은 불가 | 서버의 부분 차트 정책. 기존 코드에 시주·대운 제외 및 경계일 오류 처리 있음 |
| 지장간 전체·지장간별 십성 | 현재 공개 결과에 없음 | 채택한 지장간 규칙과 응답 항목 추가. 지지 십성 하나를 지장간 전체로 취급하지 않음 |
| 12운성·신살 | CHANGELOG에서 미제공 명시 | 필요한 항목만 기준을 정해 별도 계산·검증 |
| 신강신약·격국·용신 등 판정 | 현재 공개 결과에 없음 | 채택한 해석 규칙과 버전. AI가 계산값처럼 임의 보충하지 않도록 처리 |
| 세운·월운·일운 콘텐츠 | 완성된 상품별 context는 없음 | 대상 기간의 간지·절기와 원국 관계를 서버에서 구성 |
| 종합·재물·관계 AI 풀이 | 생성 기능 없음 | AI Provider, 콘텐츠별 prompt, 출력 검증·저장 |

추가 사주 라이브러리나 MCP 서버를 지금 필수 dependency로 도입할 근거는 없다. 필요한 명리 항목이 확정되면 현재 엔진 위에 작은 규칙을 추가하는 편이 서로 다른 엔진의 시간·역법 기준을 혼합하는 위험을 줄인다.

## KASI API의 역할

공식 [음양력 정보](https://www.data.go.kr/data/15012679/openapi.do)는 음양력 날짜·윤달·월일수·간지 등을 제공한다. 라이브러리의 변환 결과와 일진을 검증하는 기준으로 활용할 수 있다. 다만 문서의 `lunSecha`, `lunWolgeon`은 음력 간지 항목이므로 입춘·절입 순간을 쓰는 사주의 연주·월주에 그대로 대입하지 않는다.

공식 [특일 정보](https://www.data.go.kr/data/15012690/openapi.do)는 국경일·공휴일·기념일·24절기·잡절 정보다. 달력 콘텐츠를 추가하거나 절기 자료를 검증할 때 유용하다. 절기 날짜와 시·분 단위 절입 순간은 구분해야 하며, 검증 시 선택한 상세 API가 실제로 반환하는 시각 필드와 timezone을 확인한다.

출몰시각·월령·태양고도 등은 현재 원국 표시와 AI 사주 풀이에 필수 입력이 아니다. 공휴일 등 별도 달력 콘텐츠 요구가 생기면 해당 기능의 데이터 소스로 검토한다.

권장 운영 형태:

```text
사용자 요청: 출생 입력 → NestJS → manseryeok → Snapshot → UI
품질 검증:  KASI 공식 자료 → 대표 날짜·일진·절입 fixture → 계산 결과 비교
AI 풀이:    저장된 chartId → Snapshot + 상품별 규칙·기간 정보 → AI → 출력 검증
```

KASI를 사용자 요청마다 호출하면 네트워크 지연·호출 한도·장애 처리가 추가된다. 공식 API 자료를 미리 확보해 검증 fixture로 사용하는 구성이 현재의 빠른 미리보기 목표에 맞다. 실제 인증 API와의 대량 대조는 이번 점검에서 수행하지 않았다.

## 구현 전에 보완할 점

1. **시간 기준:** 후속 구현에서 한국시 보정을 기본 적용했다. `kr-mean-solar-midnight-v2`, 기준 경도 127.5°, 균시차 제외, 과거 한국 표준시·서머타임 반영이다. [계산 정책](./saju-hour-pillar-audit.md)을 따른다. 출생지나 해외 출생을 지원하면 입력·정규화·정책 버전을 함께 설계한다.
2. **표시 항목 확정:** 레퍼런스에 지장간·12운성이 있더라도 현재 Snapshot에는 없다. 원국 중심으로 시작할지, 해당 항목을 추가할지 먼저 정한다.
3. **회귀 fixture 보강:** 기존 계산기 unit test는 5개이며, 정확한 절입 직전·직후와 윤달·과거 서머타임·자시·지원 범위 경계 등을 지속적으로 검증하는 fixture가 더 필요하다.
4. **시간 DB 제약 보완:** 실제 DB의 `saju_profiles_birth_time_check`는 exact 분기에서 시·분의 `IS NOT NULL` 검사가 빠져 있다. NULL을 대입해 해당 표현식이 NULL을 반환하는 것을 SELECT로 재현했다. PostgreSQL CHECK는 NULL도 통과시키므로 exact인데 시·분이 없는 데이터가 DB 제약만으로는 차단되지 않는다. 현재 API의 Zod 검증은 이를 차단한다. 추후 별도 migration에서 exact 분기에 명시적 NULL 금지를 추가해야 한다. [PostgreSQL CHECK 문서](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-CHECK-CONSTRAINTS)

이번에는 점검 결과만 기록했으며 migration 실행·추가 dependency 설치·계산 endpoint 연결은 수행하지 않았다.
