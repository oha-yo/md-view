// md-view の回帰テスト。../md-view.html を iframe で開いて操作し、結果を expected.json と比べる。
// 動かし方：md-view のフォルダでローカルのサーバーを動かし、http://localhost:<port>/test/regress.html を開く。
// テストは OPFS（ブラウザの中の専用の場所）に sample/ を写して使い、終わったら消す。
'use strict';

const FILES = ['README.md', 'docs/guide.md', 'docs/features.md', 'docs/page.html', 'docs/css/page.css', 'docs/img/dot.png',
  'src/A.java', 'src/euc.txt', 'src/sjis.sql', 'src/data.unknown', 'src/LICENSE', 'src/v2.txt', 'src/v10.txt', 'node_modules/x/a.js'];
// 更新日時はテストのたびに変わるので、読み込んだあとで決まった値に差し替える
const MTIMES = {
  'README.md': '2026-10-31T23:59:59', 'docs/guide.md': '2026-11-01T00:00:00', 'docs/page.html': '2026-11-05T12:00:00',
  'docs/css/page.css': '2026-11-03T09:00:00', 'docs/img/dot.png': '2026-11-02T08:00:00', 'src/A.java': '2026-11-10T23:59:59',
  'src/euc.txt': '2026-11-11T00:00:00', 'src/sjis.sql': '2026-11-12T10:00:00', 'src/data.unknown': '2026-11-12T11:00:00',
  'src/LICENSE': '2026-11-12T12:00:00', 'node_modules/x/a.js': '2026-11-13T00:00:00', 'docs/features.md': '2026-11-20T09:00:00',
  'src/v2.txt': '2026-09-01T10:00:00', 'src/v10.txt': '2026-09-02T10:00:00',
};
const ROOT = 'mdv-regress';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(50); }
  throw new Error('待ちきれませんでした：' + fn);
}

let w, d, clip = '', alerts = [];
const S = () => w.mdView.state; // アプリが用意した入口（js/core.js。CSP の下では eval が使えないため）
const $ = (id) => d.getElementById(id);

