/* 통계 계산 (화면과 이미지가 같은 결과를 쓰도록 한 곳에서만 계산) */
(function (factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m;
  else { window.CR = window.CR || {}; window.CR.stats = m; }
})(function () {
  'use strict';

  const STRIP = /[\s\[\]\(\)〈〉<>《》「」『』【】'"“”‘’.,:;!?~\-–—_·•/\\|#&+*]/g;
  const norm = (s) => String(s || '').normalize('NFC').toLowerCase().replace(STRIP, '');
  const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  const isNum = (n) => typeof n === 'number' && isFinite(n);
  // 회차: 낮공(mat) → 밤공(eve) 순서
  const RO = { mat: 1, eve: 2 };
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (RO[a.round] || 0) - (RO[b.round] || 0) || (a.createdAt || 0) - (b.createdAt || 0);
  // 같은 날 기록들이 서로 다른 회차(낮공·밤공)로 나뉘어 있으면 중복이 아니다
  const diffRounds = (arr) => arr.every((r) => r.round) && new Set(arr.map((r) => r.round)).size === arr.length;

  const REASON = {
    nodate: '관람일 없음',
    year: '해당 연도 아님',
    canceled: '취소·환불',
    planned: '관람 예정',
  };

  function tally(list, keysOf) {
    const map = new Map();
    for (const r of list) {
      const seen = new Set();
      for (const raw of keysOf(r)) {
        const name = String(raw || '').trim().replace(/\s+/g, ' ');
        const key = norm(name);
        if (!key || seen.has(key)) continue; // 한 기록 안에서 같은 이름이 두 번 적혀도 1번
        seen.add(key);
        if (!map.has(key)) map.set(key, { key, name, count: 0, records: [] });
        const e = map.get(key);
        e.count += 1;
        e.records.push(r);
      }
    }
    const arr = [...map.values()].sort((a, b) =>
      b.count - a.count || byDate(a.records[0], b.records[0]));
    const max = arr.length ? arr[0].count : 0;
    return { list: arr, top: arr.filter((e) => e.count === max && max > 0), max };
  }

  function duplicates(records, ignore) {
    const ign = new Set(ignore || []);
    const groups = [];
    const add = (kind, label, arr) => {
      if (arr.length < 2 || diffRounds(arr)) return;
      const ids = arr.map((r) => r.id).sort();
      const key = ids.join('|');
      if (ign.has(key)) return;
      if (groups.some((g) => g.key === key)) return;
      groups.push({ kind, label, key, records: arr.slice().sort(byDate) });
    };
    const byTitle = new Map();
    const byVenue = new Map();
    for (const r of records) {
      if (!isDate(r.date)) continue;
      const t = r.date + '|' + (r.kopisId ? 'k:' + r.kopisId : norm(r.title));
      if (!byTitle.has(t)) byTitle.set(t, []);
      byTitle.get(t).push(r);
      if (norm(r.venue)) {
        const v = r.date + '|' + norm(r.venue);
        if (!byVenue.has(v)) byVenue.set(v, []);
        byVenue.get(v).push(r);
      }
    }
    for (const arr of byTitle.values()) add('same', '같은 날짜, 같은 공연명', arr);
    for (const arr of byVenue.values()) add('venue', '같은 날짜, 같은 공연장', arr);
    return groups;
  }

  const showKey = (r) => (r.kopisId ? 'k:' + r.kopisId : 't:' + norm(r.title));

  function compute(records, opts) {
    opts = opts || {};
    // opts.year === 'all' 이면 연도 제한 없이 전체 기간을 센다 (그래프는 달 대신 연도별)
    const all = opts.year === 'all';
    const year = all ? 'all' : String(opts.year || 2026);
    const today = opts.today || '';
    records = Array.isArray(records) ? records : [];

    const included = [];
    const excluded = [];
    for (const r of records) {
      let reason = null;
      if (!isDate(r.date)) reason = 'nodate';
      else if (!all && r.date.slice(0, 4) !== year) reason = 'year';
      else if (r.status === 'canceled') reason = 'canceled';
      else if (r.status === 'planned') reason = 'planned';
      if (reason) excluded.push({ record: r, reason, label: REASON[reason] });
      else included.push(r);
    }
    included.sort(byDate);

    const withCost = included.filter((r) => isNum(r.cost) && r.cost >= 0);
    const missingCost = included.filter((r) => !(isNum(r.cost) && r.cost >= 0));
    const spend = withCost.reduce((s, r) => s + r.cost, 0);

    // 막대 칸: 한 해 모드는 1~12월, 전체 기간은 첫 해~마지막 해
    let bins, binOf;
    if (all) {
      const ys = included.map((r) => Number(r.date.slice(0, 4)));
      const nowY = Number((today || '').slice(0, 4)) || new Date().getFullYear();
      const from = ys.length ? Math.min(...ys) : nowY, to = ys.length ? Math.max(...ys) : nowY;
      bins = []; for (let y = from; y <= to; y++) bins.push(y);
      binOf = (r) => Number(r.date.slice(0, 4)) - from;
    } else {
      bins = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
      binOf = (r) => Number(r.date.slice(5, 7)) - 1;
    }
    const months = new Array(bins.length).fill(0);
    for (const r of included) months[binOf(r)] += 1;
    const monthMax = Math.max(0, ...months);
    const peakMonths = monthMax > 0 ? months.map((c, i) => (c === monthMax ? i + 1 : 0)).filter(Boolean) : [];

    const artists = tally(included, (r) => (Array.isArray(r.artists) ? r.artists : []));
    const venues = tally(included, (r) => [r.venue]);

    const inYear = records.filter((r) => isDate(r.date) && (all || r.date.slice(0, 4) === year));
    const planned = inYear.filter((r) => r.status === 'planned').sort(byDate);
    const overdue = today ? planned.filter((r) => r.date < today) : [];
    const canceled = inYear.filter((r) => r.status === 'canceled').sort(byDate);

    // 같은 공연(KOPIS ID 또는 공연명)끼리 묶어 며칠 봤는지 센다
    const showMap = new Map();
    for (const r of included) {
      const k = showKey(r);
      if (!showMap.has(k)) showMap.set(k, { key: k, title: r.title, records: [] });
      showMap.get(k).records.push(r);
    }
    const shows = [...showMap.values()].map((g) => Object.assign(g, { days: new Set(g.records.map((r) => r.date)).size, times: g.records.length, period: g.records.find((r) => r.period) ? g.records.find((r) => r.period).period : null }));
    // 여러 번 본 공연: 여러 날이든, 하루 낮·밤이든 두 번 이상
    const multiDay = shows.filter((g) => g.times > 1).map((g) => Object.assign(g, { records: g.records.slice().sort(byDate) }))
      .sort((a, b) => b.times - a.times || b.days - a.days || byDate(a.records[0], b.records[0]));

    const excludedCount = {};
    for (const e of excluded) excludedCount[e.reason] = (excludedCount[e.reason] || 0) + 1;

    return {
      year: all ? 'all' : Number(year),
      all,
      bins,
      binOf,
      from: all ? bins[0] : Number(year),
      to: all ? bins[bins.length - 1] : Number(year),
      included,
      excluded,
      excludedCount,
      count: included.length,
      spend,
      spendRecords: withCost,
      missingCost,
      months,
      monthMax,
      peakMonths,
      artists,
      venues,
      venueCount: venues.list.length,
      artistCount: artists.list.length,
      planned,
      overdue,
      canceled,
      duplicates: duplicates(records, opts.dupIgnore),
      shows,
      showCount: shows.length,
      multiDay,
      first: included[0] || null,
      last: included[included.length - 1] || null,
    };
  }

  return { compute, norm, REASON, showKey };
});
