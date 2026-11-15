// 探す：ファイル名・中身（grep）・更新日。決まりは src-tree にそろえる https://github.com/oha-yo/md-view
'use strict';

const FIND_PH = {
  name: 'ファイル名で探す（例：README、*.md、design spec、docs/）',
  grep: '中身で探す（例：mermaid、TODO、受注番号）',
};
const findQuery = () => $('find-input').value.trim();
const isGrep = () => $('find-mode').value === 'grep';

// ファイル名：空白で区切ると「かつ」。* と ? が使える（* があるときはファイル名全体で比べる）。
// / を含むとパス全体で探す。大文字・小文字は区別しない
function termRegex(t) {
  const body = escRegex(t).replace(/\\\*/g, '.*').replace(/\\\?/g, '.');
  return new RegExp(/[*?]/.test(t) && !t.includes('/') ? '^' + body + '$' : body, 'i');
}
function nameMatcher(q) {
  const res = q.split(/\s+/).filter(Boolean).map((t) => [t.includes('/'), termRegex(t)]);
  return (n) => res.every(([byPath, re]) => re.test(byPath ? n.path : n.name));
}

// 中身：空白もそのまま探す。正規表現の書き方が違うときは null
function grepRegex() {
  try { return new RegExp($('grep-re').checked ? findQuery() : escRegex(findQuery()), 'g' + ($('grep-case').checked ? '' : 'i')); }
  catch (e) { return null; }
}

// 更新日：from だけならその日以降、to だけならその日以前（どちらも空なら null）
function dateFilter() {
  const f = $('date-from').value, t = $('date-to').value;
  if (!f && !t) return null;
  const day = (s, add) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d + add).getTime(); };
  return { from: f ? day(f, 0) : -Infinity, to: t ? day(t, 1) - 1 : Infinity };
}
const passDate = (df, n) => !df || (n.mtime >= df.from && n.mtime <= df.to);

// 今の絞り込みの説明（コピーに添える）
function filterDesc() {
  const parts = [];
  const q = findQuery();
  if (q) parts.push(`${isGrep() ? '中身' : 'ファイル名'}を「${q}」で検索`);
  const f = $('date-from').value.replaceAll('-', '/'), t = $('date-to').value.replaceAll('-', '/');
  if (f || t) parts.push('更新日 ' + (f && t ? `${f}〜${t}` : f ? `${f} 以降` : `${t} 以前`));
  return parts.join('、');
}

// ---------------------------------------------------------------- 探す
let findTimer = 0;
function scheduleFind() {
  clearTimeout(findTimer);
  findTimer = setTimeout(runFind, isGrep() ? 300 : 120);
}

async function runFind() {
  const seq = ++state.findSeq;
  const q = findQuery();
  const df = dateFilter();
  $('find-clear').hidden = !q;
  $('date-clear').hidden = !df;
  if (!state.root) return;
  const files = [...state.byPath.values()].filter((n) => passDate(df, n));
  let matched = null, grep = null;
  if (q && isGrep()) {
    grep = await grepFiles(files, seq);
    if (!grep) return; // 探している途中で条件が変わった
    matched = grep.matched;
  } else if (q) {
    matched = new Set(files.filter(nameMatcher(q)));
  } else if (df) {
    matched = new Set(files);
  }
  if (seq !== state.findSeq) return;
  state.find.matched = matched;
  state.find.grep = grep;
  applyFind();
  renderHits();
}

// 結果：{ matched, hits: パス → [{ n: 行番号, text }], count: 件数, skipped, failed, error }
async function grepFiles(files, seq) {
  const re = grepRegex();
  const g = { matched: new Set(), hits: new Map(), count: 0, skipped: 0, failed: 0, error: !re };
  if (!re) return g;
  $('find-count').textContent = '探しています…';
  const test = new RegExp(re.source, re.flags.replace('g', ''));
  for (const n of files) {
    if (n.type === 'binary') continue;
    let text;
    try { text = await readTextCached(n); } catch (e) { text = undefined; }
    if (seq !== state.findSeq) return null;
    if (text === undefined) { g.failed++; continue; } // 消えたファイルなど
    if (text === null) { g.skipped++; continue; }     // 大きすぎる
    const found = [];
    text.split('\n').forEach((line, i) => { if (test.test(line)) found.push({ n: i + 1, text: line.replace(/\r$/, '') }); });
    if (found.length) { g.hits.set(n.path, found); g.count += found.length; g.matched.add(n); }
  }
  return g;
}

// tree を絞り込む。探している間は、フォルダをすべて開いて見せる（やめたら元の開き方に戻す）
function applyFind() {
  const m = state.find.matched;
  const dirs = [];
  eachDir(state.root, (d) => dirs.push(d));
  if (m && !state.find.saved) state.find.saved = dirs.map((d) => [d, d.el.open]);
  if (m) dirs.forEach((d) => { d.el.open = true; });
  if (!m && state.find.saved) { state.find.saved.forEach(([d, open]) => { d.el.open = open; }); state.find.saved = null; }
  const walk = (n) => {
    let any = false;
    for (const c of n.children) {
      const vis = c.kind === 'dir' ? walk(c) : !m || m.has(c);
      c.li.hidden = !vis;
      any = any || vis;
    }
    return any;
  };
  walk(state.root);
  $('find-count').textContent = findSummary();
}

