/* 화면과 동작 */
(function () {
  'use strict';
  const { util: U, stats: S, parse: P, theme: T, db: DB, kopis: K, sample: SAMPLE, render: R } = window.CR;

  const YEAR = 2026;
  const VENDORS = { nol: 'NOL 티켓 (구 인터파크)', ticketlink: '티켓링크', melon: '멜론티켓', yes24: 'YES24 티켓', other: '기타' };
  const STATUS = { done: '관람 완료', planned: '관람 예정', canceled: '취소·환불' };
  const TESS_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  let state = DB.load();
  let tokens = null;
  let ledgerFilter = 'all';
  const posterURLs = new Map();
  const app = document.getElementById('app');
  const esc = U.esc;
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.createdAt || 0) - (b.createdAt || 0);

  /* ---------- 공통 ---------- */
  function save() {
    if (DB.save(state) === 'full') toast('저장 공간이 가득 찼어요. 백업 후 오래된 포스터를 지워 주세요.');
  }
  function stats() { return S.compute(state.records, { year: YEAR, today: U.todayStr(), dupIgnore: state.dupIgnore }); }
  function nick() { return (state.nickname || '').trim() || '나'; }

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 2600);
  }

  function applyTheme() {
    tokens = T.tokens(state.theme.accent, state.theme.bg);
    T.apply(tokens);
  }

  async function posterURL(id) {
    if (!id) return null;
    if (posterURLs.has(id)) return posterURLs.get(id);
    const blob = await DB.getPoster(id);
    if (!blob) return null;
    const u = URL.createObjectURL(blob);
    posterURLs.set(id, u);
    return u;
  }
  /* 같은 공연 여러 날이 포스터 하나를 함께 쓰므로, 아무도 안 쓸 때만 지운다 */
  async function releasePoster(id) {
    if (!id || state.records.some((r) => r.posterId === id)) return;
    await DB.delPoster(id);
    forgetPoster(id);
  }
  function forgetPoster(id) {
    if (posterURLs.has(id)) { URL.revokeObjectURL(posterURLs.get(id)); posterURLs.delete(id); }
  }
  async function hydrate(root) {
    const imgs = (root || document).querySelectorAll('img[data-poster]');
    await Promise.all([...imgs].map(async (img) => {
      const url = await posterURL(img.dataset.poster);
      if (url) img.src = url;
      else {
        const fb = document.createElement('span');
        fb.className = 'fallback';
        fb.textContent = img.alt.replace(/ 포스터$/, '');
        img.replaceWith(fb);
      }
    }));
  }

  function openDialog(html, opts) {
    opts = opts || {};
    const d = document.createElement('dialog');
    d.className = 'dlg ' + (opts.cls || '');
    d.innerHTML = `<div class="dlg-in">${html}</div>`;
    document.body.appendChild(d);
    document.documentElement.style.overflow = 'hidden';
    d.addEventListener('close', () => {
      d.remove();
      if (!document.querySelector('dialog[open]')) document.documentElement.style.overflow = '';
      if (opts.onClose) opts.onClose(d.returnValue);
    });
    d.addEventListener('click', (e) => {
      if (e.target === d) d.close();
      if (e.target.closest('[data-close]')) d.close();
    });
    d.showModal();
    return d;
  }
  const head = (title) => `<header class="dlg-head"><h2>${title}</h2><button class="x" data-close aria-label="닫기">×</button></header>`;
  const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();
  const previewNote = (what) => (IN_FRAME ? `<div class="notice">미리보기에서는 ${what}이 안 돼요. 배포한 주소에서는 돼요.</div>` : '');

  /* 브라우저 기본 확인 창 대신 쓰는 확인 창 (앱 안 미리보기에서도 동작) */
  function ask(message, opts) {
    opts = opts || {};
    let ok = false;
    return new Promise((resolve) => {
      const d = openDialog(`${head(esc(opts.title || '확인'))}
        <form class="dlg-body" id="ask-form" novalidate>
          <p style="margin:0">${esc(message)}</p>
          ${opts.typeWord ? `<label class="field"><span>계속하려면 ‘${esc(opts.typeWord)}’라고 적어 주세요</span><input type="text" name="w" autocomplete="off"></label><p class="err" id="ask-err" hidden>‘${esc(opts.typeWord)}’라고 정확히 적어 주세요.</p>` : ''}
        </form>
        <footer class="dlg-foot"><button class="btn quiet spacer" type="button" data-close>취소</button><button class="btn-solid${opts.danger ? ' danger' : ''}" type="submit" form="ask-form">${esc(opts.ok || '확인')}</button></footer>`,
      { cls: 'small', onClose: () => resolve(ok) });
      const f = d.querySelector('#ask-form');
      f.addEventListener('submit', (e) => {
        e.preventDefault();
        if (opts.typeWord && f.w.value.trim() !== opts.typeWord) { d.querySelector('#ask-err').hidden = false; f.w.focus(); return; }
        ok = true;
        d.close();
      });
      if (opts.typeWord) setTimeout(() => f.w.focus(), 50);
    });
  }

  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
  }

  async function processImage(file, max) {
    max = max || 1400;
    let src;
    try { src = await createImageBitmap(file); } catch (e) {
      src = await new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res(img); img.onerror = rej;
        img.src = URL.createObjectURL(file);
      });
    }
    const s = Math.min(1, max / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * s)), h = Math.max(1, Math.round(src.height * s));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.drawImage(src, 0, 0, w, h);
    if (src.close) src.close();
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.88));
    return { blob, ratio: h / w };
  }

  function galleryRecords() {
    return state.records
      .filter((r) => U.isDate(r.date) && r.date.slice(0, 4) === String(YEAR) && r.status !== 'canceled')
      .sort(byDate);
  }

  /* ---------- 첫 방문 ---------- */
  function viewOnboard() {
    document.body.classList.remove('recap-page');
    app.innerHTML = `
      <main class="onboard">
        <div class="onboard-mast" aria-hidden="true">2026</div>
        <div class="onboard-body">
          <h1>2026년 공연 기록</h1>
          <form id="nick-form" novalidate>
            <label class="field"><span>닉네임</span>
              <input type="text" name="nick" maxlength="20" autocomplete="nickname" placeholder="리캡에 들어갈 이름" required>
            </label>
            <p class="err" id="nick-err" hidden>닉네임을 적어 주세요.</p>
            <div class="row">
              <button class="btn-solid" type="submit">시작하기</button>
              <button class="btn" type="button" id="try-sample">예시 기록으로 둘러보기</button>
            </div>
          </form>
        </div>
        <p class="onboard-foot">기록은 이 기기에만 저장돼요.</p>
      </main>`;
    const form = document.getElementById('nick-form');
    const go = async (withSample) => {
      const v = form.nick.value.trim();
      if (!v && !withSample) { document.getElementById('nick-err').hidden = false; form.nick.focus(); return; }
      state.nickname = v || '공연 일기';
      save();
      if (withSample) await loadSample();
      location.hash = '';
      render();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
    document.getElementById('try-sample').addEventListener('click', () => go(true));
  }

  async function loadSample() {
    toast('예시 기록을 만드는 중이에요');
    const { records, posters } = await SAMPLE.build();
    for (const [id, blob] of posters) await DB.putPoster(id, blob);
    state.records = state.records.concat(records);
    state.sample = true;
    save();
  }
  async function clearSample() {
    const keep = [];
    for (const r of state.records) {
      if (r.source === 'sample') { if (r.posterId) { await DB.delPoster(r.posterId); forgetPoster(r.posterId); } }
      else keep.push(r);
    }
    state.records = keep;
    state.sample = false;
    state.dupIgnore = [];
    save();
    render();
    toast('예시 기록을 지웠어요');
  }

  /* ---------- 메인 ---------- */
  function alertsHTML(st) {
    const out = [];
    if (state.sample) out.push(`<div class="alert"><span>예시 기록이에요.</span><span class="acts"><button class="btn" data-act="clear-sample">예시 지우기</button></span></div>`);
    if (st.overdue.length) out.push(`<div class="alert"><span>날짜가 지난 관람 예정 <strong>${st.overdue.length}건</strong></span><span class="acts"><button class="btn" data-act="overdue-done">완료로 바꾸기</button><button class="btn quiet" data-act="filter" data-f="planned">목록 보기</button></span></div>`);
    if (st.duplicates.length) out.push(`<div class="alert"><span>중복 의심 <strong>${st.duplicates.length}묶음</strong></span><span class="acts"><button class="btn" data-act="dups">확인하기</button></span></div>`);
    const real = state.records.filter((r) => r.source !== 'sample').length;
    if (real >= 3 && Date.now() - (state.lastBackup || 0) > 14 * 864e5) out.push(`<div class="alert"><span>백업한 지 2주가 넘었어요.</span><span class="acts"><button class="btn" data-act="backup">지금 백업</button></span></div>`);
    if (!DB.canPersist()) out.push(`<div class="alert"><span>이 화면에서는 기록이 저장되지 않아요${IN_FRAME ? ' (미리보기)' : ' (개인정보 보호 모드)'}.</span></div>`);
    return out.length ? `<section class="alerts" aria-label="알림">${out.join('')}</section>` : '';
  }

  function statCards(st) {
    if (!st.count) return [];
    const cards = [];
    cards.push({ num: st.count, unit: '회', text: `관람<br><b>공연 ${st.showCount}개</b>`, why: 'count' });
    if (st.venues.top.length) cards.push({ num: st.venues.max, unit: '회', text: `가장 자주 간 곳<br><b>${esc(st.venues.top[0].name)}</b>${st.venues.top.length > 1 ? ` 외 ${st.venues.top.length - 1}` : ''}`, why: 'venue' });
    if (st.artists.top.length) cards.push({ num: st.artists.max, unit: '회', text: `가장 많이 본 아티스트<br><b>${esc(st.artists.top[0].name)}</b>${st.artists.top.length > 1 ? ` 외 ${st.artists.top.length - 1}` : ''}`, why: 'artist' });
    if (st.peakMonths.length) cards.push({ num: st.peakMonths[0], unit: '월', text: `가장 많이 간 달<br><b>${st.monthMax}회</b>`, why: 'month' });
    return cards;
  }

  function galleryHTML(st) {
    const list = galleryRecords();
    if (!list.length) {
      return `<div class="empty">
        <h2>첫 공연을 기록하세요</h2>
        <div class="row"><button class="btn-solid" data-act="import">캡처로 추가</button><button class="btn-line" data-act="add">직접 추가</button>${state.records.length ? '' : '<button class="btn" data-act="sample">예시 보기</button>'}</div>
      </div>`;
    }
    const cards = statCards(st);
    const doneIds = new Map(st.included.map((r, i) => [r.id, i + 1]));
    const groupOf = new Map();
    for (const g of st.shows) for (const r of g.records) groupOf.set(r.id, g);
    const units = [];
    list.forEach((r, i) => {
      const no = doneIds.get(r.id);
      const planned = r.status === 'planned';
      units.push(`<article class="unit">
        <button class="cell poster-cell${planned ? ' planned' : ''}" data-act="detail" data-id="${r.id}" aria-label="${esc(r.title)} 자세히 보기">
          ${r.posterId ? `<img data-poster="${r.posterId}" alt="${esc(r.title)} 포스터">` : `<span class="fallback">${esc(r.title)}</span>`}
        </button>
        <div class="cell info-cell">
          <span class="no">${planned ? '( 예정 )' : `( ${no} )`}</span>
          <span class="date">${U.md(r.date)}</span>
          <span class="wd">${U.weekday(r.date)}요일</span>
          <div class="meta">
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.venue || '')}</p>
            ${planned ? '<span class="tag">관람 예정</span>' : groupOf.get(r.id) && groupOf.get(r.id).days > 1 ? `<span class="tag">${groupOf.get(r.id).days}일 관람</span>` : ''}
          </div>
        </div>
      </article>`);
      if ((i + 1) % 5 === 0 && cards.length) {
        const c = cards.shift();
        units.push(`<aside class="unit stat-unit">
          <div class="cell stat-num">${c.num}<small>${c.unit}</small></div>
          <div class="cell stat-text"><p>${c.text}</p><button class="btn quiet" data-act="basis" data-k="${c.why}">근거</button></div>
        </aside>`);
      }
    });
    return `<div class="gallery" id="gallery">${units.join('')}</div>`;
  }

  function ledgerHTML() {
    const all = state.records.slice().sort(byDate);
    const f = ledgerFilter;
    const rows = all.filter((r) => {
      const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(YEAR));
      if (f === 'all') return true;
      if (f === 'other') return other;
      return !other && r.status === f;
    });
    const btn = (k, l) => `<button class="btn quiet" data-act="filter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`;
    return `<section class="ledger" id="ledger" aria-labelledby="ledger-title">
      <div class="ledger-head"><h2 id="ledger-title">전체 기록 <small style="font-size:var(--f-s);color:var(--muted);font-weight:500">${state.records.length}건</small></h2>
        <div class="filters">${btn('all', '전체')}${btn('done', '관람 완료')}${btn('planned', '관람 예정')}${btn('canceled', '취소·환불')}${btn('other', '2026년 외')}</div></div>
      ${rows.length ? `<ol>${rows.map((r) => {
        const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(YEAR));
        const st = other ? 'year' : r.status;
        return `<li><button data-act="detail" data-id="${r.id}">
          <span class="l-date">${U.dots(r.date) || '날짜 없음'} ${U.weekday(r.date)}</span>
          <span class="l-title">${esc(r.title)}<small>${esc((r.artists || []).join(', '))}</small></span>
          <span class="l-venue">${esc(r.venue)}</span>
          <span class="l-cost">${U.isNum(r.cost) ? U.won(r.cost) : '<span style="color:var(--muted)">금액 미입력</span>'}</span>
          <span class="l-status ${st}">${other ? '2026년 외' : STATUS[r.status] || ''}</span>
        </button></li>`;
      }).join('')}</ol>` : '<p class="help">이 조건에 맞는 기록이 없어요.</p>'}
    </section>`;
  }

  function viewMain() {
    const st = stats();
    document.body.classList.remove('recap-page');
    const n = esc(nick());
    app.innerHTML = `
    <div class="page">
      <header class="bar">
        <span class="who">${n}</span>
        <nav aria-label="기록 관리">
          <button class="btn" data-act="import">캡처로 추가</button>
          <button class="btn" data-act="add">직접 추가</button>
          <button class="btn" data-act="theme">색 바꾸기</button>
          <button class="btn" data-act="data">백업·설정</button>
        </nav>
      </header>
      <section class="hero" aria-labelledby="hero-title">
        <div class="mast26" aria-hidden="true">2026<i class="sq-in"></i></div>
        <div class="hero-title">
          <h1 id="hero-title">${n}의<br>2026년 공연</h1>
        </div>
        <dl class="hero-stats">
          <div class="stat big"><dt>관람</dt><dd>${st.count}<small>회</small></dd></div>
          <div class="stat money"><dt>티켓 지출</dt><dd>${U.won(st.spend)}</dd></div>
          <div class="stat"><dt>공연장</dt><dd>${st.venueCount}<small>곳</small></dd></div>
          <div class="stat"><dt>아티스트</dt><dd>${st.artistCount}<small>팀</small></dd></div>
        </dl>
        <div class="hero-cta">
          ${st.count ? '<a class="btn-solid" href="#recap">2026 CONCERT RECAP</a>' : '<button class="btn-solid" data-act="import">캡처로 추가</button>'}
        </div>
      </section>
      ${alertsHTML(st)}
      <section aria-labelledby="g-title">
        <div class="section-head"><h2 id="g-title">올해의 포스터</h2></div>
        ${galleryHTML(st)}
      </section>
      ${ledgerHTML()}
      <footer class="foot">
        <span>공연 정보 출처: KOPIS 공연예술통합전산망</span>
      </footer>
    </div>`;
    hydrate(app);
    layoutGallery();
  }

  function layoutGallery() {
    const g = document.getElementById('gallery');
    if (!g) return;
    const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
    const per = Math.max(1, Math.floor(cols / 2));
    [...g.children].forEach((u, i) => u.classList.toggle('flip', Math.floor(i / per) % 2 === 1));
  }

  /* ---------- 리캡 ---------- */
  /* 달마다 그 달에 본 공연 포스터를 아래부터 쌓는다. 많으면 겹쳐 쌓는다 */
  function posterChartHTML(st) {
    const byMonth = Array.from({ length: 12 }, () => []);
    st.included.forEach((r) => byMonth[Number(r.date.slice(5, 7)) - 1].push(r));
    const peak = new Set(st.peakMonths);
    const pm = st.peakMonths[0];
    const note = st.peakMonths.length > 1 ? `${st.peakMonths.join(', ')}월에 ${st.monthMax}회씩` : `${pm}월, 가장 많이 본 달`;
    return `<div class="pchart" id="pchart" role="group" aria-label="2026년 월별 관람 포스터">
      ${byMonth.map((list, i) => `<div class="pc-col${peak.has(i + 1) ? ' peak' : ''}" data-n="${list.length}" data-m="${i + 1}">
        ${list.map((r) => `<button class="pc-tile" data-act="detail" data-id="${r.id}" aria-label="${U.md(r.date)} ${esc(r.title)}" title="${U.md(r.date)} ${esc(r.title)}">${r.posterId ? `<img data-poster="${r.posterId}" alt="">` : '<span class="fallback"></span>'}</button>`).join('')}
        ${list.length ? `<span class="pc-cnt">${list.length}</span>` : ''}
        <span class="pc-m">${i + 1}</span>
      </div>`).join('')}
      ${pm ? `<span class="pc-anno" id="pc-anno">${note}</span>` : ''}
    </div>`;
  }

  function layoutPosterChart() {
    const el = document.getElementById('pchart');
    if (!el) return;
    const cols = [...el.querySelectorAll('.pc-col')];
    el.style.height = '';
    const colW = cols[0].clientWidth;
    const maxH = el.clientHeight;
    const room = maxH - 64; // 위쪽 숫자·주석 자리
    const max = Math.max(1, ...cols.map((c) => +c.dataset.n));
    const tw = Math.max(14, Math.min(84, colW * (colW < 40 ? 0.88 : 0.8)));
    let th = tw * 1.414;
    if (th > room) th = room;
    const step = max <= 1 ? th : Math.min(th + 3, (room - th) / (max - 1));
    el.classList.toggle('overlap', step < th);
    el.style.height = Math.min(maxH, Math.ceil((max - 1) * step + th + 64)) + 'px';
    let peakTop = 0, peakX = 0;
    cols.forEach((c) => {
      const n = +c.dataset.n;
      c.querySelectorAll('.pc-tile').forEach((t, k) => {
        t.style.width = tw + 'px'; t.style.height = th + 'px';
        t.style.bottom = (k * step) + 'px'; t.style.zIndex = String(k + 1);
      });
      const top = n ? (n - 1) * step + th : 0;
      const cnt = c.querySelector('.pc-cnt');
      if (cnt) cnt.style.bottom = (top + 6) + 'px';
      if (c.classList.contains('peak') && !peakX) { peakTop = top; peakX = c.offsetLeft + colW / 2; }
    });
    const anno = document.getElementById('pc-anno');
    if (anno) {
      anno.style.bottom = (peakTop + 34) + 'px';
      const right = peakX < el.clientWidth * 0.62;
      anno.classList.toggle('left', !right);
      anno.style.left = right ? peakX + 'px' : '';
      anno.style.right = right ? '' : (el.clientWidth - peakX) + 'px';
    }
  }

  function chartBlock(st) {
    const style = state.chartStyle === 'bar' ? 'bar' : 'poster';
    return `<div class="chart-toggle" role="group" aria-label="차트 모양">
        <button class="btn quiet" data-act="chart-style" data-s="poster" aria-pressed="${style === 'poster'}">포스터</button>
        <button class="btn quiet" data-act="chart-style" data-s="bar" aria-pressed="${style === 'bar'}">막대</button>
      </div>
      <div id="chart-area">${style === 'poster' ? posterChartHTML(st) : chartSVG(st)}</div>`;
  }

  function chartSVG(st) {
    const W = 720, H = 268, L = 6, Rr = 6, top = 58, base = 222;
    const slot = (W - L - Rr) / 12;
    const bw = Math.min(24, slot * 0.4);
    const max = Math.max(1, st.monthMax);
    let g = '';
    const tops = [];
    for (let i = 0; i < 12; i++) {
      const c = st.months[i];
      const bh = c ? Math.max(3, (base - top) * (c / max)) : 0;
      const x = L + slot * i + (slot - bw) / 2;
      const peak = c > 0 && c === st.monthMax;
      tops.push([x + bw / 2, base - bh]);
      g += `<g class="m" tabindex="0" role="img" aria-label="${i + 1}월 ${c}회" data-tip="${i + 1}월 ${c}회">
        <rect class="hit" x="${(L + slot * i).toFixed(1)}" y="${top - 20}" width="${slot.toFixed(1)}" height="${base - top + 50}"></rect>
        ${bh ? `<rect class="bar-r${peak ? ' peak-bar' : ''}" x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"></rect>` : ''}
        ${c ? `<text class="cnt" x="${(x + bw / 2).toFixed(1)}" y="${(base - bh - 7).toFixed(1)}" text-anchor="middle">${c}</text>` : ''}
        <text x="${(x + bw / 2).toFixed(1)}" y="${base + 22}" text-anchor="middle">${i + 1}</text>
      </g>`;
    }
    let anno = '';
    if (st.peakMonths.length) {
      const [px, py] = tops[st.peakMonths[0] - 1];
      const note = st.peakMonths.length > 1 ? `${st.peakMonths.join(', ')}월에 ${st.monthMax}회씩` : `${st.peakMonths[0]}월, 가장 많이 본 달`;
      const right = px < W * 0.62;
      const tx = right ? px + 14 : px - 14;
      anno = `<path class="lead" d="M${px.toFixed(1)} ${(py - 24).toFixed(1)} V18 H${tx.toFixed(1)}"></path>
        <text class="anno" x="${(right ? tx + 6 : tx - 6).toFixed(1)}" y="22" text-anchor="${right ? 'start' : 'end'}">${note}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="2026년 월별 관람 횟수">
      ${anno}${g}<line class="base" x1="0" x2="${W}" y1="${base + 0.75}" y2="${base + 0.75}"></line></svg>`;
  }

  function archiveHTML(st) {
    const cols = window.innerWidth < 700 ? 3 : 5;
    const r = U.rng(U.hash(state.nickname + st.count));
    const cells = [];
    st.included.forEach((rec, i) => {
      if (i > 0 && r() < 0.34) cells.push('<div aria-hidden="true"></div>');
      const low = r() < 0.4;
      const right = r() < 0.5;
      const no = `<span class="no${right ? ' r' : ''}">( ${i + 1} )</span>`;
      cells.push(`<figure class="arch${low ? ' low' : ''}" style="margin:0">
        ${low ? '' : no}
        <button data-act="detail" data-id="${rec.id}" aria-label="${esc(rec.title)} 자세히 보기">
          ${rec.posterId ? `<img data-poster="${rec.posterId}" alt="${esc(rec.title)} 포스터">` : `<span class="fallback-poster">${esc(rec.title)}</span>`}
        </button>
        ${low ? no : ''}
        <figcaption class="cap">${U.md(rec.date)} ${esc(rec.title)}</figcaption>
      </figure>`);
    });
    return `<div class="archive-grid" style="--acols:${cols}" data-cols="${cols}">${cells.join('')}</div>`;
  }

  function topList(list, unit) {
    return `<ol>${list.list.slice(0, 5).map((e) => `<li><span>${esc(e.name)}</span><span>${e.count}${unit}</span></li>`).join('')}</ol>`;
  }

  function viewRecap() {
    const st = stats();
    document.body.classList.add('recap-page');
    const n = esc(nick());
    const empty = !st.count;
    app.innerHTML = `
    <div class="page recap">
      <header class="bar">
        <a class="btn" href="#">메인으로</a>
        <nav aria-label="리캡 도구"><button class="btn" data-act="theme">색 바꾸기</button><button class="btn" data-act="export">이미지 저장</button></nav>
      </header>
      <section class="recap-head">
        <div>
          <h1>${n}의 2026년<br>콘서트 기록</h1>
        </div>
        <div class="year-mark" aria-hidden="true">20<sup>26</sup></div>
      </section>
      ${empty ? `<div class="empty"><h2>관람 완료한 공연이 없어요</h2><div class="row"><button class="btn-solid" data-act="import">캡처로 추가</button></div></div>` : `
      <section class="recap-stats" aria-label="올해의 숫자">
        <div class="rstat"><span class="lbl">관람</span><span class="val">${st.count}<small>회</small></span><span class="sub">공연 ${st.showCount}개</span><button class="btn quiet why" data-act="basis" data-k="count">근거</button></div>
        <div class="rstat"><span class="lbl">공연장</span><span class="val">${st.venueCount}<small>곳</small></span><button class="btn quiet why" data-act="basis" data-k="venue">근거</button></div>
        <div class="rstat"><span class="lbl">아티스트</span><span class="val">${st.artistCount}<small>팀</small></span><button class="btn quiet why" data-act="basis" data-k="artist">근거</button></div>
        <div class="rstat wide"><span class="lbl">티켓 지출</span><span class="val">${U.won(st.spend)}</span>
          ${st.missingCost.length ? `<span class="sub">금액 미입력 ${st.missingCost.length}건 제외</span>` : ''}
          <button class="btn quiet why" data-act="basis" data-k="spend">근거</button></div>
      </section>
      <section class="chart-wrap" aria-labelledby="chart-title">
        <div>
          <h2 id="chart-title">월별 관람</h2>
          <div class="peak">${st.peakMonths[0] || '–'}<small>월</small></div>
          <p class="chart-note">${st.peakMonths.length > 1 ? `${st.peakMonths.join(', ')}월 ${st.monthMax}회씩` : `${st.monthMax}회`}</p>
        </div>
        <div>
          ${chartBlock(st)}
          <div class="chart-table"><button class="btn quiet" data-act="chart-table" aria-expanded="false">표로 보기</button>
            <table hidden><caption class="sr">월별 관람 횟수</caption><thead><tr><th>월</th><th>관람</th></tr></thead><tbody>${st.months.map((c, i) => `<tr><td>${i + 1}월</td><td>${c}회</td></tr>`).join('')}</tbody></table>
          </div>
        </div>
      </section>
      <section class="bests">
        <div class="best"><span class="lbl">가장 많이 본 아티스트</span>
          <h3>${st.artists.top.map((e) => esc(e.name)).join(', ') || '–'}</h3>
          ${topList(st.artists, '회')}</div>
        <div class="best"><span class="lbl">가장 자주 간 공연장</span>
          <h3>${st.venues.top.map((e) => esc(e.name)).join(', ') || '–'}</h3>
          ${topList(st.venues, '회')}</div>
      </section>
      ${st.multiDay.length ? `<section class="multi" aria-labelledby="multi-title">
        <h2 id="multi-title">여러 날 본 공연</h2>
        <ol>${st.multiDay.map((g) => `<li><span class="m-days">${g.days}<small>일</small></span><span class="m-title">${esc(g.title)}<small>${g.records.map((r) => U.md(r.date)).join(' · ')}${g.period ? ` / 기간 ${U.md(g.period.from)}–${U.md(g.period.to)}` : ''}</small></span></li>`).join('')}</ol>
      </section>` : ''}
      <section class="archive" aria-labelledby="arch-title">
        <div class="section-head" style="padding:0"><h2 id="arch-title">올해의 포스터 ${st.count}장</h2></div>
        <div id="archive">${archiveHTML(st)}</div>
      </section>`}
      <details class="basis">
        <summary>계산 기준</summary>
        <dl>
          <dt>관람</dt><dd>2026년 관람 완료 1건 = 1회 (2매 예매도 1회, 이틀 보면 2회)</dd>
          <dt>제외</dt><dd>예정 ${st.excludedCount.planned || 0} · 취소 ${st.excludedCount.canceled || 0} · 다른 해 ${st.excludedCount.year || 0}${st.excludedCount.nodate ? ` · 날짜 없음 ${st.excludedCount.nodate}` : ''}</dd>
          <dt>지출</dt><dd>관람 완료 기록의 본인 부담 금액 합${st.missingCost.length ? ` (미입력 ${st.missingCost.length}건 제외)` : ''}</dd>
          <dt>중복</dt><dd>${st.duplicates.length ? `${st.duplicates.length}묶음 <button class="btn" data-act="dups">확인</button>` : '없음'}</dd>
        </dl>
      </details>
      <div class="recap-dock">
        <button class="btn-line" data-act="theme">색 바꾸기</button>
        <button class="btn-solid" data-act="export"${empty ? ' disabled' : ''}>이미지 저장</button>
      </div>
    </div>`;
    hydrate(app);
    bindChartTips();
    layoutPosterChart();
    window.scrollTo(0, 0);
  }

  function bindChartTips() {
    const svg = app.querySelector('.chart');
    if (!svg) return;
    let tip = document.querySelector('.chart-tip');
    if (!tip) { tip = document.createElement('div'); tip.className = 'chart-tip'; tip.hidden = true; document.body.appendChild(tip); }
    const show = (g) => {
      const bar = g.querySelector('.bar-r') || g.querySelector('text');
      const rc = bar.getBoundingClientRect();
      tip.textContent = g.dataset.tip;
      tip.style.left = rc.left + rc.width / 2 + 'px';
      tip.style.top = rc.top + 'px';
      tip.hidden = false;
    };
    svg.querySelectorAll('g.m').forEach((g) => {
      g.addEventListener('pointerenter', () => show(g));
      g.addEventListener('focus', () => show(g));
      g.addEventListener('pointerleave', () => { tip.hidden = true; });
      g.addEventListener('blur', () => { tip.hidden = true; });
    });
    window.addEventListener('scroll', () => { tip.hidden = true; }, { passive: true, once: true });
  }

  /* ---------- 기록 입력 ---------- */
  function cleanVenue(v) {
    return String(v || '').replace(/\s+/g, ' ')
      .replace(/\s*\(\s*구(?:\s*[.:]|\s)\s*[^)]*\)/g, '') // (구. 옛 이름)
      .replace(/^(.+?)\s*\((.+)\)$/, (m, a, b) => (S.norm(a) === S.norm(b) ? a : m)).trim();
  }

  function openForm(opts) {
    opts = opts || {};
    const rec = opts.record || null;
    const pre = Object.assign({ title: '', artists: [], date: '', venue: '', vendor: '', vendorOther: '', cost: null, status: '', memo: '', kopisId: '', period: null }, rec || {}, opts.prefill || {});
    const auto = new Set(opts.auto || []);
    let artists = (pre.artists || []).slice();
    let newPoster = null; // {blob, ratio}
    let removePoster = false;
    let statusTouched = !!rec;
    let dupConfirmed = false;
    let kopisId = pre.kopisId || '';
    let period = pre.period || null;
    const selected = new Set(pre.date ? [pre.date] : []);
    const today = U.todayStr();
    if (!pre.status) pre.status = pre.date && pre.date > today ? 'planned' : 'done';
    const a = (k) => (auto.has(k) ? ' auto' : '');
    const hints = (opts.hints || []).slice(0, 3);
    const curPoster = rec ? rec.posterId : (pre.sharePoster || null);
    const curRatio = rec ? rec.posterRatio : (pre.sharePosterRatio || null);

    const html = `${head(rec ? '기록 고치기' : '공연 기록')}
      <form class="dlg-body" id="rec-form" novalidate>
        ${auto.size || hints.length ? `<div class="notice">자동으로 채운 칸을 확인하세요.${hints.length ? `<ul>${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        <div class="kopis-box" id="kopis-box" hidden>
          <div class="k-search"><input type="search" id="k-q" class="input" placeholder="KOPIS에서 공연 찾기" value="${esc(pre.title)}" enterkeyhint="search"><button class="btn-line" type="button" id="k-go">찾기</button></div>
          <div id="k-results" aria-live="polite"></div>
        </div>
        <label class="field${a('title')}" data-f="title"><span>공연명</span><input type="text" name="title" value="${esc(pre.title)}" required maxlength="120"></label>
        <div class="field${a('artists')}" data-f="artists"><span>아티스트</span>
          <div class="chips" id="chips"></div>
          <div class="pick-row"><input type="search" id="a-q" class="input" placeholder="아티스트 검색" autocomplete="off" enterkeyhint="search"><button class="btn-line" type="button" id="a-go">찾기</button></div>
          <div class="pick-list" id="a-list" hidden></div>
        </div>
        <div class="field${a('date')}" data-f="date"><span>관람일</span><div id="dates"></div></div>
        <div class="field${a('venue')}" data-f="venue"><span>공연장</span>
          <input type="hidden" name="venue" value="${esc(pre.venue)}">
          <div class="chips" id="venue-picked"></div>
          <div class="pick-row"><input type="search" id="v-q" class="input" placeholder="공연장 검색" autocomplete="off" enterkeyhint="search"><button class="btn-line" type="button" id="v-go">찾기</button></div>
          <div class="pick-list" id="v-list" hidden></div>
        </div>
        <div class="grid2">
          <label class="field${a('vendor')}"><span>예매처</span>
            <select name="vendor"><option value="">선택 안 함</option>${Object.entries(VENDORS).map(([k, v]) => `<option value="${k}"${pre.vendor === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            <input type="text" name="vendorOther" value="${esc(pre.vendorOther)}" placeholder="예매처 이름" ${pre.vendor === 'other' ? '' : 'hidden'} maxlength="40"></label>
          <label class="field${a('cost')}"><span>내가 낸 금액 (원)</span><input type="text" name="cost" inputmode="numeric" value="${U.isNum(pre.cost) ? U.comma(pre.cost) : ''}" placeholder="0">
            ${opts.tickets > 1 && U.isNum(pre.cost) ? `<button class="btn" type="button" id="split">${opts.tickets}매로 나누기 (${U.won(Math.round(pre.cost / opts.tickets))})</button>` : ''}</label>
        </div>
        <fieldset class="field${a('status')}" style="border:0;margin:0;padding:0"><legend>상태</legend>
          <div class="seg">${Object.entries(STATUS).map(([k, v]) => `<label><input type="radio" name="status" value="${k}"${pre.status === k ? ' checked' : ''}>${v}</label>`).join('')}</div>
        </fieldset>
        <div class="field" data-f="poster"><span>포스터</span>
          <div class="poster-pick">
            <div class="thumb" id="thumb">${curPoster ? `<img data-poster="${curPoster}" alt="현재 포스터">` : '없음'}</div>
            <div class="acts">
              <span class="btn-line file-btn">고르기<input type="file" accept="image/*" id="poster-file" aria-label="포스터 이미지 고르기"></span>
              <button class="btn" type="button" id="poster-remove" ${curPoster ? '' : 'hidden'}>빼기</button>
            </div>
          </div>
        </div>
        <label class="field"><span>메모</span><textarea name="memo" maxlength="1000">${esc(pre.memo)}</textarea></label>
        <div class="notice" id="dup-warn" hidden></div>
        <p class="err" id="form-err" hidden></p>
      </form>
      <footer class="dlg-foot"><button class="btn quiet spacer" data-close type="button">취소</button><button class="btn-solid" type="submit" form="rec-form" id="save-btn">저장</button></footer>
`;
    const d = openDialog(html);
    const f = d.querySelector('#rec-form');
    hydrate(d);
    const markAuto = (k) => { const el = f.querySelector(`[data-f="${k}"]`); if (el) el.classList.add('auto'); };

    /* 아티스트 */
    const chips = d.querySelector('#chips');
    const drawChips = () => {
      chips.innerHTML = artists.map((x, i) => `<span class="chip">${esc(x)}<button type="button" data-i="${i}" aria-label="${esc(x)} 빼기">×</button></span>`).join('');
    };
    drawChips();
    const addArtist = (v) => {
      for (const part of String(v).split(/[,，]/)) {
        const t = part.trim().replace(/\s+/g, ' ');
        if (t && !artists.some((x) => S.norm(x) === S.norm(t))) artists.push(t);
      }
      drawChips();
    };
    chips.addEventListener('click', (e) => { const b = e.target.closest('button[data-i]'); if (b) { artists.splice(+b.dataset.i, 1); drawChips(); } });

    /* 검색해서 고르기 (아티스트·공연장 공용) */
    let kopisOn = false;
    const castPool = new Set();
    function picker(cfg) {
      const input = d.querySelector(cfg.input), list = d.querySelector(cfg.list), go = d.querySelector(cfg.go);
      let timer = null, seq = 0, rows = [];
      const draw = (q, remote, state, reason) => {
        if (!q) { list.hidden = true; list.innerHTML = ''; return; }
        rows = cfg.local(q).map((r) => Object.assign({ src: '내 기록' }, r));
        (remote || []).forEach((r) => { if (!rows.some((x) => S.norm(x.value) === S.norm(r.value))) rows.push(Object.assign({ src: 'KOPIS' }, r)); });
        list.innerHTML = rows.map((r, i) => `<button type="button" class="pick-item" data-i="${i}"><span><b>${esc(r.label)}</b>${r.meta ? `<small>${esc(r.meta)}</small>` : ''}</span><em>${r.src}</em></button>`).join('')
          + (state === 'loading' ? '<p class="pick-note">KOPIS에서 찾는 중…</p>' : '')
          + (state === 'error' ? `<p class="pick-note">KOPIS에 연결하지 못했어요${reason ? ` · ${esc(reason)}` : ''}</p>` : '')
          + (state === 'done' && !rows.length ? '<p class="pick-note">찾지 못했어요.</p>' : '')
          + `<button type="button" class="pick-add" data-add="1">목록에 없으면 ‘${esc(q)}’로 추가</button>`;
        list.hidden = false;
      };
      const remote = async (q) => {
        if (!kopisOn || q.length < 2) return;
        const my = ++seq;
        draw(q, [], 'loading');
        try { const r = await cfg.remote(q); if (my === seq && input.value.trim() === q) draw(q, r, 'done'); }
        catch (e) { if (my === seq) draw(q, [], 'error', K.why(e)); }
      };
      input.addEventListener('input', () => {
        const q = input.value.trim();
        clearTimeout(timer); seq++;
        draw(q);
        if (q.length >= 2) timer = setTimeout(() => remote(q), 800);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); clearTimeout(timer); remote(input.value.trim()); } });
      go.addEventListener('click', () => { clearTimeout(timer); const q = input.value.trim(); if (!q) { input.focus(); return; } draw(q); remote(q); });
      list.addEventListener('click', async (e) => {
        const add = e.target.closest('[data-add]'), it = e.target.closest('.pick-item');
        const q = input.value.trim();
        if (add) { await cfg.pick({ value: q, label: q }); }
        else if (it) { await cfg.pick(rows[+it.dataset.i], list); }
        else return;
        if (!list.dataset.keep) { input.value = ''; list.hidden = true; list.innerHTML = ''; }
      });
    }

    const has = (a, q) => S.norm(a).includes(S.norm(q));
    picker({
      input: '#a-q', list: '#a-list', go: '#a-go',
      local: (q) => [...new Set(state.records.flatMap((r) => r.artists || []).concat([...castPool]))]
        .filter((x) => has(x, q) && !artists.some((y) => S.norm(y) === S.norm(x))).slice(0, 8).map((x) => ({ value: x, label: x })),
      remote: (q) => K.artistSearch(q, [...selected].sort()[0] || (datesBox.querySelector('input[name=date]') || {}).value || '')
        .then((r) => r.map((x) => ({ value: x.name, label: x.name, meta: `KOPIS 공연 ${x.shows}건` }))),
      pick: (r) => addArtist(r.value),
    });

    const venuePicked = d.querySelector('#venue-picked');
    const setVenue = (v) => {
      f.venue.value = v || '';
      venuePicked.innerHTML = v ? `<span class="chip">${esc(v)}<button type="button" data-clear="1" aria-label="공연장 빼기">×</button></span>` : '';
    };
    setVenue(pre.venue);
    venuePicked.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) setVenue(''); });
    const vList = d.querySelector('#v-list');
    picker({
      input: '#v-q', list: '#v-list', go: '#v-go',
      local: (q) => [...new Set(state.records.map((r) => r.venue).filter(Boolean))].filter((x) => has(x, q)).slice(0, 8).map((x) => ({ value: x, label: x })),
      remote: (q) => K.venueSearch(q).then((r) => r.map((x) => ({ value: cleanVenue(x.name), label: cleanVenue(x.name), id: x.id, halls: x.halls,
        meta: [x.sido, x.gugun].filter(Boolean).join(' ') + (x.halls > 1 ? ` · 공연장 ${x.halls}곳` : '') }))),
      pick: async (r) => {
        if (r.src === 'KOPIS' && r.halls > 1) {
          vList.dataset.keep = '1';
          vList.innerHTML = '<p class="pick-note">공연장 불러오는 중…</p>';
          let halls = [];
          try { halls = await K.placeHalls(r.id); } catch (e) { /* 시설 이름만 */ }
          vList.innerHTML = `<p class="pick-note">${esc(r.value)}의 어느 공연장인가요?</p>`
            + halls.map((h) => `<button type="button" class="pick-hall" data-v="${esc(`${r.value} (${h.name})`)}"><b>${esc(h.name)}</b>${h.seats ? `<small>${U.comma(h.seats)}석</small>` : ''}</button>`).join('')
            + `<button type="button" class="pick-hall" data-v="${esc(r.value)}">${esc(r.value)} (공연장 모름)</button>`;
          vList.onclick = (e) => {
            const b = e.target.closest('.pick-hall');
            if (!b) return;
            setVenue(b.dataset.v);
            delete vList.dataset.keep; vList.onclick = null;
            d.querySelector('#v-q').value = ''; vList.hidden = true; vList.innerHTML = '';
          };
          return;
        }
        setVenue(r.value);
      },
    });

    /* 관람일: 새 기록은 여러 날을 한 번에 고를 수 있다 */
    const datesBox = d.querySelector('#dates');
    const autoStatus = () => {
      if (statusTouched || rec) return;
      const ds = [...selected];
      const v = ds.length && ds.every((x) => x > today) ? 'planned' : 'done';
      f.querySelector(`input[name=status][value=${v}]`).checked = true;
    };
    const drawDates = () => {
      if (rec) {
        datesBox.innerHTML = `<input type="date" name="date" value="${esc(pre.date)}" required min="2000-01-01" max="2099-12-31" aria-label="관람일">`;
        return;
      }
      const list = period ? K.days(period.from, period.to, 14) : null;
      const others = [...selected].filter((x) => !list || !list.includes(x)).sort();
      let h = '';
      if (period) h += `<p class="period">공연 기간 ${U.dots(period.from)} – ${U.md(period.to)}${list ? ` · ${list.length}일` : ''}</p>`;
      if (list) {
        h += `<div class="days">${list.map((x) => `<label class="day"><input type="checkbox" value="${x}"${selected.has(x) ? ' checked' : ''}><b>${U.md(x)}</b><span>${U.weekday(x)}</span></label>`).join('')}</div>`;
      }
      if (others.length) h += `<div class="chips">${others.map((x) => `<span class="chip">${U.md(x)} ${U.weekday(x)}<button type="button" data-del="${x}" aria-label="${U.dots(x)} 빼기">×</button></span>`).join('')}</div>`;
      h += `<label class="add-day"><span>${list ? '다른 날' : selected.size ? '하루 더' : '날짜'}</span><input type="date" id="add-day" min="2000-01-01" max="2099-12-31"></label>`;
      if (selected.size > 1) h += `<p class="period">${selected.size}일 → 기록 ${selected.size}개로 저장</p>`;
      datesBox.innerHTML = h;
      const costLbl = f.cost && f.cost.closest('label').querySelector('span');
      if (costLbl) costLbl.textContent = selected.size > 1 ? '하루당 낸 금액 (원)' : '내가 낸 금액 (원)';
    };
    drawDates();
    datesBox.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'add-day') { if (U.isDate(t.value)) selected.add(t.value); drawDates(); }
      else if (t.type === 'checkbox') { t.checked ? selected.add(t.value) : selected.delete(t.value); drawDates(); }
      else if (t.name === 'date') { pre.date = t.value; }
      dupConfirmed = false;
      autoStatus();
    });
    datesBox.addEventListener('click', (e) => { const b = e.target.closest('[data-del]'); if (b) { selected.delete(b.dataset.del); drawDates(); autoStatus(); } });

    f.vendor.addEventListener('change', () => { f.vendorOther.hidden = f.vendor.value !== 'other'; });
    f.querySelectorAll('input[name=status]').forEach((x) => x.addEventListener('change', () => { statusTouched = true; }));
    f.cost.addEventListener('blur', () => { const n = f.cost.value.replace(/[^\d]/g, ''); f.cost.value = n ? U.comma(Number(n)) : ''; });
    const split = d.querySelector('#split');
    if (split) split.addEventListener('click', () => { f.cost.value = U.comma(Math.round(pre.cost / opts.tickets)); split.remove(); });
    f.title.addEventListener('input', () => { dupConfirmed = false; });

    /* 포스터 */
    const thumb = d.querySelector('#thumb');
    const setPoster = (p) => {
      newPoster = p; removePoster = false;
      thumb.innerHTML = `<img src="${URL.createObjectURL(p.blob)}" alt="포스터 미리보기">`;
      d.querySelector('#poster-remove').hidden = false;
    };
    d.querySelector('#poster-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      thumb.textContent = '…';
      try { setPoster(await processImage(file, 1400)); } catch (err) { thumb.textContent = '읽지 못함'; }
    });
    d.querySelector('#poster-remove').addEventListener('click', () => {
      newPoster = null; removePoster = true; thumb.textContent = '없음';
      d.querySelector('#poster-remove').hidden = true;
    });

    /* KOPIS 찾기 */
    const kbox = d.querySelector('#kopis-box'), kres = d.querySelector('#k-results'), kq = d.querySelector('#k-q');
    let kList = [];
    const drawResults = (res, chosenId) => {
      kList = res ? res.list.slice(0, 6) : [];
      if (!res) { kres.innerHTML = ''; return; }
      if (!kList.length) { kres.innerHTML = '<p class="help">KOPIS에서 찾지 못했어요. 공연명을 고쳐서 다시 찾아보세요.</p>'; return; }
      kres.innerHTML = `<div class="k-list">${kList.map((c, i) => `<button type="button" class="k-item" data-k="${i}" aria-pressed="${c.id === chosenId}">
          <span class="k-img">${c.poster ? `<img src="/api/kopis?poster=${encodeURIComponent(c.poster)}" alt="" loading="lazy">` : ''}</span>
          <span class="k-txt"><b>${esc(c.title)}</b><small>${U.dots(c.from)} – ${U.md(c.to)} · ${esc(cleanVenue(c.venue))}</small></span></button>`).join('')}</div>
        <p class="src">출처: KOPIS 공연예술통합전산망</p>`;
    };
    const choose = async (c) => {
      kres.querySelectorAll('.k-item').forEach((b) => b.setAttribute('aria-pressed', String(kList[+b.dataset.k] && kList[+b.dataset.k].id === c.id)));
      let info = c;
      try { info = Object.assign({}, c, await K.detail(c.id)); } catch (e) { /* 목록 정보로 채움 */ }
      f.title.value = info.title; markAuto('title');
      kopisId = info.id;
      if (info.venue) { setVenue(cleanVenue(info.venue)); markAuto('venue'); }
      K.castList(info.cast).forEach((x) => castPool.add(x)); // 멤버 이름은 아티스트 검색 추천에
      const picks = K.pickArtists(info.title, info.cast);
      if (picks.length) { picks.forEach((x) => { castPool.add(x); addArtist(x); }); markAuto('artists'); }
      if (info.from && info.to) {
        period = { from: info.from, to: info.to };
        if (!rec) {
          const list = K.days(info.from, info.to, 14);
          if (list && list.length === 1) selected.add(list[0]);
          drawDates(); autoStatus(); markAuto('date');
        }
      }
      if (info.poster && !(curPoster && !removePoster) && !newPoster) {
        thumb.textContent = '…';
        try {
          const blob = await K.posterBlob(info.poster);
          if (blob) { setPoster(await processImage(blob, 1400)); markAuto('poster'); }
          else thumb.textContent = '없음';
        } catch (e) { thumb.textContent = '없음'; }
      }
    };
    kres.addEventListener('click', (e) => { const b = e.target.closest('.k-item'); if (b) choose(kList[+b.dataset.k]); });
    const runSearch = async () => {
      const q = kq.value.trim() || f.title.value.trim();
      if (!q) { kq.focus(); return; }
      kres.innerHTML = '<p class="help">찾는 중…</p>';
      const first = rec ? (datesBox.querySelector('input[name=date]') || {}).value : [...selected].sort()[0];
      try { drawResults(await K.searchAll({ title: q, date: first || '', venue: f.venue.value })); }
      catch (e) { const r = K.why(e); kres.innerHTML = `<p class="help">KOPIS에 연결하지 못했어요${r ? ` · ${esc(r)}` : ''}</p>`; }
    };
    d.querySelector('#k-go').addEventListener('click', runSearch);
    kq.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runSearch(); } });
    K.enabled().then((on) => {
      kopisOn = on;
      if (!on) return;
      kbox.hidden = false;
      if (opts.kopis) {
        drawResults(opts.kopis);
        if (opts.kopis.confident && opts.kopis.list[0]) choose(opts.kopis.list[0]);
      }
    });

    /* 저장 */
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = d.querySelector('#form-err');
      const title = f.title.value.trim();
      const addDay = datesBox.querySelector('#add-day');
      if (addDay && U.isDate(addDay.value)) selected.add(addDay.value);
      const dates = rec ? [(datesBox.querySelector('input[name=date]') || {}).value] : [...selected].sort();
      const okDates = dates.filter((x) => U.isDate(x));
      const problems = [];
      if (!title) problems.push('공연명을 적어 주세요.');
      if (!okDates.length) problems.push('관람일을 골라 주세요.');
      f.querySelector('[data-f=title]').classList.toggle('invalid', !title);
      f.querySelector('[data-f=date]').classList.toggle('invalid', !okDates.length);
      if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }
      err.hidden = true;
      const ids = new Set(rec ? [rec.id] : []);
      const dups = okDates.filter((dt) => state.records.some((r) => !ids.has(r.id) && r.date === dt &&
        ((kopisId && r.kopisId === kopisId) || S.norm(r.title) === S.norm(title))));
      if (dups.length && !dupConfirmed) {
        const w = d.querySelector('#dup-warn');
        w.innerHTML = `<strong>${dups.map(U.md).join(', ')}에 같은 공연 기록이 이미 있어요.</strong> 그래도 저장하려면 한 번 더 누르세요.`;
        w.hidden = false;
        w.scrollIntoView({ block: 'center', behavior: 'smooth' });
        dupConfirmed = true;
        return;
      }
      const costDigits = f.cost.value.replace(/[^\d]/g, '');
      const chosen = (f.querySelector('input[name=status]:checked') || {}).value || 'done';
      const base = {
        title, artists: artists.slice(),
        venue: f.venue.value.trim(),
        vendor: f.vendor.value,
        vendorOther: f.vendor.value === 'other' ? f.vendorOther.value.trim() : '',
        cost: costDigits === '' ? null : Number(costDigits),
        memo: f.memo.value.trim(),
        kopisId: kopisId || '',
        period: period || null,
        updatedAt: Date.now(),
      };
      let posterId = curPoster, posterRatio = curRatio;
      const oldPoster = rec ? rec.posterId : null;
      try {
        if (newPoster) {
          posterId = 'poster-' + U.uid();
          await DB.putPoster(posterId, newPoster.blob);
          posterRatio = newPoster.ratio;
        } else if (removePoster) { posterId = null; posterRatio = null; }
      } catch (e2) {
        err.textContent = '포스터를 저장하지 못했어요.'; err.hidden = false; return;
      }
      const now = Date.now();
      okDates.forEach((dt, i) => {
        const status = chosen === 'canceled' || statusTouched || rec ? chosen : (dt > today ? 'planned' : 'done');
        if (rec) {
          const out = Object.assign({}, rec, base, { date: dt, status, posterId, posterRatio });
          const k = state.records.findIndex((r) => r.id === rec.id);
          state.records[k] = out;
        } else {
          state.records.push(Object.assign({ id: U.uid(), createdAt: now + i, source: (opts.prefill && opts.prefill.source) || 'manual' }, base, { date: dt, status, posterId, posterRatio }));
        }
      });
      save();
      if (oldPoster && oldPoster !== posterId) await releasePoster(oldPoster);
      d.close();
      render();
      toast(rec ? '저장했어요' : okDates.length > 1 ? `${okDates.length}일 기록했어요` : '기록했어요');
    });
    setTimeout(() => { if (!rec && !pre.title) f.title.focus(); }, 50);
  }

  function openDetail(id) {
    const r = state.records.find((x) => x.id === id);
    if (!r) return;
    const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(YEAR));
    const key = S.showKey(r);
    const same = state.records.filter((x) => S.showKey(x) === key && x.status === 'done').sort(byDate);
    const span = r.period ? K.days(r.period.from, r.period.to, 400) : null;
    const html = `${head(esc(r.title))}
      <div class="dlg-body">
        <div class="detail">
          <div>${r.posterId ? `<img data-poster="${r.posterId}" alt="${esc(r.title)} 포스터">` : `<span class="fallback-poster" style="position:relative;inset:auto;aspect-ratio:1/1.414;display:grid">${esc(r.title)}</span>`}</div>
          <div>
            <div class="d-date">${U.md(r.date)}</div>
            <p style="margin:6px 0 0;color:var(--accent-text)">${U.dots(r.date).slice(0, 4)}년 ${U.weekday(r.date)}요일</p>
            <h3>${esc(r.title)}</h3>
            <dl>
              <dt>아티스트</dt><dd>${esc((r.artists || []).join(', ')) || '미입력'}</dd>
              <dt>공연장</dt><dd>${esc(r.venue) || '미입력'}</dd>
              <dt>예매처</dt><dd>${r.vendor === 'other' ? esc(r.vendorOther || '기타') : VENDORS[r.vendor] || '미입력'}</dd>
              <dt>본인 부담</dt><dd>${U.won(r.cost)}</dd>
              <dt>상태</dt><dd>${STATUS[r.status] || ''}${other ? ' · 통계 제외' : r.status !== 'done' ? ' · 통계 제외' : ''}</dd>
              ${same.length > 1 ? `<dt>관람</dt><dd>${same.length}일 · ${same.map((x) => U.md(x.date)).join(', ')}</dd>` : ''}
              ${r.period ? `<dt>공연 기간</dt><dd>${U.dots(r.period.from)} – ${U.md(r.period.to)}${span ? ` (${span.length}일)` : ''}</dd>` : ''}
            </dl>
            ${r.memo ? `<p class="memo">${esc(r.memo)}</p>` : ''}
          </div>
        </div>
      </div>
      <footer class="dlg-foot">
        <button class="btn btn-danger spacer" id="del" type="button" style="border-bottom-color:currentColor">삭제</button>
        <button class="btn-line" id="again" type="button">다른 날 추가</button>
        <button class="btn-solid" id="edit" type="button">고치기</button>
      </footer>`;
    const d = openDialog(html);
    hydrate(d);
    d.querySelector('#edit').addEventListener('click', () => { d.close(); openForm({ record: r }); });
    d.querySelector('#again').addEventListener('click', () => {
      d.close();
      openForm({ prefill: { title: r.title, artists: r.artists, venue: r.venue, vendor: r.vendor, vendorOther: r.vendorOther, cost: r.cost, date: '', status: '', kopisId: r.kopisId || '', period: r.period || null, sharePoster: r.posterId || null, sharePosterRatio: r.posterRatio || null } });
    });
    d.querySelector('#del').addEventListener('click', async () => {
      if (!(await ask(`‘${r.title}’ (${U.dots(r.date)}) 기록을 삭제할까요? 되돌릴 수 없어요.`, { title: '기록 삭제', ok: '삭제', danger: true }))) return;
      state.records = state.records.filter((x) => x.id !== r.id);
      save();
      await releasePoster(r.posterId);
      d.close();
      render();
      toast('기록을 삭제했어요');
    });
  }

  /* ---------- 가져오기 ---------- */
  function openImport() {
    const html = `${head('캡처로 추가')}
      <div class="dlg-body">
        ${previewNote('글자 인식')}
        <label class="drop" id="drop"><strong>캡처 이미지 고르기</strong><span class="help">예매 완료 · 예매 내역 화면</span>
          <input type="file" accept="image/*" id="ocr-file" class="sr"></label>
        <div id="ocr-state" hidden><div class="progress"><i id="ocr-bar"></i></div><p class="help" id="ocr-msg">글자 읽는 중…</p></div>
      </div>`;
    const d = openDialog(html);
    const drop = d.querySelector('#drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) runOCR(e.dataTransfer.files[0]); });
    d.querySelector('#ocr-file').addEventListener('change', (e) => { if (e.target.files[0]) runOCR(e.target.files[0]); });

    async function runOCR(file) {
      const box = d.querySelector('#ocr-state'), bar = d.querySelector('#ocr-bar'), msg = d.querySelector('#ocr-msg');
      box.hidden = false; bar.style.width = '4%'; msg.textContent = '글자 읽는 중…';
      try {
        const prepared = await processImage(file, 2400);
        const text = await ocr(prepared.blob, (p) => { bar.style.width = Math.max(8, Math.round(p * 90)) + '%'; msg.textContent = `글자 읽는 중 ${Math.round(p * 100)}%`; });
        const res = P.parseBooking(text, { today: U.todayStr(), year: YEAR });
        msg.textContent = 'KOPIS에서 공연 찾는 중…'; bar.style.width = '95%';
        const kopis = await findOnKopis(res.fields, text);
        d.close();
        openForm({ prefill: Object.assign({}, res.fields, { source: 'ocr' }), auto: res.auto, hints: res.hints, tickets: res.tickets, kopis });
      } catch (e) {
        bar.style.width = '0';
        msg.textContent = '글자를 읽지 못했어요. ‘직접 추가’로 입력해 주세요.';
      }
    }
  }

  /* 읽은 글에서 KOPIS 후보 찾기. 연결이 안 돼 있으면 null */
  async function findOnKopis(fields, text) {
    if (!(await K.enabled())) return null;
    let title = fields.title;
    if (!title) {
      const lines = String(text || '').split('\n').map((l) => l.trim())
        .filter((l) => l.length >= 3 && l.length <= 60 && /[가-힣A-Za-z]{2}/.test(l) && !P.SENSITIVE.test(l));
      title = lines.sort((x, y) => y.length - x.length)[0] || '';
    }
    if (!title) return null;
    try { return await K.searchAll({ title, date: fields.date || '', venue: fields.venue || '', year: YEAR }); }
    catch (e) { return null; }
  }

  async function readText(file) {
    const buf = await file.arrayBuffer();
    let text = new TextDecoder('utf-8').decode(buf);
    if (text.includes('�')) {
      try { text = new TextDecoder('euc-kr').decode(buf); } catch (e) { /* 그대로 */ }
    }
    return text;
  }

  let tessP = null;
  function loadTesseract() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tessP) return tessP;
    tessP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = TESS_URL; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = () => (window.Tesseract ? res(window.Tesseract) : rej(new Error('no Tesseract')));
      s.onerror = () => { tessP = null; s.remove(); rej(new Error('load failed')); };
      document.head.appendChild(s);
    });
    return tessP;
  }
  async function ocr(blob, onProgress) {
    const Tess = await loadTesseract();
    const worker = await Tess.createWorker('kor+eng', 1, {
      logger: (m) => { if (m.status === 'recognizing text' && typeof m.progress === 'number') onProgress(m.progress); },
    });
    try {
      const { data } = await worker.recognize(blob);
      return data.text || '';
    } finally {
      await worker.terminate();
    }
  }

  /* ---------- 색 ---------- */
  function openTheme() {
    const before = Object.assign({}, state.theme);
    const html = `${head('리캡 색 바꾸기')}
      <div class="dlg-body">
        <div class="swatches" role="group" aria-label="색 조합">${T.PRESETS.map((p) => {
          const tk = T.tokens(p.accent, p.bg);
          return `<button class="swatch" type="button" data-preset="${p.id}" aria-pressed="${state.theme.preset === p.id}" style="--sw-bg:${p.bg};--sw-a:${tk.accentLarge};--sw-ink:${tk.ink}">
            <span class="chip-a"></span><span class="big" aria-hidden="true">26</span><span class="nm">${p.name}</span></button>`;
        }).join('')}</div>
        <div class="pickers">
          <div class="picker"><span>강조색</span><div class="row"><input type="color" id="pk-a" value="${state.theme.accent}" aria-label="강조색 고르기"><input type="text" id="hx-a" value="${state.theme.accent}" maxlength="7" aria-label="강조색 코드"></div></div>
          <div class="picker"><span>배경색</span><div class="row"><input type="color" id="pk-b" value="${state.theme.bg}" aria-label="배경색 고르기"><input type="text" id="hx-b" value="${state.theme.bg}" maxlength="7" aria-label="배경색 코드"></div></div>
        </div>
        <div class="preview-strip" aria-hidden="true"><span class="yy">2026</span><span class="tx"><b>( 관람 )</b> 12회</span></div>
        <p class="contrast-note" id="cnote"></p>
      </div>
      <footer class="dlg-foot"><button class="btn quiet spacer" type="button" id="reset">처음 색으로</button><button class="btn-line" type="button" id="cancel">바꾸기 전으로</button><button class="btn-solid" type="button" data-close>완료</button></footer>`;
    const d = openDialog(html);
    const sync = () => {
      d.querySelector('#pk-a').value = state.theme.accent; d.querySelector('#hx-a').value = state.theme.accent.toUpperCase();
      d.querySelector('#pk-b').value = state.theme.bg; d.querySelector('#hx-b').value = state.theme.bg.toUpperCase();
      d.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === state.theme.preset)));
      d.querySelector('#cnote').textContent = tokens.adjusted ? '배경과 비슷한 색이라 글자는 조금 진하게 보여요.' : '';
    };
    const set = (accent, bg, preset) => {
      state.theme = { preset: preset || 'custom', accent: U.normHex(accent) || state.theme.accent, bg: U.normHex(bg) || state.theme.bg };
      applyTheme();
      saveTheme();
      sync();
      if (location.hash === '#recap') { /* 리캡은 CSS 변수로 즉시 바뀜 */ }
    };
    const saveTheme = U.debounce(save, 250);
    d.querySelectorAll('.swatch').forEach((b) => b.addEventListener('click', () => {
      const p = T.PRESETS.find((x) => x.id === b.dataset.preset);
      set(p.accent, p.bg, p.id);
    }));
    d.querySelector('#pk-a').addEventListener('input', (e) => set(e.target.value, state.theme.bg));
    d.querySelector('#pk-b').addEventListener('input', (e) => set(state.theme.accent, e.target.value));
    const hex = (el, which) => el.addEventListener('change', () => {
      let v = el.value.trim(); if (!v.startsWith('#')) v = '#' + v;
      if (!U.isHex(v)) { toast('#1F22B5처럼 6자리 색 코드를 적어 주세요'); sync(); return; }
      which === 'a' ? set(v, state.theme.bg) : set(state.theme.accent, v);
    });
    hex(d.querySelector('#hx-a'), 'a');
    hex(d.querySelector('#hx-b'), 'b');
    d.querySelector('#reset').addEventListener('click', () => set(T.DEFAULT.accent, T.DEFAULT.bg, T.DEFAULT.id));
    d.querySelector('#cancel').addEventListener('click', () => { set(before.accent, before.bg, before.preset); });
    sync();
  }

  /* ---------- 백업·설정 ---------- */
  function blobToDataURL(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  }
  function dataURLToBlob(url) {
    const [meta, b64] = String(url).split(',');
    const mime = (meta.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    const bin = atob(b64 || '');
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function makeBackup() {
    const posters = {};
    for (const r of state.records) {
      if (!r.posterId) continue;
      const b = await DB.getPoster(r.posterId);
      if (b) posters[r.posterId] = await blobToDataURL(b);
    }
    const data = { app: 'concert-recap-2026', version: 1, exportedAt: new Date().toISOString(), nickname: state.nickname, theme: state.theme, dupIgnore: state.dupIgnore, records: state.records, posters };
    return new File([JSON.stringify(data)], `concert-recap-2026-backup-${U.todayStr().replace(/-/g, '')}.json`, { type: 'application/json' });
  }
  async function doBackup(share) {
    const file = await makeBackup();
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: '공연 기록 백업' }); } catch (e) { if (e.name !== 'AbortError') download(file, file.name); else return; }
    } else download(file, file.name);
    state.lastBackup = Date.now();
    save();
    toast('백업 파일을 만들었어요');
  }
  async function restore(file, mode) {
    let data;
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error('백업 파일을 읽지 못했어요.'); }
    if (!data || data.app !== 'concert-recap-2026' || !Array.isArray(data.records)) throw new Error('이 사이트의 백업 파일이 아니에요.');
    const posters = data.posters || {};
    const valid = data.records.filter((r) => r && r.id && typeof r.title === 'string');
    if (mode === 'replace') {
      for (const r of state.records) if (r.posterId) forgetPoster(r.posterId);
      await DB.clearPosters();
      state.records = [];
      state.dupIgnore = data.dupIgnore || [];
      if (data.nickname) state.nickname = data.nickname;
      if (data.theme && U.isHex(data.theme.accent) && U.isHex(data.theme.bg)) state.theme = data.theme;
    }
    let added = 0, updated = 0;
    for (const r of valid) {
      if (r.posterId && posters[r.posterId]) await DB.putPoster(r.posterId, dataURLToBlob(posters[r.posterId]));
      const i = state.records.findIndex((x) => x.id === r.id);
      if (i < 0) { state.records.push(r); added++; }
      else if ((r.updatedAt || 0) > (state.records[i].updatedAt || 0)) { state.records[i] = r; updated++; }
    }
    state.sample = state.records.some((r) => r.source === 'sample');
    save();
    applyTheme();
    return { added, updated };
  }

  function openData() {
    const n = state.records.length;
    const hasSample = state.records.some((r) => r.source === 'sample');
    const canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
    const html = `${head('백업·설정')}
      <div class="dlg-body">
        ${previewNote('백업 파일 저장과 CSV 내보내기')}
        <form id="nick-edit" class="field"><span>닉네임</span>
          <div style="display:flex;gap:12px;align-items:end"><input type="text" name="nick" value="${esc(state.nickname)}" maxlength="20" class="input" style="flex:1"><button class="btn-line" type="submit">바꾸기</button></div></form>
        <div class="field"><span>백업 (기록 ${n}건 + 포스터 + 색)</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-solid" type="button" id="bk">백업 파일 저장</button>${canShare ? '<button class="btn-line" type="button" id="bk-share">파일 앱·에어드롭으로 보내기</button>' : ''}</div>
          <small>${state.lastBackup ? `마지막 백업 ${new Date(state.lastBackup).toLocaleDateString('ko-KR')}` : '백업 기록 없음'}</small>
        </div>
        <div class="field"><span>백업에서 복원</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><span class="btn-line file-btn">백업 파일 고르기<input type="file" accept=".json,application/json" id="rs-file"></span></div>
          <div id="rs-choose" hidden class="notice">
            <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-line" type="button" id="rs-merge">합치기</button><button class="btn-line btn-danger" type="button" id="rs-replace">지우고 바꾸기</button></div></div>
          <p class="err" id="rs-err" hidden></p>
        </div>
        <div class="field"><span>표로 내보내기</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn" type="button" id="csv-out">CSV로 내보내기</button></div></div>
        <p class="help" style="margin:0">기록은 이 기기에만 저장돼요. 아이폰은 ‘홈 화면에 추가’해서 쓰고 가끔 백업하세요.</p>
        <div class="field"><span>지우기</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap">${hasSample ? '<button class="btn-line" type="button" id="clr-sample">예시 기록 지우기</button>' : '<button class="btn" type="button" id="add-sample">예시 기록 넣기</button>'}<button class="btn-line btn-danger" type="button" id="clr-all">모든 기록 지우기</button></div></div>
      </div>
      <footer class="dlg-foot"><button class="btn-solid" data-close type="button">닫기</button></footer>`;
    const d = openDialog(html);
    d.querySelector('#nick-edit').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.nick.value.trim();
      if (!v) { toast('닉네임을 적어 주세요'); return; }
      state.nickname = v; save(); render(); toast('닉네임을 바꿨어요');
    });
    d.querySelector('#bk').addEventListener('click', () => doBackup(false));
    const bs = d.querySelector('#bk-share'); if (bs) bs.addEventListener('click', () => doBackup(true));
    let picked = null;
    d.querySelector('#rs-file').addEventListener('change', (e) => { picked = e.target.files[0]; d.querySelector('#rs-choose').hidden = !picked; });
    const run = async (mode) => {
      const er = d.querySelector('#rs-err');
      if (mode === 'replace' && !(await ask('지금 기기에 있는 기록과 포스터를 모두 지우고 백업 내용으로 바꿀까요?', { title: '백업으로 바꾸기', ok: '바꾸기', danger: true }))) return;
      try {
        const res = await restore(picked, mode);
        d.close(); render();
        toast(`복원했어요. 새 기록 ${res.added}건${res.updated ? `, 바뀐 기록 ${res.updated}건` : ''}`);
      } catch (err) { er.textContent = err.message; er.hidden = false; }
    };
    d.querySelector('#rs-merge').addEventListener('click', () => run('merge'));
    d.querySelector('#rs-replace').addEventListener('click', () => run('replace'));
    d.querySelector('#csv-out').addEventListener('click', () => {
      const head = ['공연명', '아티스트', '관람일', '공연장', '예매처', '본인 부담 금액', '상태', '메모'];
      const lines = state.records.slice().sort(byDate).map((r) => [r.title, (r.artists || []).join(';'), r.date, r.venue,
        r.vendor === 'other' ? r.vendorOther : (VENDORS[r.vendor] || ''), U.isNum(r.cost) ? r.cost : '', ({ done: '완료', planned: '예정', canceled: '취소' })[r.status] || '', r.memo || ''].map(P.csvCell).join(','));
      download(new Blob(['﻿' + [head.join(',')].concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' }), `concert-recap-2026-${U.todayStr().replace(/-/g, '')}.csv`);
    });
    const cs = d.querySelector('#clr-sample'); if (cs) cs.addEventListener('click', () => { d.close(); clearSample(); });
    const as = d.querySelector('#add-sample'); if (as) as.addEventListener('click', async () => { d.close(); await loadSample(); render(); });
    d.querySelector('#clr-all').addEventListener('click', async () => {
      if (!(await ask('모든 기록과 포스터를 지워요. 되돌릴 수 없어요. 먼저 백업해 두는 걸 권해요.', { title: '모든 기록 지우기', ok: '모두 지우기', danger: true, typeWord: '삭제' }))) return;
      for (const r of state.records) if (r.posterId) forgetPoster(r.posterId);
      await DB.clearPosters();
      state.records = []; state.sample = false; state.dupIgnore = [];
      save(); d.close(); render(); toast('모든 기록을 지웠어요');
    });
  }

  /* ---------- 중복 ---------- */
  function openDups() {
    const st = stats();
    if (!st.duplicates.length) { toast('중복일 수 있는 기록이 없어요'); return; }
    const html = `${head('중복 확인')}
      <div class="dlg-body">
        ${st.duplicates.map((g, gi) => `<div class="dup-group"><h3>${g.label}</h3>
          ${g.records.map((r) => `<div class="dup-row"><span><strong>${esc(r.title)}</strong><small>${U.dots(r.date)} · ${esc(r.venue || '공연장 미입력')} · ${STATUS[r.status]} · ${U.won(r.cost)}</small></span>
            <span style="display:flex;gap:14px"><button class="btn" data-open="${r.id}" type="button">보기</button><button class="btn btn-danger" data-del="${r.id}" type="button" style="border-bottom-color:currentColor">삭제</button></span></div>`).join('')}
          <div><button class="btn-line" data-ok="${gi}" type="button">중복 아님</button></div></div>`).join('')}
      </div>
      <footer class="dlg-foot"><button class="btn-solid" data-close type="button">닫기</button></footer>`;
    const d = openDialog(html);
    d.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]'), del = e.target.closest('[data-del]'), ok = e.target.closest('[data-ok]');
      if (o) { d.close(); openDetail(o.dataset.open); }
      if (del) {
        const r = state.records.find((x) => x.id === del.dataset.del);
        if (!r || !(await ask(`‘${r.title}’ (${U.dots(r.date)}) 기록을 삭제할까요?`, { title: '기록 삭제', ok: '삭제', danger: true }))) return;
        state.records = state.records.filter((x) => x.id !== r.id);
        await releasePoster(r.posterId);
        save(); d.close(); render(); openDups();
      }
      if (ok) {
        state.dupIgnore = (state.dupIgnore || []).concat(st.duplicates[+ok.dataset.ok].key);
        save(); d.close(); render(); if (stats().duplicates.length) openDups(); else toast('확인했어요');
      }
    });
  }

  /* ---------- 계산 근거 ---------- */
  function openBasis(k) {
    const st = stats();
    const row = (r, right, cls) => `<li class="${cls || ''}"><span>${U.dots(r.date)}</span><span>${esc(r.title)}</span><span class="r">${right}</span></li>`;
    let title = '', body = '';
    if (k === 'count') {
      title = `관람 ${st.count}회`;
      body = `<ul class="basis-list">${st.included.map((r, i) => row(r, `${i + 1}회째`)).join('')}</ul>
        ${st.excluded.length ? `<h3 style="margin:8px 0 0;font-size:var(--f-s)">제외 ${st.excluded.length}건</h3><ul class="basis-list">${st.excluded.map((e) => row(e.record, e.label, 'x')).join('')}</ul>` : ''}`;
    } else if (k === 'spend') {
      title = `티켓 지출 ${U.won(st.spend)}`;
      const plannedSum = st.planned.filter((r) => U.isNum(r.cost)).reduce((s, r) => s + r.cost, 0);
      body = `<ul class="basis-list">${st.spendRecords.map((r) => row(r, U.won(r.cost))).join('')}
          ${st.missingCost.map((r) => row(r, '미입력', 'x')).join('')}</ul>
        <div class="sum-line"><span>합계</span><span>${U.won(st.spend)}</span></div>
        ${plannedSum ? `<p class="help">관람 예정 ${U.won(plannedSum)}은 제외</p>` : ''}`;
    } else if (k === 'venue' || k === 'artist') {
      const list = k === 'venue' ? st.venues : st.artists;
      title = k === 'venue' ? `공연장 ${st.venueCount}곳` : `아티스트 ${st.artistCount}팀`;
      body = `<ul class="basis-list">${list.list.map((e) => `<li><span>${e.count}회</span><span>${esc(e.name)}</span><span class="r">${e.records.map((r) => U.md(r.date)).join(', ')}</span></li>`).join('')}</ul>
        ${k === 'venue' && st.included.some((r) => !r.venue) ? `<p class="help">공연장 미입력 ${st.included.filter((r) => !r.venue).length}건 제외</p>` : ''}
        ${k === 'artist' && st.included.some((r) => !(r.artists || []).length) ? `<p class="help">아티스트 미입력 ${st.included.filter((r) => !(r.artists || []).length).length}건 제외</p>` : ''}`;
    } else if (k === 'month') {
      title = '월별 관람';
      body = `<ul class="basis-list">${st.months.map((c, i) => `<li><span>${i + 1}월</span><span>${st.included.filter((r) => Number(r.date.slice(5, 7)) === i + 1).map((r) => esc(r.title)).join(', ') || '–'}</span><span class="r">${c}회</span></li>`).join('')}</ul>`;
    }
    openDialog(`${head(title)}<div class="dlg-body">${body}</div><footer class="dlg-foot"><button class="btn-solid" data-close type="button">닫기</button></footer>`);
  }

  /* ---------- 이미지 저장 ---------- */
  function openExport() {
    const st = stats();
    if (!st.count) { toast('관람 완료한 공연이 있어야 이미지를 만들 수 있어요'); return; }
    const prefs = Object.assign({ format: 'story', layout: 'checker', scale: 1 }, state.exportPrefs || {});
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const html = `${head('이미지 저장')}
      <div class="dlg-body">
        ${previewNote('이미지 저장')}
        <div class="ex-opts">
          <fieldset class="field" style="border:0;margin:0;padding:0"><legend>크기</legend>
            <div class="seg" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="format" value="story"${prefs.format === 'story' ? ' checked' : ''}>세로 9:16</label><label><input type="radio" name="format" value="square"${prefs.format === 'square' ? ' checked' : ''}>정사각 1:1</label></div></fieldset>
          <fieldset class="field" style="border:0;margin:0;padding:0"><legend>포스터 배치</legend>
            <div class="seg" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="layout" value="checker"${prefs.layout === 'checker' ? ' checked' : ''}>날짜와 번갈아</label><label><input type="radio" name="layout" value="grid"${prefs.layout === 'grid' ? ' checked' : ''}>촘촘하게</label></div></fieldset>
        </div>
        <label style="display:flex;gap:10px;align-items:center;font-size:var(--f-s)"><input type="checkbox" id="hi" ${prefs.scale === 2 ? 'checked' : ''} style="width:20px;height:20px;accent-color:var(--accent)"> 2배 해상도</label>
        <p class="help" id="ex-info" style="margin:0"></p>
        <div id="ex-pages" class="ex-pages"><p class="ex-loading">이미지를 만드는 중이에요…</p></div>
        <div class="share-box">
          <div class="row"><button class="btn-solid" type="button" id="ex-save" disabled>이미지 모두 저장</button></div>
          ${touch ? '<p class="help" style="margin:0">미리보기 이미지를 길게 누르면 사진 앱에 저장돼요.</p>' : ''}
        </div>
      </div>`;
    const d = openDialog(html, { cls: 'wide' });
    let files = [];
    let job = 0;
    const btns = () => ['#ex-save'].map((s) => d.querySelector(s)).filter(Boolean);
    async function build() {
      const my = ++job;
      btns().forEach((b) => { b.disabled = true; });
      const box = d.querySelector('#ex-pages');
      box.innerHTML = '<p class="ex-loading">이미지를 만드는 중이에요…</p>';
      const format = d.querySelector('input[name=format]:checked').value;
      const layout = d.querySelector('input[name=layout]:checked').value;
      const scale = d.querySelector('#hi').checked ? 2 : 1;
      state.exportPrefs = { format, layout, scale };
      save();
      try {
        const pages = await R.renderAll({ format, layout, state, st, tokens, getBlob: DB.getPoster, scale, chartStyle: state.chartStyle === 'bar' ? 'bar' : 'poster' });
        if (my !== job) return;
        const blobs = await Promise.all(pages.map((c) => new Promise((res) => c.toBlob(res, 'image/png'))));
        if (my !== job) return;
        files = blobs.map((b, i) => new File([b], `2026-concert-recap-${format === 'story' ? 'story' : 'square'}-${i + 1}.png`, { type: 'image/png' }));
        const [w, h] = R.SIZES[format];
        d.querySelector('#ex-info').textContent = `${files.length}장 · ${w * scale}×${h * scale} · ${(blobs.reduce((s, b) => s + b.size, 0) / 1048576).toFixed(1)}MB`;
        box.innerHTML = files.map((f, i) => `<figure class="ex-page" style="margin:0"><img src="${URL.createObjectURL(f)}" alt="리캡 이미지 ${i + 1}쪽"><div class="row"><span>${i + 1} / ${files.length}</span><button class="btn" type="button" data-dl="${i}">저장</button></div></figure>`).join('');
        btns().forEach((b) => { b.disabled = false; });
      } catch (e) {
        console.error(e);
        box.innerHTML = '<p class="err">이미지를 만들지 못했어요. 포스터가 너무 많으면 ‘촘촘하게’를 골라 보세요.</p>';
      }
    }
    d.querySelectorAll('input[name=format], input[name=layout], #hi').forEach((el) => el.addEventListener('change', build));
    d.querySelector('#ex-pages').addEventListener('click', (e) => { const b = e.target.closest('[data-dl]'); if (b) download(files[+b.dataset.dl], files[+b.dataset.dl].name); });
    const saveAll = async () => { for (let i = 0; i < files.length; i++) { download(files[i], files[i].name); await new Promise((r) => setTimeout(r, 450)); } };
    d.querySelector('#ex-save').addEventListener('click', async () => { await saveAll(); toast(files.length > 1 ? `${files.length}장을 저장했어요` : '저장했어요'); });
    build();
  }

  /* ---------- 라우팅 ---------- */
  function render() {
    if (!state.nickname) { viewOnboard(); return; }
    if (location.hash === '#recap') viewRecap();
    else viewMain();
  }

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('dialog') && !['dups'].includes(el.dataset.act)) return;
    const act = el.dataset.act;
    switch (act) {
      case 'add': openForm(); break;
      case 'import': openImport(); break;
      case 'theme': openTheme(); break;
      case 'data': openData(); break;
      case 'detail': openDetail(el.dataset.id); break;
      case 'basis': openBasis(el.dataset.k); break;
      case 'dups': openDups(); break;
      case 'export': openExport(); break;
      case 'backup': doBackup(false); break;
      case 'clear-sample': clearSample(); break;
      case 'sample': await loadSample(); render(); break;
      case 'overdue-done': {
        const st = stats();
        const ids = new Set(st.overdue.map((r) => r.id));
        state.records.forEach((r) => { if (ids.has(r.id)) { r.status = 'done'; r.updatedAt = Date.now(); } });
        save(); render(); toast(`${ids.size}건을 관람 완료로 바꿨어요`);
        break;
      }
      case 'filter': {
        ledgerFilter = el.dataset.f;
        const l = document.getElementById('ledger');
        if (l) { l.outerHTML = ledgerHTML(); document.getElementById('ledger').scrollIntoView({ block: 'start', behavior: 'smooth' }); }
        break;
      }
      case 'chart-style': {
        state.chartStyle = el.dataset.s;
        save();
        const area = document.getElementById('chart-area');
        if (!area) break;
        const st = stats();
        area.innerHTML = state.chartStyle === 'bar' ? chartSVG(st) : posterChartHTML(st);
        el.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
        hydrate(area); bindChartTips(); layoutPosterChart();
        break;
      }
      case 'chart-table': {
        const t = el.parentElement.querySelector('table');
        t.hidden = !t.hidden;
        el.setAttribute('aria-expanded', String(!t.hidden));
        el.textContent = t.hidden ? '표로 보기' : '표 닫기';
        break;
      }
    }
  });

  let lastCols = window.innerWidth < 700 ? 3 : 5;
  window.addEventListener('resize', U.debounce(() => {
    layoutGallery();
    layoutPosterChart();
    const c = window.innerWidth < 700 ? 3 : 5;
    if (c !== lastCols && location.hash === '#recap') {
      lastCols = c;
      const a = document.getElementById('archive');
      if (a) { a.innerHTML = archiveHTML(stats()); hydrate(a); }
    }
  }, 150));
  window.addEventListener('hashchange', render);

  function init() {
    applyTheme();
    DB.open().then(() => { if (!DB.canPersist() && state.nickname && location.hash !== '#recap') render(); });
    DB.persist();
    render();
  }
  init();

  window.CR.app = { get state() { return state; }, render, stats };
})();
