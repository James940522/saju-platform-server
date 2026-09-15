# 2026-09-15 브라우저 startTime 오류와 풀이 대기 진단

## 확인한 상태

작업 `641434f6-992f-4302-8be6-0cf628c693b5`는 00:50:46 UTC에 접수됐고 01:02:06 UTC 조회 시에도 queued였다. startedAt, leaseUntil, completedAt은 null이다. 약 680초 동안 워커가 실행을 시작하지 않았으며 Kie 호출 단계까지 도달하지 않았다. 실행 중인 다른 풀이도 없었다.

API 프로세스는 전날부터 약 10시간 실행 중이었고 health는 22ms에 HTTP 200을 반환했다. DB를 새 연결로 조회하는 것도 성공했다. 기존 프로세스에는 서로 다른 로컬 IP로 생성된 DB TCP 연결이 함께 남아 있었다. 네트워크 변경 또는 절전 후의 오래된 연결이 원인일 가능성이 높지만, 당시 JS await 위치나 TCP 패킷을 캡처하지 않았으므로 특정 소켓이 원인임을 확정하지는 않는다.

기존 워커는 DB await가 끝나기 전까지 polling=true를 유지한다. 뒤의 tick은 이를 확인하고 즉시 반환한다. DB 연결과 쿼리에 제한이 없으면 작업 조회뿐 아니라 5분 만료 정리도 함께 멈출 수 있다. 이 상태를 직접 표시하는 로그도 없었다.

## 수정

- Prisma의 실제 pg adapter에 연결/풀 획득 제한 5초, 쿼리 응답 대기 제한 15초와 TCP keepalive를 설정했다.
- 워커가 DB 응답을 10초 이상 기다리면 reading_jobs_poll_waiting에 단계와 경과 시간을 기록한다. 중복 tick을 실행하지 않는다.
- DB 호출이 거절되면 단계가 포함된 reading_job_worker_unavailable 로그를 남기고, finally에서 polling 잠금을 해제해 다음 tick이 다시 시도한다.
- 시작 시 reading_jobs_worker_configured에서 활성 여부와 주기를 확인할 수 있다.

클라이언트의 query_timeout은 SQL 실행 결과 자체를 보장하지 않는다. 예를 들어 연결이 끊어진 쓰기 요청의 결과는 불확실할 수 있어 기존의 lease 조건·idempotency·트랜잭션 검증을 유지한다. Promise.race만으로 잠금을 풀고 중복 DB 작업을 실행하는 방식은 사용하지 않았다. AI 모델·프롬프트·5분 작업 제한·공개 API와 DB 스키마는 변경하지 않았다.

## 브라우저 오류

제공된 et.reportAllChanges → n.timeout 및 익명 스크립트 위치가 [GoogleChrome/web-vitals #792](https://github.com/GoogleChrome/web-vitals/issues/792)의 보고와 일치한다. 해당 보고는 Chrome DevTools의 성능 측정용 주입 스크립트에서 soft navigation 후 발생하는 오류를 설명한다. 프로젝트 src에는 reportAllChanges나 startTime을 직접 사용하는 코드가 없고 Sentry도 설치돼 있지 않다.

따라서 DevTools 성능 측정 코드에서 발생했을 가능성이 높다. 이번 브라우저 세션에서 원래 예외를 다시 캡처하지는 못했으므로 출처를 완전히 확정하지 않았다. 프론트엔드 앱 코드나 브라우저 플래그를 임의로 변경하지 않았다. DB에서 확인한 서버 작업의 queued 정체는 별도 문제다.

## 검증

실제 PrismaService와 pg adapter를 로컬 가짜 PostgreSQL 서버에 연결해, 접속 후 handshake 무응답과 인증 후 쿼리 무응답을 각각 재현했다. 두 경우 모두 제한 내 오류가 반환되고 다음 요청은 새 연결을 생성했다. 실제 DB 데이터를 수정하거나 Kie를 호출하지 않았다.

워커 테스트는 DB 대기 중 단계 로그, 중복 polling 차단, DB 실패 후 다음 polling 재개를 확인한다. lint, 단위 테스트 262개, e2e 101개, build를 실행했다. 운영 환경의 절전/네트워크 전환을 그대로 재현한 검증은 아니므로 재발 시 단계 로그를 기준으로 추가 확인한다.

참고: [node-postgres Client 설정](https://node-postgres.com/apis/client), [Pool 연결 대기](https://node-postgres.com/apis/pool).
