/* 색 테마: 사용자는 강조색과 배경색만 고르고, 글자색은 대비를 계산해 자동으로 정한다. */
(function () {
  'use strict';
  const U = window.CR.util;

  const PRESETS = [
    { id: 'grass', name: '풀잎', accent: '#18853F', bg: '#EBE9E4' },
    { id: 'ultramarine', name: '울트라마린', accent: '#1F22B5', bg: '#E8E7E3' },
    { id: 'signal', name: '시그널 레드', accent: '#E3261D', bg: '#F1EFEA' },
    { id: 'moss', name: '이끼', accent: '#2E5E35', bg: '#E6E8DF' },
    { id: 'plum', name: '자두', accent: '#7B1E5E', bg: '#EEE7EB' },
    { id: 'tangerine', name: '귤', accent: '#F25A12', bg: '#ECECEA' },
    { id: 'night', name: '밤 공연', accent: '#F2D04A', bg: '#18181D' },
  ];
  const DEFAULT = PRESETS[0];

  function tokens(accent, bg) {
    accent = U.normHex(accent) || DEFAULT.accent;
    bg = U.normHex(bg) || DEFAULT.bg;
    const dark = U.lum(bg) < 0.2;
    const baseInk = dark ? '#F3F1EB' : '#17171B';
    const ink = U.ensureContrast(U.mix(baseInk, accent, 0.07), bg, 12, baseInk);
    const muted = U.ensureContrast(U.mix(ink, bg, 0.38), bg, 4.6, ink);
    const rule = U.mix(ink, bg, 0.8);
    const accentText = U.ensureContrast(accent, bg, 4.5, ink);
    const accentLarge = U.ensureContrast(accent, bg, 3, ink);
    const onAccent = U.contrast(accent, '#FFFFFF') >= U.contrast(accent, '#141414') ? '#FFFFFF' : '#141414';
    const faint = U.mix(ink, bg, 0.72);
    return { accent, bg, ink, muted, rule, faint, accentText, accentLarge, onAccent, dark,
      adjusted: accentText !== accent };
  }

  function apply(t) {
    const r = document.documentElement.style;
    r.setProperty('--bg', t.bg);
    r.setProperty('--ink', t.ink);
    r.setProperty('--muted', t.muted);
    r.setProperty('--rule', t.rule);
    r.setProperty('--faint', t.faint);
    r.setProperty('--accent', t.accent);
    r.setProperty('--accent-text', t.accentText);
    r.setProperty('--accent-large', t.accentLarge);
    r.setProperty('--on-accent', t.onAccent);
    document.documentElement.classList.toggle('is-dark', t.dark);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t.bg);
  }

  window.CR.theme = { PRESETS, DEFAULT, tokens, apply };
})();
