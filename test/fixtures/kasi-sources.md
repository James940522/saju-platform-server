# KASI 독립 검증 자료

2026-09-14에 승인된 특일정보 인증키로 공개 연도별 자료를 수신했다. 실제 사용자 정보, 인증키, 요청 URL 쿼리, Provider 오류 원문은 저장하지 않았다.

- 출처: [한국천문연구원 특일정보](https://www.data.go.kr/data/15012690/openapi.do)
- 메서드: `SpcdeInfoService/get24DivisionsInfo`
- 파라미터: `solYear=2018` 또는 `2019`, `numOfRows=100`, `pageNo=1`
- HTTP 200, `resultCode=00`, 각 연도 24건
- 원문에서 `dateKind`, `dateName`, `kst`, `locdate`, `sunLongitude`만 선택하고 성공 header와 totalCount를 유지한 XML이다. 선택 필드의 값은 바꾸지 않았다.

| 파일 | SHA-256 |
| --- | --- |
| `kasi-solar-terms-2018.xml` | `946bc1209f5427dc110d2f8076d569538aeb07616b74548032d29d488d7dc1aa` |
| `kasi-solar-terms-2019.xml` | `7853f95d2003108220126c6e98cfe04f1ae765ab7db24f70366b09a99373c394` |

2019년 대한의 `kst=1760`은 실제 응답의 잘못된 시각 표기다. 이를 18:00으로 고치지 않았다. 대한은 월주 전환을 결정하지 않는 중기이므로 현재 adapter는 연주·월주 검증에 필요한 **12절**의 날짜·시각·황경을 검증한다. 같은 오류가 12절에 있다면 해당 연도의 대조를 `unavailable`로 처리한다. 이 fixture를 24절기 전체가 올바른 자료라고 표현해서는 안 된다.

1992년 조회는 HTTP 200, `resultCode=00`, `totalCount=0`이었다. 이를 지원 범위 전체에 대한 결론으로 일반화하지 않으며, 반환 자료가 없으면 `no_data` 상태로 처리한다.

기존 `kasi-calendar.provider.spec.ts`의 월 XML은 `manseryeok`로 만든 합성 통신 fixture다. 위 독립 공식 절기 fixture와 검증 목적이 다르다.
