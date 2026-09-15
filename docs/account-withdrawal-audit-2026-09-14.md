# 회원 탈퇴 점검 결과

점검일: 2026-09-14 (Asia/Seoul)

첨부 검토 내용의 10개 항목을 Backend 코드·테스트·migration, Frontend의 인증/API 호출 경계, 공식 문서, 로컬 `.env`의 설정 유무, 해당 개발 DB의 보안 메타데이터와 대조했다. 실제 카카오 연결 해제와 Supabase Auth 회원 삭제는 실행하지 않았다. 기존 회원의 개인정보나 인증키 값은 조회 결과에 출력하지 않았다.

## 판정

현재 코드에서 탈퇴 후 JWT를 서명만으로 신뢰하는 경로나 카카오 ID를 JavaScript `number`로 변환하는 문제는 발견하지 못했다. 개발 DB의 관련 6개 테이블도 브라우저 역할의 접근이 차단돼 있다. 다만 실 Provider 탈퇴 검증, 외부 연결 해제 웹훅, 회원 테이블 보안 설정의 migration 기록, 장기 실패·복원 운영 절차가 남아 있다.

| 첨부 항목 | 판정 | 확인 내용과 남은 작업 |
| --- | --- | --- |
| 1. 탈퇴 후 기존 JWT | 코드 방어 확인, 실제 토큰 검증 미완료 | 매 요청에서 Supabase `/auth/v1/user`를 호출한다. 가입은 잠금 후 재검증하고, 탈퇴 처리 중에는 회원 상태로 접근을 차단한다. 실제 삭제 전 JWT로 삭제 후 API를 재호출하는 테스트는 남았다. |
| 2. Kakao ID 정밀도 | 현재 구현 적합 | 인증 identity부터 작업 저장·unlink 요청까지 문자열이다. 응답의 JSON 정수도 원문에서 숫자 문자열을 추출한다. 최대 signed 64-bit 값 테스트가 있다. |
| 3. API 키와 웹훅 키 구분 | 웹훅 구현 시 필요 | 현재는 API 호출용 `KAKAO_ADMIN_KEY`만 있다. 웹훅 도입 시 대표 어드민 키와 앱 ID 검증 설정을 추가해야 한다. |
| 4. 외부 연결 해제 웹훅 | 미구현 | 카카오에서 먼저 연결을 끊거나 카카오계정을 삭제한 경우를 수신하는 endpoint가 없다. Kakao 연결 해제만으로 현재 Supabase 계정·앱 데이터 정리가 실행되지 않는다. |
| 5. Kakao ID 역조회 | 미구현 | 일반 회원에는 Provider ID 매핑이 없고 탈퇴 작업에만 ID가 임시 저장된다. 서버 전용 역조회 경로가 필요하다. DB 필드와 API JSON 필드의 이름은 구분해야 한다. |
| 6. 웹훅 3초 응답·영속 수신 | 미구현 | 기존 worker는 재사용할 수 있지만, 사용자 JWT가 필요한 탈퇴 진입점은 웹훅에서 그대로 호출할 수 없다. 수신 저장 실패에 대한 별도 복구 방안도 필요하다. |
| 7. 실제 어드민 키·권한·IP | 미확인 | 확인한 로컬 `.env`에는 `KAKAO_ADMIN_KEY`와 `SUPABASE_SERVICE_ROLE_KEY`가 없고 탈퇴 활성화 값도 없어 기본값 false가 적용된다. 카카오 콘솔과 배포 환경의 설정은 확인하지 않았다. |
| 8. Storage 소유 객체 | 현재 기능 범위 밖 | 현재 코드에는 Supabase Storage 업로드·조회 경로가 없다. 실제 버킷/객체 상태는 조회하지 않았다. 업로드 도입 시 Auth 삭제 전에 소유 객체 정리를 추가해야 한다. |
| 9. 실패 작업 보유·알림 | 부분 구현 | 성공하면 작업을 지운다. 5회 이상 실패 시 `needsAttention=true` 로그가 남지만 외부 경고 발송, 장기 미완료 처리 기한과 보유 기준은 없다. |
| 10. 백업 복원 | 운영 절차 미완료 | 기존 문서에서 위험은 인지하고 있으나 복원 시 삭제 재적용에 사용할 자료·담당·서비스 재개 조건이 정해져 있지 않다. |

