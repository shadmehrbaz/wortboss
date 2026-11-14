// store.js — IndexedDB wrapper. Stores: vocab (one record per entry), cards (SRS state per word), kv (profile, settings, report).
const DB_NAME = 'wortboss', DB_VERSION = 1;
let dbPromise = null;
const mem = { vocab: new Map(), cards: new Map(), kv: new Map() };      // fallback when IndexedDB is unavailable
let useMem = false;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { useMem = true; resolve(null); return; }
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); } catch (e) { useMem = true; resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('vocab')) db.createObjectStore('vocab', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('cards')) db.createObjectStore('cards', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { console.warn('IndexedDB unavailable, progress will not be saved', req.error); useMem = true; resolve(null); };
    req.onblocked = () => console.warn('IndexedDB upgrade blocked by another tab');
  });
  return dbPromise;
}
function tx(db, names, mode, work) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(names, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('transaction aborted'));
    result = work(t);
  });
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const store = {
  async getAll(name) {
    const db = await open();
    if (useMem) return [...mem[name].values()];
    return reqP(db.transaction(name).objectStore(name).getAll());
  },
  async put(name, value) {
    const db = await open();
    if (useMem) { mem[name].set(value.id, value); return; }
    return tx(db, name, 'readwrite', t => { t.objectStore(name).put(value); });
  },
  async putMany(name, values) {
    const db = await open();
    if (useMem) { values.forEach(v => mem[name].set(v.id, v)); return; }
    return tx(db, name, 'readwrite', t => { const os = t.objectStore(name); values.forEach(v => os.put(v)); });
  },
  /** replace the whole content of a store in one transaction */
  async replaceAll(name, values) {
    const db = await open();
    if (useMem) { mem[name].clear(); values.forEach(v => mem[name].set(v.id, v)); return; }
    return tx(db, name, 'readwrite', t => { const os = t.objectStore(name); os.clear(); values.forEach(v => os.put(v)); });
  },
  async clear(name) {
    const db = await open();
    if (useMem) { mem[name].clear(); return; }
    return tx(db, name, 'readwrite', t => { t.objectStore(name).clear(); });
  },
  async kvGet(key) {
    const db = await open();
    if (useMem) return mem.kv.get(key);
    return reqP(db.transaction('kv').objectStore('kv').get(key));
  },
  async kvSet(key, value) {
    const db = await open();
    if (useMem) { mem.kv.set(key, value); return; }
    return tx(db, 'kv', 'readwrite', t => { t.objectStore('kv').put(value, key); });
  },
  get persistent() { return !useMem; }
};
