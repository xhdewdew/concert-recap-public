/* 공용 도우미: 날짜, 숫자, 색 대비 계산 */
(function (factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { window.CR = window.CR || {}; window.CR.util = m; }
})(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);

  const isNum = (n) => typeof n === 'number' && isFinite(n);
  const won = (n) => (isNum(n) ? '₩' + Math.round(n).toLocaleString('ko-KR') : '미입력');
  const comma = (n) => Math.round(n).toLocaleString('ko-KR');

  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function isDate(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return false;
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
  }
  function weekday(s) {
    if (!isDate(s)) return '';
    const [y, m, d] = s.split('-').map(Number);
    return '일월화수목금토'[new Date(y, m - 1, d).getDay()];
  }
  const md = (s) => (s ? s.slice(5, 7) + '.' + s.slice(8, 10) : '');
  const dots = (s) => (s ? s.replace(/-/g, '.') : '');

  /* ---- 색 ---- */
  function isHex(s) { return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(s || ''); }
  function normHex(s) {
    if (!isHex(s)) return null;
    let h = s.slice(1).toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return '#' + h;
  }
  function hexToRgb(hex) {
    const h = normHex(hex) || '#000000';
    const n = parseInt(h.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(rgb) {
    return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  }
  function lum(hex) {
    const c = hexToRgb(hex).map((v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) {
    const la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function mix(a, b, t) {
    const A = hexToRgb(a), B = hexToRgb(b);
    return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
  }
  /* fg가 bg 위에서 target 대비를 넘을 때까지 toward 쪽으로 섞는다 */
  function ensureContrast(fg, bg, target, toward) {
    if (contrast(fg, bg) >= target) return fg;
    for (let i = 1; i <= 40; i++) {
      const c = mix(fg, toward, i / 40);
      if (contrast(c, bg) >= target) return c;
    }
    return toward;
  }

  /* ---- 결정적 난수 (같은 기록이면 같은 배치) ---- */
  function hash(str) {
    let h = 2166136261;
    str = String(str);
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function debounce(fn, ms) {
    let t;
    return function () { clearTimeout(t); const a = arguments; t = setTimeout(() => fn.apply(null, a), ms); };
  }

  return { uid, esc, isNum, won, comma, todayStr, isDate, weekday, md, dots, pad,
    isHex, normHex, hexToRgb, rgbToHex, lum, contrast, mix, ensureContrast, hash, rng, debounce };
});
