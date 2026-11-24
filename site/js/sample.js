/* 예시 기록: 가상의 아티스트와 코드로 그린 포스터. 실제 기록을 시작하면 지울 수 있다. */
(function () {
  'use strict';
  const U = window.CR.util;

  const LIST = [
    ['2026-01-17', 'Neon Orchard 〈Winter Bloom〉', ['Neon Orchard'], '무신사 개러지', 'melon', 88000, 'done', '', 'p'],
    ['2026-02-21', '하얀 소음 단독 콘서트', ['하얀 소음'], '롤링홀', 'ticketlink', 66000, 'done', '', 'p'],
    ['2026-03-14', 'Velvet Static Asia Tour in Seoul', ['Velvet Static'], 'KSPO DOME', 'nol', 154000, 'done', '첫날', 'p'],
    ['2026-03-15', 'Velvet Static Asia Tour in Seoul', ['Velvet Static'], 'KSPO DOME', 'nol', 154000, 'done', '같은 공연 둘째 날도 봤다', 'p'],
    ['2026-04-25', 'Spring Wave Festival 2026', ['Neon Orchard', 'Ocean Kid', '새벽세시'], '난지한강공원', 'yes24', 132000, 'done', '', 'l'],
    ['2026-05-09', 'Ocean Kid 〈Tidal〉', ['Ocean Kid'], 'YES24 LIVE HALL', 'yes24', 99000, 'done', '', 'f'],
    ['2026-05-16', 'Neon Orchard Pop-up Show', ['Neon Orchard'], '롤링홀', 'melon', 44000, 'done', '', 's'],
    ['2026-05-30', '새벽세시 소극장 콘서트', ['새벽세시'], '롤링홀', 'nol', 55000, 'done', '친구 표까지 2매 예매, 내 몫만 기록', 'p'],
    ['2026-06-20', 'Moth & Moon Live', ['Moth & Moon'], '블루스퀘어 마스터카드홀', 'melon', 121000, 'canceled', '일정이 겹쳐 취소', 'p'],
    ['2026-07-11', 'Glass Avenue 〈Summer Light〉', ['Glass Avenue'], '올림픽공원 핸드볼경기장', 'nol', 143000, 'done', '', 'p'],
    ['2026-07-11', 'Glass Avenue Summer Light', ['Glass Avenue'], '올림픽공원 핸드볼경기장', 'nol', 143000, 'done', '중복 확인 기능을 보여 주는 예시', 'p'],
    ['2026-08-15', 'Midsummer Noise Fest', ['Velvet Static', '하얀 소음'], '인스파이어 아레나', 'ticketlink', 165000, 'done', '', 'f'],
    ['2026-09-26', 'Neon Orchard 〈Afterglow〉', ['Neon Orchard'], '올림픽공원 핸드볼경기장', 'melon', 132000, 'done', '', 'p'],
    ['2026-10-18', 'Ocean Kid Encore', ['Ocean Kid'], 'KSPO DOME', 'yes24', 0, 'done', '초대권', 'p'],
    ['2026-11-08', '하얀 소음 10th Anniversary', ['하얀 소음'], '블루스퀘어 마스터카드홀', 'ticketlink', 110000, 'done', '', 'f'],
    ['2026-12-13', 'Glass Avenue Year End', ['Glass Avenue'], '고척스카이돔', 'nol', 165000, 'planned', '', 'p'],
    ['2026-12-27', 'Velvet Static Countdown', ['Velvet Static'], 'KSPO DOME', 'nol', 154000, 'planned', '', 'p'],
  ];

  const PALETTES = [
    ['#0E3B43', '#F2C14E', '#F78154'], ['#2B2D42', '#EF233C', '#EDF2F4'], ['#1B998B', '#F8F1FF', '#ED217C'],
    ['#3D348B', '#F7B801', '#F18701'], ['#F4F1DE', '#E07A5F', '#3D405B'], ['#111D4A', '#FFCF99', '#92140C'],
    ['#E9D8A6', '#005F73', '#AE2012'], ['#FFE5EC', '#FB6F92', '#2D3047'], ['#0B132B', '#5BC0BE', '#F4D35E'],
    ['#F5F3F5', '#1F7A8C', '#BF4342'], ['#283618', '#FEFAE0', '#DDA15E'], ['#7400B8', '#80FFDB', '#F72585'],
  ];
  const SIZES = { p: [1000, 1414], f: [1000, 1250], s: [1000, 1000], l: [1200, 900] };
  const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", Inter, "Noto Sans CJK KR", sans-serif';

  function drawPoster(r, idx) {
    const [W, H] = SIZES[r.shape] || SIZES.p;
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const rnd = U.rng(U.hash(r.title + idx));
    const [bg, a, b] = PALETTES[idx % PALETTES.length];
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    const style = idx % 4;
    if (style === 0) {
      for (let i = 0; i < 3; i++) {
        x.fillStyle = i % 2 ? b : a;
        x.beginPath();
        x.arc(W * (0.25 + rnd() * 0.5), H * (0.2 + rnd() * 0.45), W * (0.18 + rnd() * 0.25), 0, Math.PI * 2);
        x.fill();
      }
    } else if (style === 1) {
      x.save(); x.translate(W / 2, H / 2); x.rotate(-0.5);
      for (let i = -20; i < 20; i++) { x.fillStyle = i % 2 ? a : b; x.fillRect(i * 46, -H, 23, H * 2); }
      x.restore();
      x.fillStyle = bg; x.fillRect(W * 0.08, H * 0.58, W * 0.84, H * 0.34);
    } else if (style === 2) {
      for (let yy = 60; yy < H * 0.66; yy += 54) for (let xx = 60; xx < W - 40; xx += 54) {
        x.fillStyle = rnd() > 0.5 ? a : b;
        x.beginPath(); x.arc(xx, yy, 8 + rnd() * 16, 0, Math.PI * 2); x.fill();
      }
    } else {
      x.fillStyle = a;
      x.font = `800 ${H * 0.62}px ${FONT}`;
      x.textBaseline = 'alphabetic';
      x.fillText((r.artists[0] || r.title).slice(0, 1).toUpperCase(), W * 0.02, H * 0.6);
      x.fillStyle = b; x.fillRect(W * 0.62, H * 0.08, W * 0.3, W * 0.3);
    }
    const ink = U.contrast(bg, '#111111') > U.contrast(bg, '#ffffff') ? '#111111' : '#ffffff';
    x.fillStyle = ink;
    const pad = W * 0.08;
    let size = W * 0.085;
    x.font = `800 ${size}px ${FONT}`;
    const title = r.title.replace(/[〈〉]/g, ' ').replace(/\s+/g, ' ').trim();
    const words = title.split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (x.measureText(t).width > W - pad * 2 && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    let y = H - pad - size * 1.9 - (lines.length - 1) * size * 1.02;
    for (const l of lines) { x.fillText(l, pad, y); y += size * 1.02; }
    x.font = `500 ${W * 0.034}px ${FONT}`;
    x.fillText(U.dots(r.date) + '  ' + r.venue, pad, H - pad - size * 0.35);
    x.font = `600 ${W * 0.03}px ${FONT}`;
    x.fillText(r.artists.join(' / '), pad, pad + W * 0.03);
    return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  }

  // 예시는 2026년 기준으로 적어 두고, 고른 연도로 날짜를 옮긴다.
  // 상태: 지난 해는 모두 관람 완료, 올해는 오늘 기준(지난 날 완료·다가올 날 예정), 내년 이후는 예시 그대로. 취소는 그대로.
  async function build(year, today) {
    const Y = String(year || 2026);
    const out = [];
    const now = Date.now();
    for (let i = 0; i < LIST.length; i++) {
      const row = LIST[i];
      const date = Y + row[0].slice(4);
      const title = row[1].replace(/2026/g, Y);
      const [, , artists, venue, vendor, cost, status0, memo, shape] = row;
      const ty = today ? today.slice(0, 4) : Y;
      const status = status0 === 'canceled' ? status0 : Y < ty ? 'done' : Y === ty ? (date > today ? 'planned' : 'done') : status0;
      out.push({
        id: U.uid(), title, artists, date, venue, vendor, vendorOther: '', cost, status, memo,
        shape, posterId: null, posterRatio: null, source: 'sample', createdAt: now + i, updatedAt: now + i,
      });
    }
    const posters = [];
    for (let i = 0; i < out.length; i++) {
      const r = out[i];
      const blob = await drawPoster(r, i);
      const [W, H] = SIZES[r.shape];
      r.posterId = 'poster-' + r.id;
      r.posterRatio = H / W;
      delete r.shape;
      posters.push([r.posterId, blob]);
    }
    return { records: out, posters };
  }

  window.CR.sample = { build };
})();