async function makeFixture() {
  const opfs = await navigator.storage.getDirectory();
  try { await opfs.removeEntry(ROOT, { recursive: true }); } catch (e) { /* 無ければよい */ }
  const root = await opfs.getDirectoryHandle(ROOT, { create: true });
  for (const p of FILES) {
    const parts = p.split('/');
    let dir = root;
    for (const x of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(x, { create: true });
    const buf = await (await fetch('sample/' + p)).arrayBuffer();
    const wr = await (await dir.getFileHandle(parts.at(-1), { create: true })).createWritable();
    await wr.write(buf);
    await wr.close();
  }
  return root;
}

function clearStores() {
  for (const k of Object.keys(localStorage)) if (k.startsWith('md-view')) localStorage.removeItem(k);
  return new Promise((r) => { const q = indexedDB.deleteDatabase('md-view'); q.onsuccess = q.onerror = q.onblocked = () => r(); });
}

// 別画面は、ポップアップの代わりに、アプリの中に作った見えない iframe を渡す
// （アプリの中に作るので、本物のポップアップと同じく、アプリの CSP を引き継ぐ）
function stubWindow() {
  w.open = () => {
    const f = d.createElement('iframe');
    f.style.cssText = 'position:absolute;left:-10000px;top:0;width:900px;height:600px';
    d.body.appendChild(f);
    return f.contentWindow;
  };
  w.alert = (m) => alerts.push(m);
  Object.defineProperty(w.navigator, 'clipboard', { value: { writeText: async (t) => { clip = t; } }, configurable: true });
  w.showSaveFilePicker = async () => ({ name: 'saved.txt', createWritable: async () => ({ write: async (t) => { clip = t; }, close: async () => {} }) });
}

async function loadRoot(handle) {
  await w.load({ kind: 'handle', handle });
  // 日時を決まった値にして、tree を描き直す
  for (const [p, t] of Object.entries(MTIMES)) { const n = S().byPath.get(p); if (n) n.mtime = new Date(t).getTime(); }
  const clearDir = (n) => { if (n.kind === 'dir') { delete n.mtime; n.children.forEach(clearDir); } };
  clearDir(S().root);
  w.renderTree();
  await w.runFind();
}

const visibleFiles = () => [...d.querySelectorAll('#tree li.file')]
  .filter((li) => !li.closest('li[hidden]') && !li.hidden)
  .map((li) => li.querySelector('a,.bin').textContent + (li.querySelector('.bin') ? '(bin)' : '') + '×' + li.querySelectorAll('a.icon').length);

async function setFind({ mode = 'name', q = '', from = '', to = '', cs = false, re = false } = {}) {
  $('find-mode').value = mode;
  $('find-mode').dispatchEvent(new Event('change'));
  $('find-input').value = q;
  $('date-from').value = from;
  $('date-to').value = to;
  $('grep-case').checked = cs;
  $('grep-re').checked = re;
  await w.runFind();
  return { files: visibleFiles(), count: $('find-count').textContent };
}

async function click(id) { $(id).click(); await sleep(50); }

// 別画面の中身（日時は毎回変わるので消す）
function viewInfo(v) {
  const vd = v.win.document;
  const c = vd.getElementById('content');
  const fr = c.querySelector('iframe.htmlview');
  const info = {
    title: vd.title,
    path: vd.querySelector('.path').textContent,
    meta: vd.querySelector('.meta').textContent.replace(/\d{4}\/\d{1,2}\/\d{1,2} \d{1,2}:\d{2}:\d{2}/, '<日時>'),
    modeBtn: vd.querySelector('[data-act=mode]').hidden ? null : vd.querySelector('[data-act=mode]').textContent,
  };
  if (fr) {
    const fd = fr.contentDocument;
    Object.assign(info, {
      html: fd.body.innerText.trim(),
      cssBorder: fd.querySelector('.box') && fd.defaultView.getComputedStyle(fd.querySelector('.box')).borderTopColor,
      imgOk: [...fd.querySelectorAll('img')].map((i) => i.naturalWidth > 0),
      local: [...fd.querySelectorAll('a[data-local]')].map((a) => a.dataset.local),
      sandbox: fr.getAttribute('sandbox'),
    });
  } else if (c.querySelector('.md')) {
    Object.assign(info, {
      text: c.innerText.replace(/\s+/g, ' ').trim().slice(0, 200),
      mermaidSvg: c.querySelectorAll('.mermaid svg').length,
      mermaidErr: [...c.querySelectorAll('.mermaid-err')].map((e) => e.textContent.split('\n')[0]),
      imgOk: [...c.querySelectorAll('img')].map((i) => i.naturalWidth > 0),
      missing: [...c.querySelectorAll('.missing')].map((e) => e.textContent),
      local: [...c.querySelectorAll('a[data-local]')].map((a) => a.dataset.local),
      external: [...c.querySelectorAll('a[target=_blank]')].map((a) => a.getAttribute('href')),
      // ```html-raw：SVG（矢印の marker も）は出す。スクリプトとイベントの属性は取り除く
      htmlRaw: [...c.querySelectorAll('.html-raw')].map((x) => ({
        svg: x.querySelectorAll('svg').length,
        marker: !!x.querySelector('marker#raw-arr') && x.querySelector('line').getAttribute('marker-end'),
        script: x.querySelectorAll('script').length,
        onclick: x.querySelectorAll('[onclick]').length,
        text: x.textContent.replace(/\s+/g, ' ').trim(),
      })),
      // GitHub のアラート・コードの色付け・数式
      alerts: [...c.querySelectorAll('.alert')].map((x) => x.className + ':' + x.textContent.replace(/\s+/g, ' ').trim()),
      quotes: c.querySelectorAll('blockquote').length,
      code: [...c.querySelectorAll('pre > code')].map((x) => [x.className, x.querySelectorAll('[class^="hljs-"]').length > 0]),
      math: [...c.querySelectorAll('.math')].map((x) => [x.className, !!x.querySelector('math'), x.querySelector('annotation') ? x.querySelector('annotation').textContent : null]),
    });
  } else if (c.querySelector('.code')) {
    const tx = c.querySelector('.tx');
    const hl = c.querySelector('.hl');
    const lh = parseFloat(v.win.getComputedStyle(tx).lineHeight);
    const pad = parseFloat(v.win.getComputedStyle(tx).paddingTop);
    Object.assign(info, {
      lines: c.querySelector('.ln').textContent.split('\n').length,
      head: tx.textContent.split('\n').slice(0, 2),
      hlLine: hl ? Math.round((parseFloat(hl.style.top) - pad) / lh) + 1 : null,
      colored: [...new Set([...tx.querySelectorAll('[class^="hljs-"]')].map((s) => s.className))].sort(), // コードの色付け
    });
  } else {
    info.msg = c.textContent;
  }
  return info;
}

const lastView = () => [...S().views].at(-1);
async function viewSettled() { await sleep(300); await until(() => lastView() && lastView().win.document.getElementById('content').childElementCount > 0); await sleep(700); }

async function run() {
  const r = {};
  await clearStores();
  const root = await makeFixture();
  // 直した JS を必ず使うため、test/serve.py は「キャッシュしない」で返す（ほかのサーバーで動かすときは、ブラウザのキャッシュに注意）
  const app = document.getElementById('app');
  app.src = '../md-view.html';
  await new Promise((res) => { app.onload = res; });
  w = app.contentWindow;
  d = w.document;
  stubWindow();

  // ---- 設定の初期値
  r.settings = { excludes: $('excludes').value, placeholder: $('excludes').placeholder, date: $('chk-date').checked };
  // 大きいライブラリは、開いた時点では読み込まない
  r.libsAtStart = ['mermaid', 'katex', 'hljs'].map((n) => n + ':' + w.mdView.libLoaded(n));
  // フォルダを選ぶ前は「場所」と「探す」の欄を出さない
  r.hiddenAtStart = ['where', 'find', 'hits'].map((id) => id + ':' + w.getComputedStyle($(id)).display);

  // ---- 読み込み・tree
  await loadRoot(root);
  r.load = { status: $('status').textContent, files: visibleFiles(), reload: !$('btn-reload').disabled };
  r.treeFull = w.treeText(false, false);
  r.treeFullDate = w.treeText(false, true);
  await click('btn-copy'); r.copyDefault = clip;
  $('chk-date').click();
  r.dateColumn = { cls: $('tree').classList.contains('show-date'), first: d.querySelector('#tree .date').textContent, stored: localStorage.getItem('md-view-date') };
  await click('btn-copy'); r.copyDate = clip;
  await click('btn-save'); r.saveDate = clip;
  $('chk-date').click();
  // 一番上のフォルダを閉じてコピー
  d.querySelector('#tree summary').click(); await click('btn-copy'); r.copyRootClosed = clip; d.querySelector('#tree summary').click();

  // ---- 並べ方（名前は数を数として比べる。更新日時は新しい順、大きさは大きい順。フォルダはいつも先）
  const srcFiles = () => [...d.querySelectorAll('#tree li.file')].filter((li) => li.closest('li:not(.file)').querySelector('summary').textContent.includes('src/'))
    .map((li) => li.querySelector('a,.bin').textContent);
  const sortBy = (v) => { $('sort').value = v; $('sort').dispatchEvent(new Event('change')); };
  r.sortName = srcFiles();
  d.querySelectorAll('#tree details')[2].open = true; // 並べ直しても、フォルダの開き方は保つ
  sortBy('mtime');
  r.sortMtime = { src: srcFiles(), top: [...S().root.children].map((c) => c.name), kept: d.querySelectorAll('#tree details')[2].open === true, stored: localStorage.getItem('md-view-sort') };
  sortBy('size');
  r.sortSize = { src: srcFiles(), top: [...S().root.children].map((c) => c.name) };
  await click('btn-copy'); r.sortSizeCopy = clip;
  sortBy('name');
  r.sortBack = srcFiles();

  // ---- 外すフォルダ
  $('excludes').value = 'node_modules, .git';
  await loadRoot(root);
  r.exclude = { files: visibleFiles().length, has: S().byPath.has('node_modules/x/a.js'), stored: localStorage.getItem('md-view-excludes') };

  // ---- ファイル名で探す
  r.findWild = await setFind({ q: '*.md' });
  r.findPathAnd = await setFind({ q: 'docs/ html' });
  await click('btn-copy'); r.findCopy = clip;
  r.findNone = await setFind({ q: 'zzzz' });
  r.findClear = await setFind({});
  r.findClearOpen = [...d.querySelectorAll('#tree details')].map((x) => x.open);

  // ---- 更新日
  r.dateFrom = await setFind({ from: '2026-11-01' });
  r.dateTo = await setFind({ to: '2026-11-10' });
  r.dateBoth = await setFind({ from: '2026-11-01', to: '2026-11-10' });
  r.dateRev = await setFind({ from: '2026-11-10', to: '2026-11-01' });
  r.dateName = await setFind({ q: '*.md', from: '2026-11-01', to: '2026-11-10' });
  await click('btn-copy'); r.dateCopy = clip;

  // ---- 中身（grep）
  r.grepJa = await setFind({ mode: 'grep', q: '日本語' });
  r.grepCI = await setFind({ mode: 'grep', q: 'MERMAID' });
  r.grepCase = await setFind({ mode: 'grep', q: 'MERMAID', cs: true });
  r.grepRe = await setFind({ mode: 'grep', q: '^#+ ', re: true });
  r.grepRows = [...d.querySelectorAll('#hits-list > div')].map((x) => x.className + ':' + x.innerHTML);
  r.grepBad = await setFind({ mode: 'grep', q: '([', re: true });
  r.grepDate = await setFind({ mode: 'grep', q: 'flowchart', from: '2026-11-01' });
  await click('btn-copy-grep'); r.grepCopy = clip;
  r.grepHits = { hidden: $('hits').hidden, summary: $('hits-summary').textContent };
  r.placeholder = $('find-input').placeholder;

  // ---- 別画面：テキスト（grep の行から）
  await setFind({ mode: 'grep', q: 'int x' });
  d.querySelector('.hit-line').click(); await viewSettled();
  r.viewGrepLine = viewInfo(lastView());
  await setFind({});

  // ---- 別画面：Markdown
  w.openView(S().byPath.get('README.md'), 'preview'); await viewSettled();
  const vMd = lastView();
  r.viewMd = viewInfo(vMd);
  vMd.win.document.querySelector('a[data-local]').click(); await viewSettled();
  r.viewMdLink = viewInfo(vMd);
  vMd.win.document.querySelector('[data-act=mode]').click(); await viewSettled();
  r.viewMdText = viewInfo(vMd);
  // 同じファイル・同じモードは、新しく開かずに前の画面を使う
  const before = S().views.size;
  w.openView(S().byPath.get('docs/guide.md'), 'text'); await sleep(200);
  r.viewReuse = S().views.size === before;

  // ---- 別画面：GitHub のアラート・コードの色付け・数式
  w.openView(S().byPath.get('docs/features.md'), 'preview'); await viewSettled();
  r.viewFeatures = viewInfo(lastView());
  r.libsLoaded = ['mermaid', 'katex', 'hljs'].map((n) => n + ':' + w.mdView.libLoaded(n));

  // ---- 別画面：文字コード
  w.openView(S().byPath.get('src/euc.txt'), 'text'); await viewSettled(); r.viewEuc = viewInfo(lastView());
  w.openView(S().byPath.get('src/sjis.sql'), 'text'); await viewSettled(); r.viewSjis = viewInfo(lastView());

  // ---- 別画面：HTML
  w.openView(S().byPath.get('docs/page.html'), 'preview'); await viewSettled();
  const vHtml = lastView();
  vHtml.win.document.querySelector('iframe.htmlview').contentDocument.querySelector('button').click();
  r.viewHtml = viewInfo(vHtml);
  vHtml.win.document.querySelector('[data-act=mode]').click(); await viewSettled();
  r.viewHtmlText = viewInfo(vHtml);

  // ---- 自動更新
  w.openView(S().byPath.get('README.md'), 'preview'); await viewSettled();
  const vAuto = lastView();
  const wr = await (await root.getFileHandle('README.md')).createWritable();
  await wr.write('# 書き換えた\n\n```mermaid\npie\n "a":1\n "b":2\n```\n');
  await wr.close();
  await until(() => vAuto.win.document.querySelector('h1') && vAuto.win.document.querySelector('h1').textContent === '書き換えた', 6000);
  await sleep(500);
  r.autoUpdate = viewInfo(vAuto);

  // ---- フルパス
  await loadRoot(root);
  await until(() => !$('where').hidden);
  r.whereFirst = { form: !$('where-form').hidden, show: !$('where-show').hidden };
  $('path-input').value = 'D:\\work\\other'; await click('btn-path-save');
  r.whereWrong = alerts.slice(-1)[0];
  $('path-input').value = `"D:\\work\\${ROOT}\\"`; await click('btn-path-save');
  await until(() => !$('where-show').hidden);
  r.whereSaved = $('where-path').textContent;
  await click('btn-path-copy'); r.whereCopy = clip;
  await w.load({ kind: 'handle', handle: await root.getDirectoryHandle('docs') });
  await until(() => $('where-path').textContent.endsWith('docs'));
  r.whereSub = $('where-path').textContent;
  w.openView(S().byPath.get('guide.md'), 'text'); await viewSettled();
  r.whereView = lastView().win.document.querySelector('.path').textContent;

  // ---- 後片づけ
  for (const v of S().views) v.win.close();
  const opfs = await navigator.storage.getDirectory();
  await opfs.removeEntry(ROOT, { recursive: true });
  app.src = 'about:blank';
  await sleep(200);
  await clearStores();
  return r;
}

function diff(a, b, path = '') {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => diff(a[k], b[k], path + '.' + k));
  }
  return [`${path}\n  期待：${JSON.stringify(b)}\n  結果：${JSON.stringify(a)}`];
}

(async () => {
  const out = document.getElementById('result');
  const pre = document.getElementById('diff');
  let r;
  try { r = await run(); } catch (e) { out.className = 'ng'; out.textContent = 'テストが途中で止まりました：' + e.message; console.error(e); return; }
  window.__result = r;
  if (location.search.includes('update')) {
    // test/serve.py で動かしているときは、そのまま expected.json に書く
    const json = JSON.stringify(r, null, 2) + '\n';
    pre.textContent = json;
    const res = await fetch('expected.json', { method: 'PUT', body: json }).catch(() => null);
    out.textContent = res && res.ok ? 'expected.json に保存しました。' : '今の結果です。expected.json に保存してください（PUT できるサーバーではありませんでした）。';
    return;
  }
  const expected = await (await fetch('expected.json', { cache: 'no-store' })).json();
  const ds = diff(r, expected);
  const n = Object.keys(expected).length;
  out.className = ds.length ? 'ng' : 'ok';
  out.textContent = ds.length ? `違いがあります（${ds.length} か所）` : `OK：${n} 項目すべて同じです`;
  pre.textContent = ds.join('\n\n');
})();
