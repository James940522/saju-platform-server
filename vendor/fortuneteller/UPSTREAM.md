# fortuneteller 분석 패키지

이 디렉터리는 [hjsh200219/fortuneteller](https://github.com/hjsh200219/fortuneteller)의 원본 분석 함수와 필요한 데이터·타입을 포함하는 로컬 npm 포크다. 원본 commit은 [`1a930ad54c5342b855222e3aa304809b0ed587d5`](https://github.com/hjsh200219/fortuneteller/tree/1a930ad54c5342b855222e3aa304809b0ed587d5)로 고정했다. 원본 패키지 버전은 `1.2.0`, 서비스 패치 버전은 `1.2.0-sunnyeo.1`이다.

2026-09-14 npm 공식 registry 조회에서 `@hoshin/saju-mcp-server@1.2.0`은 E404였다. 따라서 게시되지 않은 패키지에 의존하거나 기존 서버 재구현을 유지하는 대신, 실제 원본 소스를 로컬 npm dependency로 설치했다. 원본 전체 MCP 서버를 실행하는 패키지와 구분해야 한다.

## 출처와 포함 범위

- [upstream.json](./upstream.json): 원본 리비전과 복사한 12개 파일의 패치 전 SHA-256.
- [UPSTREAM-README.md](./UPSTREAM-README.md): 원본 README 사본.
- [patches/0001-saved-chart-analysis.patch](./patches/0001-saved-chart-analysis.patch): 원본 대비 수정 사항. 저장소 원본 소스에 적용하는 경로 기준이다.
- `src/analysis.ts`: 서비스용 새 진입점. 분석 함수만 공개하고 MCP stdio 시작 코드와 원국 계산 함수는 노출하지 않는다.
- `src/lib/fortune.ts`는 원본 보존을 위해 다른 상품 함수도 파일 안에 남아 있지만 서비스는 `analyzeWealthFortune`만 호출한다.
- `src/lib/leap_month_analysis.ts`는 원본 용신 함수의 내부 의존성이며 달력 변환 함수가 아니다.
- 달력·출생시각 변환, `calculateSaju`, MCP 서버, 외부 API 및 다른 상품 module은 설치 범위에 포함하지 않았다. 이 패키지에는 네트워크 호출과 runtime dependency가 없다.

원본 README와 package metadata는 MIT를 명시한다. 해당 리비전에는 별도 LICENSE 파일이 없으므로 작성자·출처·원본 README와 라이선스 표기를 보존했으며, 존재하지 않는 원본 라이선스 문서를 만들어 넣지는 않았다. 패키지는 `private: true`이며 외부 npm에 게시하지 않는다.

## 적용한 패치

1. `PartialSajuData`를 추가해 `hour: null`을 표현한다. 전체 분석의 `SajuData`는 여전히 시주를 필수로 요구한다.
2. 십성 분포에서 일간 **위치**만 제외한다. 다른 기둥과 지장간의 동일 천간은 비견으로 집계한다. 시주가 없으면 남아 있는 시주 가중치도 집계하지 않는다.
3. 지장간 세력의 월 번호를 함수에 명시된 寅=0과 내부 지지 배열 子=0 사이에서 변환한다. 12개월 대응을 테스트한다.
4. 강약의 비겁·인성 `=== 1` 분기를 `>= 1`로 고쳐 1~2 사이 소수 가중치가 누락되지 않게 한다. 0보다 크고 1보다 작은 비겁은 0개로 단정하거나 무비겁 감점을 하지 않는다. 기존 첫 가점 구간에는 미달하므로 가점은 추가하지 않는다. 이는 버전이 있는 해석 정책이며 명리학의 정답으로 인증된 임계값은 아니다.
5. 기존 재물 분석 함수를 export하고 3주 입력을 허용한다. 미상자의 요약과 부재 표현을 관찰한 3주 범위로 제한한다. 그 외 원본 재물 분석 로직은 유지한다.

호출 순서는 adapter가 지장간 세력 → 십성 분포 → 월령 → 전체/부분 분석으로 명시한다. 원본 전체 원국 계산 경로는 지장간 세력보다 십성 집계가 먼저여서 기본 가중치 경로를 사용할 수 있다. 따라서 이번 분석 값은 원본 전체 `calculateSaju`의 출력과 같다고 보장하지 않는다. 사용자에게 표시되는 기존 만세력 Snapshot은 변경하지 않는다.

## 설치·빌드·배포

서버 package.json은 `"@hoshin/saju-mcp-server": "file:vendor/fortuneteller"`를 사용한다. package-lock.json과 vendor 소스·dist를 함께 관리한다.

```bash
npm ci
npm run build:fortuneteller
npm test
npm run build
```

`npm run build`의 prebuild에서 vendor를 컴파일한다. `dist`와 선언 파일을 저장소에 포함하므로 TypeScript 없는 운영 설치도 실행할 수 있다. 운영 이미지에는 서버 dist, production node_modules 외에 **vendor/fortuneteller 전체**도 복사해야 한다. npm의 로컬 dependency 링크가 이 경로를 가리킨다. vendor 수정 후에는 `npm run build:fortuneteller`로 산출물을 갱신하고 API·worker 프로세스를 재시작한다. 이 패키지에 API 키는 필요 없다.

원본을 갱신할 때 commit/hash/패치/패키지 버전을 함께 갱신하고 서버 adapter와 프롬프트 정책, 전체·부분 분석 회귀 테스트를 확인한다. 임의로 GitHub 최신 브랜치를 런타임에 받지 않는다.
