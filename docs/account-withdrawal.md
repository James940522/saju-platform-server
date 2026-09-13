# 선녀 사주 회원 탈퇴 구현

2026-09-10 기준 화면·API·영속 삭제 작업을 구현했다. 개발 DB migration과 자동 테스트를 완료했다. 사용자 요청에 따라 키 설정과 실제 Supabase Auth·카카오 삭제 검증은 추후 진행한다. 기본 설정에서는 삭제 처리가 비활성화되어 있고, 화면 흐름과 접수 전 오류 처리는 사용할 수 있다.

## 화면과 API

Frontend의 `내 만세력 → 계정 관리(/account) → 회원 탈퇴`에서 시작한다. 최종 모달에 전체 삭제 범위, 복구 불가, 카카오 서비스 연결 해제를 안내한다. 확인 체크 후에만 최종 버튼을 누를 수 있다. 처리 중 중복 제출을 막고, 취소·ESC·초기 취소 버튼 포커스·닫은 후 포커스 복귀를 제공한다.

홈 상단은 비로그인 시 `나그네님` 텍스트로 로그인 화면에 연결하고, 로그인 시 `이름님` 텍스트로 계정 관리에 연결한다. 기존 로그인·로그아웃 아이콘과 버튼 테두리는 제거했다. 로그아웃은 계정 관리 안의 별도 텍스트 버튼에서 수행한다.

`DELETE /v1/users/me`는 Bearer 인증과 아래 입력을 요구한다. 다른 필드는 허용하지 않으며 대상 ID를 클라이언트에서 받지 않는다.

```json
{ "confirmDataDeletion": true }
```

| HTTP | data / reason | 의미 |
| --- | --- | --- |
| 200 | `{ "status": "completed" }` | 앱 데이터·Auth 계정·카카오 연결 정리 완료 |
| 202 | `{ "status": "processing" }` | 앱 개인정보 삭제와 작업 저장 완료, 나머지 단계 재시도 |
| 400 | `VALIDATION_ERROR` | 확인값이 없거나 잘못된 요청 |
| 401 | `AUTHENTICATION_REQUIRED` | 유효한 본인 인증 없음 |
| 429 | `RATE_LIMITED` | 인스턴스별 인증 주체당 1분 5회 초과, Retry-After 제공 |
| 503 | `ACCOUNT_WITHDRAWAL_UNAVAILABLE` | 비활성화 또는 접수 전 Provider 확인 실패 |

표준 `{ code, message, data }` 응답과 `Cache-Control: no-store`를 유지한다. HTTP 상태와 body의 `code`는 같으며, 200/202의 상태값 조합을 클라이언트에서도 확인한다. 응답을 받지 못한 경우 완료로 표시하지 않는다. 공통 오류 필터는 503의 `ACCOUNT_WITHDRAWAL_UNAVAILABLE`만 고정된 공개 사유·문구로 전달하여 접수 전 거절을 구분한다. 임의의 Provider 원문·메시지·fieldErrors는 노출하지 않고, 그 외 5xx 상세는 기존처럼 null로 유지한다.

가입 미완료·이용 정지 계정도 유효한 본인 인증으로 탈퇴할 수 있다. 접수 후에는 `GET /v1/users/me`와 가입 완료가 403을 반환하며, 활성 회원 검사와 사용자 행 잠금을 사용하는 프로필 쓰기도 차단된다.

클라이언트는 200/202 수신 시 완료/접수 안내를 먼저 표시하고 Query 요청·캐시, 데모 구매 저장값, Supabase 로컬 인증을 정리한다. 다른 탭의 인증 변경과 포커스 복귀 시 검증도 처리한다. `/account`에서는 가입 동의 모달을 열지 않아 가입 전에도 탈퇴할 수 있다.

## 삭제 단계와 데이터

