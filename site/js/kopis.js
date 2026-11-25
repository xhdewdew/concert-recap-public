/* KOPIS 공연 찾기: 캡처에서 읽은 공연명·날짜·공연장으로 후보를 찾고 점수를 매긴다. */
(function (factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { window.CR = window.CR || {}; window.CR.kopis = m; }
})(function () {
  'use strict';

  const GENERIC = new Set(['2024', '2025', '2026', '2027', '콘서트', 'concert', '투어', 'tour', 'live', '라이브', 'in', 'seoul', '서울',
    '단독', '공연', 'the', 'world', 'asia', '아시아', '월드', '팬미팅', 'fanmeeting', 'fan', 'meeting', '앵콜', 'encore', 'busan', '부산',
    'vol', 'season', '시즌', 'and', 'with', 'of', '예매', '티켓', 'ticket', 'nol', '인터파크', '티켓링크', '멜론티켓', 'yes24']);
  const STRIP = /[\s\[\]\(\)〈〉<>《》「」『』【】'"“”‘’.,:;!?~\-–—_·•/\\|#&+*]/g;
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(STRIP, '');
  const clean = (t) => String(t || '').replace(/[〈〉<>《》「」『』【】\[\]()"'“”‘’:|·•\-–—_~!?,.]/g, ' ').replace(/\s+/g, ' ').trim();

  function keywords(title, max) {
    const c = clean(title);
    const out = [];
    const toks = c.split(' ').filter((w) => {
      const l = w.toLowerCase();
      if (GENERIC.has(l) || /^\d+$/.test(w)) return false;
      return /[가-힣]/.test(w) ? w.length >= 2 : w.length >= 3;
    });
    const core = toks.join(' ');
    if (core && core.length <= 40) out.push(core);
    toks.slice().sort((a, b) => b.length - a.length).forEach((t) => {
      if (!out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    });
    return out.slice(0, max || 3);
  }

  function dayDiff(a, b) {
    const pa = a.split('-').map(Number), pb = b.split('-').map(Number);
    return Math.round((Date.UTC(pb[0], pb[1] - 1, pb[2]) - Date.UTC(pa[0], pa[1] - 1, pa[2])) / 864e5);
  }

  function score(c, info) {
    let s = 0;
    const toks = clean(info.title).split(' ').filter((w) => w.length >= 2 && !GENERIC.has(w.toLowerCase()) && !/^\d+$/.test(w));
    const ct = norm(c.title);
    if (toks.length) {
      const hit = toks.filter((t) => ct.includes(norm(t))).length;
      s += 12 * (hit / toks.length);
    }
    if (info.date && c.from && c.to) {
      if (info.date >= c.from && info.date <= c.to) s += 8;
      else if (Math.min(Math.abs(dayDiff(info.date, c.from)), Math.abs(dayDiff(info.date, c.to))) <= 7) s += 2;
    }
    const v = norm(info.venue), cv = norm(c.venue);
    if (v.length >= 2 && cv && (cv.includes(v) || v.includes(cv))) s += 5;
    if (/대중음악/.test(c.genre || '')) s += 1;
    return Math.round(s * 10) / 10;
  }

  function rank(cands, info) {
    const list = (cands || []).map((c) => Object.assign({}, c, { score: score(c, info || {}) }))
      .sort((a, b) => b.score - a.score || (a.from || '').localeCompare(b.from || ''));
    const top = list[0], second = list[1];
    const confident = !!top && top.score >= 12 && (!second || top.score - second.score >= 3);
    return { list, confident };
  }

  /* 공연 기간의 날짜 목록. 너무 길면(오픈런 등) null */
  function days(from, to, max) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')) return null;
    const n = dayDiff(from, to);
    if (n < 0 || n + 1 > (max || 14)) return null;
    const [y, m, d] = from.split('-').map(Number);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const dt = new Date(Date.UTC(y, m - 1, d + i));
      out.push(dt.getUTCFullYear() + '-' + String(dt.getUTCMonth() + 1).padStart(2, '0') + '-' + String(dt.getUTCDate()).padStart(2, '0'));
    }
    return out;
  }

  function castList(s) {
    return String(s || '').replace(/\s*등\s*$/, '').split(/\s*[,，]\s*/).map((x) => x.trim()).filter((x) => x && x.length <= 40).slice(0, 12);
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

  /* KOPIS 공연을 골랐을 때 채울 아티스트: 공연명에 나오는 출연진 > 공연명에서 추정한 이름 > 출연진 */
  function pickArtists(title, cast) {
    const names = castList(cast);
    const nt = norm(title);
    const inTitle = names.filter((n) => norm(n).length >= 2 && nt.includes(norm(n)));
    if (inTitle.length) return inTitle;
    const ta = titleArtist(title);
    if (ta) return [ta];
    return names;
  }

  /* ---- 브라우저에서만 ---- */
  /* 서버(무료 요금제) 호출 줄이기
     - 같은 요청은 이 기기에 12시간 저장해 두고 다시 쓴다
     - 하루 무료 사용량이 다 차면(Cloudflare 1027) 다음 날 오전 9시까지 서버를 부르지 않는다 */
  const CACHE_KEY = 'concert-recap-kopis-cache';
  const LIMIT_KEY = 'concert-recap-kopis-limit';
  const HEALTH_KEY = 'concert-recap-kopis-on';
  const TTL = 12 * 3600 * 1000;
  const tr = (s) => (typeof window !== 'undefined' && window.CR && window.CR.i18n ? window.CR.i18n.tr(s) : s);
  const LIMIT_MSG = tr('오늘 자동 불러오기 사용량이 다 찼어요. 오전 9시에 다시 열려요. 직접 입력은 지금도 돼요.');
  const ls = {
    get(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 공간 없음 */ } },
  };
  const mem = new Map();
  function cacheGet(key) {
    const hit = mem.get(key) || (ls.get(CACHE_KEY) || {})[key];
    return hit && Date.now() - hit.at < TTL ? hit.v : null;
  }
  function cachePut(key, v) {
    const e = { at: Date.now(), v };
    mem.set(key, e);
    const all = ls.get(CACHE_KEY) || {};
    all[key] = e;
    const keys = Object.keys(all).sort((a, b) => all[b].at - all[a].at);
    for (const k of keys.slice(60)) delete all[k]; // 최근 60개만
    ls.set(CACHE_KEY, all);
  }
  function limited() { const u = ls.get(LIMIT_KEY); return u && Date.now() < u ? LIMIT_MSG : ''; }
  function markLimited() {
    const d = new Date();
    ls.set(LIMIT_KEY, Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)); // 다음 UTC 0시 = 한국 오전 9시
  }
  const limitError = () => { const e = new Error('limit'); e.reason = LIMIT_MSG; e.limit = true; return e; };
  // Cloudflare가 하루 한도를 넘겼을 때 주는 화면(1027, 429)인지
  async function isLimitPage(r) {
    if (r.status === 429) return true;
    if (/json/.test(r.headers.get('content-type') || '')) return false;
    try { return /1027|rate limited/i.test(await r.clone().text()); } catch (e) { return false; }
  }

  let healthP = null;
  async function get(params, ms) {
    if (limited()) throw limitError();
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 30000);
    try {
      const r = await fetch('/api/kopis?' + new URLSearchParams(params).toString(), { signal: ctrl.signal });
      if (!r.ok && await isLimitPage(r)) { markLimited(); throw limitError(); }
      return r;
    } finally { clearTimeout(t); }
  }
  /* JSON 요청: 저장된 결과가 있으면 서버를 부르지 않는다 */
  async function getJSON(params, ms) {
    const key = new URLSearchParams(params).toString();
    const hit = cacheGet(key);
    if (hit) return hit;
    const r = await get(params, ms);
    if (!r.ok) throw await fail(r);
    const j = await r.json();
    cachePut(key, j);
    return j;
  }
  function enabled() {
    if (!healthP) {
      const known = ls.get(HEALTH_KEY);
      if (limited() || (known && Date.now() - known < 6 * 3600 * 1000)) healthP = Promise.resolve(true);
      else {
        healthP = get({ health: 1 }, 4000)
          .then((r) => (r.ok && /json/.test(r.headers.get('content-type') || '') ? r.json() : { enabled: false }))
          .then((j) => { if (j.enabled) ls.set(HEALTH_KEY, Date.now()); return !!j.enabled; })
          .catch((e) => !!(e && e.limit));
      }
    }
    return healthP;
  }
  /* 서버가 알려 준 실패 이유를 그대로 담은 오류 */
  async function fail(r) {
    let reason = '';
    try { const j = await r.json(); reason = j.reason || j.error || ''; } catch (e) { /* 본문 없음 */ }
    reason = reason.replace(/^중계 서버:\s*/, '');
    const e = new Error(reason || ('서버 응답 ' + r.status)); e.reason = reason || ('서버 응답 ' + r.status);
    return e;
  }
  const why = (e) => (e && e.reason) || (e && e.name === 'AbortError' ? tr('응답 시간 초과') : '');
  /* 목록 미리보기 포스터: 보는 사람 폰이 KOPIS에서 바로 받는다(서버 호출 없음). 안 되면 서버로 */
  const posterSrc = (url) => String(url || '').replace(/^http:\/\//, 'https://');
  const posterFallback = (url) => '/api/kopis?poster=' + encodeURIComponent(url);
  async function searchAll(info) {
    const kws = keywords(info.title, info.date ? 3 : 2);
    if (!kws.length) return { list: [], confident: false };
    const params = info.date ? { date: info.date } : { year: info.year || new Date().getFullYear() };
    const errs = [];
    const lists = [];
    for (const q of kws) { // 한 번에 하나씩: KOPIS가 몰린 요청을 거절해서
      const l = await getJSON(Object.assign({ q }, params))
        .then((j) => j.results || [])
        .catch((e) => { errs.push(e); return []; });
      lists.push(l);
      if (errs.length && errs[errs.length - 1].limit) break;
      if (rank(l, info).confident) break;
    }
    if (errs.length && errs.length === lists.length) { const e = new Error('kopis'); e.reason = why(errs[errs.length - 1]); throw e; }
    const seen = new Map();
    for (const l of lists) for (const x of l) if (!seen.has(x.id)) seen.set(x.id, x);
    return rank([...seen.values()], info);
  }
  const detail = (id) => getJSON({ id });
  async function posterBlob(url) {
    if (!url) return null;
    const r = await get({ poster: url });
    if (!r.ok) return null;
    return r.blob();
  }

  async function json(params) {
    try { return await getJSON(params); } catch (e) {
      if (e.reason) throw e;
      const x = new Error('kopis'); x.reason = why(e) || tr('사이트 서버에 연결하지 못했어요'); throw x;
    }
  }
  const venueSearch = (q) => json({ venue: q }).then((j) => j.results || []);
  const placeHalls = (id) => json({ place: id }).then((j) => j.halls || []);
  const artistSearch = (q, date, year) => json(Object.assign({ artist: q }, date ? { date } : { year: year || new Date().getFullYear() })).then((j) => j.results || []);

  return { keywords, score, rank, days, castList, titleArtist, pickArtists, norm, enabled, limited, searchAll, detail, posterBlob, posterSrc, posterFallback, venueSearch, placeHalls, artistSearch, why };
});
