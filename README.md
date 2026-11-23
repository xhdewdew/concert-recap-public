# 2026 CONCERT RECAP — 배포용 (Cloudflare)

친구용(Vercel)과 완전히 따로 돌아가는 배포용 사이트예요. 화면과 기능은 같아요.

| 구분 | 친구용 | 배포용 (이 저장소) |
| --- | --- | --- |
| 호스팅 | Vercel | Cloudflare (Workers 또는 Pages) |
| 코드 | 원래 GitHub 저장소 | 이 저장소 |
| KOPIS 중계 | 닷홈 1번 | 닷홈 2번(없으면 1번을 같이 써도 됨) |
| 무료 한도 | Vercel 계정 | Cloudflare 계정 (페이지 요청 무제한, 서버 호출 하루 10만 번) |

## 폴더

```
site/                 사이트 파일 (Cloudflare가 이 폴더를 그대로 올려요)
  _headers            보안·캐시 헤더
functions/api/kopis.js  KOPIS를 대신 불러 주는 서버 함수 (/api/kopis)
worker/index.js       Workers로 만들었을 때의 입구 (위 함수를 그대로 씀)
wrangler.jsonc        Workers 설정 (Worker 이름)
```

Cloudflare **Workers**로 만들어도, **Pages**로 만들어도 둘 다 돌아가요.

`functions/api/kopis.js`는 친구용 `api/kopis.js`와 같은 로직으로 자동 생성돼요(키는 코드에 없음).

## Cloudflare Workers 설정 (지금 쓰는 방식)

1. **Workers & Pages** → **Create application** → GitHub 저장소 가져오기 → 이 저장소 선택
2. Worker 이름은 `wrangler.jsonc`의 `"name"`(지금 `concertrecap2026`)과 똑같아야 해요. 다르면 둘 중 하나를 맞춰요.
3. Build command 비워 둠 · Deploy command `npx wrangler deploy` (기본값)
4. 배포 뒤 Worker → **Settings** 맨 위쪽 **Variables and Secrets** → **Add** → Type **Secret**, 이름 `KOPIS_API_KEY`, 값 = KOPIS 인증키 → **Deploy**
   - 아래쪽 **Build** 묶음 안의 *Variables and secrets*는 빌드할 때만 쓰는 칸이라 여기에 넣으면 안 돼요.
5. 중계 주소는 `worker/index.js`의 `DEFAULT_RELAY`에 적혀 있어요. 중계를 바꾸려면 그 줄만 고쳐서 올리면 돼요.

주소: `https://concertrecap2026.(내 계정 이름).workers.dev`

## Cloudflare Pages 설정 (Pages로 만들 때)

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. **GitHub** 연결 → 이 저장소 선택 → **Begin setup**
3. **Project name**: 원하는 이름 (주소가 `이름.pages.dev`가 돼요)
4. **Framework preset**: None · **Build command**: 비워 둠 · **Build output directory**: `site`
5. **Environment variables**
   - `KOPIS_API_KEY` = KOPIS 인증키
   - `KOPIS_RELAY` = 닷홈 중계 파일 주소 (예: `https://아이디.dothome.co.kr/kopis.php`)
6. **Save and Deploy**

환경 변수를 나중에 바꾸면: 프로젝트 → **Deployments** → 최신 배포 **⋯** → **Retry deployment**.

## 연결 점검

`https://사이트주소/api/kopis?health=1&check=1` → `"ok":true`, `"using":"relay"`면 정상이에요. 키는 응답에 나오지 않아요.

## 사이트 고치기

이 저장소에 새 파일을 올리면(Commit) Cloudflare가 자동으로 다시 배포해요. 친구용 사이트에는 영향이 없어요.

## 무료로 쓰는 범위

- Cloudflare: 화면 파일 요청은 무제한·무료, KOPIS 서버 호출(/api/kopis)만 하루 100,000번까지 무료(UTC 자정 초기화). 카드를 등록하지 않으면 요금이 나가지 않아요.
- 요청 한 번에 바깥 호출 50번 제한이 있어서, 함수가 한 번에 최대 45번까지만 KOPIS를 부르도록 해 뒀어요.
- 같은 검색은 1시간 동안 Cloudflare 캐시에서 바로 돌려줘요(내 도메인을 연결했을 때. `workers.dev` 주소에서는 캐시가 꺼져 있어요).
- 닷홈 무료호스팅: 월 트래픽 15GB, 6개월마다 연장 신청.
