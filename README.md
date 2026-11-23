# 2026 CONCERT RECAP — 배포용 (Cloudflare Pages)

친구용(Vercel)과 완전히 따로 돌아가는 배포용 사이트예요. 화면과 기능은 같아요.

| 구분 | 친구용 | 배포용 (이 저장소) |
| --- | --- | --- |
| 호스팅 | Vercel | Cloudflare Pages |
| 코드 | 원래 GitHub 저장소 | 이 저장소 |
| KOPIS 중계 | 닷홈 1번 | 닷홈 2번(없으면 1번을 같이 써도 됨) |
| 무료 한도 | Vercel 계정 | Cloudflare 계정 (페이지 요청 무제한, 서버 호출 하루 10만 번) |

## 폴더

```
site/                 사이트 파일 (Cloudflare가 이 폴더를 그대로 올려요)
  _headers            보안·캐시 헤더
functions/api/kopis.js  KOPIS를 대신 불러 주는 서버 함수 (/api/kopis)
```

`functions/api/kopis.js`는 친구용 `api/kopis.js`와 같은 로직으로 자동 생성돼요(키는 코드에 없음).

## Cloudflare Pages 설정

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

`https://이름.pages.dev/api/kopis?health=1&check=1` → `"ok":true`, `"using":"relay"`면 정상이에요. 키는 응답에 나오지 않아요.

## 사이트 고치기

이 저장소에 새 파일을 올리면(Commit) Cloudflare가 자동으로 다시 배포해요. 친구용 사이트에는 영향이 없어요.

## 무료로 쓰는 범위

- Cloudflare Pages: 정적 파일 요청 무제한·무료, 서버 함수(Pages Functions) 하루 100,000번 무료(UTC 자정 초기화). 카드를 등록하지 않으면 요금이 나가지 않아요.
- 요청 한 번에 바깥 호출 50번 제한이 있어서, 함수가 한 번에 최대 45번까지만 KOPIS를 부르도록 해 뒀어요.
- 같은 검색은 1시간 동안 Cloudflare 캐시에서 바로 돌려줘서 KOPIS·닷홈 사용량을 줄여요.
- 닷홈 무료호스팅: 월 트래픽 15GB, 6개월마다 연장 신청.
