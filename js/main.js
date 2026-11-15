// 入口：フォルダを選ぶ・読み込む・画面の準備（このファイルを最後に読む） https://github.com/oha-yo/md-view
'use strict';

// 外すフォルダ（設定）。0.6.0 までは例の値が初期値として保存されていたので、それと同じなら空に戻す
function loadExcludes() {
  const v = store.get('md-view-excludes');
  $('excludes').value = !v || v === EXAMPLE_EXCLUDES ? '' : v;
  $('excludes').placeholder = '例：' + EXAMPLE_EXCLUDES;
}
function excludeSet() {
  const v = $('excludes').value;
  store.set('md-view-excludes', v);
  return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}

// source：{ kind: 'handle', handle }（読み直せる）か { kind: 'files', files }（<input> で選んだもの）
async function load(source) {
  setStatus('読み込んでいます…');
  $('tree').textContent = '';
  const byPath = new Map();
  const excludes = excludeSet();
  let root;
  try {
    root = source.kind === 'handle'
      ? await scanHandle(source.handle, excludes, byPath)
      : await scanFileList(source.files, excludes, byPath);
  } catch (e) {
    setStatus('読み込めませんでした：' + e.message);
    return;
  }
  Object.assign(state, { root, byPath, rootHandle: source.kind === 'handle' ? source.handle : null, textCache: new Map() });
  // 開いている別画面のノードを、新しく読んだものに差し替える
  for (const v of state.views) v.node = byPath.get(v.node.path) || v.node;
  renderTree();
  showWhere();
  await resetFind();
}

async function pick() {
  if (!window.showDirectoryPicker) { $('input-dir').click(); return; }
  let h;
  try { h = await showDirectoryPicker({ mode: 'read' }); } catch (e) { return; } // キャンセル
  await load({ kind: 'handle', handle: h });
}

function initLoad() {
  $('btn-pick').addEventListener('click', pick);
  $('input-dir').addEventListener('change', (e) => { if (e.target.files.length) load({ kind: 'files', files: [...e.target.files] }); });
  $('btn-reload').addEventListener('click', () => state.rootHandle && load({ kind: 'handle', handle: state.rootHandle }));

  const drop = $('drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', async (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
    if (!item || !item.getAsFileSystemHandle) { setStatus('このブラウザではドラッグで読めません。「フォルダを選ぶ」を使ってください。'); return; }
    const h = await item.getAsFileSystemHandle(); // drop の処理の中で、すぐに呼ぶ必要がある
    if (!h || h.kind !== 'directory') { setStatus('フォルダを落としてください。'); return; }
    await load({ kind: 'handle', handle: h });
  });
}

$('version').textContent = 'v' + VERSION;
loadExcludes();
initLoad();
initTree();
initFind();
initFullPath();
initViewer();
