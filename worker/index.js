// Cloudflare Workers용 입구 파일.
// /api/kopis 요청만 이 코드가 처리하고, 나머지(화면 파일)는 site 폴더에서 바로 보내요.
// KOPIS 처리 코드는 Pages용과 같은 functions/api/kopis.js를 그대로 써요.
import { onRequestGet } from '../functions/api/kopis.js';

// 닷홈 2번 중계 주소. 비밀이 아니라서 코드에 적어 둬요. (인증키는 절대 여기 적지 마세요.)
// Cloudflare 설정에 KOPIS_RELAY를 따로 넣었고 그 값이 올바르면 그 값을 먼저 써요.
const DEFAULT_RELAY = 'https://concertrecap26b.dothome.co.kr/kopis.php';
function relayFrom(v) {
  let u = String(v || '').trim();
  if (u && !/^https?:\/\//i.test(u)) u = 'https://' + u;
  return /^https?:\/\/[^\s?#]+\.php$/i.test(u) ? u : DEFAULT_RELAY;
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/kopis' || pathname === '/api/kopis/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      }
      const e = Object.assign({}, env, { KOPIS_RELAY: relayFrom(env.KOPIS_RELAY) });
      return onRequestGet({ request, env: e, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: '없는 주소예요.' }), {
        status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
