# 사용 중지한 서버 자체 재물 분석

2026-09-14 사용자의 요청에 따라 이전 자체 구현 3개와 대응 테스트 3개를 보관했다. 각 원본 줄 앞에 `// `를 붙였으며 확장자도 `.ts.disabled`로 바꿨다. 서버 import·빌드·테스트 경로에서 제외되어 실행되지 않는다.

| 보관 파일 | 기존 역할 |
| --- | --- |
| `saju-reading-facts.ts.disabled` | 자체 지장간·삼합 파생 |
| `wealth-ranking-analysis.ts.disabled` | 자체 재물 성향 분류 |
| `fortuneteller-analysis.ts.disabled` | 원본을 참고한 자체 강약·용신 후보 등 분석 |
| 위 이름의 `.spec.ts.disabled` 3개 | 해당 구현의 과거 테스트 |
| [analysis-documentation.md](./analysis-documentation.md) | 교체 전 동작 설명과 검증 이력 |

현재 실행 코드는 [설치된 원본 패키지](../../vendor/fortuneteller/UPSTREAM.md)와 [서버 adapter](../../src/modules/readings/infrastructure/fortuneteller-analysis.adapter.ts)다. [현재 연결 문서](../../docs/fortuneteller-analysis.md)를 기준으로 판단한다.

보관 코드는 자동 fallback이 아니다. 되돌릴 필요가 생기면 앞의 설명 2줄을 제외하고 각 줄의 첫 `// `만 제거하여 복원한 뒤 당시 타입·프롬프트·테스트를 함께 검토해야 한다. 현재 코드에 단순히 import를 추가해서 두 분석을 동시에 사용하면 안 된다.
