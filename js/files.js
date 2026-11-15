// ファイルを読む：種類の判定・文字コード・フォルダの読み込み https://github.com/oha-yo/md-view
'use strict';

const MD_EXT = new Set(['md', 'markdown', 'mdown', 'mkd']);
const HTML_EXT = new Set(['html', 'htm', 'xhtml']);
const TEXT_EXT = new Set(('txt log csv tsv json jsonc yaml yml toml ini cfg conf properties env xml xsl xsd css scss less ' +
  'js mjs cjs ts tsx jsx vue svelte java jsp kt groovy gradle py rb php pl go rs c h cpp hpp cs vb bas cls frm ' +
  'sql sh bash zsh bat cmd ps1 psm1 tld svg gitignore gitattributes editorconfig dockerfile makefile r lua dart swift').split(' '));
const BINARY_EXT = new Set(('png jpg jpeg gif bmp ico webp tif tiff psd ai pdf zip gz tgz 7z rar tar bz2 xz lzh jar war ear class ' +
  'exe dll so o a lib obj bin dat db sqlite mdb accdb xls xlsx xlsm doc docx ppt pptx odt ods mp3 mp4 m4a wav avi mov mkv flv wmv ' +
  'woff woff2 ttf otf eot pyc iso dmg msi cab').split(' '));

const extOf = (name) => { const i = name.lastIndexOf('.'); return (i > 0 ? name.slice(i + 1) : name).toLowerCase(); };

// ファイルの種類：'md'・'html'（テキストとプレビュー）・'text'（テキスト）・'binary'（開かない）
const hasPreview = (node) => node.type === 'md' || node.type === 'html';

async function classify(name, file) {
  const ext = extOf(name);
  if (MD_EXT.has(ext)) return 'md';
  if (HTML_EXT.has(ext)) return 'html';
  if (TEXT_EXT.has(ext)) return 'text';
  if (BINARY_EXT.has(ext)) return 'binary';
  // 拡張子でわからないものは、先頭を見て NUL があればバイナリとする
  if (file.size === 0) return 'text';
  const head = new Uint8Array(await file.slice(0, 8000).arrayBuffer());
  if ((head[0] === 0xFF && head[1] === 0xFE) || (head[0] === 0xFE && head[1] === 0xFF)) return 'text'; // UTF-16
  return head.includes(0) ? 'binary' : 'text';
}

// 文字コードを判定して文字列にする（UTF-8・UTF-16・Shift_JIS・EUC-JP）
function decode(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0xEF && u8[1] === 0xBB && u8[2] === 0xBF) return { text: new TextDecoder('utf-8').decode(u8.subarray(3)), enc: 'UTF-8（BOM 付き）' };
  if (u8[0] === 0xFF && u8[1] === 0xFE) return { text: new TextDecoder('utf-16le').decode(u8.subarray(2)), enc: 'UTF-16LE' };
  if (u8[0] === 0xFE && u8[1] === 0xFF) return { text: new TextDecoder('utf-16be').decode(u8.subarray(2)), enc: 'UTF-16BE' };
  try { return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), enc: 'UTF-8' }; } catch (e) { /* 次を試す */ }
  // 日本語の古い文字コード：化けた文字（U+FFFD）が少ないほうにする
  const bad = (s) => (s.match(/�/g) || []).length;
  const sj = new TextDecoder('shift_jis').decode(u8);
  const eu = new TextDecoder('euc-jp').decode(u8);
  return bad(eu) < bad(sj) ? { text: eu, enc: 'EUC-JP' } : { text: sj, enc: 'Shift_JIS' };
}

// 入口（handle）があれば毎回読み直す（自動更新のため）。<input> で読んだものは、そのときの File
const getFile = (node) => (node.handle ? node.handle.getFile() : Promise.resolve(node.file));

// grep 用に中身を読む。大きすぎるものは null。変わっていなければ前に読んだものを使う
async function readTextCached(node) {
  const f = await getFile(node);
  if (f.size > GREP_MAX_SIZE) return null;
  const c = state.textCache.get(node.path);
  if (c && c.mtime === f.lastModified && c.size === f.size) return c.text;
  const { text } = decode(await f.arrayBuffer());
  state.textCache.set(node.path, { mtime: f.lastModified, size: f.size, text });
  return text;
}

