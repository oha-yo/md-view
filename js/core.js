// md-view の土台：決まった値・アプリの状態・小さな道具 https://github.com/oha-yo/md-view
// ファイルはブラウザの中で読むだけで、どこにも送らない。
// どのファイルも、ふつうの <script> で読む（file:// で開いても動くように、ES モジュールにしない）。
'use strict';

const VERSION = '0.14.0';
const EXAMPLE_EXCLUDES = '.git, node_modules, .svn, .idea, .vs, __pycache__'; // 入力欄に薄く見せる例（初期値は空）
const MAX_VIEW_SIZE = 20 * 1024 * 1024;  // これより大きいファイルは開かない
const GREP_MAX_SIZE = 5 * 1024 * 1024;   // これより大きいファイルは中身を探さない
const GREP_SHOW = 1000;                  // grep の結果を画面に出す行の上限（コピーには全部入る）
const POLL_MS = 1500;                    // 自動更新で見に行く間隔
const MAX_PATHS = 100;                   // 覚えておくフルパスの数

// アプリの状態（ここ 1 か所にまとめる）
const state = {
  root: null,          // tree の根のノード
  rootHandle: null,    // フォルダの入口（showDirectoryPicker・ドラッグのとき。<input> のときは null）
  byPath: new Map(),   // パス → ファイルのノード
  fullPath: null,      // 選んだフォルダのフルパス（覚えていれば）
  views: new Set(),    // 開いている別画面
  find: { matched: null, grep: null, saved: null }, // 探した結果（matched：見つかったファイルのノード）
  findSeq: 0,          // 探す処理の番号（古い結果を捨てるため）
  textCache: new Map(), // grep 用：パス → { mtime, size, text }
};

// 回帰テスト（test/regress.js）から状態を見るための入口。トップレベルの const は window から見えず、
// CSP（script-src 'self'）の下では eval も使えないため
window.mdView = { version: VERSION, state, libLoaded: (name) => !!LIBS[name].get() };

// ---------------------------------------------------------------- 使うときだけ読み込むライブラリ
// 大きいライブラリは、ページを開いたときには読まず、初めて使うときに <script> を足して読む
// （Mermaid は約 3.5 MB。Web に置いたとき、使わない人にまでダウンロードさせないため）
const LIBS = {
  mermaid: { src: 'lib/mermaid.min.js', get: () => window.mermaid },
  katex: { src: 'lib/katex.min.js', get: () => window.katex },
  hljs: { src: 'lib/highlight.min.js', get: () => window.hljs },
};
const libLoading = {};
function loadLib(name) {
  const lib = LIBS[name];
  if (lib.get()) return Promise.resolve(lib.get());
  if (!libLoading[name]) {
    libLoading[name] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = lib.src + '?v=' + VERSION; // 版ごとに URL を変える（サーバーが js を長くキャッシュさせるため）
      s.onload = () => resolve(lib.get());
      s.onerror = () => { delete libLoading[name]; s.remove(); reject(new Error(`${lib.src} を読み込めませんでした`)); };
      document.head.appendChild(s);
    });
  }
  return libLoading[name];
}

// ---------------------------------------------------------------- 画面・文字
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function setStatus(msg) { $('status').textContent = msg; }

async function copyText(text, msg) {
  await navigator.clipboard.writeText(text);
  setStatus(msg);
}

// localStorage は使えないことがある（プライベートウィンドウなど）ので、失敗しても止まらないようにする
const store = {
  get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* 使えなくても動く */ } },
};

const fmtSize = (n) => (n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB');
const pad2 = (x) => String(x).padStart(2, '0');
function fmtDate(t) {
  if (!t) return ' '.repeat(16); // 中にファイルのないフォルダ
  const d = new Date(t);
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// ---------------------------------------------------------------- アイコン（固定の SVG）
const svgIcon = (body) => `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICON_PREVIEW = svgIcon('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>');            // 目
const ICON_TEXT = svgIcon('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M8 13h8M8 17h6"/>'); // 紙
const ICON_COPY = svgIcon('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>');
const ICON_CHECK = svgIcon('<path d="M20 6 9 17l-5-5"/>'); // コピーできた印

// ---------------------------------------------------------------- パス
// tree の中のパスは、選んだフォルダから見た「/」区切り（例：docs/img/a.png）
const joinPath = (dir, name) => (dir ? dir + '/' + name : name);
const parentDir = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

// .md・.html の場所から見た相対パスを、tree のパスにする
function resolvePath(baseDir, href) {
  const clean = decodeURIComponent(href.split('#')[0].split('?')[0]);
  const parts = clean.startsWith('/') ? [] : baseDir.split('/').filter(Boolean);
  for (const p of clean.split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop(); else parts.push(p);
  }
  return parts.join('/');
}
const isExternal = (href) => /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(href);

// Windows のフルパス（D:\work）とそれ以外（/home/…）の両方を扱う
const sepOf = (p) => (p.includes('\\') || /^[A-Za-z]:/.test(p) ? '\\' : '/');
const lastName = (p) => p.split(/[\\/]/).filter(Boolean).pop() || '';
// 貼り付けた文字を整える（前後の引用符・空白・末尾の \ を取る）
function cleanPath(s) {
  let p = s.trim().replace(/^["']|["']$/g, '').trim();
  if (p.length > 3) p = p.replace(/[\\/]+$/, '');
  return p;
}