1. 서버 전용 Auth Admin API에서 원래 인증 주체의 Kakao identity를 확인한다. 현재 지원 범위는 단일 Kakao identity다. 사용자 수정이 가능한 metadata는 사용하지 않는다.
2. 인증 주체 advisory lock과 사용자 행 잠금을 획득한다. 같은 잠금 안에서 access token을 재검증하여 오래 기다린 요청이 삭제된 회원을 다시 만들지 못하게 한다.
3. 하나의 DB transaction에서 사용자를 `withdrawn`으로 전환하고 이름·대표 프로필 참조를 지운다. 현재 차트 참조를 비우고 모든 프로필·과거 차트·생성 요청 기록·동의를 삭제한다. Auth만 있는 계정은 처리용 최소 사용자 행을 만들고 탈퇴 작업을 저장한다.
4. 카카오 연결을 해제하고 `delete_auth`로 진행한다. 원래 Auth identity가 그대로인지 다시 확인한 후 unlink한다.
5. 원래 Supabase Auth UUID를 hard delete하고 `delete_user`로 진행한다. 이메일이나 카카오 ID로 새 계정을 찾아 삭제하지 않는다.
6. 마지막 transaction에서 임시 사용자와 탈퇴 작업을 삭제한다.

Auth 재검증은 등록·삭제의 잠금 안에서 실행하지만 외부 unlink·Auth 삭제는 DB transaction 밖에서 수행한다. DB·외부 서비스 사이에 분산 transaction이 있다고 가정하지 않는다.

| 데이터 | 삭제 방식 |
| --- | --- |
| `user_consents` | 해당 회원의 전체 동의 기록 삭제 |
| `saju_profiles` | 해당 회원의 본인·가족·지인 프로필 전체 삭제 |
| `saju_charts` | 프로필 cascade로 현재·과거 snapshot 전체 삭제 |
| `saju_profile_creations` | 이미 삭제된 프로필의 재시도 기록까지 삭제 |
| `users` | 접수 때 개인 필드 정리, 외부 처리 후 행 삭제 |
| `account_withdrawals` | 최소 식별자·단계·재시도 정보만 임시 저장, 완료 시 삭제 |

실제 저장 기능이 없는 AI 풀이·결제·업로드는 이번 삭제 대상에 없다. 공용 상품 목록과 다른 회원 데이터는 유지한다. 이후 도메인 추가 시 삭제 범위를 확장해야 한다.

## 활성화와 배포 순서

1. 배포 대상 DB에 `npm run prisma:migrate:deploy`를 적용하고 `npm run prisma:generate`를 실행한다. 새 migration은 `20260910210000_create_account_withdrawals`이며 기존 데이터 삭제 없이 작업 테이블을 추가한다. 가입 경로도 이 테이블을 사용하므로 **기능을 꺼 두더라도 새 코드 실행 전에 migration이 필요하다.**
2. 서버 환경변수에 해당 Supabase 프로젝트의 `SUPABASE_SERVICE_ROLE_KEY`, 로그인과 같은 카카오 앱의 `KAKAO_ADMIN_KEY`를 설정한다. 브라우저나 `NEXT_PUBLIC_*`에 넣지 않는다.
3. 전용 테스트 환경에서 `ACCOUNT_WITHDRAWAL_ENABLED=true`로 설정하고 서버를 재시작한다. 키가 빠지면 시작 시 설정 검증이 실패한다. 기본값 false에서는 탈퇴 요청만 503을 반환하고 worker는 시작하지 않는다.
4. 버려도 되는 전용 테스트 계정으로 실제 삭제·재가입 검증을 완료한 뒤 서비스 환경에 활성화한다.

이번 작업에서 개발 DB의 migration을 적용했다. 다른 환경에는 별도 배포가 필요하다. 실제 키는 저장소나 이 문서에 기록하지 않는다.

## 재시도와 운영

