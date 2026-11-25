/* 리캡 이미지를 캔버스에 직접 그린다.
   화면 캡처 방식이 아니라서 색·포스터·한글 글꼴이 저장 결과에 그대로 들어간다.
   공개 이미지에는 메모·좌석·예매번호를 넣지 않는다. */
(function () {
  'use strict';
  const U = window.CR.util;
  const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", Inter, "Noto Sans KR", "Noto Sans CJK KR", sans-serif';
  const SIZES = { story: [1080, 1920], square: [1080, 1080] };
  const PER_PAGE = { story: { checker: 10, grid: 12 }, square: { checker: 6, grid: 12 } };
  const GRID = { story: { checker: [4, 5], grid: [3, 4] }, square: { checker: [4, 3], grid: [4, 3] } };

  const font = (ctx, w, s) => { ctx.font = `${w} ${s}px ${FONT}`; };
  const hasLS = (ctx) => 'letterSpacing' in ctx;

  function tracked(ctx, text, x, y, track) {
    if (!track) { ctx.fillText(text, x, y); return ctx.measureText(text).width; }
    if (hasLS(ctx)) {
      ctx.letterSpacing = track + 'px';
      ctx.fillText(text, x, y);
      const w = ctx.measureText(text).width;
      ctx.letterSpacing = '0px';
      return w;
    }
    let cx = x;
    for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + track; }
    return cx - x - track;
  }
  function measureTracked(ctx, text, track) {
    if (!track) return ctx.measureText(text).width;
    if (hasLS(ctx)) { ctx.letterSpacing = track + 'px'; const w = ctx.measureText(text).width; ctx.letterSpacing = '0px'; return w; }
    let w = 0; for (const ch of text) w += ctx.measureText(ch).width + track; return w - track;
  }
  function fit(ctx, text, maxW) {
    text = String(text || '');
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).trimEnd() + '…';
  }
  function wrap(ctx, text, maxW, maxLines) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = '';
    const push = (w) => {
      // 한 단어가 너무 길면 글자 단위로 자른다
      if (ctx.measureText(w).width <= maxW) return [w];
      const parts = []; let p = '';
      for (const ch of w) { if (ctx.measureText(p + ch).width > maxW && p) { parts.push(p); p = ch; } else p += ch; }
      if (p) parts.push(p);
      return parts;
    };
    for (const w0 of words) {
      for (const w of push(w0)) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t;
      }
    }
    if (cur) lines.push(cur);
    if (lines.length > maxLines) {
      const keep = lines.slice(0, maxLines);
      keep[maxLines - 1] = fit(ctx, keep[maxLines - 1] + ' ' + lines.slice(maxLines).join(' '), maxW);
      return keep;
    }
    return lines;
  }

  function paper(ctx, W, H, t) {
    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
  }
  function square(ctx, t, x, y, s) { ctx.fillStyle = t.accentLarge; ctx.fillRect(x, y, s, s); }

  function label(ctx, t, text, x, y, align, size) {
    font(ctx, 400, size || 24);
    ctx.fillStyle = t.accentText;
    ctx.textAlign = align || 'left';
    ctx.fillText('( ' + text + ' )', x, y);
    ctx.textAlign = 'left';
  }

  function contain(img, bx, by, bw, bh, alignY) {
    const iw = img.width, ih = img.height;
    const s = Math.min(bw / iw, bh / ih);
    const w = iw * s, h = ih * s;
    const y = alignY === 'top' ? by : alignY === 'bottom' ? by + bh - h : by + (bh - h) / 2;
    return [bx + (bw - w) / 2, y, w, h];
  }

  function fallbackPoster(ctx, t, r, x, y, w, h) {
    ctx.strokeStyle = t.ink; ctx.lineWidth = 2;
    const pw = Math.min(w, h / 1.414), ph = pw * 1.414;
    const px = x + (w - pw) / 2, py = y + (h - ph) / 2;
    ctx.strokeRect(px + 1, py + 1, pw - 2, ph - 2);
    font(ctx, 800, Math.max(20, pw * 0.11));
    ctx.fillStyle = t.ink;
    const lines = wrap(ctx, r.title, pw * 0.8, 4);
    let ly = py + ph - pw * 0.1 - (lines.length - 1) * pw * 0.12;
    for (const l of lines) { ctx.fillText(l, px + pw * 0.1, ly); ly += pw * 0.12; }
  }

  function chart(ctx, t, st, x, y, w, h, opt) {
    opt = opt || {};
    const max = Math.max(1, st.monthMax);
    const slot = w / 12;
    const bw = Math.max(6, slot * (opt.barRatio || 0.36));
    const base = y + h;
    const lblSize = opt.label || 22;
    ctx.strokeStyle = t.ink; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, base + 0.5); ctx.lineTo(x + w, base + 0.5); ctx.stroke();
    const tops = [];
    for (let i = 0; i < 12; i++) {
      const c = st.months[i];
      const bh = c ? Math.max(4, (h - lblSize * 1.6) * (c / max)) : 0;
      const bx = x + slot * i + (slot - bw) / 2;
      const peak = c > 0 && c === st.monthMax;
      if (bh) {
        ctx.fillStyle = peak ? t.accentLarge : t.faint;
        ctx.fillRect(bx, base - bh, bw, bh);
        font(ctx, 700, lblSize);
        ctx.fillStyle = t.ink; ctx.textAlign = 'center';
        ctx.fillText(String(c), bx + bw / 2, base - bh - lblSize * 0.45);
      }
      tops.push([bx + bw / 2, base - bh]);
      font(ctx, 400, lblSize);
      ctx.fillStyle = t.muted; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), bx + bw / 2, base + lblSize * 1.35);
    }
    ctx.textAlign = 'left';
    return tops;
  }

  function cover(img, x, y, w, h) {
    const s = Math.max(w / img.width, h / img.height);
    const sw = w / s, sh = h / s;
    return [(img.width - sw) / 2, Math.max(0, (img.height - sh) * 0.3), sw, sh, x, y, w, h];
  }

  /* 막대 대신 그 달 포스터를 아래부터 쌓는다. rows=2면 1~6월, 7~12월 두 줄 */
  function posterChart(ctx, t, st, x, y, w, h, opt) {
    const lbl = opt.label || 22;
    const rows = opt.rows || 1;
    const per = 12 / rows;
    const rowH = h / rows;
    const slot = w / per;
    const byMonth = Array.from({ length: 12 }, () => []);
    (opt.items || []).forEach((r, i) => byMonth[Number(r.date.slice(5, 7)) - 1].push(opt.imgs[i]));
    const max = Math.max(1, ...byMonth.map((l) => l.length));
    const room = rowH - lbl * 1.9 - lbl * 1.8;
    const tw = Math.min(slot * 0.72, opt.maxW || 150);
    const th = Math.min(tw * 1.414, Math.max(room / max, room * 0.4));
    const step = max <= 1 ? th : Math.min(th + 4, (room - th) / (max - 1));
    const tops = [];
    for (let r = 0; r < rows; r++) {
      const base = y + rowH * (r + 1) - lbl * 1.9;
      ctx.strokeStyle = t.ink; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x, base + 0.5); ctx.lineTo(x + w, base + 0.5); ctx.stroke();
      for (let j = 0; j < per; j++) {
        const i = r * per + j;
        const list = byMonth[i];
        const cx = x + slot * j + slot / 2;
        const peak = list.length > 0 && list.length === st.monthMax;
        list.forEach((img, k) => {
          const tx = cx - tw / 2, ty = base - th - k * step;
          if (img) { const c = cover(img, tx, ty, tw, th); ctx.drawImage(img, c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]); }
          else { ctx.fillStyle = t.bg; ctx.fillRect(tx, ty, tw, th); ctx.strokeStyle = t.ink; ctx.lineWidth = 1.5; ctx.strokeRect(tx + 0.75, ty + 0.75, tw - 1.5, th - 1.5); }
          if (k > 0 && step < th) { ctx.fillStyle = t.bg; ctx.fillRect(tx, ty + th - 0.5, tw, 2); }
        });
        const top = list.length ? base - th - (list.length - 1) * step : base;
        if (list.length) {
          font(ctx, 700, lbl); ctx.fillStyle = peak ? t.accentText : t.ink; ctx.textAlign = 'center';
          ctx.fillText(String(list.length), cx, top - lbl * 0.45);
        }
        font(ctx, peak ? 700 : 400, lbl); ctx.fillStyle = peak ? t.accentText : t.muted; ctx.textAlign = 'center';
        ctx.fillText(rows > 1 ? (i + 1) + '월' : String(i + 1), cx, base + lbl * 1.35);
        tops.push([cx, top - lbl * 1.4]);
      }
    }
    ctx.textAlign = 'left';
    return tops;
  }

  /* 포스터 불러오기
     - 폰 메모리를 아끼려고 그릴 크기(긴 변 900px)로 줄여서 작은 캔버스로 바꿔 둔다.
       (원본 그대로 여러 장을 한꺼번에 풀면 아이폰에서 메모리가 모자라 포스터가 빈칸으로 나왔다)
     - <img>로 안 되면 createImageBitmap으로 한 번 더 시도한다. */
  const MAX_SIDE = 900;
  // 화면에 포스터를 보여 줄 때와 같은 방법(<img>)을 먼저 쓴다.
  // 일부 사파리는 createImageBitmap이 오류 없이 빈 그림을 돌려줘서 포스터가 빈칸으로 나왔다.
  async function decode(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      if (img.naturalWidth) return { src: img, url };
    } catch (e) { /* 아래 방법으로 */ }
    URL.revokeObjectURL(url);
    return { src: await createImageBitmap(blob) };
  }
  async function loadImage(getBlob, id) {
    if (!id) return null;
    let d = null;
    try {
      const blob = await getBlob(id);
      if (!blob) return null;
      d = await decode(blob);
      const w = d.src.naturalWidth || d.src.width, h = d.src.naturalHeight || d.src.height;
      if (!w || !h) return null;
      const s = Math.min(1, MAX_SIDE / Math.max(w, h));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      const x = c.getContext('2d');
      x.imageSmoothingQuality = 'high';
      x.drawImage(d.src, 0, 0, c.width, c.height);
      return c;
    } catch (e) { return null; } finally {
      if (d && d.src && d.src.close) d.src.close();
      if (d && d.url) URL.revokeObjectURL(d.url);
    }
  }
  /* 같은 포스터(여러 날 본 공연)는 한 번만 불러오고, 동시에 3장까지만 */
  async function loadAll(getBlob, items) {
    const ids = [...new Set(items.map((r) => r.posterId).filter(Boolean))];
    const map = new Map();
    let k = 0;
    const worker = async () => { while (k < ids.length) { const id = ids[k++]; map.set(id, await loadImage(getBlob, id)); } };
    await Promise.all([worker(), worker(), worker()]);
    return { imgs: items.map((r) => map.get(r.posterId) || null), release: () => map.forEach((c) => { if (c) { c.width = 0; c.height = 0; } }) };
  }

  async function ensureFonts(texts) {
    if (!document.fonts || !document.fonts.load) return;
    const sample = Array.from(new Set(texts.join('') + '0123456789()₩.,·–/회곳팀월')).join('');
    try {
      await Promise.all([300, 400, 450, 500, 600, 700, 800].map((w) => document.fonts.load(`${w} 40px "Pretendard Variable"`, sample)));
      await document.fonts.ready;
    } catch (e) { /* 시스템 글꼴로 계속 */ }
  }

  /* ---------- 표지 ---------- */
  function coverStory(ctx, W, H, t, st, nick, pageNo, total, opts) {
    const M = 64;
    label(ctx, t, nick, M, M + 22, 'left', 26);
    const Y = String(opts.year || 2026);
    label(ctx, t, Y + ' concert recap', W - M, M + 22, 'right', 26);

    // 굵은 연도: 화면 안에 들어오는 크기
    let size = 400;
    const track = (sz) => -sz * 0.075;
    font(ctx, 800, size);
    while (size > 200 && measureTracked(ctx, Y, track(size)) > W - M * 2 - 40) { size -= 6; font(ctx, 800, size); }
    ctx.fillStyle = t.accentLarge;
    const base = 150 + size * 0.73;
    const w26 = tracked(ctx, Y, M - size * 0.03, base, track(size));
    square(ctx, t, M - size * 0.03 + w26 + 14, base - size * 0.72, 30);

    // 제목 (왼쪽) + 관람 횟수 (오른쪽)
    let y = base + 120;
    const tw = W * 0.5 - M;
    let ts = 54;
    font(ctx, 800, ts);
    const fixed = [Y + '년', '콘서트 기록'];
    while (ts > 34 && (fixed.some((l) => ctx.measureText(l).width > tw) || ctx.measureText(nick + '의').width > tw * 2)) { ts -= 2; font(ctx, 800, ts); }
    const titleLines = wrap(ctx, nick + '의', tw, 3).concat(fixed);
    ctx.fillStyle = t.ink;
    let ty = y + ts;
    for (const l of titleLines) { ctx.fillText(fit(ctx, l, tw), M, ty); ty += ts * 1.12; }
    const rx = W * 0.54;
    label(ctx, t, '관람', rx, y + 10, 'left', 26);
    let cs = 220;
    font(ctx, 800, cs);
    while (cs > 110 && rx + measureTracked(ctx, String(st.count), -cs * 0.06) + 80 > W - M) { cs -= 10; font(ctx, 800, cs); }
    ctx.fillStyle = t.ink;
    const cw = tracked(ctx, String(st.count), rx - 6, y + 10 + cs * 0.86, -cs * 0.06);
    font(ctx, 700, 58);
    ctx.fillText('회', rx - 6 + cw + 10, y + 10 + cs * 0.86);
    y = Math.max(ty - ts * 1.12, y + 10 + cs * 0.86) + 110;

    // 보여줄 내용 (이미지 저장 창에서 고름)
    const sh = show(opts);
    const inner = W - M * 2;
    const rowsH = (sh.spend || sh.counts ? 204 : 0) + (sh.bests ? 196 : 0);
    // 월별 그래프를 빼면 숫자 줄을 아래쪽에 붙여서 빈 곳이 가운데로 가게
    if (!sh.chart && rowsH) { const shift = (H - M - 80) - (y + rowsH - 100); if (shift > 0) y += shift; }

    // 지출 · 공연장 · 아티스트 한 줄
    if (sh.spend || sh.counts) {
      ctx.fillStyle = t.rule; ctx.fillRect(M, y - 50, W - M * 2, 2);
      if (sh.spend) {
        const spendW = sh.counts ? inner * 0.5 - 44 : inner;
        label(ctx, t, '티켓 지출', M, y, 'left', 26);
        let ss = sh.counts ? 92 : 120;
        const spend = U.won(st.spend);
        font(ctx, 800, ss);
        while (ss > 44 && measureTracked(ctx, spend, -ss * 0.05) > spendW) { ss -= 2; font(ctx, 800, ss); }
        ctx.fillStyle = t.ink;
        tracked(ctx, spend, M - 3, y + 100, -ss * 0.05);
      }
      if (sh.counts) {
        [['공연장', st.venueCount, '곳'], ['아티스트', st.artistCount, '팀']].forEach(([lb, v, unit], i) => {
          const x = sh.spend ? M + inner * 0.5 + (inner * 0.25) * i : M + (inner * 0.5) * i;
          label(ctx, t, lb, x, y, 'left', 26);
          font(ctx, 800, 100); ctx.fillStyle = t.ink;
          const w = tracked(ctx, String(v), x - 4, y + 100, -100 * 0.06);
          font(ctx, 700, 38); ctx.fillText(unit, x + w + 8, y + 100);
        });
      }
      y += 100 + 104;
    }

    // 가장 많이 본 아티스트 · 가장 자주 간 공연장
    if (sh.bests) {
    ctx.fillStyle = t.rule; ctx.fillRect(M, y - 50, W - M * 2, 2);
    const half = inner / 2;
    [['가장 많이 본 아티스트', st.artists, '팀'], ['가장 자주 간 공연장', st.venues, '곳']].forEach(([lb, list, unitWord], i) => {
      const x = M + half * i, w = half - 28;
      label(ctx, t, lb, x, y, 'left', 24);
      font(ctx, 800, 44); ctx.fillStyle = t.ink;
      ctx.fillText(list.top.length ? fit(ctx, list.top[0].name, w) : '기록 없음', x, y + 58);
      if (list.top.length) {
        font(ctx, 600, 26); ctx.fillStyle = t.muted;
        ctx.fillText(`${list.max}회${list.top.length > 1 ? ` · 공동 ${list.top.length}${unitWord}` : ''}`, x, y + 98);
      }
    });
    y += 196; // 아래 가로선과 위 칸들 사이 간격을 맞춤 (글자 아래 약 54px)
    }

    // 월별
    if (!sh.chart) { footer(ctx, t, W, H, M, pageNo, total); return; }
    ctx.fillStyle = t.rule; ctx.fillRect(M, y - 44, W - M * 2, 2);
    const chTop = y + 40;
    const chH = H - M - 60 - chTop;
    const rows = 1;
    const tops = opts.chartStyle === 'bar' ? chart(ctx, t, st, M, chTop + 40, W - M * 2, chH - 40, { label: 22 }).map(([a, b]) => [a, b - 34])
      : posterChart(ctx, t, st, M, chTop, W - M * 2, chH, { label: 22, rows, items: opts.items, imgs: opts.imgs });
    annotate(ctx, t, st, tops, W, M, 24);
    label(ctx, t, '월별 관람', M, y, 'left', 24); // 그래프 높이와 상관없이 가로선 바로 아래에 고정
    footer(ctx, t, W, H, M, pageNo, total);
  }

  function coverSquare(ctx, W, H, t, st, nick, pageNo, total, opts) {
    const M = 56;
    label(ctx, t, nick, M, M + 18, 'left', 22);
    const Y = String(opts.year || 2026);
    label(ctx, t, Y + ' concert recap', W - M, M + 18, 'right', 22);
    // 20²⁶ (앞 두 자리 + 작게 뒤 두 자리)
    const size = 330;
    font(ctx, 300, size);
    ctx.fillStyle = t.accentLarge;
    const base = M + 40 + size * 0.74;
    const w20 = tracked(ctx, Y.slice(0, 2), M - 10, base, -size * 0.06);
    font(ctx, 300, size * 0.5);
    tracked(ctx, Y.slice(2), M - 10 + w20 + 6, base - size * 0.36, -size * 0.03);
    // 제목
    const tx = W * 0.62, tw = W - M - tx;
    let ts = 40; font(ctx, 800, ts);
    while (ts > 26 && ([Y + '년', '콘서트 기록'].some((l) => ctx.measureText(l).width > tw) || ctx.measureText(nick + '의').width > tw * 2)) { ts -= 2; font(ctx, 800, ts); }
    const tl = wrap(ctx, nick + '의', tw, 3).concat([Y + '년', '콘서트 기록']);
    ctx.fillStyle = t.ink;
    let ty = base - (tl.length - 1) * ts * 1.14;
    for (const l of tl) { ctx.fillText(fit(ctx, l, tw), tx, ty); ty += ts * 1.14; }

    // 숫자 칸 (관람은 늘, 나머지는 고른 것만)
    const sh = show(opts);
    let y = base + 70;
    const rowsH = 150 + (sh.bests ? 120 : 0);
    if (!sh.chart) { const shift = (H - M - 80) - (y + rowsH - 40); if (shift > 0) y += shift; }
    ctx.fillStyle = t.rule; ctx.fillRect(M, y - 34, W - M * 2, 2);
    const cw = (W - M * 2) / 4;
    const cells = [['관람', String(st.count), '회']].concat(sh.counts ? [['공연장', String(st.venueCount), '곳'], ['아티스트', String(st.artistCount), '팀']] : []);
    cells.forEach(([lb, v, u], i) => {
      const x = M + cw * i;
      label(ctx, t, lb, x, y, 'left', 20);
      font(ctx, 800, 92); ctx.fillStyle = t.ink;
      const w = tracked(ctx, v, x - 3, y + 92, -92 * 0.06);
      font(ctx, 700, 30); ctx.fillText(u, x + w + 6, y + 92);
    });
    if (sh.spend) {
      const sx = M + cw * cells.length, sw = W - M - sx;
      label(ctx, t, '티켓 지출', sx, y, 'left', 20);
      let ss = cells.length > 1 ? 50 : 80; font(ctx, 800, ss); ctx.fillStyle = t.ink;
      const sp = U.won(st.spend);
      while (ss > 26 && ctx.measureText(sp).width > sw) { ss -= 2; font(ctx, 800, ss); }
      ctx.fillText(sp, sx, y + 88);
    }
    y += 150;

    // 베스트 2칸
    if (sh.bests) [['가장 많이 본 아티스트', st.artists, '팀'], ['가장 자주 간 공연장', st.venues, '곳']].forEach(([lb, list, unitWord], i) => {
      const x = M + ((W - M * 2) / 2 + 12) * i, w = (W - M * 2) / 2 - 12;
      label(ctx, t, lb, x, y, 'left', 20);
      font(ctx, 800, 34); ctx.fillStyle = t.ink;
      ctx.fillText(fit(ctx, list.top.length ? list.top[0].name : '기록 없음', w), x, y + 44);
      if (list.top.length) {
        font(ctx, 500, 22); ctx.fillStyle = t.muted;
        ctx.fillText(`${list.max}회${list.top.length > 1 ? ` · 공동 ${list.top.length}${unitWord}` : ''}`, x, y + 76);
      }
    });
    if (sh.bests) y += 120;
    if (!sh.chart) { footer(ctx, t, W, H, M, pageNo, total); square(ctx, t, W - M - 22, base - 4, 22); return; }
    label(ctx, t, '월별 관람', M, y, 'left', 20);
    const top0 = y + 10;
    const h = H - M - 56 - top0;
    const tops = opts.chartStyle === 'bar' ? chart(ctx, t, st, M, top0 + 30, W - M * 2, h - 30, { label: 20, barRatio: 0.34 }).map(([a, b]) => [a, b - 30])
      : posterChart(ctx, t, st, M, top0, W - M * 2, h, { label: 20, items: opts.items, imgs: opts.imgs });
    annotate(ctx, t, st, tops, W, M, 20);
    footer(ctx, t, W, H, M, pageNo, total);
    square(ctx, t, W - M - 22, base - 4, 22);
  }

  // 보여줄 내용: 기본은 모두 보이기
  function show(opts) { return Object.assign({ spend: true, counts: true, bests: true, chart: true, posters: true }, (opts && opts.show) || {}); }

  function annotate(ctx, t, st, tops, W, M, size) {
    if (!st.peakMonths.length) return;
    const pm = st.peakMonths[0];
    const [px, py] = tops[pm - 1];
    const note = st.peakMonths.length > 1 ? `${st.peakMonths.join('·')}월에 ${st.monthMax}회씩` : `${pm}월이 가장 바빴어요`;
    font(ctx, 600, size);
    const nw = ctx.measureText(note).width;
    const right = px + 26 + nw < W - M;
    const nx = right ? px + 26 : px - 26 - nw;
    const ny = py - size * 0.9;
    ctx.strokeStyle = t.accentText; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(px, py - 4); ctx.lineTo(px, ny - size * 0.35); ctx.lineTo(right ? nx - 8 : nx + nw + 8, ny - size * 0.35); ctx.stroke();
    ctx.fillStyle = t.accentText;
    ctx.fillText(note, nx, ny);
  }

  function footer(ctx, t, W, H, M, pageNo, total) {
    font(ctx, 400, 22);
    ctx.textAlign = 'right';
    ctx.fillStyle = t.accentText;
    ctx.fillText(`( ${pageNo} / ${total} )`, W - M, H - M + 6);
    ctx.textAlign = 'left';
  }

  /* ---------- 포스터 페이지 ---------- */
  function posterPage(ctx, W, H, t, items, imgs, opts) {
    const { format, layout, nick, pageNo, total, startNo, countAll } = opts;
    const M = format === 'story' ? 64 : 56;
    label(ctx, t, nick, M, M + 20, 'left', format === 'story' ? 26 : 22);
    label(ctx, t, `공연 포스터 ${startNo}–${startNo + items.length - 1} / ${countAll}`, W - M, M + 20, 'right', format === 'story' ? 26 : 22);
    const top = M + (format === 'story' ? 74 : 56);
    const bottom = H - M - 44;
    const [cols, rows] = GRID[format][layout];
    const cw = (W - M * 2) / cols;
    const ch = (bottom - top) / rows;

    if (layout === 'grid') {
      const cap = format === 'story' ? 76 : 64;
      items.forEach((r, i) => {
        const c = i % cols, row = Math.floor(i / cols);
        const x = M + c * cw, y = top + row * ch;
        const pad = format === 'story' ? 10 : 8;
        const img = imgs[i];
        if (img) {
          const [ix, iy, iw, ih] = contain(img, x + pad, y + pad, cw - pad * 2, ch - cap - pad, 'bottom');
          ctx.drawImage(img, ix, iy, iw, ih);
        } else fallbackPoster(ctx, t, r, x + pad, y + pad, cw - pad * 2, ch - cap - pad);
        const fs = format === 'story' ? 22 : 18;
        font(ctx, 400, fs); ctx.fillStyle = t.accentText;
        ctx.fillText(`( ${startNo + i} )  ${U.md(r.date)}`, x + pad, y + ch - cap + fs * 1.4);
        font(ctx, 700, fs); ctx.fillStyle = t.ink;
        ctx.fillText(fit(ctx, r.title, cw - pad * 2), x + pad, y + ch - cap + fs * 2.75);
      });
      return;
    }
    // 체커보드: 포스터 칸과 날짜 칸이 번갈아 놓인다
    let k = 0;
    for (let row = 0; row < rows && k < items.length; row++) {
      for (let c = 0; c < cols && k < items.length; c += 2) {
        const flip = row % 2 === 1;
        const r = items[k], img = imgs[k];
        const pc = flip ? c + 1 : c, ic = flip ? c : c + 1;
        const px = M + pc * cw, ix = M + ic * cw, y = top + row * ch;
        if (pc < cols) {
          if (img) { const [a, b, w, h] = contain(img, px, y, cw, ch, 'center'); ctx.drawImage(img, a, b, w, h); }
          else fallbackPoster(ctx, t, r, px + 8, y + 8, cw - 16, ch - 16);
        }
        if (ic < cols) infoCell(ctx, t, r, startNo + k, ix, y, cw, ch, format);
        k++;
      }
    }
  }

  function infoCell(ctx, t, r, no, x, y, w, h, format) {
    const p = format === 'story' ? 16 : 14;
    const inner = w - p * 2;
    font(ctx, 400, 22); ctx.fillStyle = t.accentText;
    ctx.fillText(`( ${no} )`, x + p, y + p + 18);
    let ds = 96;
    font(ctx, 400, ds);
    while (ds > 40 && measureTracked(ctx, U.md(r.date), -ds * 0.05) > inner) { ds -= 2; font(ctx, 400, ds); }
    tracked(ctx, U.md(r.date), x + p - 3, y + p + 26 + ds * 0.86, -ds * 0.05);
    font(ctx, 400, 24);
    ctx.fillText(U.weekday(r.date) + '요일', x + p, y + p + 26 + ds * 0.86 + 40);
    const ts = format === 'story' ? 25 : 22;
    font(ctx, 700, ts); ctx.fillStyle = t.ink;
    const lines = wrap(ctx, r.title, inner, 3);
    const lh = ts * 1.22;
    let ly = y + h - p - 30 - (lines.length - 1) * lh;
    for (const l of lines) { ctx.fillText(l, x + p, ly); ly += lh; }
    font(ctx, 400, 20); ctx.fillStyle = t.muted;
    ctx.fillText(fit(ctx, r.venue || '', inner), x + p, y + h - p);
  }

  function pageCount(format, layout, n, posters) {
    const per = PER_PAGE[format][layout];
    return 1 + (posters === false ? 0 : Math.ceil(n / per));
  }

  async function renderAll(opts) {
    const { format, layout, state, st, tokens, getBlob, scale } = opts;
    const [W, H] = SIZES[format];
    const sc = scale || 1;
    const nick = (state.nickname || '나').trim();
    const items = st.included.slice();
    const per = PER_PAGE[format][layout];
    const sh = show(opts);
    const total = 1 + (sh.posters ? Math.ceil(items.length / per) : 0);
    const Y = String(opts.year || 2026);
    const texts = [nick, Y + ' 0123456789', '의 년 콘서트 기록 관람 티켓 지출 공연장 아티스트 가장 많이 본 자주 간 월별 관람 완료 기준 공연 포스터 요일 기록 없음 이 바빴어요 회씩 외 공동 올해 번 에 갔어요 에서 을 봤고 썼어요 곳 concert recap',
      ...items.map((r) => r.title + r.venue + (r.artists || []).join(''))];
    await ensureFonts(texts);

    const { imgs, release } = await loadAll(getBlob, items);
    const pages = [];
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(W * sc); c.height = Math.round(H * sc);
      const ctx = c.getContext('2d');
      ctx.scale(sc, sc);
      ctx.textBaseline = 'alphabetic';
      paper(ctx, W, H, tokens);
      return [c, ctx];
    };
    {
      const [c, ctx] = mk();
      const co = { chartStyle: opts.chartStyle || 'poster', items, imgs, year: Y, show: sh };
      if (format === 'story') coverStory(ctx, W, H, tokens, st, nick, 1, total, co);
      else coverSquare(ctx, W, H, tokens, st, nick, 1, total, co);
      pages.push(c);
    }
    for (let i = 0; sh.posters && i < items.length; i += per) {
      const [c, ctx] = mk();
      posterPage(ctx, W, H, tokens, items.slice(i, i + per), imgs.slice(i, i + per),
        { format, layout, nick, pageNo: pages.length + 1, total, startNo: i + 1, countAll: items.length });
      footer(ctx, tokens, W, H, format === 'story' ? 64 : 56, pages.length + 1, total);
      pages.push(c);
    }
    for (const im of imgs) if (im && im.close) im.close();
    release(); // 줄인 포스터 캔버스 메모리 돌려주기
    return pages;
  }

  window.CR.render = { renderAll, pageCount, SIZES, PER_PAGE };
})();