// ---------------------------------------------------------------- フォルダを読む
// ノード：{ kind: 'dir', name, path, children } / { kind: 'file', name, path, handle, file, size, mtime, type }
// 画面を作ると、ノードに el（フォルダの <details>）と li（行）が付く
// 名前の比べ方はエクスプローラーにそろえる（大文字・小文字を区別しない。名前の中の数字は数として比べる：file2 → file10）
const nameCompare = new Intl.Collator('ja', { numeric: true, sensitivity: 'base' }).compare;

// 並べ方：'name'（名前）・'mtime'（更新日時の新しい順）・'size'（大きさの大きい順）。どれもフォルダが先
// フォルダの更新日時は、中のいちばん新しいファイルの日時。フォルダには大きさがないので、大きさの順のときは名前の順
function compareNodes(a, b, mode = 'name') {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  let d = 0;
  if (mode === 'mtime') d = dirMtime(b) - dirMtime(a);
  else if (mode === 'size' && a.kind === 'file') d = b.size - a.size;
  return d || nameCompare(a.name, b.name);
}

function sortChildren(node, mode) {
  node.children.sort((a, b) => compareNodes(a, b, mode));
}

function sortTree(node, mode) {
  eachDir(node, (d) => sortChildren(d, mode));
}

async function makeFileNode(byPath, name, path, file, handle) {
  const node = { kind: 'file', name, path, handle, file: handle ? null : file, size: file.size, mtime: file.lastModified, type: await classify(name, file) };
  byPath.set(path, node);
  return node;
}

// File System Access API の入口から読む（あとで読み直せる）
async function scanHandle(dirHandle, excludes, byPath, path = '') {
  const node = { kind: 'dir', name: dirHandle.name, path, children: [] };
  for await (const [name, h] of dirHandle.entries()) {
    const p = joinPath(path, name);
    if (h.kind === 'directory') {
      if (!excludes.has(name)) node.children.push(await scanHandle(h, excludes, byPath, p));
    } else {
      node.children.push(await makeFileNode(byPath, name, p, await h.getFile(), h));
    }
  }
  sortChildren(node);
  return node;
}

// <input webkitdirectory> のファイルの一覧から読む（読み直しはできない）
async function scanFileList(files, excludes, byPath) {
  const root = { kind: 'dir', name: files[0].webkitRelativePath.split('/')[0], path: '', children: [] };
  const dirs = new Map([['', root]]);
  const dirOf = (path) => {
    if (dirs.has(path)) return dirs.get(path);
    const parent = dirOf(parentDir(path));
    const d = { kind: 'dir', name: lastName(path), path, children: [] };
    parent.children.push(d);
    dirs.set(path, d);
    return d;
  };
  for (const f of files) {
    const parts = f.webkitRelativePath.split('/').slice(1); // 先頭は選んだフォルダの名前
    if (parts.slice(0, -1).some((p) => excludes.has(p))) continue;
    const path = parts.join('/');
    dirOf(parentDir(path)).children.push(await makeFileNode(byPath, f.name, path, f, null));
  }
  for (const d of dirs.values()) sortChildren(d);
  return root;
}

// ---------------------------------------------------------------- tree をたどる
function eachDir(node, fn) {
  fn(node);
  for (const c of node.children) if (c.kind === 'dir') eachDir(c, fn);
}

function counts(node) {
  let dirs = 0, files = 0;
  eachDir(node, (d) => { if (d !== node) dirs++; files += d.children.filter((c) => c.kind === 'file').length; });
  return { dirs, files };
}

// フォルダの更新日時：ブラウザはフォルダそのものの日時を教えないので、中のファイルのいちばん新しい日時にする
function dirMtime(n) {
  if (n.kind === 'file') return n.mtime || 0;
  if (n.mtime === undefined) n.mtime = n.children.reduce((m, c) => Math.max(m, dirMtime(c)), 0);
  return n.mtime;
}
