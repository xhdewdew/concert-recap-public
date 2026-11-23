/* 2026 CONCERT RECAP — Cloudflare Pages Function (/api/kopis)
   Vercel 판(api/kopis.js)과 같은 로직이에요. tools/make_cf.py가 자동으로 만들어요.
   환경변수(Cloudflare Pages → Settings → Variables and Secrets):
     KOPIS_API_KEY  KOPIS 인증키 (Secret으로)
     KOPIS_RELAY    국내 호스팅 중계 파일 주소 (예: https://아이디.dothome.co.kr/kopis.php) */


/* KOPIS 개발가이드(v5.0)상 오픈API는 http지만, 서버 위치에 따라 http가 막힐 수 있어서
   여러 길(http/https, www 유무)을 동시에 시험해 처음 응답한 길을 기억해 두고 쓴다.
   KOPIS는 해외 접속을 막는 것으로 보여서 함수는 서울 리전(icn1)에서 돌린다(vercel.json). */
const ROUTES = [
  { id: 'http://www', base: 'http://www.kopis.or.kr/openApi/restful' },
  { id: 'https://www', base: 'https://www.kopis.or.kr/openApi/restful' },
  { id: 'http://', base: 'http://kopis.or.kr/openApi/restful' },
  { id: 'https://', base: 'https://kopis.or.kr/openApi/restful' },
];
/* KOPIS가 클라우드 서버를 막아서, 국내 호스팅의 중계 파일(kopis.php)을 거쳐 부른다.
   Vercel 환경변수 KOPIS_RELAY = 중계 파일 주소(예: http://아이디.dothome.co.kr/kopis.php) */
let relayUrl = '';
function setRelay(env) {
  const u = String((env && env.KOPIS_RELAY) || '').trim();
  relayUrl = /^https?:\/\/[^\s?#]+$/.test(u) ? u : '';
}
const routes = () => (relayUrl ? [{ id: 'relay', relay: relayUrl }] : ROUTES);
const HEADERS = { 'User-Agent': 'Mozilla/5.0 (compatible; ConcertRecap/1.0)', Accept: 'application/xml, text/xml, */*' };
const TIMEOUT = 12000;
const POSTER_HOSTS = new Set(['www.kopis.or.kr', 'kopis.or.kr']);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate());

function toDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}
function decode(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}
function blocks(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>', 'g');
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}
function field(b, tag) {
  const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(b);
  return m ? decode(m[1]) : '';
}
const dash = (s) => (s || '').replace(/\./g, '-');

/* 실패 이유를 사람이 읽을 수 있게(키·주소는 절대 넣지 않는다) */
function netReason(e) {
  if (e && e.name === 'AbortError') return '응답 시간 초과';
  const c = e && e.cause && (e.cause.code || e.cause.name);
  return c ? '연결 실패 (' + String(c).slice(0, 40) + ')' : '연결 실패';
}
function kerr(msg, kind) { const e = new Error(msg); e.kind = kind; return e; }

async function fetchText(url, fetchImpl, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetchImpl(url, { signal: ctrl.signal, headers: HEADERS, redirect: 'follow' });
    return { r, xml: await r.text() };
  } catch (e) {
    throw kerr(netReason(e), 'net');
  } finally {
    clearTimeout(timer);
  }
}
function judge(r, xml) {
  if (!r.ok) { const e = kerr('KOPIS 응답 ' + r.status, 'http'); e.status = r.status; throw e; }
  if (!/<mt(20|10)id>/.test(xml) && /<(errmsg|returncode|returnreasoncode|returnauthmsg)>/i.test(xml)) {
    throw kerr('KOPIS: ' + (field(xml, 'errmsg') || field(xml, 'returnauthmsg') || '오류').slice(0, 120), 'kopis');
  }
  if (!/<dbs[\s>/]/.test(xml)) throw kerr('KOPIS가 예상과 다른 응답을 보냈어요', 'format');
  return xml;
}
function routeUrl(route, path, qs) {
  if (route.relay) return route.relay + '?path=' + encodeURIComponent(path).replace(/%2F/g, '/') + '&' + qs;
  return route.base + '/' + path + '?' + qs;
}
async function attempt(route, path, qs, fetchImpl, ms) {
  let res;
  try { res = await fetchText(routeUrl(route, path, qs), fetchImpl, ms || TIMEOUT); }
  catch (e) { if (route.relay) e.message = '중계 서버 ' + e.message; throw e; }
  if (route.relay && !res.r.ok && /json/.test((res.r.headers && res.r.headers.get && res.r.headers.get('content-type')) || '')) {
    let j = {}; try { j = JSON.parse(res.xml); } catch (e) { /* 무시 */ }
    throw kerr('중계 서버: ' + String(j.error || res.r.status).slice(0, 80) + (j.detail ? ' (' + String(j.detail).slice(0, 60) + ')' : ''), 'net');
  }
  return judge(res.r, res.xml);
}
/* 여러 실패 중 가장 쓸모 있는 이유: KOPIS가 직접 준 오류 > HTTP 상태 > 형식 > 연결 */
const RANK = { kopis: 0, http: 1, format: 2, net: 3 };
function best(errs) {
  return (errs || []).slice().sort((a, b) => (RANK[a.kind] ?? 9) - (RANK[b.kind] ?? 9))[0] || kerr('연결 실패', 'net');
}

