// tree：画面の表示と、文字にした tree（保存・コピー） https://github.com/oha-yo/md-view
'use strict';

const sortMode = () => $('sort').value;

// 並べ方を変えたとき：フォルダの開き方と、探して絞り込んだ状態はそのままにして、並べ直す
function resortTree() {
  store.set('md-view-sort', sortMode());
  if (!state.root) return;
  const opens = [];
  eachDir(state.root, (d) => opens.push([d, d.el.open]));
  renderTree();
  opens.forEach(([d, open]) => { d.el.open = open; });
  if (state.find.matched) applyFind();
}

function renderTree() {
  const root = state.root;
  sortTree(root, sortMode());
  const { dirs, files } = counts(root);
  setStatus(`「${root.name}」 フォルダ ${dirs} 個・ファイル ${files} 個` +
    (state.rootHandle ? '' : '（このブラウザでは「読み直す」と自動更新は使えません）'));
  const ul = document.createElement('ul');
  ul.appendChild(dirItem(root, 0));
  $('tree').replaceChildren(ul);
  $('btn-reload').disabled = !state.rootHandle;
  $('btn-save').disabled = false;
  $('btn-copy').disabled = false;
}

// 2 段目までは開いておく
function dirItem(node, depth) {
  const li = document.createElement('li');
  const det = document.createElement('details');
  det.open = depth < 2;
  node.el = det; // 「今見えている状態」のコピーで、開いているかを見る
  node.li = li;  // 探すときに隠す
  const sum = document.createElement('summary');
  const cnt = document.createElement('span');
  cnt.className = 'count';
  cnt.textContent = `(${node.children.length})`;
  sum.append(dateSpan(node), (node.name || '/') + '/', cnt);
  const ul = document.createElement('ul');
  for (const c of node.children) ul.appendChild(c.kind === 'dir' ? dirItem(c, depth + 1) : fileItem(c));
  det.append(sum, ul);
  li.appendChild(det);
  return li;
}

// テキストはファイル名で開く。md・html はファイル名と目でプレビュー、紙でテキスト。バイナリはリンクなし
function fileItem(node) {
  const li = document.createElement('li');
  li.className = 'file';
  node.li = li;
  li.appendChild(dateSpan(node));
  if (node.type === 'binary') {
    const s = document.createElement('span');
    s.className = 'bin';
    s.textContent = node.name;
    li.appendChild(s);
  } else if (hasPreview(node)) {
    li.append(
      link(node.name, () => openView(node, 'preview')),
      iconLink(ICON_PREVIEW, 'プレビュー', () => openView(node, 'preview')),
      iconLink(ICON_TEXT, 'テキスト', () => openView(node, 'text')),
    );
  } else {
    li.appendChild(link(node.name, () => openView(node, 'text')));
  }
  const size = document.createElement('span');
  size.className = 'size';
  size.textContent = fmtSize(node.size);
  li.appendChild(size);
  return li;
}

function link(text, onClick) {
  const a = document.createElement('a');
  a.textContent = text;
  a.addEventListener('click', onClick);
  return a;
}

function iconLink(svg, label, onClick) {
  const a = link('', onClick);
  a.className = 'icon';
  a.innerHTML = svg; // 固定の SVG だけ
  a.title = label + 'で開く';
  a.setAttribute('aria-label', label + 'で開く');
  return a;
}

// 更新日時の列（「更新日時を付ける」に印があるときだけ見える）
function dateSpan(node) {
  const s = document.createElement('span');
  s.className = 'date';
  s.textContent = fmtDate(dirMtime(node));
  return s;
}

// ---------------------------------------------------------------- 文字にした tree
// visibleOnly：今見えている状態にする（閉じているフォルダは中身を省いて 1 行。絞り込んでいるときは見つかったものだけ）
// withDate：行の先頭に更新日時を付ける
function treeText(visibleOnly, withDate) {
  const root = state.root;
  const dateOf = (n) => (withDate ? fmtDate(dirMtime(n)) + ' ' : '');
  const isClosed = (n) => visibleOnly && n.el && !n.el.open;
  const shown = (n) => !visibleOnly || !n.li || !n.li.hidden;
  const folded = (n) => {
    const { dirs, files } = counts(n);
    return '  …（省略：' + [dirs && `フォルダ ${dirs}`, files && `ファイル ${files}`].filter(Boolean).join('・') + '）';
  };
  const lines = [dateOf(root) + root.name + '/' + (isClosed(root) ? folded(root) : '')];
  const walk = (n, prefix) => n.children.filter(shown).forEach((c, i, arr) => {
    const last = i === arr.length - 1;
    const closed = c.kind === 'dir' && isClosed(c) && c.children.length > 0;
    lines.push(dateOf(c) + prefix + (last ? '└── ' : '├── ') + c.name + (c.kind === 'dir' ? '/' : '') + (closed ? folded(c) : ''));
    if (c.kind === 'dir' && !closed) walk(c, prefix + (last ? '    ' : '│   '));
  });
  if (!isClosed(root)) walk(root, '');
  const { dirs, files } = counts(root);
  lines.push('', `${dirs} directories, ${files} files`);
  if (visibleOnly && state.find.matched) lines.push(`（絞り込み：${filterDesc()}。見つかった ${state.find.matched.size} 個だけを出しています）`);
  return lines.join('\n') + '\n';
}

// 保存は、いつもすべて開いた状態。.md を選んだら、コードの囲みに入れる
async function saveTree() {
  const text = treeText(false, $('chk-date').checked);
  const name = `${state.root.name}-tree`;
  if (!window.showSaveFilePicker) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = name + '.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return;
  }
  let h;
  try {
    h = await showSaveFilePicker({
      suggestedName: name + '.txt',
      types: [
        { description: 'テキスト', accept: { 'text/plain': ['.txt'] } },
        { description: 'Markdown', accept: { 'text/markdown': ['.md'] } },
      ],
    });
  } catch (e) { return; } // キャンセル
  const body = h.name.toLowerCase().endsWith('.md') ? `# ${state.root.name}\n\n\`\`\`text\n${text}\`\`\`\n` : text;
  const w = await h.createWritable();
  await w.write(body);
  await w.close();
  setStatus(`tree を「${h.name}」に保存しました。`);
}

function copyTree() {
  return copyText(treeText(true, $('chk-date').checked), 'tree を今見えている状態でコピーしました（閉じているフォルダは中身を省いています）。');
}

function initTree() {
  const chk = $('chk-date');
  const apply = () => $('tree').classList.toggle('show-date', chk.checked);
  chk.checked = store.get('md-view-date') === '1';
  apply();
  chk.addEventListener('change', () => { apply(); store.set('md-view-date', chk.checked ? '1' : '0'); });
  const saved = store.get('md-view-sort');
  if (saved && [...$('sort').options].some((o) => o.value === saved)) $('sort').value = saved;
  $('sort').addEventListener('change', resortTree);
  $('btn-save').addEventListener('click', saveTree);
  $('btn-copy').addEventListener('click', copyTree);
}
