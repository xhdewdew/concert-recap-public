/* 예매 안내 글·OCR 글자·CSV를 공연 기록 후보로 바꾼다.
   결과는 항상 사용자가 확인한 뒤에 저장한다. 예매번호·좌석·QR 같은 줄은 읽지 않는다. */
(function (factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { window.CR = window.CR || {}; window.CR.parse = m; }
})(function () {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  const SENSITIVE = /(예매\s*번호|예약\s*번호|주문\s*번호|티켓\s*번호|좌석|구역|\d+\s*열\s*\d+|\b\d+\s*번\s*좌석|QR|바코드|입장\s*번호|정리\s*번호|휴대\s*폰|휴대전화|연락처|전화\s*번호|생년월일|이메일|e-?mail|카드\s*번호|승인\s*번호|계좌|주소)/i;
  const BOOKING_DATE = /(예매일|예매\s*일시|결제일|결제\s*일시|주문일|취소\s*가능|취소\s*마감|입금|발권|배송|수령|티켓\s*오픈|예매\s*기간|판매\s*기간)/;
  const SHOW_DATE = /(관람일|관람\s*일시|공연일|공연\s*일시|일시|날짜|회차)/;

  const VENDORS = [
    { id: 'nol', re: /(NOL\s*티켓|놀\s*티켓|nol\s*ticket|인터파크|interpark|nol\.|놀유니버스)/i },
    { id: 'ticketlink', re: /(티켓\s*링크|ticket\s*link|ticketlink)/i },
    { id: 'melon', re: /(멜론\s*티켓|melon\s*ticket|멜론)/i },
    { id: 'yes24', re: /(yes\s*24|예스\s*24)/i },
  ];

  const VENUE_HINT = /(아레나|ARENA|돔|DOME|홀|HALL|스타디움|STADIUM|경기장|체육관|센터|CENTER|극장|THEATER|THEATRE|아트센터|라이브하우스|LIVE\s*HOUSE|KSPO|올림픽|블루스퀘어|롤링홀|무신사\s*개러지|벡스코|BEXCO|킨텍스|KINTEX|코엑스|COEX|인스파이어|INSPIRE)/i;
  const TITLE_HINT = /(콘서트|CONCERT|투어|TOUR|LIVE|라이브|페스티벌|FESTIVAL|FEST|팬\s*미팅|FANMEETING|FAN\s*MEETING|쇼케이스|SHOWCASE|단독\s*공연|in\s+seoul|IN\s+SEOUL|〈|<|《|「|『|\[)/i;

  function cleanLines(text) {
    return String(text || '')
      .replace(/\r/g, '')
      .replace(/[ 　]/g, ' ')
      .replace(/[：﹕]/g, ':')
      .split('\n')
      .map((l) => l.replace(/[ \t]+/g, ' ').trim())
      .filter(Boolean);
  }

  function valueAfterLabel(lines, i, labelRe) {
    const line = lines[i];
    const m = line.match(labelRe);
    if (!m) return '';
    let rest = line.slice(m.index + m[0].length).replace(/^\s*[:|\-–\]>\)]?\s*/, '').trim();
    if (!rest && lines[i + 1] && !SENSITIVE.test(lines[i + 1])) rest = lines[i + 1].trim();
    return rest;
  }

  function findDate(str, assumeYear) {
    let m = str.match(/(20\d{2})\s*[.\-/년]\s*(\d{1,2})\s*[.\-/월]\s*(\d{1,2})\s*일?/);
    if (m) return mk(m[1], m[2], m[3]);
    m = str.match(/(?:^|[^\d])(\d{2})\.(\d{1,2})\.(\d{1,2})(?:[^\d]|$)/);
    if (m) return mk('20' + m[1], m[2], m[3]);
    if (assumeYear) {
      m = str.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
      if (m) return mk(assumeYear, m[1], m[2]);
    }
    return '';
    function mk(y, mo, d) {
      mo = Number(mo); d = Number(d);
      if (mo < 1 || mo > 12 || d < 1 || d > 31) return '';
      return y + '-' + pad(mo) + '-' + pad(d);
    }
  }

  function findAmount(str) {
    const m = str.match(/([\d]{1,3}(?:,\d{3})+|\d{4,8})\s*원/);
    if (!m) return null;
    return Number(m[1].replace(/,/g, ''));
  }

  function splitArtists(s) {
    return String(s || '')
      .split(/\s*(?:,|，|\/|·|&|\+|\||그리고|외\s*\d*\s*명?)\s*/)
      .map((x) => x.trim())
      .filter((x) => x && x.length <= 40);
  }

  function stripBrackets(s) {
    return s.replace(/^[\[(【]\s*(단독|티켓\s*오픈|선예매|일반\s*예매)\s*[\])】]\s*/, '').trim();
  }

  /* 예매 안내 글 → 후보 */
  function parseBooking(text, opts) {
    opts = opts || {};
    const today = opts.today || '';
    const all = cleanLines(text);
    const lines = [];
    let sensitive = 0;
    for (const l of all) {
      if (SENSITIVE.test(l)) { sensitive++; continue; }
      lines.push(l);
    }
    const joined = lines.join('\n');
    const out = { title: '', artists: [], date: '', venue: '', vendor: '', cost: null, status: '' };
    const auto = [];
    const hints = [];

    // 예매처
    for (const v of VENDORS) if (v.re.test(joined)) { out.vendor = v.id; break; }

    // 공연명
    const TITLE_LABEL = /(공연\s*명|상품\s*명|공연\s*제목|티켓\s*명|상품\s*정보|공연\s*정보)\s*:?/;
    for (let i = 0; i < lines.length && !out.title; i++) {
      if (TITLE_LABEL.test(lines[i])) out.title = stripBrackets(valueAfterLabel(lines, i, TITLE_LABEL));
    }
    if (!out.title) {
      const cands = lines.filter((l) => TITLE_HINT.test(l) && !BOOKING_DATE.test(l) && !findAmount(l) && !VENUE_HINT.test(l) && l.length >= 4 && l.length <= 80);
      if (cands.length) out.title = stripBrackets(cands.sort((a, b) => b.length - a.length)[0]);
    }

    // 관람일
    const yearGuess = (opts.year || 2026).toString();
    for (let i = 0; i < lines.length && !out.date; i++) {
      if (SHOW_DATE.test(lines[i]) && !BOOKING_DATE.test(lines[i])) {
        out.date = findDate(lines[i], yearGuess) || (lines[i + 1] && !BOOKING_DATE.test(lines[i + 1]) ? findDate(lines[i + 1], yearGuess) : '');
      }
    }
    if (!out.date) {
      for (const l of lines) {
        if (BOOKING_DATE.test(l)) continue;
        const d = findDate(l);
        if (d) { out.date = d; hints.push('관람일 표시를 찾지 못해 글에 있는 날짜를 넣었어요. 예매일이 아닌지 확인해 주세요.'); break; }
      }
    }

    // 공연장
    const VENUE_LABEL = /(공연\s*장소|관람\s*장소|공연장|장소)\s*:?/;
    for (let i = 0; i < lines.length && !out.venue; i++) {
      if (VENUE_LABEL.test(lines[i]) && !/(수령|배송)/.test(lines[i])) out.venue = valueAfterLabel(lines, i, VENUE_LABEL);
    }
    if (!out.venue) {
      const v = lines.find((l) => VENUE_HINT.test(l) && l !== out.title && !TITLE_LABEL.test(l) && l.length <= 50);
      if (v) out.venue = v.replace(/^(장소|공연장)\s*:?\s*/, '');
    }

    // 출연
    const ART_LABEL = /(출연\s*진|출연|아티스트|가수|라인업)\s*:?/;
    for (let i = 0; i < lines.length && !out.artists.length; i++) {
      if (ART_LABEL.test(lines[i])) out.artists = splitArtists(valueAfterLabel(lines, i, ART_LABEL));
    }

    // 금액
    const PRICE_LABELS = [/총\s*결제\s*금액/, /결제\s*금액/, /총\s*금액/, /최종\s*결제/, /티켓\s*금액/, /합계/, /금액/];
    for (const re of PRICE_LABELS) {
      if (out.cost != null) break;
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        const amt = findAmount(lines[i]) ?? (lines[i + 1] ? findAmount(lines[i + 1]) : null);
        if (amt != null) { out.cost = amt; break; }
      }
    }
    if (out.cost == null) {
      const amts = lines.map(findAmount).filter((x) => x != null);
      if (amts.length === 1) out.cost = amts[0];
      else if (amts.length > 1) hints.push('금액이 여러 개 보여서 비워 두었어요. 내가 낸 금액을 직접 적어 주세요.');
    }

    // 매수
    let tickets = 0;
    const tm = joined.match(/(\d+)\s*매/) || joined.match(/매수\s*:?\s*(\d+)/);
    if (tm) tickets = Number(tm[1]);
    if (tickets > 1 && out.cost != null) {
      hints.push(tickets + '매 결제 금액일 수 있어요. 내가 부담한 금액으로 고쳐 주세요.');
    }

    // 상태
    if (/(취소\s*완료|환불\s*완료|예매\s*취소|취소된|취소\s*처리)/.test(joined)) out.status = 'canceled';
    else if (out.date && today) out.status = out.date > today ? 'planned' : 'done';

    for (const k of ['title', 'date', 'venue', 'vendor', 'status']) if (out[k]) auto.push(k);
    if (out.artists.length) auto.push('artists');
    if (out.cost != null) auto.push('cost');

    if (!out.title) hints.push('공연명을 찾지 못했어요.');
    if (!out.date) hints.push('관람일을 찾지 못했어요.');

    return { fields: out, auto, hints, tickets, sensitiveSkipped: sensitive };
  }

  /* ---- CSV ---- */
  function parseCSV(text) {
    text = String(text || '').replace(/^﻿/, '');
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === ',') { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c !== '\r') cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((x) => String(x).trim() !== ''));
  }

  const HEAD = {
    title: /^(공연\s*명|공연|title|name)$/i,
    artists: /^(아티스트|출연|출연진|artists?)$/i,
    date: /^(관람\s*일|날짜|공연\s*일|date)$/i,
    venue: /^(공연장|장소|venue)$/i,
    vendor: /^(예매처|vendor|구매처)$/i,
    cost: /^(본인\s*부담\s*금액|금액|지출|가격|cost|price)$/i,
    status: /^(상태|관람\s*상태|status)$/i,
    memo: /^(메모|memo|note)$/i,
    seat: /^(좌석|seat)$/i,
  };
  const STATUS = [
    ['done', /^(완료|관람\s*완료|봤음|done|seen)$/i],
    ['planned', /^(예정|관람\s*예정|planned|upcoming)$/i],
    ['canceled', /^(취소|환불|취소·환불|취소\/환불|canceled|cancelled|refunded)$/i],
  ];

  function vendorId(s) {
    s = String(s || '').trim();
    if (!s) return '';
    for (const v of VENDORS) if (v.re.test(s)) return v.id;
    return 'other';
  }

  function normalizeDateCell(s) {
    s = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return findDate(s) || '';
  }

  function rowsToRecords(rows, opts) {
    opts = opts || {};
    const today = opts.today || '';
    if (!rows.length) return { items: [], error: '빈 파일이에요.' };
    const head = rows[0].map((h) => String(h).trim());
    const idx = {};
    head.forEach((h, i) => { for (const k in HEAD) if (HEAD[k].test(h) && idx[k] == null) idx[k] = i; });
    if (idx.title == null || idx.date == null) {
      return { items: [], error: '첫 줄에 "공연명"과 "관람일" 제목 칸이 필요해요. 예시 CSV를 내려받아 형식을 맞춰 주세요.' };
    }
    const items = rows.slice(1).map((r, n) => {
      const get = (k) => (idx[k] == null ? '' : String(r[idx[k]] || '').trim());
      const errors = [];
      const date = normalizeDateCell(get('date'));
      if (!get('title')) errors.push('공연명 없음');
      if (!date) errors.push('관람일 형식 확인 (예: 2026-03-14)');
      const costRaw = get('cost').replace(/[^\d.]/g, '');
      const cost = costRaw === '' ? null : Number(costRaw);
      let status = '';
      const st = get('status');
      for (const [id, re] of STATUS) if (re.test(st)) status = id;
      if (!status) status = date && today && date > today ? 'planned' : 'done';
      return {
        line: n + 2,
        errors,
        record: {
          title: get('title'),
          artists: get('artists') ? get('artists').split(/\s*[;/|]\s*|\s*,\s*/).filter(Boolean) : [],
          date,
          venue: get('venue'),
          vendor: vendorId(get('vendor')),
          vendorOther: vendorId(get('vendor')) === 'other' ? get('vendor') : '',
          cost: isFinite(cost) ? cost : null,
          seat: get('seat'),
          status,
          memo: get('memo'),
        },
      };
    });
    return { items, error: '' };
  }

  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  return { parseBooking, parseCSV, rowsToRecords, vendorId, csvCell, findDate, SENSITIVE };
});