let good = null;     // 이 서버 인스턴스에서 성공한 길
let probing = null;  // 동시에 여러 요청이 와도 길 찾기는 한 번만
function probe(key, fetchImpl) {
  if (!probing) {
    const qs = new URLSearchParams({ service: key, cpage: 1, rows: 1, shprfnmfct: '예술의전당' }).toString();
    probing = Promise.any(routes().map((rt) => attemptRetry(rt, 'prfplc', qs, fetchImpl).then(() => rt)))
      .then((rt) => { good = rt; return rt; }, (agg) => { throw best(agg.errors); })
      .finally(() => { probing = null; });
  }
  return probing;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/* KOPIS(또는 중계)는 한꺼번에 많이 부르면 400을 돌려줘서, 잠깐 쉬었다가 두 번까지 다시 부른다 */
async function attemptRetry(rt, path, qs, fetchImpl) {
  let last;
  for (let i = 0; i < 3; i++) {
    try { return await attempt(rt, path, qs, fetchImpl); }
    catch (e) {
      last = e;
      if (e.kind !== 'http' && e.kind !== 'format') throw e;
      if (i < 2) await sleep(350 * (i + 1) * (i + 1) + Math.floor(Math.random() * 200));
    }
  }
  throw last;
}
async function call(path, params, key, fetchImpl) {
  const qs = new URLSearchParams(Object.assign({ service: key }, params)).toString();
  const known = good;
  let rt = known || await probe(key, fetchImpl);
  try {
    return await attemptRetry(rt, path, qs, fetchImpl);
  } catch (e) {
    if (e.kind === 'kopis' || e.kind === 'http' || !known) throw e; // 방금 길을 찾았는데도 실패하면 다시 찾지 않음(시간 제한)
    if (good === rt) good = null;
    rt = await probe(key, fetchImpl);
    return attemptRetry(rt, path, qs, fetchImpl);
  }
}

/* 영어를 전부 소문자로 쳤을 때 KOPIS 검색이 대소문자를 가릴 수 있어서, 결과가 없으면 IMPULSE·Impulse로 한 번 더 */
function caseVariants(q) {
  if (!/[a-z]/.test(q) || /[A-Z]/.test(q)) return [];
  const title = q.replace(/(^|[\s\-_/])([a-z])/g, (m, a, b) => a + b.toUpperCase());
  return [...new Set([q.toUpperCase(), title])].filter((x) => x !== q);
}

function mapList(xml) {
  return blocks(xml, 'db').map((b) => ({
    id: field(b, 'mt20id'),
    title: field(b, 'prfnm'),
    from: dash(field(b, 'prfpdfrom')),
    to: dash(field(b, 'prfpdto')),
    venue: field(b, 'fcltynm'),
    poster: field(b, 'poster'),
    genre: field(b, 'genrenm'),
    state: field(b, 'prfstate'),
  })).filter((x) => x.id);
}
function mapDetail(xml) {
  const b = blocks(xml, 'db')[0] || '';
  return {
    id: field(b, 'mt20id'),
    title: field(b, 'prfnm'),
    from: dash(field(b, 'prfpdfrom')),
    to: dash(field(b, 'prfpdto')),
    venue: field(b, 'fcltynm'),
    cast: field(b, 'prfcast'),
    poster: field(b, 'poster'),
    genre: field(b, 'genrenm'),
    times: field(b, 'dtguidance'),
    state: field(b, 'prfstate'),
  };
}

function windows(query) {
  const d = toDate(query.date);
  if (d) {
    const a = new Date(d); a.setUTCDate(a.getUTCDate() - 15);
    const b = new Date(d); b.setUTCDate(b.getUTCDate() + 15);
    return [[ymd(a), ymd(b)]];
  }
  const y = /^\d{4}$/.test(query.year || '') ? +query.year : new Date().getUTCFullYear();
  const out = [];
  for (let m = 0; m < 12; m++) {
    const a = new Date(Date.UTC(y, m, 1));
    const b = new Date(Date.UTC(y, m + 1, 0));
    out.push([ymd(a), ymd(b)]);
  }
  return out;
}

/* 동시에 너무 많이 부르지 않도록 4개씩 */
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

/* 공연명에서 아티스트 이름 추정: "Xdinary Heroes Concert: IMPULSE [인천]" → "Xdinary Heroes"
   KOPIS 출연진에는 밴드·그룹 이름 대신 멤버 본명이 들어가는 경우가 많아서 쓴다. */
const T_GENERIC = /^(?:\d{4}|\d+(?:st|nd|rd|th)|concert|concerts|tour|world|asia|asian|national|arena|live|show|showcase|fan|fanmeeting|fancon|meeting|party|special|solo|encore|final|in|the|vol\.?\d*|seoul|busan|콘서트|단독|단독공연|단독콘서트|투어|전국투어|월드투어|아시아투어|팬미팅|팬콘|팬콘서트|쇼케이스|라이브|앙코르|앵콜|공연|스페셜|연말|소극장|서울|부산|대구|광주|대전|인천|수원|고양)$/i;
const T_CUT = /^(?:concert|tour|world|live|fanmeeting|fancon|showcase|콘서트|단독|단독공연|단독콘서트|투어|전국투어|월드투어|팬미팅|팬콘|쇼케이스|앙코르|앵콜|소극장|summer|winter|spring|autumn|christmas|holiday|year-end|yearend|썸머|윈터|크리스마스|연말)$/i;
function titleArtist(title) {
  let t = String(title || '');
  if (/festival|페스티벌|페스타|\bfest\b|락페|록페|합동|갈라/i.test(t)) return '';
  t = t.replace(/[\[(<〈《「『【][^\])>〉》」』】]*[\])>〉》」』】]/g, ' ');
  t = t.split(/\s*[:|–—]\s*|\s+-\s+/)[0];
  const words = t.trim().split(/\s+/).filter(Boolean);
  while (words.length && T_GENERIC.test(words[0])) words.shift();
  const cut = words.findIndex((w, i) => i > 0 && T_CUT.test(w));
  if (cut > 0) words.length = cut;
  while (words.length && T_GENERIC.test(words[words.length - 1])) words.pop();
  const out = words.join(' ').replace(/['’]s$/i, '').trim();
  return out.length >= 2 && out.length <= 30 ? out : '';
}

const normName = (s) => String(s || '').toLowerCase().replace(/[\s()（）\[\]·.,'"-]/g, '');

async function venues(query, key, fetchImpl) {
  const q = String(query.venue || '').trim().slice(0, 40);
  if (!q) return { status: 400, body: { error: '공연장 이름을 적어 주세요.' } };
  const xml = await call('prfplc', { cpage: 1, rows: 30, shprfnmfct: q }, key, fetchImpl);
  const results = blocks(xml, 'db').map((b) => ({
    id: field(b, 'mt10id'), name: field(b, 'fcltynm'), sido: field(b, 'sidonm'), gugun: field(b, 'gugunnm'), halls: Number(field(b, 'mt13cnt')) || 0,
  })).filter((x) => x.id && x.name);
  return { status: 200, body: { results }, cache: 'public, s-maxage=86400' };
}

async function place(id, key, fetchImpl) {
  if (!/^[A-Za-z0-9]{4,20}$/.test(id)) return { status: 400, body: { error: '잘못된 시설 ID예요.' } };
  const xml = await call('prfplc/' + id, {}, key, fetchImpl);
  const b = blocks(xml, 'db')[0] || '';
  const halls = blocks(b, 'mt13').map((h) => ({ name: field(h, 'prfplcnm'), seats: Number(field(h, 'seatscale')) || 0 })).filter((h) => h.name);
  return { status: 200, body: { id, name: field(b, 'fcltynm'), halls }, cache: 'public, s-maxage=86400' };
}

/* KOPIS에는 아티스트 목록이 따로 없어서, 이름이 들어간 공연을 찾고 그 출연진에서 고른다 */
async function artists(query, key, fetchImpl) {
  const q = String(query.artist || '').trim().slice(0, 40);
  if (!q) return { status: 400, body: { error: '아티스트 이름을 적어 주세요.' } };
  const wins = windows(query);
  const run = (term) => pool(wins, 2, ([st, ed]) =>
    call('pblprfr', { stdate: st, eddate: ed, cpage: 1, rows: 50, shprfnm: term }, key, fetchImpl).then(mapList).catch((e) => e));
  const seen = new Map();
  const errs = [];
  const take = (lists) => { for (const l of lists) { if (l instanceof Error) { errs.push(l); continue; } for (const x of l) if (!seen.has(x.id)) seen.set(x.id, x); } };
  take(await run(q));
  if (!seen.size) for (const v of caseVariants(q)) { take(await run(v)); if (seen.size) break; }
  if (!seen.size && errs.length) throw errs[0];
  const shows = [...seen.values()].slice(0, 6);
  const details = await pool(shows, 2, (x) => call('pblprfr/' + x.id, {}, key, fetchImpl).then(mapDetail).catch(() => null));
  const nq = normName(q);
  const names = new Map();
  const add = (name, n) => { const k = normName(name); if (k.length < 2) return; const cur = names.get(k); names.set(k, { name: cur ? cur.name : name, shows: (cur ? cur.shows : 0) + (n || 1) }); };
  /* 1) 공연명에서 아티스트 이름 (밴드·그룹은 출연진에 멤버 본명만 있는 경우가 많음) */
  for (const x of seen.values()) {
    const ta = titleArtist(x.title);
    const k = normName(ta);
    if (ta && (k.includes(nq) || nq.includes(k))) { add(ta); continue; }
    const i = x.title.toLowerCase().indexOf(q.toLowerCase());
    if (i >= 0) add(x.title.substr(i, q.length));
  }
  /* 2) 출연진에서 이름이 맞는 사람 */
  for (const d of details) {
    if (!d || !d.cast) continue;
    for (const raw of d.cast.replace(/\s*등\s*$/, '').split(/\s*[,，]\s*/)) {
      const name = raw.trim();
      if (!name || name.length > 40) continue;
      const k = normName(name);
      if (!k.includes(nq) && !nq.includes(k)) continue;
      add(name);
    }
  }
  /* "Xdinary Heroes Summer"는 "Xdinary Heroes"로 합치고, 다른 이름에 들어 있는 조각("Heroes")은 뺀다 */
  const list = [...names.entries()];
  for (const [k, v] of list) {
    const base = list.find(([k2]) => k2 !== k && k.startsWith(k2) && names.has(k2));
    if (base && names.has(k)) { names.get(base[0]).shows += v.shows; names.delete(k); }
  }
  for (const [k] of [...names.entries()]) {
    if ([...names.keys()].some((k2) => k2 !== k && k2.includes(k))) names.delete(k);
  }
  return { status: 200, body: { results: [...names.values()].sort((a, b) => b.shows - a.shows), showCount: seen.size }, cache: 'public, s-maxage=3600' };
}

async function search(query, key, fetchImpl) {
  const q = String(query.q || '').trim().slice(0, 60);
  if (!q) return { status: 400, body: { error: '공연명을 적어 주세요.' } };
  const wins = windows(query);
  const seen = new Map();
  const errs = [];
  const run = async (term) => {
    const lists = await pool(wins, 2, ([st, ed]) =>
      call('pblprfr', { stdate: st, eddate: ed, cpage: 1, rows: 100, shprfnm: term }, key, fetchImpl).then(mapList).catch((e) => e));
    for (const l of lists) { if (l instanceof Error) { errs.push(l); continue; } for (const x of l) if (!seen.has(x.id)) seen.set(x.id, x); }
  };
  await run(q);
  if (!seen.size) for (const v of caseVariants(q)) { await run(v); if (seen.size) break; }
  if (!seen.size && errs.length) throw errs[0];
  return { status: 200, body: { results: [...seen.values()].slice(0, 40) }, cache: 'public, s-maxage=3600' };
}

/* 연결 점검: 모든 길을 동시에 시험하고 결과만 보여 준다(키·주소의 키 부분은 응답에 넣지 않음) */
async function check(key, fetchImpl) {
  const qs = new URLSearchParams({ service: key, cpage: 1, rows: 1, shprfnmfct: '예술의전당' }).toString();
  const one = async (id, fn) => {
    const t0 = Date.now();
    try { const out = await fn(); return Object.assign({ id, ok: true, ms: Date.now() - t0 }, out || {}); }
    catch (e) { return { id, ok: false, ms: Date.now() - t0, reason: e.message }; }
  };
  const page = (url) => async () => { const { r } = await fetchText(url, fetchImpl, 20000); return { status: r.status }; };
  const rs = routes();
  const tests = rs.map((rt) => one('api ' + rt.id, async () => { await attempt(rt, 'prfplc', qs, fetchImpl, 20000); good = good || rt; }))
    .concat(relayUrl ? [one('relay ping', async () => {
      const { r, xml } = await fetchText(relayUrl + '?ping=1', fetchImpl, 20000);
      let j = {}; try { j = JSON.parse(xml); } catch (e) { throw kerr('중계 파일이 아니에요 (응답 ' + r.status + ')', 'format'); }
      return { reachable: !!j.reachable, status: j.status, error: j.error || '' };
    })] : [])
    .concat([
      one('home https://www', page('https://www.kopis.or.kr/')),
      one('home http://www', page('http://www.kopis.or.kr/')),
      one('control', page('https://www.google.com/generate_204')),
    ]);
  const results = await Promise.all(tests);
  return { ok: results.slice(0, rs.length).some((x) => x.ok), using: good ? good.id : null, results };
}

async function handle(query, env, fetchImpl) {
  const key = env.KOPIS_API_KEY;
  const before = relayUrl;
  setRelay(env);
  if (relayUrl !== before) { good = null; probing = null; }
  if (query.health) {
    const body = { enabled: !!key, region: env.VERCEL_REGION || null, relay: !!relayUrl };
    if (query.check && key) body.check = await check(key, fetchImpl);
    return { status: 200, body };
  }
  if (!key) return { status: 503, body: { error: 'KOPIS 인증키(KOPIS_API_KEY)가 설정되지 않았어요.' } };
  if (query.venue) return venues(query, key, fetchImpl);
  if (query.place) return place(query.place, key, fetchImpl);
  if (query.artist) return artists(query, key, fetchImpl);
  if (query.id) {
    if (!/^[A-Za-z0-9]{4,20}$/.test(query.id)) return { status: 400, body: { error: '잘못된 공연 ID예요.' } };
    const xml = await call('pblprfr/' + query.id, {}, key, fetchImpl);
    return { status: 200, body: mapDetail(xml), cache: 'public, s-maxage=86400' };
  }
  return search(query, key, fetchImpl);
}


/* ---------- Cloudflare 전용 ---------- */
const SUBREQ_LIMIT = 45; // 무료 플랜은 요청 1번에 바깥 호출 50번까지

async function posterResponse(url, fetchImpl) {
  let u;
  try { u = new URL(url); } catch (e) { return json(400, { error: '잘못된 주소예요.' }); }
  if (!/^https?:$/.test(u.protocol) || !POSTER_HOSTS.has(u.hostname)) return json(400, { error: 'KOPIS 포스터만 가져올 수 있어요.' });
  const tries = relayUrl ? [relayUrl + '?img=' + encodeURIComponent(u.toString())] : ['http:', 'https:'].map((p) => { u.protocol = p; return u.toString(); });
  for (const t of tries) {
    try {
      const r = await fetchImpl(t, { headers: HEADERS });
      const type = r.headers.get('content-type') || '';
      if (!r.ok || !type.startsWith('image/')) continue;
      const buf = await r.arrayBuffer();
      if (buf.byteLength > 5 * 1024 * 1024) return json(413, { error: '포스터가 너무 커요.' });
      return new Response(buf, { status: 200, headers: { 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
    } catch (e) { /* 다음 방법으로 */ }
  }
  return json(502, { error: '포스터를 가져오지 못했어요.' });
}

function json(status, body, cache) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-store', 'X-Content-Type-Options': 'nosniff' },
  });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  const cacheable = !!cache && !query.health;
  if (cacheable) {
    try { const hit = await cache.match(request); if (hit) return hit; } catch (e) { /* 캐시 없이 */ }
  }
  let n = 0;
  const limited = (u, o) => (++n > SUBREQ_LIMIT
    ? Promise.reject(Object.assign(new Error('too many subrequests'), { name: 'Budget' }))
    : fetch(u, o));
  setRelay(env);
  let res;
  try {
    if (query.poster) res = await posterResponse(query.poster, limited);
    else {
      const out = await handle(query, env, limited);
      res = json(out.status, out.body, out.cache);
    }
  } catch (e) {
    res = json(502, { error: 'KOPIS에 연결하지 못했어요.', reason: e && e.kind ? e.message : '알 수 없는 오류' });
  }
  if (cacheable && res.status === 200 && /max-?age/.test(res.headers.get('Cache-Control') || '')) {
    try { context.waitUntil(cache.put(request, res.clone())); } catch (e) { /* 무시 */ }
  }
  return res;
}

export const _test = { handle, setRelay, titleArtist, caseVariants, reset: () => { good = null; probing = null; relayUrl = ''; } };