## 우선 조치 사항

### 1. 회원 테이블의 현재 보안 설정을 migration에 기록

개발 DB에서 `users`, `user_consents`, `saju_profiles`, `saju_charts`, `saju_profile_creations`, `account_withdrawals` 모두 다음 상태를 확인했다.

- RLS 활성화.
- `anon`과 `authenticated`에 대한 SELECT/INSERT/UPDATE/DELETE 권한 없음.
- 이 6개 테이블에 허용 RLS policy 없음.
- 저장소의 migration 6개 모두 적용 완료.

그러나 저장소에서 RLS 활성화와 권한 회수를 재현하는 migration은 사주 저장 테이블 3개와 탈퇴 작업 테이블에만 있다. `20260908000000_create_users`와 `20260908120000_create_user_consents` 및 후속 migration에는 회원·동의 테이블의 같은 설정이 없다.

따라서 현재 개발 DB가 노출됐다는 결과는 아니다. **새 DB에 저장소 migration만 적용하면 현재 회원 테이블의 보안 상태가 보장되지 않는 배포 재현성 문제**다. Supabase의 schema 노출과 기본 grant 설정에 따라 직접 접근이 가능해질 수 있다. 두 테이블에 RLS와 PUBLIC/anon/authenticated 권한 회수를 적용하는 새 migration 및 해당 두 테이블에 대한 통합 검증이 필요하다. 기존 적용 migration은 수정하지 않는다.