- worker가 시작 시 및 10초 간격으로 실행할 작업을 최대 10개 조회한다. 한 인스턴스 안의 실행 중복을 막으며 DB에서 60초 lease와 고유 lease ID로 여러 인스턴스의 소유권을 구분한다. 프로세스 재시작 후 만료된 작업도 재개한다.
- Provider 요청 제한 시간은 2초다. 실패 시 5초부터 최대 1시간까지 지수 간격으로 재시도한다. 저장된 처리 단계부터 이어가며 완료된 unlink를 정상적인 Auth 삭제 재시도 때 반복하지 않는다.
- 카카오 400 / `code=-101`만 이미 미연결인 상태로 인정한다. Supabase 404 / `code=user_not_found`만 이미 삭제된 상태로 인정한다. 다른 오류를 성공으로 간주하지 않는다.
- `account_withdrawal_retry` 로그에는 안전한 사유 코드·시도 횟수·`needsAttention`만 기록한다. 5회 이상 실패는 `needsAttention=true`이므로 운영 로그 알림과 연결해야 한다. 이 구현 자체가 외부 알림을 발송하지는 않는다.
- `account_withdrawal_worker_unavailable`은 DB 조회 등 worker 오류다. DB 연결 상태를 복구하면 다음 주기에 재개한다.
- 운영자는 서버 전용 DB 접근으로 남은 작업의 `phase`, `attempts`, `last_error`, `next_attempt_at`, `lease_until`을 확인한다. 키·권한·연결 문제를 수정한 후 자동 재시도를 기다린다. 원래 Auth가 사라졌거나 identity가 달라진 작업은 `AUTH_IDENTITY_CHANGED`로 남기며 저장된 Kakao ID만으로 재연결 계정을 unlink하지 않는다. 원인을 조사하지 않고 작업을 삭제하거나 강제로 완료 단계로 바꾸지 않는다.
- `account_withdrawals`는 RLS가 활성화되고 PUBLIC·anon·authenticated 권한이 제거되어 있다. 서버 DB 역할만 접근해야 한다.

## 검증 결과와 남은 확인

- Backend: lint·build 통과, 단위 테스트 79개, HTTP e2e 43개 통과. 접수 전 거절 사유 보존과 임의 Provider 정보 비노출 회귀 사례를 추가했다. 기존 PostgreSQL 통합 테스트 36개와 TypeScript 검사는 최초 구현 시 통과했다(탈퇴 통합 사례 13개 포함). 이후 변경은 HTTP 오류 표현과 Frontend에 한정되어 DB 통합 테스트는 반복하지 않았다.
- Prisma: client 생성과 schema 검증 완료, 개발 DB migration 적용 완료.
- Frontend: lint와 실제 Next 프로덕션 빌드 통과. 환경의 pnpm build 래퍼가 Turbopack 프로세스를 막아 `node node_modules/next/dist/bin/next build`로 동일한 Next 빌드를 실행했다.
- 브라우저: 실제 계정 관리 페이지·모달, 체크 전/후 버튼 상태, 재열기 초기화, 취소·ESC·포커스 복귀, 390px 모바일 레이아웃 확인. 후속 실제 요청 테스트에서 비활성 503의 사유가 공통 필터에서 사라지는 문제를 재현·수정했고 `탈퇴 요청을 접수하지 못했어요` 안내를 확인했다. 서버 삭제 단계는 실행되지 않았다. 로그인 상태의 이름 텍스트→계정 관리, 텍스트 로그아웃→홈의 `나그네님`, `나그네님`→로그인 화면 연결도 확인했다.
- 통합 테스트는 개발 DB의 매 실행 전용 두 테스트 사용자 범위에서 데이터를 생성·삭제하고 정리한다. Auth·카카오 호출은 테스트 대역을 사용한다. 외부 서비스에 실사용자 삭제 요청을 보내지 않는다.

전용 계정으로 확인할 남은 항목은 실제 Auth identity 형태·카카오 연결 해제와 callback 영향, Auth 사용자·세션·refresh token 삭제, 기존 토큰 거부, 같은 카카오로 재가입 후 빈 계정, 실제 여러 탭의 인증 정리다. 특히 외부 성공 직후 응답 유실/중단과 재로그인이 겹칠 때의 Provider 동작은 로컬 lease만으로 원격 실행을 취소할 수 없으므로 출시 전 검증해야 한다.

서비스 운영 DB 삭제와 기존 백업·인프라 로그 보존은 범위가 다르다. 기능 공개 전 백업 보존 기간과 복원 시 이미 삭제된 계정의 재노출을 막는 절차를 정하고 사용자 안내와 맞춰야 한다.

Provider 계약 참고: [Supabase Auth 삭제](https://supabase.com/docs/reference/javascript/auth-admin-deleteuser), [Supabase 사용자 관리](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users), [카카오 연결 해제](https://developers.kakao.com/docs/ko/kakaologin/rest-api#unlink), [카카오 오류 코드](https://developers.kakao.com/docs/ko/kakaologin/trouble-shooting).