function findSummary() {
  const m = state.find.matched;
  const g = state.find.grep;
  const df = dateFilter();
  if (!m) return '';
  if (g && g.error) return '正規表現の書き方が違います';
  if (df && df.from > df.to) return 'from が to より後の日になっています';
  if (!g) return `${m.size} 個`;
  return `ファイル ${g.hits.size} 個、${g.count.toLocaleString()} 件` +
    (g.skipped ? `（大きくて探さなかったファイル ${g.skipped} 個）` : '') +
    (g.failed ? `（読めなかったファイル ${g.failed} 個。消えたなら「読み直す」を押してください）` : '');
}

// ---------------------------------------------------------------- grep の結果
// 一致した部分に <mark> を付ける（長さ 0 の一致は飛ばす）
function markText(text, re) {
  let out = '', last = 0;
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    out += esc(text.slice(last, m.index)) + '<mark>' + esc(m[0]) + '</mark>';
    last = m.index + m[0].length;
  }
  return out + esc(text.slice(last));
}

// tree の下の、一致した行の一覧。行を押すと、その行に色を付けてテキストで開く
function renderHits() {
  const g = state.find.grep;
  const list = $('hits-list');
  if (!g || g.error || !g.count) { $('hits').hidden = true; list.textContent = ''; return; }
  $('hits').hidden = false;
  $('hits-summary').textContent = `ファイル ${g.hits.size} 個、${g.count.toLocaleString()} 件` +
    (g.count > GREP_SHOW ? `（ここには最初の ${GREP_SHOW.toLocaleString()} 件だけ出します。コピーには全部入ります）` : '');
  const re = grepRegex();
  const html = [];
  let shown = 0;
  for (const [path, found] of g.hits) {
    if (shown >= GREP_SHOW) break;
    html.push(`<div class="hit-file">${esc(path)}<span class="n">${found.length} 件</span></div>`);
    for (const h of found) {
      if (shown++ >= GREP_SHOW) break;
      const t = h.text.trim();
      html.push(`<div class="hit-line" data-path="${esc(path)}" data-line="${h.n}"><span class="ln">${h.n}</span><span>${markText(t.length > 300 ? t.slice(0, 300) + '…' : t, re)}</span></div>`);
    }
  }
  list.innerHTML = html.join('');
}

// grep 結果の文字（チャットに貼る用）
function grepText() {
  const g = state.find.grep;
  const opts = [$('grep-case').checked && '大文字・小文字を区別', $('grep-re').checked && '正規表現'].filter(Boolean);
  const lines = [`【md-view】${state.fullPath || state.root.name} の${filterDesc()}（ファイル ${g.hits.size} 個、${g.count.toLocaleString()} 件）` + (opts.length ? `（${opts.join('、')}）` : '')];
  for (const [path, found] of g.hits) {
    lines.push('', path);
    for (const h of found) lines.push(`  ${h.n}: ${h.text.trim()}`);
  }
  return lines.join('\n') + '\n';
}

// 新しく読み込んだときは、探した結果を捨てて、条件があれば探し直す
function resetFind() {
  $('find').hidden = false;
  state.find = { matched: null, grep: null, saved: null };
  if (findQuery() || dateFilter()) return runFind();
  renderHits();
  $('find-count').textContent = '';
}

function initFind() {
  const input = $('find-input');
  const clearQuery = () => { input.value = ''; runFind(); };
  input.placeholder = FIND_PH.name;
  input.addEventListener('input', scheduleFind);
  input.addEventListener('keydown', (e) => { if (e.key === 'Escape') clearQuery(); });
  $('find-clear').addEventListener('click', () => { clearQuery(); input.focus(); });
  $('find-mode').addEventListener('change', () => {
    input.placeholder = FIND_PH[$('find-mode').value];
    $('grep-opts').hidden = !isGrep();
    scheduleFind();
  });
  $('grep-case').addEventListener('change', scheduleFind);
  $('grep-re').addEventListener('change', scheduleFind);
  $('date-from').addEventListener('change', runFind);
  $('date-to').addEventListener('change', runFind);
  $('date-clear').addEventListener('click', () => { $('date-from').value = ''; $('date-to').value = ''; runFind(); });
  $('hits-list').addEventListener('click', (e) => {
    const row = e.target.closest('.hit-line');
    const node = row && state.byPath.get(row.dataset.path);
    if (node) openView(node, 'text', Number(row.dataset.line));
  });
  $('btn-copy-grep').addEventListener('click', () => {
    if (state.find.grep && state.find.grep.count) copyText(grepText(), 'grep の結果をコピーしました。');
  });
}
