// Cloudflare Workers용 입구 파일.
// /api/kopis 요청만 이 코드가 처리하고, 나머지(화면 파일)는 site 폴더에서 바로 보내요.
// KOPIS 처리 코드는 Pages용과 같은 functions/api/kopis.js를 그대로 써요.
import { onRequestGet } from '../functions/api/kopis.js';

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api/kopis' || pathname === '/api/kopis/') {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET' } });
      }
      return onRequestGet({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
    }
    if (pathname.startsWith('/api/')) {
      return new Response(JSON.stringify({ error: '없는 주소예요.' }), {
        status: 404, headers: { 'Content-Type': 'application/json; charset=utf-8' },
      });
    }
    return env.ASSETS.fetch(request);
  },
};
