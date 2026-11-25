/* 화면 언어: 한국어 · English · 日本語
   - 처음에는 폰(브라우저) 언어를 보고 고른다. 시작 화면과 설정에서 바꿀 수 있다.
   - 문장은 한국어 원문을 열쇠로 쓴다. 번역이 없으면 한국어가 그대로 나온다.
   - 주소 뒤에 ?lang=en 처럼 붙이면 그 언어로 연다. */
(function () {
  'use strict';
  const KEY = 'concert-recap-lang';
  const LANGS = [['ko', '한국어'], ['en', 'English'], ['ja', '日本語']];
  const ok = (l) => LANGS.some(([k]) => k === l);

  function detect() {
    const list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || 'ko']);
    for (const l of list) {
      if (/^ko/i.test(l)) return 'ko';
      if (/^ja/i.test(l)) return 'ja';
      if (/^en/i.test(l)) return 'en';
    }
    return 'en';
  }
  let lang = null;
  try { const q = new URLSearchParams(location.search).get('lang'); if (ok(q)) { lang = q; localStorage.setItem(KEY, q); } } catch (e) { /* 무시 */ }
  if (!lang) { try { lang = localStorage.getItem(KEY); } catch (e) { /* 무시 */ } }
  if (!ok(lang)) lang = detect();
  document.documentElement.lang = lang;

  const D = window.CR_I18N || {};

  function tr(s, v) {
    // 'Korean|ctx' 처럼 뜻을 구분하는 꼬리표가 붙은 열쇠는 한국어에서 꼬리표를 뗀다
    let out = lang !== 'ko' && D[lang] && D[lang][s] != null ? D[lang][s] : s.replace(/\|\w+$/, '');
    if (v) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
    return out;
  }
  function setLang(l) {
    if (!ok(l)) return;
    try { localStorage.setItem(KEY, l); } catch (e) { /* 무시 */ }
    // 주소에 ?lang=이 있으면 지우고 다시 연다
    const u = new URL(location.href); u.searchParams.delete('lang');
    if (u.href === location.href) location.reload(); else location.replace(u.href);
  }

  const EN_MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WD = { ko: '일월화수목금토', ja: '日月火水木金土' };
  const EN_WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const EN_WDL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  // 달 이름: 5월 / May / 5月
  const mon = (m) => (lang === 'en' ? EN_MON[m - 1] : lang === 'ja' ? m + '月' : m + '월');
  // 여러 달: 5·7월 / May·Jul / 5·7月
  const mons = (arr, sep) => (lang === 'en' ? arr.map((m) => EN_MON[m - 1]).join(sep) : arr.join(sep) + (lang === 'ja' ? '月' : '월'));
  // 요일 (0=일요일)
  const wd = (i) => (lang === 'en' ? EN_WD[i] : WD[lang][i]);
  const wdLong = (i) => (lang === 'en' ? EN_WDL[i] : lang === 'ja' ? WD.ja[i] + '曜日' : WD.ko[i] + '요일');
  // 서버에서 온 오류 이유: 번역이 없으면 한국어 이외 언어에서는 숨긴다
  function reason(r) {
    if (!r) return '';
    if (lang === 'ko') return r;
    if (/몰려|쉬는 중/.test(r)) return tr('KOPIS 요청이 몰려 잠시 쉬는 중이에요.');
    if (D[lang] && D[lang][r]) return D[lang][r];
    return /[가-힣]/.test(r) ? '' : r;
  }
  // 그래프 칸 이름: 한 해 모드는 달(5월), 전체 기간은 해(2025년). k는 1부터
  const bin = (st, k) => (st && st.all ? tr('{y}년', { y: st.bins[k - 1] }) : mon(k));
  const bins = (st, arr, sep) => (st && st.all ? tr('{y}년', { y: arr.map((k) => st.bins[k - 1]).join(sep) }) : mons(arr, sep));
  // 축 눈금: 1~12 / 2025 (해가 많으면 '25)
  const tick = (st, i) => (st && st.all ? (st.bins.length > 8 ? '’' + String(st.bins[i]).slice(2) : String(st.bins[i])) : String(i + 1));
  // 가장 많은 칸 설명 (그래프 주석)
  function peak(st, sep, kind) {
    if (!st.peakMonths.length) return '';
    if (st.peakMonths.length > 1) return tr('{ms}에 {n}회씩', { ms: bins(st, st.peakMonths, sep), n: st.monthMax });
    const m = bin(st, st.peakMonths[0]);
    if (kind === 'busy') return st.all ? tr('{m}이 가장 바빴어요|year', { m }) : tr('{m}이 가장 바빴어요', { m });
    return st.all ? tr('{m}, 가장 많이 본 해', { m }) : tr('{m}, 가장 많이 본 달', { m });
  }
  const locale = () => (lang === 'en' ? 'en-US' : lang === 'ja' ? 'ja-JP' : 'ko-KR');

  window.CR = window.CR || {};
  window.CR.i18n = { lang, LANGS, tr, setLang, mon, mons, wd, wdLong, reason, locale, detect, bin, bins, tick, peak };
})();
