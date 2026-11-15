// フルパスを覚える https://github.com/oha-yo/md-view
// ブラウザはフォルダのフルパスを教えないので、利用者に一度だけ貼り付けてもらい、
// フォルダの入口（handle）と組にして IndexedDB に覚えておく。
// 覚えたフォルダの下のフォルダを選んだときは、handle.resolve() で途中の名前を求めてつなぐ。
'use strict';

// ---------------------------------------------------------------- IndexedDB（'md-view' の 'paths'）
let dbPromise = null;
function idb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('md-view', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('paths', { autoIncrement: true });
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; }; // ほかから消されるときは閉じる
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
    });
  }
  return dbPromise;
}

// 覚えているものすべて：[{ key, handle, name, path, saved }]
async function idbAll() {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction('paths').objectStore('paths').openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out.push({ key: c.key, ...c.value }); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}

async function idbWrite(fn) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('paths', 'readwrite');
    fn(tx.objectStore('paths'));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// 覚えているもの e から見て、今のフォルダがどこにあるか（同じなら []、下にあれば途中の名前、関係なければ null）
// 読み直しのできないブラウザ（handle なし）では、フォルダの名前で比べる
async function relFrom(e) {
  const root = state.rootHandle;
  if (root && e.handle) {
    try { return await e.handle.resolve(root); } catch (err) { return null; }
  }
  return !root && !e.handle && e.name === state.root.name ? [] : null;
}

// 選んだフォルダのフルパスを、覚えているものから探す（いちばん近い親を使う）
async function findFullPath() {
  let list;
  try { list = await idbAll(); } catch (e) { return null; }
  let best = null;
  for (const e of list) {
    const rel = await relFrom(e);
    if (rel && (!best || rel.length < best.rel.length)) best = { rel, path: e.path };
  }
  if (!best) return null;
  return [best.path.replace(/[\\/]+$/, ''), ...best.rel].join(sepOf(best.path));
}

// 同じフォルダの古いものは消して覚え直す。多すぎたら古いものから消す
async function rememberPath(path) {
  const list = await idbAll();
  const same = [];
  for (const e of list) {
    const rel = await relFrom(e);
    if (rel && rel.length === 0) same.push(e.key);
  }
  const extra = Math.max(0, list.length - same.length + 1 - MAX_PATHS);
  const old = list.filter((e) => !same.includes(e.key)).slice(0, extra).map((e) => e.key);
  await idbWrite((st) => {
    [...same, ...old].forEach((k) => st.delete(k));
    st.add({ handle: state.rootHandle || null, name: state.root.name, path, saved: Date.now() });
  });
}

// ---------------------------------------------------------------- 画面
function showPathForm(value) {
  $('path-input').value = value;
  $('where-show').hidden = true;
  $('where-form').hidden = false;
}

async function showWhere() {
  $('where').hidden = false;
  state.fullPath = await findFullPath();
  if (!state.fullPath) { showPathForm(''); return; }
  $('where-path').textContent = state.fullPath;
  $('where-show').hidden = false;
  $('where-form').hidden = true;
}

async function savePath() {
  const path = cleanPath($('path-input').value);
  if (!path) return;
  if (lastName(path).toLowerCase() !== state.root.name.toLowerCase()) {
    alert(`貼り付けたパスの最後のフォルダ名が「${lastName(path)}」で、選んだフォルダ「${state.root.name}」と違います。\n選んだフォルダそのもののパスを貼り付けてください。`);
    return;
  }
  try { await rememberPath(path); } catch (e) { alert('覚えられませんでした：' + e.message); return; }
  await showWhere();
}

function initFullPath() {
  $('btn-path-copy').innerHTML = ICON_COPY; // 固定の SVG だけ
  $('btn-path-copy').addEventListener('click', () => state.fullPath && copyText(state.fullPath, `「${state.fullPath}」をコピーしました。`));
  $('btn-path-edit').addEventListener('click', () => { showPathForm(state.fullPath || ''); $('path-input').focus(); });
  $('btn-path-save').addEventListener('click', savePath);
  $('path-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') savePath(); });
}
