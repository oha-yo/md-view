// プレビュー：Markdown（Mermaid の図・数式・コードの色付け・GitHub のアラートも）と HTML https://github.com/oha-yo/md-view
'use strict';

// ---------------------------------------------------------------- Markdown の書き方の追加
// 数式は GitHub と同じ書き方：```math・$$ … $$（ブロック）・$ … $（文の中）。
// $ は、開きの直後と閉じの直前に空白がなく、閉じの直後が数字でないときだけ数式にする（「$5 と $10」を数式にしないため）
const mathBlock = {
  name: 'mathBlock',
  level: 'block',
  start: (src) => src.match(/(^|\n)\$\$/)?.index,
  tokenizer(src) {
    const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src);
    if (m) return { type: 'mathBlock', raw: m[0], text: m[1].trim() };
  },
  renderer: (t) => `<div class="math-src" data-display="1">${esc(t.text)}</div>\n`,
};
const mathInline = {
  name: 'mathInline',
  level: 'inline',
  start: (src) => { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
  tokenizer(src) {
    let m = /^\$\$([^$]+?)\$\$/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1].trim(), display: true };
    m = /^\$(?![\s$])((?:\\.|[^\\$\n])+?)(?<![\s\\])\$(?![\d$])/.exec(src);
    if (m) return { type: 'mathInline', raw: m[0], text: m[1], display: false };
  },
  renderer: (t) => `<span class="math-src" data-display="${t.display ? 1 : 0}">${esc(t.text)}</span>`,
};

if (window.marked) {
  marked.use({
    gfm: true,
    extensions: [mathBlock, mathInline],
    renderer: {
      code(token) {
        const lang = (token.lang || '').trim().toLowerCase();
        if (lang === 'mermaid') return `<div class="mermaid-src">${esc(token.text)}</div>`;
        if (lang === 'math') return `<div class="math-src" data-display="1">${esc(token.text)}</div>\n`;
        // ```html-raw：中身をそのまま HTML として出す（ブログの下書きで、図の SVG などを書く囲み。oha-yo-post と同じ決まり）。
        // 危ないもの（スクリプトなど）は、このあと DOMPurify で取り除く
        if (lang === 'html-raw') return `<div class="html-raw">${token.text}</div>\n`;
        return false; // ふつうのコードは標準の出し方（<pre><code class="language-sql"> など。色はあとで付ける）
      },
    },
  });
}

// ---------------------------------------------------------------- コードの色付け（highlight.js）
// 拡張子から言語へ。highlight.js が知っている名前（java・sql・ps1 など）はそのまま使う
const EXT_LANG = { jsp: 'xml', tld: 'xml', xsl: 'xml', xsd: 'xml', svg: 'xml', htm: 'xml', html: 'xml', xhtml: 'xml', mdown: 'markdown', mkd: 'markdown', cmd: 'dos' };
const NO_LANG = new Set(['txt', 'log', 'csv', 'tsv']);
const HIGHLIGHT_MAX = 1024 * 1024; // これより大きいテキストは色を付けない（重くなるため）

// テキストで見るときの言語の名前（色を付けないファイルは null）
function fileLang(node) {
  const ext = extOf(node.name);
  return NO_LANG.has(ext) ? null : EXT_LANG[ext] || ext;
}

// 色を付けた HTML を返す。highlight.js が知らない言語なら null
async function highlightCode(text, lang) {
  if (!lang || text.length > HIGHLIGHT_MAX) return null;
  const hljs = await loadLib('hljs');
  if (!hljs.getLanguage(lang)) return null;
  return hljs.highlight(text, { language: lang, ignoreIllegals: true }).value;
}

// ---------------------------------------------------------------- GitHub のアラート（> [!NOTE] など）
const ALERTS = { NOTE: '補足', TIP: 'ヒント', IMPORTANT: '重要', WARNING: '注意', CAUTION: '警告' };

function renderAlerts(box) {
  for (const bq of box.querySelectorAll('blockquote')) {
    const p = bq.firstElementChild;
    const first = p && p.tagName === 'P' ? p.firstChild : null;
    const m = first && first.nodeType === 3 && /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*\n?/i.exec(first.nodeValue);
    if (!m) continue;
    const kind = m[1].toUpperCase();
    first.nodeValue = first.nodeValue.slice(m[0].length);
    if (p.firstChild && p.firstChild.nodeName === 'BR') p.firstChild.remove();
    if (!p.textContent.trim() && !p.querySelector('img,svg')) p.remove();
    const div = box.ownerDocument.createElement('div');
    div.className = 'alert alert-' + kind.toLowerCase();
    const title = box.ownerDocument.createElement('p');
    title.className = 'alert-title';
    title.textContent = ALERTS[kind];
    div.append(title, ...bq.childNodes);
    bq.replaceWith(div);
  }
}

// ---------------------------------------------------------------- 数式（KaTeX）・Mermaid
// 数式は MathML で出す（ブラウザが自分で描くので、別画面にフォントや CSS を読み込まなくてよい）
async function renderMath(box) {
  const els = box.querySelectorAll('.math-src');
  if (!els.length) return;
  let katex;
  try { katex = await loadLib('katex'); } catch (e) { els.forEach((el) => { el.className = 'math-err'; }); return; }
  for (const el of els) {
    const display = el.dataset.display === '1';
    el.className = display ? 'math math-display' : 'math';
    el.innerHTML = katex.renderToString(el.textContent, { output: 'mathml', displayMode: display, throwOnError: false });
  }
}

