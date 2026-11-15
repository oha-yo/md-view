// 別画面：テキスト（行番号付き）・プレビュー・自動更新 https://github.com/oha-yo/md-view
// 別画面は about:blank のポップアップに、この画面から中身を書き込む（同じオリジンなので、この画面の関数で操作できる）。
'use strict';

// 別画面の見た目（ポップアップには外のファイルを読ませないので、ここに書く）
const VIEW_CSS = `
:root { --blue:#5B7DB1; --blue-pale:#E8EEF8; --line:#d8dee8; }
* { box-sizing: border-box; }
body { margin:0; font-family:"Segoe UI","Yu Gothic UI",Meiryo,sans-serif; color:#222; background:#fff; }
.vbar { position:sticky; top:0; display:flex; flex-wrap:wrap; gap:8px; align-items:center; padding:6px 12px; background:var(--blue-pale); border-bottom:2px solid var(--blue); font-size:13px; z-index:1; }
.vbar .path { font-weight:bold; color:var(--blue); word-break:break-all; }
.vbar .meta { color:#777; }
.vbar .sp { flex:1; }
.vbar button { font:inherit; padding:3px 10px; border:1px solid var(--blue); border-radius:4px; background:#fff; color:var(--blue); cursor:pointer; }
.vbar button:hover { background:#fff8; }
.msg { padding:16px; color:#a33; }
.code { position:relative; display:flex; font-family:Consolas,"BIZ UDGothic",monospace; font-size:13px; line-height:1.55; }
.code pre { margin:0; padding:8px 10px; }
.code .ln { color:#aaa; text-align:right; background:#f6f8fa; border-right:1px solid var(--line); user-select:none; }
.code .tx { flex:1; white-space:pre; overflow-x:auto; tab-size:4; }
.code .hl { position:absolute; left:0; right:0; background:rgba(255,214,0,.28); pointer-events:none; }
.md { max-width:980px; margin:0 auto; padding:16px 32px 48px; line-height:1.75; font-size:15px; }
.md h1, .md h2 { border-bottom:1px solid var(--line); padding-bottom:.3em; }
.md h1, .md h2, .md h3 { color:#1f3a63; }
.md a { color:var(--blue); }
.md code { font-family:Consolas,"BIZ UDGothic",monospace; background:#f3f5f8; padding:.1em .35em; border-radius:3px; font-size:.9em; }
.md pre { background:#f6f8fa; border:1px solid var(--line); border-radius:6px; padding:12px; overflow:auto; line-height:1.5; }
.md pre code { background:none; padding:0; font-size:13px; }
.md blockquote { margin:0; padding:0 1em; color:#555; border-left:4px solid var(--blue); background:#fafbfd; }
.md table { border-collapse:collapse; margin:1em 0; display:block; overflow:auto; }
.md th, .md td { border:1px solid #c9d1dc; padding:6px 12px; }
.md th { background:var(--blue-pale); }
.md img { max-width:100%; }
.md hr { border:none; border-top:1px solid var(--line); }
.md .mermaid { text-align:center; margin:1em 0; overflow:auto; }
.md .mermaid-err { color:#a33; border:1px solid #e3b0b0; background:#fff6f6; padding:8px; border-radius:6px; white-space:pre-wrap; font-family:Consolas,monospace; font-size:12px; }
.md .missing { color:#a33; font-size:12px; }
.md .html-raw { margin:1em 0; overflow-x:auto; }
.md pre code.hljs { padding:0; background:none; overflow:visible; }
.md .math-display { display:block; margin:1em 0; padding:4px 0; overflow-x:auto; overflow-y:hidden; text-align:center; }
.md .math-display math { font-size:1.15em; }
.md .math-err { color:#a33; font-family:Consolas,monospace; }
.md .alert { margin:1em 0; padding:8px 16px; border-left:4px solid var(--ac); background:#fafbfd; }
.md .alert > :last-child { margin-bottom:0; }
.md .alert-title { margin:0 0 4px; font-weight:bold; color:var(--ac); }
.md .alert-note { --ac:#0969da; }
.md .alert-tip { --ac:#1a7f37; }
.md .alert-important { --ac:#8250df; }
.md .alert-warning { --ac:#9a6700; }
.md .alert-caution { --ac:#d1242f; }
iframe.htmlview { display:block; width:100%; border:0; background:#fff; }
`;

