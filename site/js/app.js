/* 화면과 동작 */
(function () {
  'use strict';
  const { util: U, stats: S, parse: P, theme: T, db: DB, kopis: K, sample: SAMPLE, render: R, i18n: I } = window.CR;
  const tr = I.tr; // 화면 언어 (언어를 바꾸면 페이지를 다시 연다)

  // 기록할 연도: 처음 시작할 때 고르고, 백업·설정에서 바꾼다. 예전 기록(연도 없음)은 2026.
  const THIS_YEAR = new Date().getFullYear();
  const year = () => { const y = Number(state && state.year); return y >= 2000 && y <= 2100 ? y : 2026; };
  const yy = (y) => `${String(y).slice(0, 2)}<sup>${String(y).slice(2)}</sup>`;
  const VENDORS = { nol: tr('NOL 티켓 (구 인터파크)'), ticketlink: tr('티켓링크'), melon: tr('멜론티켓'), yes24: tr('YES24 티켓'), other: tr('기타') };
  const STATUS = { done: tr('관람 완료'), planned: tr('관람 예정'), canceled: tr('취소·환불') };
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
    if (DB.save(state) === 'full') toast(tr('저장 공간이 가득 찼어요. 백업 후 오래된 포스터를 지워 주세요.'));
  }
  function stats() { return S.compute(state.records, { year: year(), today: U.todayStr(), dupIgnore: state.dupIgnore }); }
  const kopisFail = (reason) => { const r = I.reason(reason); return tr('KOPIS에 연결하지 못했어요') + (r ? ` · ${esc(r)}` : ''); };
  function nick() { return (state.nickname || '').trim() || tr('나'); }

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
        fb.textContent = img.dataset.title || img.alt;
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
  const head = (title) => `<header class="dlg-head"><h2>${title}</h2><button class="x" data-close aria-label="${tr('닫기')}">×</button></header>`;
  const IN_FRAME = (() => { try { return window.self !== window.top; } catch (e) { return true; } })();

  /* X·카톡·인스타 같은 앱 안 브라우저: 이미지·백업 저장이 막히고 기록도 그 앱 안에만 남는다.
     그래서 화면마다 '브라우저에서 열기' 안내를 띄운다. (주소 뒤 ?inapp=X 로 미리 볼 수 있음) */
  const UA = navigator.userAgent || '';
  const IS_ANDROID = /Android/i.test(UA);
  const IS_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1);
  const INAPP = (() => {
    const force = /[?&]inapp=([^&#]+)/.exec(location.search);
    if (force) return decodeURIComponent(force[1]);
    const apps = [[/KAKAOTALK/i, '카카오톡'], [/Twitter/i, 'X'], [/Instagram/i, tr('인스타그램')], [/Barcelona/i, tr('스레드')],
      [/FBAN|FBAV|FB_IAB|FBIOS/, tr('페이스북')], [/\bLine\//i, tr('라인')], [/NAVER\(inapp|NAVER\//, tr('네이버')], [/DaumApps/i, tr('다음')],
      [/BAND\//, tr('밴드')], [/everytime/i, tr('에브리타임')], [/musical_ly|BytedanceWebview|TikTok/i, tr('틱톡')]];
    for (const [re, name] of apps) if (re.test(UA)) return name;
    if (IS_ANDROID && /; wv\)/.test(UA)) return '앱';
    return '';
  })();
  const SITE = location.origin + location.pathname;
  function inAppBox(compact) {
    if (!INAPP) return '';
    const who = INAPP === '앱' ? tr('다른 앱') : tr('{app} 앱', { app: esc(tr(INAPP)) });
    let open = '';
    if (INAPP === '카카오톡') open = `<a class="btn-solid" href="kakaotalk://web/openExternal?url=${encodeURIComponent(SITE)}">${tr('다른 브라우저로 열기')}</a>`;
    else if (IS_ANDROID) open = `<a class="btn-solid" href="intent://${location.host}${location.pathname}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(SITE)};end">${tr('크롬으로 열기')}</a>`;
    else if (IS_IOS) open = `<a class="btn-solid" href="x-safari-${SITE}">${tr('사파리로 열기')}</a>`;
    return `<div class="inapp${compact ? ' compact' : ''}" role="note">
      <p>${tr('<b>지금 {who} 안에서 열었어요.</b> 여기서는 이미지 저장·백업이 안 되고, 기록도 이 앱 안에만 남아요.', { who })}</p>
      <p>${open ? tr('아래 버튼을 누르거나, ') : ''}${tr('화면의 ⋮ 또는 ··· 메뉴에서 <b>‘브라우저에서 열기’</b>를 눌러 주세요.')}${compact ? '' : tr(' 이미 입력한 기록은 브라우저로 옮겨지지 않아요.')}</p>
      <div class="row">${open}<button class="btn-line" type="button" data-copy-url>${tr('주소 복사')}</button></div>
    </div>`;
  }
  async function copySite() {
    let ok = false;
    try { await navigator.clipboard.writeText(SITE); ok = true; } catch (e) {
      const t = document.createElement('textarea'); t.value = SITE; t.setAttribute('readonly', ''); t.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(t); t.select(); try { ok = document.execCommand('copy'); } catch (x) { ok = false; } t.remove();
    }
    toast(ok ? tr('주소를 복사했어요. 사파리·크롬 주소창에 붙여 넣어 주세요.') : SITE);
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-copy-url]')) copySite(); });
  const previewNote = (what) => (IN_FRAME ? `<div class="notice">${tr('미리보기에서는 {what}이 안 돼요. 배포한 주소에서는 돼요.', { what })}</div>` : '');

  /* 브라우저 기본 확인 창 대신 쓰는 확인 창 (앱 안 미리보기에서도 동작) */
  function ask(message, opts) {
    opts = opts || {};
    let ok = false;
    return new Promise((resolve) => {
      const d = openDialog(`${head(esc(opts.title || tr('확인')))}
        <form class="dlg-body" id="ask-form" novalidate>
          <p style="margin:0">${esc(message)}</p>
          ${opts.typeWord ? `<label class="field"><span>${tr('계속하려면 ‘{w}’라고 적어 주세요', { w: esc(opts.typeWord) })}</span><input type="text" name="w" autocomplete="off"></label><p class="err" id="ask-err" hidden>${tr('‘{w}’라고 정확히 적어 주세요.', { w: esc(opts.typeWord) })}</p>` : ''}
        </form>
        <footer class="dlg-foot"><button class="btn quiet spacer" type="button" data-close>${tr('취소')}</button><button class="btn-solid${opts.danger ? ' danger' : ''}" type="submit" form="ask-form">${esc(opts.ok || tr('확인'))}</button></footer>`,
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
      .filter((r) => U.isDate(r.date) && r.date.slice(0, 4) === String(year()) && r.status !== 'canceled')
      .sort(byDate);
  }

  /* ---------- 첫 방문 ---------- */
  function viewOnboard() {
    document.body.classList.remove('recap-page', 'has-dock');
    const back = !!state.nickname; // 메인에서 '처음으로'를 눌러 온 경우: 지금 값을 채워 둔다
    // 시작 화면에서 언어를 바꾸면 페이지를 다시 여니, 쓰던 닉네임·연도를 잠깐 기억해 둔다
    let draft = {};
    try { draft = JSON.parse(sessionStorage.getItem('cr-ob-draft') || '{}') || {}; sessionStorage.removeItem('cr-ob-draft'); } catch (e) { /* 무시 */ }
    const startYear = draft.year || (back ? year() : THIS_YEAR);
    const years = [...new Set([THIS_YEAR - 1, THIS_YEAR, THIS_YEAR + 1, startYear])].sort();
    app.innerHTML = `
      <main class="onboard">
        <div class="onboard-mast" aria-hidden="true" id="ob-mast">${startYear}</div>
        <div class="onboard-body">
          ${inAppBox()}
          <div class="lang-pick" role="group" aria-label="Language">${I.LANGS.map(([k, v]) => `<button type="button" class="btn quiet" data-lang="${k}" aria-pressed="${I.lang === k}">${v}</button>`).join('')}</div>
          <h1 id="ob-title">${tr('{y}년 공연 기록', { y: startYear })}</h1>
          <form id="nick-form" novalidate>
            <fieldset class="field" style="border:0;margin:0;padding:0"><legend>${tr('몇 년도 공연을 기록할까요?')}</legend>
              <div class="seg" style="grid-template-columns:repeat(${years.length},1fr)">${years.map((v) => `<label><input type="radio" name="year" value="${v}"${v === startYear ? ' checked' : ''}>${v}</label>`).join('')}</div>
            </fieldset>
            <label class="field"><span>${tr('닉네임')}</span>
              <input type="text" name="nick" maxlength="20" autocomplete="nickname" placeholder="${tr('리캡에 들어갈 이름')}" value="${esc(draft.nick != null ? draft.nick : back ? state.nickname : '')}" required>
            </label>
            <p class="err" id="nick-err" hidden>${tr('닉네임을 적어 주세요.')}</p>
            <div class="row">
              <button class="btn-solid" type="submit">${tr('시작하기')}</button>
              ${back ? `<a class="btn" href="#">${tr('메인으로')}</a>` : ''}
            </div>
          </form>
        </div>
        <p class="onboard-foot">${back && state.records.length ? tr('지금까지 쓴 기록 {n}건은 그대로 있어요. ', { n: state.records.length }) : ''}${tr('기록은 이 기기에만 저장돼요.')}</p>
      </main>`;
    const form = document.getElementById('nick-form');
    const pickedYear = () => Number((form.querySelector('input[name=year]:checked') || {}).value) || THIS_YEAR;
    form.querySelectorAll('input[name=year]').forEach((x) => x.addEventListener('change', () => {
      document.getElementById('ob-mast').textContent = pickedYear();
      document.getElementById('ob-title').textContent = tr('{y}년 공연 기록', { y: pickedYear() });
    }));
    app.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lang === I.lang) return;
      try { sessionStorage.setItem('cr-ob-draft', JSON.stringify({ nick: form.nick.value, year: pickedYear() })); } catch (e) { /* 무시 */ }
      I.setLang(b.dataset.lang);
    }));
    const go = async (withSample) => {
      const v = form.nick.value.trim();
      if (!v && !withSample) { document.getElementById('nick-err').hidden = false; form.nick.focus(); return; }
      state.year = pickedYear();
      state.nickname = v || tr('공연 일기');
      save();
      if (withSample) await loadSample();
      location.hash = '';
      render();
    };
    form.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
  }

  async function loadSample() {
    toast(tr('예시 기록을 만드는 중이에요'));
    const { records, posters } = await SAMPLE.build(year(), U.todayStr());
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
    toast(tr('예시 기록을 지웠어요'));
  }

  /* ---------- 메인 ---------- */
  function alertsHTML(st) {
    const out = [];
    if (INAPP) out.push(inAppBox());
    if (state.sample) out.push(`<div class="alert"><span>${tr('예시 기록이에요.')}</span><span class="acts"><button class="btn" data-act="clear-sample">${tr('예시 지우기')}</button></span></div>`);
    if (st.overdue.length) out.push(`<div class="alert"><span>${tr('날짜가 지난 관람 예정 <strong>{n}건</strong>', { n: st.overdue.length })}</span><span class="acts"><button class="btn" data-act="overdue-done">${tr('완료로 바꾸기')}</button><button class="btn quiet" data-act="filter" data-f="planned">${tr('목록 보기')}</button></span></div>`);
    if (st.duplicates.length) out.push(`<div class="alert"><span>${tr('중복 의심 <strong>{n}묶음</strong>', { n: st.duplicates.length })}</span><span class="acts"><button class="btn" data-act="dups">${tr('확인하기')}</button></span></div>`);
    const real = state.records.filter((r) => r.source !== 'sample').length;
    if (real >= 3 && Date.now() - (state.lastBackup || 0) > 14 * 864e5) out.push(`<div class="alert"><span>${tr('백업한 지 2주가 넘었어요.')}</span><span class="acts"><button class="btn" data-act="backup">${tr('지금 백업')}</button></span></div>`);
    if (!DB.canPersist()) out.push(`<div class="alert"><span>${tr('이 화면에서는 기록이 저장되지 않아요')}${IN_FRAME ? tr(' (미리보기)') : tr(' (개인정보 보호 모드)')}.</span></div>`);
    else if (DB.isPrivate()) out.push(`<div class="alert"><span>${tr('개인정보 보호 모드예요. 이 창을 닫으면 기록이 지워져요. 일반 창에서 열어 주세요.')}</span>${real ? `<span class="acts"><button class="btn" data-act="backup">${tr('지금 백업')}</button></span>` : ''}</div>`);
    return out.length ? `<section class="alerts" aria-label="${tr('알림')}">${out.join('')}</section>` : '';
  }

  function statCards(st) {
    if (!st.count) return [];
    const cards = [];
    const more = (n) => (n > 1 ? tr(' 외 {n}', { n: n - 1 }) : '');
    cards.push({ num: st.count, unit: tr('회'), text: tr('관람<br><b>공연 {n}개</b>', { n: st.showCount }), why: 'count' });
    if (st.venues.top.length) cards.push({ num: st.venues.max, unit: tr('회'), text: `${tr('가장 자주 간 곳')}<br><b>${esc(st.venues.top[0].name)}</b>${more(st.venues.top.length)}`, why: 'venue' });
    if (st.artists.top.length) cards.push({ num: st.artists.max, unit: tr('회'), text: `${tr('가장 많이 본 아티스트')}<br><b>${esc(st.artists.top[0].name)}</b>${more(st.artists.top.length)}`, why: 'artist' });
    if (st.peakMonths.length) cards.push({ num: I.lang === 'en' ? I.mon(st.peakMonths[0]) : st.peakMonths[0], unit: tr('월'), text: tr('가장 많이 간 달<br><b>{n}회</b>', { n: st.monthMax }), why: 'month' });
    return cards;
  }

  function galleryHTML(st) {
    const list = galleryRecords();
    if (!list.length) {
      return `<div class="empty">
        <h2>${tr('첫 공연을 기록하세요')}</h2>
        <div class="row"><button class="btn-solid" data-act="add">${tr('직접 추가')}</button><button class="btn-line" data-act="import">${tr('캡처로 추가')}</button></div>
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
        <button class="cell poster-cell${planned ? ' planned' : ''}" data-act="detail" data-id="${r.id}" aria-label="${tr('{t} 자세히 보기', { t: esc(r.title) })}">
          ${r.posterId ? `<img data-poster="${r.posterId}" data-title="${esc(r.title)}" alt="${tr('{t} 포스터', { t: esc(r.title) })}">` : `<span class="fallback">${esc(r.title)}</span>`}
        </button>
        <div class="cell info-cell">
          <span class="no">${planned ? tr('( 예정 )') : `( ${no} )`}</span>
          <span class="date">${U.md(r.date)}</span>
          <span class="wd">${U.weekdayLong(r.date)}</span>
          <div class="meta">
            <h3>${esc(r.title)}</h3>
            <p>${esc(r.venue || '')}</p>
            ${planned ? `<span class="tag">${tr('관람 예정')}</span>` : groupOf.get(r.id) && groupOf.get(r.id).days > 1 ? `<span class="tag">${tr('{n}일 관람', { n: groupOf.get(r.id).days })}</span>` : ''}
          </div>
        </div>
      </article>`);
      if ((i + 1) % 5 === 0 && cards.length) {
        const c = cards.shift();
        units.push(`<aside class="unit stat-unit">
          <div class="cell stat-num">${c.num}<small>${c.unit}</small></div>
          <div class="cell stat-text"><p>${c.text}</p><button class="btn quiet" data-act="basis" data-k="${c.why}">${tr('근거')}</button></div>
        </aside>`);
      }
    });
    return `<div class="gallery" id="gallery">${units.join('')}</div>`;
  }

  function ledgerHTML() {
    const all = state.records.slice().sort(byDate);
    const f = ledgerFilter;
    const rows = all.filter((r) => {
      const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(year()));
      if (f === 'all') return true;
      if (f === 'other') return other;
      return !other && r.status === f;
    });
    const btn = (k, l) => `<button class="btn quiet" data-act="filter" data-f="${k}" aria-pressed="${f === k}">${l}</button>`;
    return `<section class="ledger" id="ledger" aria-labelledby="ledger-title">
      <div class="ledger-head"><h2 id="ledger-title">${tr('전체 기록')} <small style="font-size:var(--f-s);color:var(--muted);font-weight:500">${tr('{n}건', { n: state.records.length })}</small></h2>
        <div class="filters">${btn('all', tr('전체'))}${btn('done', tr('관람 완료'))}${btn('planned', tr('관람 예정'))}${btn('canceled', tr('취소·환불'))}${btn('other', tr('{y}년 외', { y: year() }))}</div></div>
      ${rows.length ? `<ol>${rows.map((r) => {
        const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(year()));
        const st = other ? 'year' : r.status;
        return `<li><button data-act="detail" data-id="${r.id}">
          <span class="l-date">${U.dots(r.date) || tr('날짜 없음')} ${U.weekday(r.date)}</span>
          <span class="l-title">${esc(r.title)}<small>${esc((r.artists || []).join(', '))}</small></span>
          <span class="l-venue">${esc(r.venue)}</span>
          <span class="l-cost">${U.isNum(r.cost) ? U.won(r.cost) : `<span style="color:var(--muted)">${tr('금액 미입력')}</span>`}</span>
          <span class="l-status ${st}">${other ? tr('{y}년 외', { y: year() }) : STATUS[r.status] || ''}</span>
        </button></li>`;
      }).join('')}</ol>` : `<p class="help">${tr('이 조건에 맞는 기록이 없어요.')}</p>`}
    </section>`;
  }

  function viewMain() {
    const st = stats();
    document.body.classList.remove('recap-page');
    const n = esc(nick());
    app.innerHTML = `
    <div class="page">
      <header class="bar">
        <a class="btn" href="#start">${tr('처음으로')}</a>
        <nav aria-label="${tr('메뉴')}">
          <button class="btn" data-act="backup-open">${tr('백업')}</button>
          <button class="btn" data-act="settings">${tr('설정')}</button>
        </nav>
      </header>
      <section class="hero" aria-labelledby="hero-title">
        <div class="mast26" aria-hidden="true">${year()}<i class="sq-in"></i></div>
        <div class="hero-title">
          <h1 id="hero-title">${tr('{n}의<br>{y}년 공연', { n, y: year() })}</h1>
        </div>
        <dl class="hero-stats">
          <div class="stat big"><dt>${tr('관람')}</dt><dd>${st.count}<small>${tr('회')}</small></dd></div>
          <div class="stat money"><dt>${tr('티켓 지출')}</dt><dd>${U.won(st.spend)}</dd></div>
          <div class="stat"><dt>${tr('공연장')}</dt><dd>${st.venueCount}<small>${tr('곳')}</small></dd></div>
          <div class="stat"><dt>${tr('아티스트')}</dt><dd>${st.artistCount}<small>${tr('팀')}</small></dd></div>
        </dl>
        <div class="hero-cta">
          ${st.count ? `<a class="btn-solid" href="#recap">${year()} CONCERT RECAP</a>` : ''}
        </div>
      </section>
      ${alertsHTML(st)}
      <section aria-labelledby="g-title">
        <div class="section-head"><h2 id="g-title">${tr('올해의 포스터')}</h2></div>
        ${galleryHTML(st)}
      </section>
      ${ledgerHTML()}
      <footer class="foot">
        <span>${tr('공연 정보 출처: KOPIS 공연예술통합전산망')}</span>
      </footer>
      ${galleryRecords().length ? `<div class="recap-dock add-dock"><button class="btn-solid" data-act="add">${tr('직접 추가')}</button><button class="btn-line" data-act="import">${tr('캡처로 추가')}</button></div>` : ''}
    </div>`;
    hydrate(app);
    layoutGallery();
    document.body.classList.toggle('has-dock', !!galleryRecords().length);
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
  function peakNote(st) {
    return st.peakMonths.length > 1 ? tr('{ms}에 {n}회씩', { ms: I.mons(st.peakMonths, ', '), n: st.monthMax }) : tr('{m}, 가장 많이 본 달', { m: I.mon(st.peakMonths[0]) });
  }
  function posterChartHTML(st) {
    const byMonth = Array.from({ length: 12 }, () => []);
    st.included.forEach((r) => byMonth[Number(r.date.slice(5, 7)) - 1].push(r));
    const peak = new Set(st.peakMonths);
    const pm = st.peakMonths[0];
    const note = peakNote(st);
    return `<div class="pchart" id="pchart" role="group" aria-label="${tr('{y}년 월별 관람 포스터', { y: year() })}">
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
    return `<div class="chart-toggle" role="group" aria-label="${tr('차트 모양')}">
        <button class="btn quiet" data-act="chart-style" data-s="poster" aria-pressed="${style === 'poster'}">${tr('포스터')}</button>
        <button class="btn quiet" data-act="chart-style" data-s="bar" aria-pressed="${style === 'bar'}">${tr('막대')}</button>
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
      g += `<g class="m" tabindex="0" role="img" aria-label="${tr('{m} {n}회', { m: I.mon(i + 1), n: c })}" data-tip="${tr('{m} {n}회', { m: I.mon(i + 1), n: c })}">
        <rect class="hit" x="${(L + slot * i).toFixed(1)}" y="${top - 20}" width="${slot.toFixed(1)}" height="${base - top + 50}"></rect>
        ${bh ? `<rect class="bar-r${peak ? ' peak-bar' : ''}" x="${x.toFixed(1)}" y="${(base - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}"></rect>` : ''}
        ${c ? `<text class="cnt" x="${(x + bw / 2).toFixed(1)}" y="${(base - bh - 7).toFixed(1)}" text-anchor="middle">${c}</text>` : ''}
        <text x="${(x + bw / 2).toFixed(1)}" y="${base + 22}" text-anchor="middle">${i + 1}</text>
      </g>`;
    }
    let anno = '';
    if (st.peakMonths.length) {
      const [px, py] = tops[st.peakMonths[0] - 1];
      const note = peakNote(st);
      const right = px < W * 0.62;
      const tx = right ? px + 14 : px - 14;
      anno = `<path class="lead" d="M${px.toFixed(1)} ${(py - 24).toFixed(1)} V18 H${tx.toFixed(1)}"></path>
        <text class="anno" x="${(right ? tx + 6 : tx - 6).toFixed(1)}" y="22" text-anchor="${right ? 'start' : 'end'}">${note}</text>`;
    }
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="group" aria-label="${tr('{y}년 월별 관람 횟수', { y: year() })}">
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
        <button data-act="detail" data-id="${rec.id}" aria-label="${tr('{t} 자세히 보기', { t: esc(rec.title) })}">
          ${rec.posterId ? `<img data-poster="${rec.posterId}" data-title="${esc(rec.title)}" alt="${tr('{t} 포스터', { t: esc(rec.title) })}">` : `<span class="fallback-poster">${esc(rec.title)}</span>`}
        </button>
        ${low ? no : ''}
        <figcaption class="cap">${U.md(rec.date)} ${esc(rec.title)}</figcaption>
      </figure>`);
    });
    return `<div class="archive-grid" style="--acols:${cols}" data-cols="${cols}">${cells.join('')}</div>`;
  }

  function topList(list) {
    return `<ol>${list.list.slice(0, 5).map((e) => `<li><span>${esc(e.name)}</span><span>${tr('{n}회', { n: e.count })}</span></li>`).join('')}</ol>`;
  }

  function viewRecap() {
    const st = stats();
    document.body.classList.add('recap-page');
    document.body.classList.remove('has-dock');
    const n = esc(nick());
    const empty = !st.count;
    app.innerHTML = `
    <div class="page recap">
      <header class="bar">
        <a class="btn" href="#">${tr('메인으로')}</a>
        <nav aria-label="${tr('리캡 도구')}"><button class="btn" data-act="theme">${tr('색 바꾸기')}</button><button class="btn" data-act="export">${tr('이미지 저장')}</button></nav>
      </header>
      <section class="recap-head">
        <div>
          <h1>${tr('{n}의 {y}년<br>콘서트 기록', { n, y: year() })}</h1>
        </div>
        <div class="year-mark" aria-hidden="true">${yy(year())}</div>
      </section>
      ${empty ? `<div class="empty"><h2>${tr('관람 완료한 공연이 없어요')}</h2><div class="row"><button class="btn-solid" data-act="add">${tr('직접 추가')}</button></div></div>` : `
      <section class="recap-stats" aria-label="${tr('올해의 숫자')}">
        <div class="rstat"><span class="lbl">${tr('관람')}</span><span class="val">${st.count}<small>${tr('회')}</small></span><span class="sub">${tr('공연 {n}개', { n: st.showCount })}</span><button class="btn quiet why" data-act="basis" data-k="count">${tr('근거')}</button></div>
        <div class="rstat"><span class="lbl">${tr('공연장')}</span><span class="val">${st.venueCount}<small>${tr('곳')}</small></span><button class="btn quiet why" data-act="basis" data-k="venue">${tr('근거')}</button></div>
        <div class="rstat"><span class="lbl">${tr('아티스트')}</span><span class="val">${st.artistCount}<small>${tr('팀')}</small></span><button class="btn quiet why" data-act="basis" data-k="artist">${tr('근거')}</button></div>
        <div class="rstat wide"><span class="lbl">${tr('티켓 지출')}</span><span class="val">${U.won(st.spend)}</span>
          ${st.missingCost.length ? `<span class="sub">${tr('금액 미입력 {n}건 제외', { n: st.missingCost.length })}</span>` : ''}
          <button class="btn quiet why" data-act="basis" data-k="spend">${tr('근거')}</button></div>
      </section>
      <section class="chart-wrap" aria-labelledby="chart-title">
        <div>
          <h2 id="chart-title">${tr('월별 관람')}</h2>
          <div class="peak">${st.peakMonths[0] ? (I.lang === 'en' ? I.mon(st.peakMonths[0]) : st.peakMonths[0]) : '–'}<small>${tr('월')}</small></div>
          <p class="chart-note">${st.peakMonths.length > 1 ? tr('{ms} {n}회씩', { ms: I.mons(st.peakMonths, ', '), n: st.monthMax }) : tr('{n}회', { n: st.monthMax })}</p>
        </div>
        <div>
          ${chartBlock(st)}
          <div class="chart-table"><button class="btn quiet" data-act="chart-table" aria-expanded="false">${tr('표로 보기')}</button>
            <table hidden><caption class="sr">${tr('월별 관람 횟수')}</caption><thead><tr><th>${tr('달')}</th><th>${tr('관람')}</th></tr></thead><tbody>${st.months.map((c, i) => `<tr><td>${I.mon(i + 1)}</td><td>${tr('{n}회', { n: c })}</td></tr>`).join('')}</tbody></table>
          </div>
        </div>
      </section>
      <section class="bests">
        <div class="best"><span class="lbl">${tr('가장 많이 본 아티스트')}</span>
          <h3>${st.artists.top.map((e) => esc(e.name)).join(', ') || '–'}</h3>
          ${topList(st.artists)}</div>
        <div class="best"><span class="lbl">${tr('가장 자주 간 공연장')}</span>
          <h3>${st.venues.top.map((e) => esc(e.name)).join(', ') || '–'}</h3>
          ${topList(st.venues)}</div>
      </section>
      ${st.multiDay.length ? `<section class="multi" aria-labelledby="multi-title">
        <h2 id="multi-title">${tr('여러 날 본 공연')}</h2>
        <ol>${st.multiDay.map((g) => `<li><span class="m-days">${g.days}<small>${tr('일')}</small></span><span class="m-title">${esc(g.title)}<small>${g.records.map((r) => U.md(r.date)).join(' · ')}${g.period ? tr(' / 기간 {a}–{b}', { a: U.md(g.period.from), b: U.md(g.period.to) }) : ''}</small></span></li>`).join('')}</ol>
      </section>` : ''}
      <section class="archive" aria-labelledby="arch-title">
        <div class="section-head" style="padding:0"><h2 id="arch-title">${tr('올해의 포스터 {n}장', { n: st.count })}</h2></div>
        <div id="archive">${archiveHTML(st)}</div>
      </section>`}
      <details class="basis">
        <summary>${tr('계산 기준')}</summary>
        <dl>
          <dt>${tr('관람')}</dt><dd>${tr('{y}년 관람 완료 1건 = 1회 (2매 예매도 1회, 이틀 보면 2회)', { y: year() })}</dd>
          <dt>${tr('제외')}</dt><dd>${tr('예정 {a} · 취소 {b} · 다른 해 {c}', { a: st.excludedCount.planned || 0, b: st.excludedCount.canceled || 0, c: st.excludedCount.year || 0 })}${st.excludedCount.nodate ? tr(' · 날짜 없음 {n}', { n: st.excludedCount.nodate }) : ''}</dd>
          <dt>${tr('지출')}</dt><dd>${tr('관람 완료 기록의 본인 부담 금액 합')}${st.missingCost.length ? tr(' (미입력 {n}건 제외)', { n: st.missingCost.length }) : ''}</dd>
          <dt>${tr('중복')}</dt><dd>${st.duplicates.length ? `${tr('{n}묶음', { n: st.duplicates.length })} <button class="btn" data-act="dups">${tr('확인')}</button>` : tr('없음')}</dd>
        </dl>
      </details>
      <div class="recap-dock">
        <button class="btn-line" data-act="theme">${tr('색 바꾸기')}</button>
        <button class="btn-solid" data-act="export"${empty ? ' disabled' : ''}>${tr('이미지 저장')}</button>
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
    const pre = Object.assign({ title: '', artists: [], date: '', venue: '', vendor: '', vendorOther: '', cost: null, seat: '', status: '', memo: '', kopisId: '', period: null }, rec || {}, opts.prefill || {});
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

    const html = `${head(rec ? tr('기록 고치기') : tr('공연 기록'))}
      <form class="dlg-body" id="rec-form" novalidate>
        ${auto.size || hints.length ? `<div class="notice">${tr('자동으로 채운 칸을 확인하세요.')}${hints.length ? `<ul>${hints.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}</div>` : ''}
        <div class="kopis-box" id="kopis-box" hidden>
          <div class="k-search"><input type="search" id="k-q" class="input" placeholder="${tr('KOPIS에서 공연 찾기')}" value="${esc(pre.title)}" enterkeyhint="search"><button class="btn-line" type="button" id="k-go">${tr('찾기')}</button></div>
          <div id="k-results" aria-live="polite"></div>
        </div>
        <label class="field${a('title')}" data-f="title"><span>${tr('공연명')}</span><input type="text" name="title" value="${esc(pre.title)}" required maxlength="120"></label>
        <div class="field${a('artists')}" data-f="artists"><span>${tr('아티스트')}</span>
          <div class="chips" id="chips"></div>
          <div class="pick-row"><input type="search" id="a-q" class="input" placeholder="${tr('아티스트 검색')}" autocomplete="off" enterkeyhint="search"><button class="btn-line" type="button" id="a-go">${tr('찾기')}</button></div>
          <div class="pick-list" id="a-list" hidden></div>
        </div>
        <div class="field${a('date')}" data-f="date"><span>${tr('관람일')}</span><div id="dates"></div></div>
        <div class="field${a('venue')}" data-f="venue"><span>${tr('공연장')}</span>
          <input type="hidden" name="venue" value="${esc(pre.venue)}">
          <div class="chips" id="venue-picked"></div>
          <div class="pick-row"><input type="search" id="v-q" class="input" placeholder="${tr('공연장 검색')}" autocomplete="off" enterkeyhint="search"><button class="btn-line" type="button" id="v-go">${tr('찾기')}</button></div>
          <div class="pick-list" id="v-list" hidden></div>
        </div>
        <div class="grid2">
          <label class="field${a('vendor')}"><span>${tr('예매처')}</span>
            <select name="vendor"><option value="">${tr('선택 안 함')}</option>${Object.entries(VENDORS).map(([k, v]) => `<option value="${k}"${pre.vendor === k ? ' selected' : ''}>${v}</option>`).join('')}</select>
            <input type="text" name="vendorOther" value="${esc(pre.vendorOther)}" placeholder="${tr('예매처 이름')}" ${pre.vendor === 'other' ? '' : 'hidden'} maxlength="40"></label>
          <label class="field${a('cost')}"><span>${tr('내가 낸 금액 (원)')}</span><input type="text" name="cost" inputmode="numeric" value="${U.isNum(pre.cost) ? U.comma(pre.cost) : ''}" placeholder="0">
            ${opts.tickets > 1 && U.isNum(pre.cost) ? `<button class="btn" type="button" id="split">${tr('{n}매로 나누기 ({w})', { n: opts.tickets, w: U.won(Math.round(pre.cost / opts.tickets)) })}</button>` : ''}</label>
        </div>
        <label class="field"><span>${tr('좌석 (선택)')}</span><input type="text" name="seat" value="${esc(pre.seat || '')}" maxlength="60" placeholder="${tr('예: 플로어 A구역 12열 5번')}" autocomplete="off">
          <small>${tr('나만 보는 정보예요. 이미지 저장에는 들어가지 않아요.')}</small></label>
        <fieldset class="field${a('status')}" style="border:0;margin:0;padding:0"><legend>${tr('상태')}</legend>
          <div class="seg">${Object.entries(STATUS).map(([k, v]) => `<label><input type="radio" name="status" value="${k}"${pre.status === k ? ' checked' : ''}>${v}</label>`).join('')}</div>
        </fieldset>
        <div class="field" data-f="poster"><span>${tr('포스터')}</span>
          <div class="poster-pick">
            <div class="thumb" id="thumb">${curPoster ? `<img data-poster="${curPoster}" data-title="" alt="${tr('현재 포스터')}">` : tr('없음')}</div>
            <div class="acts">
              <span class="btn-line file-btn">${tr('고르기')}<input type="file" accept="image/*" id="poster-file" aria-label="${tr('포스터 이미지 고르기')}"></span>
              <button class="btn" type="button" id="poster-remove" ${curPoster ? '' : 'hidden'}>${tr('빼기')}</button>
            </div>
          </div>
        </div>
        <label class="field"><span>${tr('메모')}</span><textarea name="memo" maxlength="1000">${esc(pre.memo)}</textarea></label>
        <div class="notice" id="dup-warn" hidden></div>
        <p class="err" id="form-err" hidden></p>
      </form>
      <footer class="dlg-foot"><button class="btn quiet spacer" data-close type="button">${tr('취소')}</button><button class="btn-solid" type="submit" form="rec-form" id="save-btn">${tr('저장')}</button></footer>
`;
    const d = openDialog(html);
    const f = d.querySelector('#rec-form');
    hydrate(d);
    const markAuto = (k) => { const el = f.querySelector(`[data-f="${k}"]`); if (el) el.classList.add('auto'); };

    /* 아티스트 */
    const chips = d.querySelector('#chips');
    const drawChips = () => {
      chips.innerHTML = artists.map((x, i) => `<span class="chip">${esc(x)}<button type="button" data-i="${i}" aria-label="${tr('{x} 빼기', { x: esc(x) })}">×</button></span>`).join('');
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
        rows = cfg.local(q).map((r) => Object.assign({ src: tr('내 기록') }, r));
        (remote || []).forEach((r) => { if (!rows.some((x) => S.norm(x.value) === S.norm(r.value))) rows.push(Object.assign({ src: 'KOPIS' }, r)); });
        list.innerHTML = rows.map((r, i) => `<button type="button" class="pick-item" data-i="${i}"><span><b>${esc(r.label)}</b>${r.meta ? `<small>${esc(r.meta)}</small>` : ''}</span><em>${r.src}</em></button>`).join('')
          + (state === 'loading' ? `<p class="pick-note">${tr('KOPIS에서 찾는 중…')}</p>` : '')
          + (state === 'error' ? `<p class="pick-note">${K.limited() ? esc(K.limited()) : kopisFail(reason)}</p>` : '')
          + (state === 'done' && !rows.length ? `<p class="pick-note">${tr('찾지 못했어요.')}</p>` : '')
          + `<button type="button" class="pick-add" data-add="1">${tr('목록에 없으면 ‘{q}’로 추가', { q: esc(q) })}</button>`;
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
      remote: (q) => K.artistSearch(q, [...selected].sort()[0] || (datesBox.querySelector('input[name=date]') || {}).value || '', year())
        .then((r) => r.map((x) => ({ value: x.name, label: x.name, meta: tr('KOPIS 공연 {n}건', { n: x.shows }) }))),
      pick: (r) => addArtist(r.value),
    });

    const venuePicked = d.querySelector('#venue-picked');
    const setVenue = (v) => {
      f.venue.value = v || '';
      venuePicked.innerHTML = v ? `<span class="chip">${esc(v)}<button type="button" data-clear="1" aria-label="${tr('공연장 빼기')}">×</button></span>` : '';
    };
    setVenue(pre.venue);
    venuePicked.addEventListener('click', (e) => { if (e.target.closest('[data-clear]')) setVenue(''); });
    const vList = d.querySelector('#v-list');
    picker({
      input: '#v-q', list: '#v-list', go: '#v-go',
      local: (q) => [...new Set(state.records.map((r) => r.venue).filter(Boolean))].filter((x) => has(x, q)).slice(0, 8).map((x) => ({ value: x, label: x })),
      remote: (q) => K.venueSearch(q).then((r) => r.map((x) => ({ value: cleanVenue(x.name), label: cleanVenue(x.name), id: x.id, halls: x.halls,
        meta: [x.sido, x.gugun].filter(Boolean).join(' ') + (x.halls > 1 ? tr(' · 공연장 {n}곳', { n: x.halls }) : '') }))),
      pick: async (r) => {
        if (r.src === 'KOPIS' && r.halls > 1) {
          vList.dataset.keep = '1';
          vList.innerHTML = `<p class="pick-note">${tr('공연장 불러오는 중…')}</p>`;
          let halls = [];
          try { halls = await K.placeHalls(r.id); } catch (e) { /* 시설 이름만 */ }
          vList.innerHTML = `<p class="pick-note">${tr('{v}의 어느 공연장인가요?', { v: esc(r.value) })}</p>`
            + halls.map((h) => `<button type="button" class="pick-hall" data-v="${esc(`${r.value} (${h.name})`)}"><b>${esc(h.name)}</b>${h.seats ? `<small>${tr('{n}석', { n: U.comma(h.seats) })}</small>` : ''}</button>`).join('')
            + `<button type="button" class="pick-hall" data-v="${esc(r.value)}">${esc(r.value)} ${tr('(공연장 모름)')}</button>`;
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
        datesBox.innerHTML = `<input type="date" name="date" value="${esc(pre.date)}" required min="2000-01-01" max="2099-12-31" aria-label="${tr('관람일')}">`;
        return;
      }
      // 날짜 칸(#add-day)은 한 번 만들고 다시 그리지 않는다.
      // 아이폰은 빈 날짜 칸을 누르자마자 '오늘'을 넣고 change를 보내는데,
      // 그때 칸을 새로 그리면 달력이 닫혀 버려서 오늘로 고정되던 문제가 있었다.
      if (!datesBox.querySelector('#add-day')) {
        datesBox.innerHTML = '<div class="dates-top"></div><label class="add-day"><span></span><input type="date" id="add-day" min="2000-01-01" max="2099-12-31"></label><div class="dates-note"></div>';
      }
      const list = period ? K.days(period.from, period.to, 14) : null;
      const others = [...selected].filter((x) => !list || !list.includes(x)).sort();
      let h = '';
      if (period) h += `<p class="period">${tr('공연 기간 {a} – {b}', { a: U.dots(period.from), b: U.md(period.to) })}${list ? tr(' · {n}일', { n: list.length }) : ''}</p>`;
      if (list) {
        h += `<div class="days">${list.map((x) => `<label class="day"><input type="checkbox" value="${x}"${selected.has(x) ? ' checked' : ''}><b>${U.md(x)}</b><span>${U.weekday(x)}</span></label>`).join('')}</div>`;
      }
      if (others.length) h += `<div class="chips">${others.map((x) => `<span class="chip">${U.md(x)} ${U.weekday(x)}<button type="button" data-del="${x}" aria-label="${tr('{x} 빼기', { x: U.dots(x) })}">×</button></span>`).join('')}</div>`;
      datesBox.querySelector('.dates-top').innerHTML = h;
      datesBox.querySelector('.add-day span').textContent = list ? tr('다른 날') : selected.size ? tr('하루 더') : tr('날짜');
      datesBox.querySelector('.dates-note').innerHTML = selected.size > 1 ? `<p class="period">${tr('{n}일 → 기록 {n}개로 저장', { n: selected.size })}</p>` : '';
      const costLbl = f.cost && f.cost.closest('label').querySelector('span');
      if (costLbl) costLbl.textContent = selected.size > 1 ? tr('하루당 낸 금액 (원)') : tr('내가 낸 금액 (원)');
    };
    drawDates();
    // 달력을 한 번 여는 동안(누름 → 닫힘) 바뀐 날짜는 '추가'가 아니라 '교체'로 본다.
    // 그래야 아이폰이 먼저 넣은 '오늘'이나, 연도를 치는 중간값이 쌓이지 않는다.
    let pending = null; // { v: 이번에 넣은 날짜, isNew: 원래는 없던 날짜인지 }
    // 새로 시작: 칸을 다시 누를 때(안드로이드는 고른 뒤에도 칸에 포커스가 남음), 칸에서 나갈 때.
    // focusin은 쓰지 않는다 — 브라우저에 따라 값이 바뀔 때도 다시 오기 때문.
    // 달력이 열려 있는 동안에는 날짜 칸 주변을 다시 그리지 않는다.
    // 칸 위에 날짜 칩이 생기거나 옆 글자가 바뀌어 칸이 움직이면, 아이폰 달력이 닫혀 버릴 수 있다.
    // 고른 날짜는 바로 기억해 두고, 칸에서 나갈 때(달력을 닫을 때) 한 번에 그린다.
    let needDraw = false;
    datesBox.addEventListener('pointerdown', (e) => { if (e.target.id === 'add-day') pending = null; });
    datesBox.addEventListener('focusout', (e) => {
      if (e.target.id !== 'add-day') return;
      pending = null; e.target.value = '';
      if (needDraw) { needDraw = false; drawDates(); autoStatus(); }
    });
    datesBox.addEventListener('change', (e) => {
      const t = e.target;
      if (t.id === 'add-day') {
        if (pending && pending.isNew && pending.v !== t.value) selected.delete(pending.v);
        pending = null;
        if (U.isDate(t.value)) { pending = { v: t.value, isNew: !selected.has(t.value) }; selected.add(t.value); }
        if (document.activeElement === t) needDraw = true; else drawDates();
      }
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
      thumb.innerHTML = `<img src="${URL.createObjectURL(p.blob)}" alt="${tr('포스터 미리보기')}">`;
      d.querySelector('#poster-remove').hidden = false;
    };
    d.querySelector('#poster-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      thumb.textContent = '…';
      try { setPoster(await processImage(file, 1400)); } catch (err) { thumb.textContent = tr('읽지 못함'); }
    });
    d.querySelector('#poster-remove').addEventListener('click', () => {
      newPoster = null; removePoster = true; thumb.textContent = tr('없음');
      d.querySelector('#poster-remove').hidden = true;
    });

    /* KOPIS 찾기 */
    const kbox = d.querySelector('#kopis-box'), kres = d.querySelector('#k-results'), kq = d.querySelector('#k-q');
    let kList = [];
    const drawResults = (res, chosenId) => {
      kList = res ? res.list.slice(0, 6) : [];
      if (!res) { kres.innerHTML = ''; return; }
      if (!kList.length) { kres.innerHTML = `<p class="help">${tr('KOPIS에서 찾지 못했어요. 공연명을 고쳐서 다시 찾아보세요.')}</p>`; return; }
      kres.innerHTML = `<div class="k-list">${kList.map((c, i) => `<button type="button" class="k-item" data-k="${i}" aria-pressed="${c.id === chosenId}">
          <span class="k-img">${c.poster ? `<img src="${esc(K.posterSrc(c.poster))}" data-fb="${esc(K.posterFallback(c.poster))}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</span>
          <span class="k-txt"><b>${esc(c.title)}</b><small>${U.dots(c.from)} – ${U.md(c.to)} · ${esc(cleanVenue(c.venue))}</small></span></button>`).join('')}</div>
        <p class="src">${tr('출처: KOPIS 공연예술통합전산망')}</p>`;
      // 폰에서 KOPIS 포스터를 바로 못 받으면 사이트 서버로 한 번 더
      kres.querySelectorAll('img[data-fb]').forEach((im) => im.addEventListener('error', () => {
        if (im.dataset.fb && !K.limited()) { const u = im.dataset.fb; delete im.dataset.fb; im.src = u; } else im.remove();
      }));
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
          else thumb.textContent = tr('없음');
        } catch (e) { thumb.textContent = tr('없음'); }
      }
    };
    kres.addEventListener('click', (e) => { const b = e.target.closest('.k-item'); if (b) choose(kList[+b.dataset.k]); });
    const runSearch = async () => {
      const q = kq.value.trim() || f.title.value.trim();
      if (!q) { kq.focus(); return; }
      kres.innerHTML = `<p class="help">${tr('찾는 중…')}</p>`;
      const first = rec ? (datesBox.querySelector('input[name=date]') || {}).value : [...selected].sort()[0];
      try { drawResults(await K.searchAll({ title: q, date: first || '', venue: f.venue.value, year: year() })); }
      catch (e) { kres.innerHTML = `<p class="help">${K.limited() ? esc(K.limited()) : kopisFail(K.why(e))}</p>`; }
    };
    d.querySelector('#k-go').addEventListener('click', runSearch);
    kq.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); runSearch(); } });
    K.enabled().then((on) => {
      kopisOn = on;
      if (!on) return;
      kbox.hidden = false;
      if (K.limited() && !opts.kopis) kres.innerHTML = `<p class="help">${esc(K.limited())}</p>`;
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
      if (!title) problems.push(tr('공연명을 적어 주세요.'));
      if (!okDates.length) problems.push(tr('관람일을 골라 주세요.'));
      f.querySelector('[data-f=title]').classList.toggle('invalid', !title);
      f.querySelector('[data-f=date]').classList.toggle('invalid', !okDates.length);
      if (problems.length) { err.textContent = problems.join(' '); err.hidden = false; return; }
      err.hidden = true;
      const ids = new Set(rec ? [rec.id] : []);
      const dups = okDates.filter((dt) => state.records.some((r) => !ids.has(r.id) && r.date === dt &&
        ((kopisId && r.kopisId === kopisId) || S.norm(r.title) === S.norm(title))));
      if (dups.length && !dupConfirmed) {
        const w = d.querySelector('#dup-warn');
        w.innerHTML = tr('<strong>{d}에 같은 공연 기록이 이미 있어요.</strong> 그래도 저장하려면 한 번 더 누르세요.', { d: dups.map(U.md).join(', ') });
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
        seat: f.seat.value.trim(),
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
        err.textContent = tr('포스터를 저장하지 못했어요.'); err.hidden = false; return;
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
      toast(rec ? tr('저장했어요') : okDates.length > 1 ? tr('{n}일 기록했어요', { n: okDates.length }) : tr('기록했어요'));
    });
    setTimeout(() => { if (!rec && !pre.title) f.title.focus(); }, 50);
  }

  function openDetail(id) {
    const r = state.records.find((x) => x.id === id);
    if (!r) return;
    const other = !(U.isDate(r.date) && r.date.slice(0, 4) === String(year()));
    const key = S.showKey(r);
    const same = state.records.filter((x) => S.showKey(x) === key && x.status === 'done').sort(byDate);
    const span = r.period ? K.days(r.period.from, r.period.to, 400) : null;
    const html = `${head(esc(r.title))}
      <div class="dlg-body">
        <div class="detail">
          <div>${r.posterId ? `<img data-poster="${r.posterId}" data-title="${esc(r.title)}" alt="${tr('{t} 포스터', { t: esc(r.title) })}">` : `<span class="fallback-poster" style="position:relative;inset:auto;aspect-ratio:1/1.414;display:grid">${esc(r.title)}</span>`}</div>
          <div>
            <div class="d-date">${U.md(r.date)}</div>
            <p style="margin:6px 0 0;color:var(--accent-text)">${tr('{y}년 {w}', { y: U.dots(r.date).slice(0, 4), w: U.weekdayLong(r.date) })}</p>
            <h3>${esc(r.title)}</h3>
            <dl>
              <dt>${tr('아티스트')}</dt><dd>${esc((r.artists || []).join(', ')) || tr('미입력')}</dd>
              <dt>${tr('공연장')}</dt><dd>${esc(r.venue) || tr('미입력')}</dd>
              ${r.seat ? `<dt>${tr('좌석')}</dt><dd>${esc(r.seat)}</dd>` : ''}
              <dt>${tr('예매처')}</dt><dd>${r.vendor === 'other' ? esc(r.vendorOther || VENDORS.other) : VENDORS[r.vendor] || tr('미입력')}</dd>
              <dt>${tr('본인 부담')}</dt><dd>${U.won(r.cost)}</dd>
              <dt>${tr('상태')}</dt><dd>${STATUS[r.status] || ''}${other || r.status !== 'done' ? tr(' · 통계 제외') : ''}</dd>
              ${same.length > 1 ? `<dt>${tr('관람')}</dt><dd>${tr('{n}일', { n: same.length })} · ${same.map((x) => U.md(x.date)).join(', ')}</dd>` : ''}
              ${r.period ? `<dt>${tr('공연 기간')}</dt><dd>${U.dots(r.period.from)} – ${U.md(r.period.to)}${span ? ` (${tr('{n}일', { n: span.length })})` : ''}</dd>` : ''}
            </dl>
            ${r.memo ? `<p class="memo">${esc(r.memo)}</p>` : ''}
          </div>
        </div>
      </div>
      <footer class="dlg-foot">
        <button class="btn btn-danger spacer" id="del" type="button" style="border-bottom-color:currentColor">${tr('삭제')}</button>
        <button class="btn-line" id="again" type="button">${tr('다른 날 추가')}</button>
        <button class="btn-solid" id="edit" type="button">${tr('고치기')}</button>
      </footer>`;
    const d = openDialog(html);
    hydrate(d);
    d.querySelector('#edit').addEventListener('click', () => { d.close(); openForm({ record: r }); });
    d.querySelector('#again').addEventListener('click', () => {
      d.close();
      openForm({ prefill: { title: r.title, artists: r.artists, venue: r.venue, vendor: r.vendor, vendorOther: r.vendorOther, cost: r.cost, date: '', status: '', kopisId: r.kopisId || '', period: r.period || null, sharePoster: r.posterId || null, sharePosterRatio: r.posterRatio || null } });
    });
    d.querySelector('#del').addEventListener('click', async () => {
      if (!(await ask(tr('‘{t}’ ({d}) 기록을 삭제할까요? 되돌릴 수 없어요.', { t: r.title, d: U.dots(r.date) }), { title: tr('기록 삭제'), ok: tr('삭제'), danger: true }))) return;
      state.records = state.records.filter((x) => x.id !== r.id);
      save();
      await releasePoster(r.posterId);
      d.close();
      render();
      toast(tr('기록을 삭제했어요'));
    });
  }

  /* ---------- 가져오기 ---------- */
  function openImport() {
    const html = `${head(tr('캡처로 추가'))}
      <div class="dlg-body">
        ${previewNote(tr('글자 인식'))}
        <label class="drop" id="drop"><strong>${tr('캡처 이미지 고르기')}</strong><span class="help">${tr('예매 완료 · 예매 내역 화면 (한국 예매처)')}</span>
          <input type="file" accept="image/*" id="ocr-file" class="sr"></label>
        <div id="ocr-state" hidden><div class="progress"><i id="ocr-bar"></i></div><p class="help" id="ocr-msg">${tr('글자 읽는 중…')}</p></div>
      </div>`;
    const d = openDialog(html);
    const drop = d.querySelector('#drop');
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files[0]) runOCR(e.dataTransfer.files[0]); });
    d.querySelector('#ocr-file').addEventListener('change', (e) => { if (e.target.files[0]) runOCR(e.target.files[0]); });

    async function runOCR(file) {
      const box = d.querySelector('#ocr-state'), bar = d.querySelector('#ocr-bar'), msg = d.querySelector('#ocr-msg');
      box.hidden = false; bar.style.width = '4%'; msg.textContent = tr('글자 읽는 중…');
      try {
        const prepared = await processImage(file, 2400);
        const text = await ocr(prepared.blob, (p) => { bar.style.width = Math.max(8, Math.round(p * 90)) + '%'; msg.textContent = tr('글자 읽는 중 {n}%', { n: Math.round(p * 100) }); });
        const res = P.parseBooking(text, { today: U.todayStr(), year: year() });
        msg.textContent = tr('KOPIS에서 공연 찾는 중…'); bar.style.width = '95%';
        const kopis = await findOnKopis(res.fields, text);
        d.close();
        openForm({ prefill: Object.assign({}, res.fields, { source: 'ocr' }), auto: res.auto, hints: res.hints, tickets: res.tickets, kopis });
      } catch (e) {
        bar.style.width = '0';
        msg.textContent = tr('글자를 읽지 못했어요. ‘직접 추가’로 입력해 주세요.');
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
    try { return await K.searchAll({ title, date: fields.date || '', venue: fields.venue || '', year: year() }); }
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
    const html = `${head(tr('리캡 색 바꾸기'))}
      <div class="dlg-body">
        <div class="pickers" style="margin-top:0">
          ${[['a', tr('강조색'), state.theme.accent], ['b', tr('배경색'), state.theme.bg]].map(([k, lb, v]) => `<div class="picker"><span>${lb}</span>
            <label class="pick-tap"><input type="color" id="pk-${k}" value="${v}" aria-label="${tr('{x} 팔레트에서 고르기', { x: lb })}"><i class="sw" id="sw-${k}" style="background:${v}"></i><b id="cd-${k}">${v.toUpperCase()}</b><em>${tr('눌러서 고르기')}</em></label>
            <div class="row hx-row"><small>${tr('코드로 입력')}</small><input type="text" id="hx-${k}" value="${v.toUpperCase()}" maxlength="7" aria-label="${tr('{x} 코드', { x: lb })}" autocomplete="off" spellcheck="false"></div></div>`).join('')}
        </div>
        <div class="preview-strip" aria-hidden="true"><span class="yy">${year()}</span><span class="tx"><b>( ${tr('관람')} )</b> ${tr('{n}회', { n: 12 })}</span></div>
        <p class="contrast-note" id="cnote"></p>
        <p class="help" style="margin:18px 0 0;font-weight:600;color:var(--ink)">${tr('추천 색 조합')}</p>
        <div class="swatches" role="group" aria-label="${tr('추천 색 조합')}" style="margin-top:8px">${T.PRESETS.map((p) => {
          const tk = T.tokens(p.accent, p.bg);
          return `<button class="swatch" type="button" data-preset="${p.id}" aria-pressed="${state.theme.preset === p.id}" style="--sw-bg:${p.bg};--sw-a:${tk.accentLarge};--sw-ink:${tk.ink}">
            <span class="chip-a"></span><span class="big" aria-hidden="true">${String(year()).slice(2)}</span><span class="nm">${tr(p.name)}</span></button>`;
        }).join('')}</div>
      </div>
      <footer class="dlg-foot"><button class="btn quiet spacer" type="button" id="reset">${tr('처음 색으로')}</button><button class="btn-line" type="button" id="cancel">${tr('바꾸기 전으로')}</button><button class="btn-solid" type="button" data-close>${tr('완료')}</button></footer>`;
    const d = openDialog(html);
    const sync = () => {
      for (const [k, v] of [['a', state.theme.accent], ['b', state.theme.bg]]) {
        d.querySelector('#pk-' + k).value = v; d.querySelector('#hx-' + k).value = v.toUpperCase();
        d.querySelector('#cd-' + k).textContent = v.toUpperCase(); d.querySelector('#sw-' + k).style.background = v;
      }
      d.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === state.theme.preset)));
      d.querySelector('#cnote').textContent = tokens.adjusted ? tr('배경과 비슷한 색이라 글자는 조금 진하게 보여요.') : '';
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
      if (!U.isHex(v)) { toast(tr('#1F22B5처럼 6자리 색 코드를 적어 주세요')); sync(); return; }
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
    const data = { app: 'concert-recap-2026', version: 1, exportedAt: new Date().toISOString(), nickname: state.nickname, year: year(), theme: state.theme, dupIgnore: state.dupIgnore, records: state.records, posters };
    return new File([JSON.stringify(data)], `concert-recap-backup-${U.todayStr().replace(/-/g, '')}.json`, { type: 'application/json' });
  }
  async function doBackup(share) {
    const file = await makeBackup();
    if (share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], title: tr('공연 기록 백업') }); } catch (e) { if (e.name !== 'AbortError') download(file, file.name); else return; }
    } else download(file, file.name);
    state.lastBackup = Date.now();
    save();
    toast(tr('백업 파일을 만들었어요'));
  }
  async function restore(file, mode) {
    let data;
    const notOurs = tr('이 파일은 백업 파일이 아니에요. 이름이 concert-recap-backup-날짜.json 인 파일을 골라 주세요.');
    try { data = JSON.parse(await file.text()); } catch (e) { throw new Error(notOurs); }
    if (!data || data.app !== 'concert-recap-2026' || !Array.isArray(data.records)) throw new Error(notOurs);
    const posters = data.posters || {};
    const valid = data.records.filter((r) => r && r.id && typeof r.title === 'string');
    if (mode === 'replace') {
      for (const r of state.records) if (r.posterId) forgetPoster(r.posterId);
      await DB.clearPosters();
      state.records = [];
      state.dupIgnore = data.dupIgnore || [];
      if (data.nickname) state.nickname = data.nickname;
      if (Number(data.year) >= 2000 && Number(data.year) <= 2100) state.year = Number(data.year);
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

  /* 연도 목록: 기록이 있는 해 + 올해·내년, 2015년부터. 해마다 기록 수를 같이 보여 준다 */
  function yearOptions() {
    const count = {};
    for (const r of state.records) if (U.isDate(r.date)) count[r.date.slice(0, 4)] = (count[r.date.slice(0, 4)] || 0) + 1;
    const ys = Object.keys(count).map(Number).filter((y) => y >= 2000 && y <= 2100);
    const hi = Math.max(THIS_YEAR + 1, year(), ...ys), lo = Math.min(2015, year(), ...ys);
    let out = '';
    for (let y = hi; y >= lo; y--) out += `<option value="${y}"${y === year() ? ' selected' : ''}>${y}${count[y] ? tr(' (기록 {n}건)', { n: count[y] }) : ''}</option>`;
    return out;
  }

  /* ---------- 설정 ---------- */
  function openSettings() {
    const hasSample = state.records.some((r) => r.source === 'sample');
    const html = `${head(tr('설정'))}
      <div class="dlg-body">
        <div class="field"><span>${I.lang === 'en' ? 'Language' : tr('언어') + ' · Language'}</span>
          <div class="lang-pick" role="group" aria-label="Language">${I.LANGS.map(([k, v]) => `<button type="button" class="btn quiet" data-lang="${k}" aria-pressed="${I.lang === k}">${v}</button>`).join('')}</div>
          <small>${tr('공연명·공연장 이름은 KOPIS에서 가져온 한국어 그대로 나와요.')}</small></div>
        <form id="nick-edit" class="field"><span>${tr('닉네임')}</span>
          <div style="display:flex;gap:12px;align-items:end"><input type="text" name="nick" value="${esc(state.nickname)}" maxlength="20" class="input" style="flex:1"><button class="btn-line" type="submit">${tr('바꾸기')}</button></div></form>
        <form id="year-edit" class="field"><span>${tr('기록할 연도')}</span>
          <div style="display:flex;gap:12px;align-items:end"><select name="year" class="input" style="flex:1" aria-label="${tr('기록할 연도')}">${yearOptions()}</select><button class="btn-line" type="submit">${tr('바꾸기')}</button></div>
          <small>${tr('다른 해 기록은 지우지 않아요. 전체 기록의 ‘{y}년 외’에서 볼 수 있어요.', { y: year() })}</small></form>
        <div class="field"><span>${tr('리캡 색')}</span>
          <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap">
            <span class="color-now" aria-hidden="true"><i style="background:${state.theme.accent}"></i><i style="background:${state.theme.bg}"></i></span>
            <button class="btn-line" type="button" id="go-theme">${tr('색 바꾸기')}</button></div></div>
        <div class="field"><span>${tr('지우기')}</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap">${hasSample ? `<button class="btn-line" type="button" id="clr-sample">${tr('예시 기록 지우기')}</button>` : ''}<button class="btn-line btn-danger" type="button" id="clr-all">${tr('모든 기록 지우기')}</button></div>
          <small>${tr('지우기 전에 ‘백업’에서 백업 파일을 만들어 두세요.')}</small></div>
      </div>
      <footer class="dlg-foot"><button class="btn-solid" data-close type="button">${tr('닫기')}</button></footer>`;
    const d = openDialog(html);
    d.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.lang !== I.lang) I.setLang(b.dataset.lang); }));
    d.querySelector('#year-edit').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = Number(e.target.year.value);
      if (!(v >= 2000 && v <= 2100) || v === year()) return;
      state.year = v; save(); d.close(); render(); toast(tr('{y}년 기록으로 바꿨어요', { y: v }));
    });
    d.querySelector('#nick-edit').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = e.target.nick.value.trim();
      if (!v) { toast(tr('닉네임을 적어 주세요')); return; }
      state.nickname = v; save(); render(); toast(tr('닉네임을 바꿨어요'));
    });
    d.querySelector('#go-theme').addEventListener('click', () => { d.close(); openTheme(); });
    const cs = d.querySelector('#clr-sample'); if (cs) cs.addEventListener('click', () => { d.close(); clearSample(); });
    d.querySelector('#clr-all').addEventListener('click', async () => {
      if (!(await ask(tr('모든 기록과 포스터를 지워요. 되돌릴 수 없어요. 먼저 백업해 두는 걸 권해요.'), { title: tr('모든 기록 지우기'), ok: tr('모두 지우기'), danger: true, typeWord: tr('삭제') }))) return;
      for (const r of state.records) if (r.posterId) forgetPoster(r.posterId);
      await DB.clearPosters();
      state.records = []; state.sample = false; state.dupIgnore = [];
      save(); d.close(); render(); toast(tr('모든 기록을 지웠어요'));
    });
  }

  /* ---------- 백업 (처음 쓰는 사람도 따라 할 수 있게 단계별로) ---------- */
  function openBackup() {
    const n = state.records.length;
    const canShare = !!(navigator.canShare && window.File && navigator.canShare({ files: [new File(['x'], 'x.json', { type: 'application/json' })] }));
    const where = IS_IOS ? tr('<b>파일</b> 앱 → <b>다운로드</b> 폴더') : IS_ANDROID ? tr('<b>내 파일</b>(또는 파일) 앱 → <b>다운로드</b> 폴더') : tr('<b>다운로드</b> 폴더');
    const saveSteps = IS_IOS
      ? [tr('아래 <b>백업 파일 저장</b>을 눌러요.'), tr('‘다운로드할까요?’ 창이 뜨면 <b>다운로드</b>를 눌러요.'), tr('파일은 {where}에 들어가요. 이름은 <b>concert-recap-backup-날짜.json</b>이에요.', { where })]
      : [tr('아래 <b>백업 파일 저장</b>을 눌러요.'), tr('파일은 {where}에 들어가요. 이름은 <b>concert-recap-backup-날짜.json</b>이에요.', { where })];
    const openSteps = IS_IOS
      ? [tr('<b>백업 파일 고르기</b>를 눌러요.'), tr('파일 창이 열리면 <b>둘러보기</b> → <b>다운로드</b>로 가서 백업 파일을 눌러요.'), tr('카톡으로 받은 파일이면, 먼저 카톡에서 파일을 열고 <b>공유(↑) → 파일에 저장</b>을 해 두세요.')]
      : IS_ANDROID
        ? [tr('<b>백업 파일 고르기</b>를 눌러요.'), tr('‘최근’ 목록이 나오면 왼쪽 위 <b>≡</b> → <b>다운로드</b>로 가서 백업 파일을 눌러요.'), tr('카톡으로 받은 파일이면, 먼저 카톡에서 파일을 눌러 <b>저장</b>해 두세요.')]
        : [tr('<b>백업 파일 고르기</b>를 눌러 백업 파일을 골라요.')];
    const ol = (list) => `<ol class="steps">${list.map((x) => `<li>${x}</li>`).join('')}</ol>`;
    const html = `${head(tr('백업'))}
      <div class="dlg-body">
        ${previewNote(tr('백업 파일 저장과 CSV 내보내기'))}${inAppBox(true)}
        <div class="notice">${tr('기록은 서버가 아니라 <b>이 폰의 브라우저에만</b> 저장돼요. 브라우저 기록·캐시를 지우거나 폰을 바꾸면 사라질 수 있어요. <b>백업 파일</b>을 만들어 두면 언제든, 다른 폰에서도 그대로 되살릴 수 있어요.')}</div>
        <section class="field"><span>${tr('1. 백업 파일 만들기 · 기록 {n}건 + 포스터 + 색', { n })}</span>
          ${ol(saveSteps)}
          <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-solid" type="button" id="bk">${tr('백업 파일 저장')}</button>${canShare ? `<button class="btn-line" type="button" id="bk-share">${tr('카톡·드라이브로 보내기')}</button>` : ''}</div>
          <small>${canShare ? tr('‘카톡·드라이브로 보내기’로 카톡 나와의 채팅이나 구글 드라이브에 보내 두면 폰을 바꿔도 안전해요. ') : ''}${state.lastBackup ? tr('마지막 백업: {d}', { d: new Date(state.lastBackup).toLocaleDateString(I.locale()) }) : tr('아직 백업한 적이 없어요.')}</small>
        </section>
        <section class="field"><span>${tr('2. 백업 파일로 되살리기')}</span>
          ${ol(openSteps)}
          <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center"><span class="btn-line file-btn">${tr('백업 파일 고르기')}<input type="file" accept=".json,application/json,text/plain,application/octet-stream" id="rs-file"></span></div>
          <div id="rs-choose" hidden class="notice">
            <p style="margin:0 0 8px">${tr('<b id="rs-name"></b> 을(를) 골랐어요. 어떻게 할까요?')}</p>
            <ul style="margin:0 0 10px;padding-left:18px"><li>${tr('<b>합치기</b>: 지금 기록은 두고, 백업에만 있는 기록을 더해요. (보통은 이걸 고르세요)')}</li><li>${tr('<b>바꾸기</b>: 지금 기록을 지우고 백업 내용으로 바꿔요.')}</li></ul>
            <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn-solid" type="button" id="rs-merge">${tr('합치기')}</button><button class="btn-line btn-danger" type="button" id="rs-replace">${tr('바꾸기|restore')}</button></div></div>
          <p class="err" id="rs-err" hidden></p>
          <small>${tr('파일이 흐리게 보여서 안 눌리면, 파일 이름 끝이 <b>.json</b>인지 확인해 주세요.')}</small>
        </section>
        <section class="field"><span>${tr('표로 내보내기 (엑셀·구글 시트)')}</span>
          <div style="display:flex;gap:12px;flex-wrap:wrap"><button class="btn" type="button" id="csv-out">${tr('CSV로 내보내기')}</button></div>
          <small>${tr('보기용 표예요. 되살리기에는 위의 백업 파일을 쓰세요.')}</small></section>
        ${IS_IOS ? `<p class="help" style="margin:0">${tr('아이폰은 사파리 아래 <b>공유(↑) → 홈 화면에 추가</b>로 앱처럼 쓰면 기록이 더 오래 안전하게 남아요.')}</p>` : ''}
      </div>
      <footer class="dlg-foot"><button class="btn-solid" data-close type="button">${tr('닫기')}</button></footer>`;
    const d = openDialog(html);
    d.querySelector('#bk').addEventListener('click', () => doBackup(false));
    const bs = d.querySelector('#bk-share'); if (bs) bs.addEventListener('click', () => doBackup(true));
    let picked = null;
    d.querySelector('#rs-file').addEventListener('change', (e) => {
      picked = e.target.files[0];
      d.querySelector('#rs-choose').hidden = !picked;
      d.querySelector('#rs-err').hidden = true;
      if (picked) d.querySelector('#rs-name').textContent = picked.name;
    });
    const run = async (mode) => {
      const er = d.querySelector('#rs-err');
      if (mode === 'replace' && !(await ask(tr('지금 기기에 있는 기록과 포스터를 모두 지우고 백업 내용으로 바꿀까요?'), { title: tr('백업으로 바꾸기'), ok: tr('바꾸기|restore'), danger: true }))) return;
      try {
        const res = await restore(picked, mode);
        d.close(); render();
        toast(tr('되살렸어요. 새 기록 {n}건', { n: res.added }) + (res.updated ? tr(', 바뀐 기록 {n}건', { n: res.updated }) : ''));
      } catch (err) { er.textContent = err.message; er.hidden = false; }
    };
    d.querySelector('#rs-merge').addEventListener('click', () => run('merge'));
    d.querySelector('#rs-replace').addEventListener('click', () => run('replace'));
    d.querySelector('#csv-out').addEventListener('click', () => {
      // 표 제목·상태 글자는 화면 언어로 (다시 읽을 때도 세 언어 모두 알아본다)
      const CSV = {
        ko: [['공연명', '아티스트', '관람일', '공연장', '좌석', '예매처', '본인 부담 금액', '상태', '메모'], { done: '완료', planned: '예정', canceled: '취소' }],
        en: [['Title', 'Artists', 'Date', 'Venue', 'Seat', 'Vendor', 'Cost', 'Status', 'Memo'], { done: 'done', planned: 'planned', canceled: 'canceled' }],
        ja: [['公演名', 'アーティスト', '観覧日', '会場', '座席', '購入先', '自己負担額', '状態', 'メモ'], { done: '済み', planned: '予定', canceled: 'キャンセル' }],
      }[I.lang];
      const head = CSV[0];
      const lines = state.records.slice().sort(byDate).map((r) => [r.title, (r.artists || []).join(';'), r.date, r.venue, r.seat || '',
        r.vendor === 'other' ? r.vendorOther : (VENDORS[r.vendor] || ''), U.isNum(r.cost) ? r.cost : '', CSV[1][r.status] || '', r.memo || ''].map(P.csvCell).join(','));
      download(new Blob(['﻿' + [head.join(',')].concat(lines).join('\n')], { type: 'text/csv;charset=utf-8' }), `concert-recap-${U.todayStr().replace(/-/g, '')}.csv`);
    });
  }

  /* ---------- 중복 ---------- */
  function openDups() {
    const st = stats();
    if (!st.duplicates.length) { toast(tr('중복일 수 있는 기록이 없어요')); return; }
    const html = `${head(tr('중복 확인'))}
      <div class="dlg-body">
        ${st.duplicates.map((g, gi) => `<div class="dup-group"><h3>${tr(g.label)}</h3>
          ${g.records.map((r) => `<div class="dup-row"><span><strong>${esc(r.title)}</strong><small>${U.dots(r.date)} · ${esc(r.venue || tr('공연장 미입력'))} · ${STATUS[r.status]} · ${U.won(r.cost)}</small></span>
            <span style="display:flex;gap:14px"><button class="btn" data-open="${r.id}" type="button">${tr('보기')}</button><button class="btn btn-danger" data-del="${r.id}" type="button" style="border-bottom-color:currentColor">${tr('삭제')}</button></span></div>`).join('')}
          <div><button class="btn-line" data-ok="${gi}" type="button">${tr('중복 아님')}</button></div></div>`).join('')}
      </div>
      <footer class="dlg-foot"><button class="btn-solid" data-close type="button">${tr('닫기')}</button></footer>`;
    const d = openDialog(html);
    d.addEventListener('click', async (e) => {
      const o = e.target.closest('[data-open]'), del = e.target.closest('[data-del]'), ok = e.target.closest('[data-ok]');
      if (o) { d.close(); openDetail(o.dataset.open); }
      if (del) {
        const r = state.records.find((x) => x.id === del.dataset.del);
        if (!r || !(await ask(tr('‘{t}’ ({d}) 기록을 삭제할까요?', { t: r.title, d: U.dots(r.date) }), { title: tr('기록 삭제'), ok: tr('삭제'), danger: true }))) return;
        state.records = state.records.filter((x) => x.id !== r.id);
        await releasePoster(r.posterId);
        save(); d.close(); render(); openDups();
      }
      if (ok) {
        state.dupIgnore = (state.dupIgnore || []).concat(st.duplicates[+ok.dataset.ok].key);
        save(); d.close(); render(); if (stats().duplicates.length) openDups(); else toast(tr('확인했어요'));
      }
    });
  }

  /* ---------- 계산 근거 ---------- */
  function openBasis(k) {
    const st = stats();
    const row = (r, right, cls) => `<li class="${cls || ''}"><span>${U.dots(r.date)}</span><span>${esc(r.title)}</span><span class="r">${right}</span></li>`;
    let title = '', body = '';
    if (k === 'count') {
      title = tr('관람 {n}회', { n: st.count });
      body = `<ul class="basis-list">${st.included.map((r, i) => row(r, tr('{n}회째', { n: i + 1 }))).join('')}</ul>
        ${st.excluded.length ? `<h3 style="margin:8px 0 0;font-size:var(--f-s)">${tr('제외 {n}건', { n: st.excluded.length })}</h3><ul class="basis-list">${st.excluded.map((e) => row(e.record, tr(e.label), 'x')).join('')}</ul>` : ''}`;
    } else if (k === 'spend') {
      title = tr('티켓 지출 {w}', { w: U.won(st.spend) });
      const plannedSum = st.planned.filter((r) => U.isNum(r.cost)).reduce((s, r) => s + r.cost, 0);
      body = `<ul class="basis-list">${st.spendRecords.map((r) => row(r, U.won(r.cost))).join('')}
          ${st.missingCost.map((r) => row(r, tr('미입력'), 'x')).join('')}</ul>
        <div class="sum-line"><span>${tr('합계')}</span><span>${U.won(st.spend)}</span></div>
        ${plannedSum ? `<p class="help">${tr('관람 예정 {w}은 제외', { w: U.won(plannedSum) })}</p>` : ''}`;
    } else if (k === 'venue' || k === 'artist') {
      const list = k === 'venue' ? st.venues : st.artists;
      title = k === 'venue' ? tr('공연장 {n}곳', { n: st.venueCount }) : tr('아티스트 {n}팀', { n: st.artistCount });
      body = `<ul class="basis-list">${list.list.map((e) => `<li><span>${tr('{n}회', { n: e.count })}</span><span>${esc(e.name)}</span><span class="r">${e.records.map((r) => U.md(r.date)).join(', ')}</span></li>`).join('')}</ul>
        ${k === 'venue' && st.included.some((r) => !r.venue) ? `<p class="help">${tr('공연장 미입력 {n}건 제외', { n: st.included.filter((r) => !r.venue).length })}</p>` : ''}
        ${k === 'artist' && st.included.some((r) => !(r.artists || []).length) ? `<p class="help">${tr('아티스트 미입력 {n}건 제외', { n: st.included.filter((r) => !(r.artists || []).length).length })}</p>` : ''}`;
    } else if (k === 'month') {
      title = tr('월별 관람');
      body = `<ul class="basis-list">${st.months.map((c, i) => `<li><span>${I.mon(i + 1)}</span><span>${st.included.filter((r) => Number(r.date.slice(5, 7)) === i + 1).map((r) => esc(r.title)).join(', ') || '–'}</span><span class="r">${tr('{n}회', { n: c })}</span></li>`).join('')}</ul>`;
    }
    openDialog(`${head(title)}<div class="dlg-body">${body}</div><footer class="dlg-foot"><button class="btn-solid" data-close type="button">${tr('닫기')}</button></footer>`);
  }

  /* ---------- 이미지 저장 ---------- */
  function openExport() {
    const st = stats();
    if (!st.count) { toast(tr('관람 완료한 공연이 있어야 이미지를 만들 수 있어요')); return; }
    const prefs = Object.assign({ format: 'story', layout: 'checker', scale: 1 }, state.exportPrefs || {});
    const SHOW = [['spend', tr('티켓 지출')], ['counts', tr('공연장·아티스트 수')], ['bests', tr('가장 많이 본 아티스트·자주 간 공연장')], ['chart', tr('월별 관람 그래프')], ['posters', tr('공연별 포스터 장')]];
    const shown = Object.assign({ spend: true, counts: true, bests: true, chart: true, posters: true }, prefs.show || {});
    const touch = window.matchMedia && matchMedia('(pointer: coarse)').matches;
    const html = `${head(tr('이미지 저장'))}
      <div class="dlg-body">
        ${previewNote(tr('이미지 저장'))}${inAppBox(true)}
        <div class="ex-opts">
          <fieldset class="field" style="border:0;margin:0;padding:0"><legend>${tr('크기')}</legend>
            <div class="seg" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="format" value="story"${prefs.format === 'story' ? ' checked' : ''}>${tr('세로 9:16')}</label><label><input type="radio" name="format" value="square"${prefs.format === 'square' ? ' checked' : ''}>${tr('정사각 1:1')}</label></div></fieldset>
          <fieldset class="field" style="border:0;margin:0;padding:0"><legend>${tr('포스터 배치')}</legend>
            <div class="seg" style="grid-template-columns:1fr 1fr"><label><input type="radio" name="layout" value="checker"${prefs.layout === 'checker' ? ' checked' : ''}>${tr('날짜와 번갈아')}</label><label><input type="radio" name="layout" value="grid"${prefs.layout === 'grid' ? ' checked' : ''}>${tr('촘촘하게')}</label></div></fieldset>
        </div>
        <fieldset class="field" style="border:0;margin:0;padding:0"><legend>${tr('보여줄 내용')} <small style="font-weight:400;color:var(--muted)">${tr('(관람 횟수는 늘 들어가요)')}</small></legend>
          <div class="ex-show">${SHOW.map(([k, lb]) => `<label class="tgl"><input type="checkbox" name="show" value="${k}"${shown[k] ? ' checked' : ''}><i aria-hidden="true"></i><span>${lb}</span></label>`).join('')}</div></fieldset>
        <div class="ex-show solo"><label class="tgl"><input type="checkbox" id="hi" ${prefs.scale === 2 ? 'checked' : ''}><i aria-hidden="true"></i><span>${tr('2배 해상도')} <small>${tr('(더 선명, 파일이 커져요)')}</small></span></label></div>
        <p class="help" id="ex-info" style="margin:0"></p>
        <div id="ex-pages" class="ex-pages"><p class="ex-loading">${tr('이미지를 만드는 중이에요…')}</p></div>
        <div class="share-box">
          <div class="row"><button class="btn-solid" type="button" id="ex-save" disabled>${tr('이미지 모두 저장')}</button></div>
          ${touch && !INAPP ? `<p class="help" style="margin:0">${tr('미리보기 이미지를 길게 누르면 사진 앱에 저장돼요.')}</p>` : ''}
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
      box.innerHTML = `<p class="ex-loading">${tr('이미지를 만드는 중이에요…')}</p>`;
      const format = d.querySelector('input[name=format]:checked').value;
      const layout = d.querySelector('input[name=layout]:checked').value;
      const scale = d.querySelector('#hi').checked ? 2 : 1;
      const show = {};
      d.querySelectorAll('input[name=show]').forEach((c) => { show[c.value] = c.checked; });
      d.querySelector('input[name=layout]').closest('fieldset').hidden = !show.posters; // 포스터 장을 빼면 배치 고르기도 숨김
      state.exportPrefs = { format, layout, scale, show };
      save();
      try {
        const pages = await R.renderAll({ format, layout, state, st, tokens, year: year(), getBlob: DB.getPoster, scale, show, chartStyle: state.chartStyle === 'bar' ? 'bar' : 'poster' });
        if (my !== job) return;
        const blobs = [];
        for (const c of pages) { blobs.push(await new Promise((res) => c.toBlob(res, 'image/png'))); c.width = 0; c.height = 0; } // 한 장씩 PNG로 바꾸고 캔버스 메모리 돌려주기
        if (my !== job) return;
        if (blobs.some((b) => !b)) throw new Error('toBlob');
        box.querySelectorAll('img').forEach((im) => URL.revokeObjectURL(im.src));
        files = blobs.map((b, i) => new File([b], `${year()}-concert-recap-${format === 'story' ? 'story' : 'square'}-${i + 1}.png`, { type: 'image/png' }));
        const [w, h] = R.SIZES[format];
        d.querySelector('#ex-info').textContent = `${tr('{n}장', { n: files.length })} · ${w * scale}×${h * scale} · ${(blobs.reduce((s, b) => s + b.size, 0) / 1048576).toFixed(1)}MB`;
        box.innerHTML = files.map((f, i) => `<figure class="ex-page" style="margin:0"><img src="${URL.createObjectURL(f)}" alt="${tr('리캡 이미지 {n}쪽', { n: i + 1 })}"><div class="row"><span>${i + 1} / ${files.length}</span><button class="btn" type="button" data-dl="${i}">${tr('저장')}</button></div></figure>`).join('');
        btns().forEach((b) => { b.disabled = false; });
      } catch (e) {
        console.error(e);
        box.innerHTML = `<p class="err">${tr('이미지를 만들지 못했어요. 포스터가 너무 많으면 ‘촘촘하게’를 골라 보세요.')}</p>`;
      }
    }
    d.querySelectorAll('input[name=format], input[name=layout], input[name=show], #hi').forEach((el) => el.addEventListener('change', build));
    d.querySelector('#ex-pages').addEventListener('click', (e) => { const b = e.target.closest('[data-dl]'); if (b) download(files[+b.dataset.dl], files[+b.dataset.dl].name); });
    const saveAll = async () => { for (let i = 0; i < files.length; i++) { download(files[i], files[i].name); await new Promise((r) => setTimeout(r, 450)); } };
    d.querySelector('#ex-save').addEventListener('click', async () => { await saveAll(); toast(files.length > 1 ? tr('{n}장을 저장했어요', { n: files.length }) : tr('저장했어요')); });
    build();
  }

  /* ---------- 라우팅 ---------- */
  function render() {
    document.title = `${state.nickname ? year() : THIS_YEAR} CONCERT RECAP`;
    if (!state.nickname || location.hash === '#start') { viewOnboard(); return; }
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
      case 'data': case 'settings': openSettings(); break;
      case 'backup-open': openBackup(); break;
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
        save(); render(); toast(tr('{n}건을 관람 완료로 바꿨어요', { n: ids.size }));
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
        el.textContent = t.hidden ? tr('표로 보기') : tr('표 닫기');
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
    DB.open().then(() => { if ((!DB.canPersist() || DB.isPrivate()) && state.nickname && location.hash !== '#recap') render(); });
    DB.persist();
    render();
  }
  init();

  window.CR.app = { get state() { return state; }, render, stats, loadSample };
})();