let mermaidSeq = 0;
let mermaidReady = false;
async function renderMermaid(box) {
  const els = box.querySelectorAll('.mermaid-src');
  if (!els.length) return;
  let mermaid;
  try { mermaid = await loadLib('mermaid'); } catch (e) {
    els.forEach((el) => { el.className = 'mermaid-err'; el.textContent = 'Mermaid を読み込めませんでした：' + e.message; });
    return;
  }
  if (!mermaidReady) { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' }); mermaidReady = true; }
  for (const el of els) {
    const code = el.textContent;
    const id = 'mmd' + (++mermaidSeq);
    try {
      const { svg } = await mermaid.render(id, code);
      el.className = 'mermaid';
      el.innerHTML = svg;
    } catch (e) {
      el.className = 'mermaid-err';
      el.textContent = 'Mermaid の図を描けませんでした：' + (e.message || e) + '\n\n' + code;
    } finally {
      document.getElementById('d' + id)?.remove(); // 描くときの作業用の要素が残ることがある
    }
  }
}

// ```sql などのコードに色を付ける。言語の指定がないもの・知らない言語はそのまま
async function renderCodeBlocks(box) {
  for (const code of box.querySelectorAll('pre > code[class*="language-"]')) {
    const lang = [...code.classList].find((c) => c.startsWith('language-')).slice(9).toLowerCase();
    let html = null;
    try { html = await highlightCode(code.textContent, lang); } catch (e) { return; } // 読み込めなければ色なし
    if (html === null) continue;
    code.innerHTML = html; // highlight.js が文字を esc した HTML
    code.classList.add('hljs');
  }
}

// リンク：外は新しいタブ、フォルダの中のファイルは data-local を付けて、別画面の中で開き直す（viewer.js）
function markLinks(root, baseDir) {
  for (const a of root.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (href.startsWith('#')) continue;
    if (isExternal(href)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; continue; }
    const p = resolvePath(baseDir, href);
    if (state.byPath.has(p)) a.dataset.local = p;
  }
}

// フォルダの中のファイルを blob: の URL にする（別画面を閉じたり描き直したりしたら捨てる）
async function localUrl(v, baseDir, href, type) {
  if (!href || isExternal(href)) return null;
  const target = state.byPath.get(resolvePath(baseDir, href));
  if (!target) return null;
  const f = await getFile(target);
  const url = URL.createObjectURL(type ? new Blob([await f.arrayBuffer()], { type }) : f);
  v.blobUrls.push(url);
  return url;
}

// ---------------------------------------------------------------- Markdown
async function renderMarkdown(text, v, doc) {
  // 画面に出していない文書の中で組み立てる（相対パスの画像を、サーバーに読みに行かせないため）
  const inert = document.implementation.createHTMLDocument('');
  const box = inert.createElement('div');
  box.className = 'md';
  box.innerHTML = DOMPurify.sanitize(marked.parse(text));
  const baseDir = parentDir(v.node.path);

  renderAlerts(box);
  await renderMath(box);
  await renderMermaid(box);
  await renderCodeBlocks(box);

  for (const img of box.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!src || isExternal(src)) continue;
    let url = null;
    try { url = await localUrl(v, baseDir, src); } catch (e) { continue; } // 読めない画像はそのまま
    if (url) { img.src = url; continue; }
    const s = inert.createElement('span');
    s.className = 'missing';
    s.textContent = `［画像が見つかりません：${src}］`;
    img.replaceWith(s);
  }

  markLinks(box, baseDir);
  return doc.importNode(box, true);
}

// ---------------------------------------------------------------- HTML
// 枠（iframe）の中に出す。sandbox に allow-scripts を付けないので、スクリプトは動かない。
// allow-same-origin は、スクロールの位置を保つのと、フォルダの中の画像・CSS（blob:）を読ませるために付ける。
async function renderHtml(text, v, content, scrollY) {
  const pd = new DOMParser().parseFromString(text, 'text/html');
  pd.querySelectorAll('script, base').forEach((el) => el.remove());
  const baseDir = parentDir(v.node.path);
  for (const el of pd.querySelectorAll('img[src], source[src], video[poster]')) {
    const attr = el.hasAttribute('src') ? 'src' : 'poster';
    const url = await localUrl(v, baseDir, el.getAttribute(attr));
    if (url) el.setAttribute(attr, url);
    el.removeAttribute('srcset');
  }
  for (const el of pd.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const url = await localUrl(v, baseDir, el.getAttribute('href'), 'text/css');
    if (url) el.setAttribute('href', url);
  }
  markLinks(pd, baseDir);

  const fr = v.win.document.createElement('iframe');
  fr.className = 'htmlview';
  fr.setAttribute('sandbox', 'allow-same-origin allow-popups allow-popups-to-escape-sandbox');
  fr.addEventListener('load', () => {
    fr.contentDocument.addEventListener('click', (e) => onLocalLink(v, e));
    fr.contentWindow.scrollTo(0, scrollY);
  }, { once: true });
  fr.srcdoc = '<!doctype html>\n' + pd.documentElement.outerHTML;
  content.replaceChildren(fr);
  fitFrame(v);
}