const VIEW_BODY = '<div class="vbar"><span class="path"></span><span class="meta"></span><span class="sp"></span>' +
  '<button data-act="mode" hidden></button><button data-act="reload">読み直す</button></div><div id="content"></div>';

// 別画面 v：{ node, mode（'text'・'preview'）, win, lastModified, blobUrls, hlLine（色を付ける行）, gotoLine（そこまで動かす行） }
// tree のクリックから同期のまま呼ぶ（ポップアップを止められないように、最初に window.open する）。
// 同じファイル・同じモードの画面があれば、それを前に出す。
function openView(node, mode, line) {
  for (const v of state.views) {
    if (v.win.closed) { state.views.delete(v); continue; }
    if (v.node.path === node.path && v.mode === mode) {
      v.win.focus();
      if (line) { v.hlLine = line; v.gotoLine = line; renderView(v); }
      return;
    }
  }
  const win = window.open('', '_blank', 'popup,width=960,height=860');
  if (!win) { alert('別の画面を開けませんでした。ブラウザでポップアップを許可してください。'); return; }
  const v = { node, mode, win, lastModified: 0, blobUrls: [], hlLine: line || null, gotoLine: line || null };
  const doc = win.document;
  doc.open();
  doc.write(`<!doctype html><html lang="ja"><head><meta charset="utf-8"><title></title><style>${HLJS_CSS}${VIEW_CSS}</style></head><body>${VIEW_BODY}</body></html>`);
  doc.close();
  doc.querySelector('[data-act=reload]').addEventListener('click', () => renderView(v));
  doc.querySelector('[data-act=mode]').addEventListener('click', () => showInView(v, v.node, v.mode === 'preview' ? 'text' : 'preview'));
  doc.addEventListener('click', (e) => onLocalLink(v, e));
  win.addEventListener('resize', () => fitFrame(v));
  state.views.add(v);
  renderView(v);
}

// 同じ別画面の中で、別のファイルやモードに切り替える
function showInView(v, node, mode) {
  v.node = node;
  v.mode = mode;
  v.hlLine = null;
  renderView(v, true);
}

// .md・.html の中の、tree にあるファイルへのリンク
function onLocalLink(v, e) {
  const a = e.target.closest && e.target.closest('a[data-local]');
  if (!a) return;
  e.preventDefault();
  const target = state.byPath.get(a.dataset.local);
  if (target && target.type !== 'binary') showInView(v, target, hasPreview(target) ? 'preview' : 'text');
}

// HTML のプレビューの枠を、画面の残りの高さいっぱいにする
function fitFrame(v) {
  const doc = v.win.document;
  const fr = doc.querySelector('iframe.htmlview');
  if (fr) fr.style.height = (v.win.innerHeight - doc.querySelector('.vbar').offsetHeight) + 'px';
}

// 上の帯に出すパス（フルパスがわかっていればフルパス）
function viewPath(node) {
  if (!state.fullPath) return (state.root ? state.root.name + '/' : '') + node.path;
  const sep = sepOf(state.fullPath);
  return state.fullPath + sep + node.path.split('/').join(sep);
}

