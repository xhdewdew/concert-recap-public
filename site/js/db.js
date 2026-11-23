/* 저장소: 기록은 localStorage, 포스터 이미지는 IndexedDB.
   모두 이 기기 브라우저 안에만 있고 어떤 서버로도 보내지 않는다. */
(function () {
  'use strict';
  const KEY = 'concert-recap-2026:v1';
  const DBNAME = 'concert-recap-2026';
  const STORE = 'posters';

  function blank() {
    return {
      v: 1,
      nickname: '',
      records: [],
      theme: { preset: 'grass', accent: '#18853F', bg: '#EBE9E4' },
      dupIgnore: [],
      sample: false,
      lastBackup: 0,
      exportPrefs: { format: 'story', layout: 'checker' },
    };
  }

  let lsOK = true;
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return blank();
      const s = Object.assign(blank(), JSON.parse(raw));
      if (!Array.isArray(s.records)) s.records = [];
      return s;
    } catch (e) {
      if (e && e.name === 'SecurityError') lsOK = false;
      console.warn('기록을 읽지 못했어요', e);
      return blank();
    }
  }

  /* 'ok' | 'full'(용량 부족) | 'denied'(이 화면에서 저장 공간을 못 씀) */
  function save(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      lsOK = true;
      return 'ok';
    } catch (e) {
      if (e && (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014)) return 'full';
      lsOK = false;
      return 'denied';
    }
  }

  let dbp = null;
  let memory = null; // IndexedDB를 못 쓰는 브라우저용 임시 저장
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve) => {
      let done = false;
      const finish = (db) => { if (done) return; done = true; clearTimeout(timer); resolve(db); };
      const fallback = () => { if (done) return; memory = memory || new Map(); finish(null); };
      // 저장 공간을 막은 화면에서는 응답이 아예 없을 때가 있어 3초 뒤 임시 저장으로 넘어간다
      const timer = setTimeout(fallback, 3000);
      try {
        const idb = window.indexedDB;
        if (!idb) { fallback(); return; }
        const req = idb.open(DBNAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => { if (done) { try { req.result.close(); } catch (e) { /* 무시 */ } return; } finish(req.result); };
        req.onerror = fallback;
        req.onblocked = fallback;
      } catch (e) {
        fallback(); // 사생활 보호 모드나 앱 안 미리보기처럼 저장 공간을 막은 경우
      }
    });
    return dbp;
  }
  async function tx(mode, fn) {
    const db = await open();
    if (!db) return fn(null);
    return new Promise((resolve, reject) => {
      let t;
      try { t = db.transaction(STORE, mode); } catch (e) { reject(e); return; }
      const store = t.objectStore(STORE);
      const req = fn(store);
      t.oncomplete = () => resolve(req && req.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }
  const putPoster = (id, blob) => tx('readwrite', (s) => (s ? s.put(blob, id) : memory.set(id, blob)));
  const getPoster = async (id) => {
    const db = await open();
    if (!db) return memory.get(id) || null;
    return tx('readonly', (s) => s.get(id));
  };
  const delPoster = (id) => tx('readwrite', (s) => (s ? s.delete(id) : memory.delete(id)));
  const clearPosters = () => tx('readwrite', (s) => (s ? s.clear() : memory.clear()));
  const usesMemory = () => !!memory;
  const canPersist = () => lsOK && !memory;

  async function persist() {
    try {
      if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
    } catch (e) { /* 무시 */ }
    return false;
  }

  window.CR.db = { load, save, blank, open, putPoster, getPoster, delPoster, clearPosters, persist, usesMemory, canPersist, KEY };
})();