현재 Frontend의 Supabase 사용은 OAuth, 세션, 로그인 콜백, 쿠키 갱신에 한정돼 있다. `src`에서 DB `.from()`/`.rpc()` 및 Storage 직접 호출 경로는 발견하지 못했다. 프론트가 직접 호출하지 않는다는 사실만으로 DB 접근 차단을 대신할 수는 없으므로 위 실 DB 권한 확인도 함께 수행했다. Supabase는 SQL로 생성한 노출 schema의 테이블에도 RLS를 명시적으로 설정하도록 안내한다. [공식 RLS 문서](https://supabase.com/docs/guides/database/postgres/row-level-security)

### 2. 외부 연결 해제 수신과 대상 매핑 추가

현재 `withdraw(subject, accessToken)`은 로그인한 본인의 요청을 위한 진입점이다. 웹훅에서는 사용자 JWT 없이 대표 어드민 키·앱 ID로 요청을 검증하고, 카카오 ID를 원래 Supabase UUID와 연결하는 별도 경로가 필요하다.

권장 구현 조건은 다음과 같다.

- 카카오 ID는 문자열로 유지하고 대표 어드민 키와 `app_id`를 함께 검증한다. API 호출용 키와 대표 키가 다를 수 있으므로 각 역할을 설정에 명시한다.
- 전체 Auth 사용자 목록을 매번 순회하지 않는 서버 전용 역조회를 사용한다. 앱 회원 행이 아직 없는 가입 미완료 Auth 계정까지 처리 범위에 포함한다. 로그인 후 첫 Backend 호출에서만 매핑을 만들면 그 호출 전 외부 연결 해제는 누락될 수 있다.
- 대상 UUID를 작업에 고정한다. 중복·지연 수신, 동시 서비스 탈퇴, 재가입과의 경합에서 새로운 계정을 과거 요청으로 삭제하지 않도록 검증한다.
- 사용자 상태 전환·앱 개인정보 정리·작업 저장을 일관되게 처리한다. 외부 unlink는 완료됐으므로 카카오 API를 다시 호출하지 않는 경로를 둔다.
- **현재 worker에 `phase=delete_auth` 작업만 삽입해서는 충분하지 않다.** 마지막 사용자 삭제는 `status=WITHDRAWN`을 조건으로 한다. 상태 전환을 생략하면 사용자 행은 남고 작업만 완료될 수 있다. 기존 접수 transaction을 공유하거나 필요한 단계를 명시적으로 추가해야 한다.
- 정상 수신에서는 처리할 내용을 영속 저장한 뒤 3초 안에 200을 반환하고 외부 삭제는 worker가 수행하도록 한다.

카카오는 연결 해제 웹훅에서 사용자가 없거나 처리 오류가 있어도 3초 안에 200 응답을 요구한다. 서비스가 unlink API를 호출한 경우에는 이 연결 해제 웹훅이 발송되지 않는다. [연결 해제 웹훅 규격](https://developers.kakao.com/docs/ko/kakaologin/callback#unlink-callback)

첨부 내용의 “재전송 없음”은 맞다. 현재 재전송 지원은 계정 상태 변경 웹훅에 한정된다. 따라서 **DB에 작업을 저장하기 전에 장애가 발생한 경우에는 기존 worker가 복구할 작업 자체가 없다.** 영속 수신 실패를 감지하는 경고와 누락 확인·복구 절차도 필요하며, 200 응답 또는 5xx 재전송에만 의존해서는 안 된다. 대안인 계정 상태 변경 웹훅을 선택한다면 별도의 SET 검증 규격을 구현해야 한다. [웹훅 재전송 정책](https://developers.kakao.com/docs/ko/getting-started/callback#retry)

### 3. 전용 계정으로 실제 Provider 계약 검증

확인한 로컬 설정에는 삭제에 필요한 두 키가 없다. 카카오 콘솔의 동일 앱 여부, 키 활성 상태, unlink API 허용, 서버 외부 통신 IP와 allowlist 일치 여부는 미확인이다. 키 설정은 서버 루트 `.env`에서 사용자가 관리한다. [카카오 어드민 키 설정](https://developers.kakao.com/docs/ko/app-setting/app#admin-key)

실제 테스트 계정으로 다음을 검증해야 한다.

1. Auth Admin 응답의 identity 형태와 문자열 카카오 회원번호 확인. 키·JWT·사용자 원문을 로그에 남기지 않는다.
2. 서비스 탈퇴 완료 후 카카오 연결, Supabase Auth 계정·세션·refresh token, 앱 데이터와 임시 작업 정리 확인.
3. 삭제 전 보관한 access token으로 `/v1/users/me`, 가입 완료, 프로필 조회·생성·수정 요청이 거부되는지 확인. 공개 API는 별도다.
4. 같은 카카오 계정으로 재가입한 회원이 이전 정보에 접근하지 못하는지 확인.
5. 카카오 성공 응답 유실, Auth 삭제 실패/응답 유실, 프로세스 재시작과 재로그인이 겹치는 경우 확인.
6. 웹훅 구현 후 외부 연결 해제와 가입 미완료 계정에 대해서도 같은 정리가 되는지 확인.

## 첨부 설명에서 보완할 두 부분

### JWT가 아직 유효하다는 사실과 Backend에서 허용한다는 것은 별개

Supabase는 Auth 삭제 후에도 이미 발급된 JWT가 `exp`까지 암호학적으로 유효할 수 있다고 안내한다. [사용자 삭제 문서](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)

현재 `src/modules/auth/supabase-auth.service.ts`는 매번 `/auth/v1/user`를 호출하고 401/403을 인증 실패로 바꾼다. `users.service.ts`는 가입 처리의 advisory lock 안에서 이를 다시 호출하고, `account-withdrawal.service.ts`의 접수 단계에도 동일한 재검증이 있다. 프로필 저장은 사용자 행 잠금과 active 상태 검사를 거친다.

확인한 Supabase Auth 공식 소스의 인증 경로는 JWT 서명 확인 후 실제 사용자와 session을 조회하며, 삭제돼 없으면 거부한다. 현재 구조에는 이 검증을 건너뛰는 로컬 JWT 인증 경로가 없다. 다만 공식 저장소의 소스 확인과 mock 기반 테스트는 사용 중인 배포 Provider에서의 실토큰 검증을 대신하지 않는다. [Supabase Auth 인증 구현](https://github.com/supabase/auth/blob/master/internal/api/auth.go)

Frontend `proxy.ts`의 `getClaims()`는 쿠키 갱신 경로이며 Backend의 최종 인가를 대체하지 않는다. 탈퇴 성공/접수 후 Query 취소·캐시 정리·로컬 인증 제거 코드도 존재한다. 실제 여러 탭과 브라우저의 동작은 이번 점검에서 재실행하지 않았다.

### `identity.provider_id`로 기계적으로 변경하면 안 됨

Supabase 문서의 identity 데이터 모델은 Provider 계정 ID를 `provider_id`, identity 자체 ID를 `id`라고 설명한다. [Identity 문서](https://supabase.com/docs/guides/auth/identities)

반면 확인한 공식 Auth 서버의 JSON 직렬화는 호환성을 위해 DB의 `provider_id`를 JSON `id`로, DB의 UUID `id`를 JSON `identity_id`로 반환한다. 따라서 현재 `AuthAccountAdminService.getKakaoIdentity()`가 **Auth Admin API 응답**의 `identity.id`를 읽는 구현은 공식 소스와 일치한다. DB를 직접 역조회할 때는 `provider='kakao' AND provider_id=...`를 사용해야 한다. 이 두 경계를 혼동해서 변경하지 않는다. [공식 identity 직렬화 구현](https://github.com/supabase/auth/blob/master/internal/models/identity.go)

카카오 ID는 `KakaoUserIdSchema`의 문자열 검증, Prisma `String @db.VarChar(20)`, `URLSearchParams`를 거친다. unlink 성공 응답도 JSON 전체를 숫자로 파싱하지 않아 정밀도 손실을 피한다. `auth-account-admin.service.spec.ts`의 `9223372036854775807` 사례가 통과했다.

## 운영 후속 항목

`account_withdrawals`는 성공 시 즉시 삭제된다. 실패 시 최대 1시간 간격으로 계속 재시도하며, 5회 이상에서 경고용 필드가 남는다. 실제 경고 전달·담당·장기 미완료 기한과 처리 절차는 정해져 있지 않다. 실패 작업을 기한만으로 버리면 외부 삭제가 누락되므로, 임의 TTL을 추가하기보다 원인 해결·개인정보 최소화·보유 기준을 함께 정해야 한다.

백업 복원 시 현재 DB와 작업 테이블도 과거 상태로 돌아갈 수 있다. 정상 완료 작업을 즉시 지우는 현재 구조에서 어떤 별도 기록을 근거로 삭제를 재적용할지 정해야 한다. 복원 후 서비스 개방 전에 삭제 대상 재확인·삭제 재적용·검증을 수행하는 운영 절차가 필요하다. 백업의 실제 보유기간과 플랜 설정은 이번 점검에서 확인하지 않았다. [Supabase 백업 문서](https://supabase.com/docs/guides/platform/backups)

Storage 객체를 소유한 사용자는 Auth 삭제가 실패할 수 있다. 현재 업로드 기능은 없지만 향후 도입 시 객체 삭제 또는 적절한 소유권 정리와 재시도 단계를 추가해야 한다. [Supabase 사용자 관리](https://supabase.com/docs/guides/auth/managing-user-data#deleting-users)

## 검증 결과와 범위

| 검증 | 결과 |
| --- | --- |
| `npm run lint` | 통과 |
| `npm test` | 15개 파일, 154개 테스트 통과 |
| `npm run test:e2e` | 5개 파일, 76개 테스트 통과 |
| `npm run test:integration -- --development-db` | 2개 파일, 37개 테스트 통과. 탈퇴 13개 사례 포함 |
| `npm run build` | 통과 |
| 개발 DB RLS·역할 권한·migration | 읽기 전용 메타데이터 조회로 확인 |
| 실제 카카오·Supabase Auth 삭제/기존 JWT | 미실행 |
| Frontend | 인증/API 호출 경계 정적 검토. 코드 수정·브라우저 재검증 없음 |

처음 HTTP e2e는 샌드박스의 포트 열기 제한으로 실패했으며, 제한 밖에서 동일 명령을 실행해 통과했다. 임시 독립 스키마를 사용하는 DB 통합 테스트는 개발 DB 역할의 CREATE SCHEMA 권한 부족으로 시작되지 않았다. 이후 저장소가 제공하는 개발 DB 전용 러너로 이번 실행의 임의 UUID 두 개에 한정한 합성 데이터를 사용했고, 테스트 종료 후 정리 완료를 확인했다. 카카오·Auth 삭제와 인증은 통합 테스트에서도 대역이다.

이번 변경 파일은 이 점검 문서뿐이다. Backend/Frontend 소스, API 계약, 환경변수, 실제 서비스 DB schema와 기존 회원 데이터는 변경하지 않았다.