// toTop：いちばん上から見せる（ファイルやモードを変えたとき）。そうでなければスクロールの位置を保つ
async function renderView(v, toTop) {
  const doc = v.win.document;
  const content = doc.getElementById('content');
  const node = v.node;
  if (!hasPreview(node)) v.mode = 'text';
  const isHtmlPreview = v.mode === 'preview' && node.type === 'html';
  doc.title = node.name + (v.mode === 'preview' ? '（プレビュー）' : '');
  doc.querySelector('.path').textContent = viewPath(node);
  const modeBtn = doc.querySelector('[data-act=mode]');
  modeBtn.hidden = !hasPreview(node);
  modeBtn.textContent = v.mode === 'preview' ? 'テキストで見る' : 'プレビューで見る';

  let file;
  try { file = await getFile(node); } catch (e) {
    content.innerHTML = `<p class="msg">ファイルを読めませんでした（消えたか、名前が変わった可能性があります）：${esc(e.message)}</p>`;
    return;
  }
  v.lastModified = file.lastModified;
  if (file.size > MAX_VIEW_SIZE) {
    content.innerHTML = `<p class="msg">${fmtSize(file.size)} あるので開きません（上限 ${fmtSize(MAX_VIEW_SIZE)}）。</p>`;
    return;
  }
  const { text, enc } = decode(await file.arrayBuffer());
  doc.querySelector('.meta').textContent =
    `${enc}・${fmtSize(file.size)}・${new Date(file.lastModified).toLocaleString('ja-JP')} 更新` +
    (node.handle ? '' : '・自動更新なし') +
    (isHtmlPreview ? '・スクリプトは動かしません' : '');

  const oldFrame = content.querySelector('iframe.htmlview');
  const scrollY = toTop ? 0 : (oldFrame ? oldFrame.contentWindow.scrollY : v.win.scrollY);
  const oldBlobs = v.blobUrls;
  v.blobUrls = [];
  if (isHtmlPreview) {
    await renderHtml(text, v, content, scrollY); // スクロールは枠の中で戻す
  } else if (v.mode === 'preview') {
    content.replaceChildren(await renderMarkdown(text, v, doc));
    v.win.scrollTo(0, scrollY);
  } else {
    let html = null;
    try { html = await highlightCode(text, fileLang(node)); } catch (e) { /* 読み込めなければ色なし */ }
    renderCode(v, content, text, scrollY, html);
  }
  oldBlobs.forEach((u) => URL.revokeObjectURL(u)); // 描き終えてから、前の画像などを捨てる
}

// テキスト：行番号の列と本文の列。html は色を付けた本文（なければ文字のまま）。hlLine があれば、その行に色を付ける
function renderCode(v, content, text, scrollY, html) {
  const n = text.split('\n').length - (text.endsWith('\n') ? 1 : 0) || 1;
  content.innerHTML = '<div class="code"><pre class="ln">' +
    Array.from({ length: n }, (_, i) => i + 1).join('\n') + '</pre><pre class="tx">' + (html ?? esc(text)) + '</pre></div>';
  if (!v.hlLine) { v.win.scrollTo(0, scrollY); return; }
  const tx = content.querySelector('.tx');
  const style = v.win.getComputedStyle(tx);
  const lh = parseFloat(style.lineHeight);
  const hl = v.win.document.createElement('div');
  hl.className = 'hl';
  hl.style.top = (parseFloat(style.paddingTop) + (v.hlLine - 1) * lh) + 'px';
  hl.style.height = lh + 'px';
  content.querySelector('.code').appendChild(hl);
  if (v.gotoLine) {
    // grep の結果から開いたときは、その行を画面の上から 1/3 あたりに出す
    v.gotoLine = null;
    v.win.scrollTo(0, Math.max(0, hl.getBoundingClientRect().top + v.win.scrollY - v.win.innerHeight / 3));
  } else {
    v.win.scrollTo(0, scrollY);
  }
}

// ---------------------------------------------------------------- 自動更新
async function poll() {
  if ($('chk-auto').checked) {
    for (const v of state.views) {
      if (v.win.closed) { state.views.delete(v); continue; }
      if (!v.node.handle) continue;
      try {
        const f = await v.node.handle.getFile();
        if (f.lastModified !== v.lastModified) await renderView(v);
      } catch (e) { /* 消えたファイルは「読み直す」で知らせる */ }
    }
  }
  setTimeout(poll, POLL_MS);
}

function initViewer() {
  window.addEventListener('beforeunload', () => state.views.forEach((v) => { if (!v.win.closed) v.win.close(); }));
  poll();
}
