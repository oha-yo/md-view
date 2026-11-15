# md-view の開発ルール

ユーザー（sooni さん）が自分で使う、フォルダの tree を出してテキスト・Markdown・HTML を別画面で見るツール。`md-view.html` をブラウザ（Chrome・Edge）で開いて使う。ユーザーは日本語しか読まないので、画面の文言・コメント・説明はすべて日本語にする。

## 守ること
- **ファイルはブラウザの中で読むだけ。** 外への通信はしない。ライブラリは `lib/` に置いたものだけを使い、CDN は使わない。
- 大きいライブラリ（Mermaid・KaTeX・highlight.js）は、`js/core.js` の `loadLib()` で**使うときだけ**読み込む。`md-view.html` に `<script>` で足さない。数式は KaTeX の MathML で出す（別画面にフォントや CSS を読み込まないため）。
- ダウンロードしたライブラリを Node.js などで実行して確かめない。中身は文字として調べ、動きはブラウザのテストで確かめる。
- **`file://` で開いても動くこと。** そのため ES モジュール（`import`）は使わず、`js/` の下のファイルをふつうの `<script>` で順に読む。トップレベルの `const` や `function` は、ファイルをまたいで共有される。
- アプリの状態は `js/core.js` の `state` にまとめる。
- 画面に値を入れるときは `textContent` を使う。`innerHTML` には、`esc()` を通した文字か、固定の文字列（アイコンの SVG など）だけを入れる。Markdown は DOMPurify を通す。HTML のプレビューは sandbox（`allow-scripts` なし）の iframe に出す。
- 別画面は `window.open` で開くので、クリックの処理から**同期のまま**呼ぶ（`await` のあとで開くと、ポップアップとして止められる）。
- 保存しているもの：localStorage の `md-view-excludes`・`md-view-date`・`md-view-sort`、IndexedDB の `md-view`（フルパスとフォルダの入口）。名前や形を変えるときは、前のものを読み替える処理を書く。
- **GitHub で公開している**（https://github.com/oha-yo/md-view）。ファイルの先頭のコメントにリポジトリの URL を書く（新しいファイルにも）。ファイル・コメント・コミットメッセージに、ユーザーの本名やローカルのパス（`C:\Users\...`）、会社の情報を入れない。名前が必要なら「sooni」にする。コミットの作者は公開用のアドレス（`...@users.noreply.github.com`）、push は `oha-yo` のアカウント（このリポジトリの `credential.username`）。この PC の `gh` は別のアカウントでログインしているので、リポジトリの操作に `gh` を使わない。
- 「tree を保存」で保存したファイル（`*-tree.txt` など）は、自分のフォルダの名前が入るので、`.gitignore` で外している。
- **Web（https://md-view.oha-yo.com/）では CSP を付けている**（`deploy/.htaccess`）。スクリプトは自分のサイトのものだけ（eval も不可）、外への通信は禁止。外の URL を読む処理や、`eval`・`new Function` を使うライブラリを足すときは、`python test/serve.py <port> --csp` で回帰テストを流して確かめる。

## テストのやり方
1. md-view のフォルダで `python test/serve.py 8790` を動かす（バックグラウンドで）。
2. `http://localhost:8790/test/regress.html` を開く。md-view を iframe で開いて自動で操作し、結果を `test/expected.json` と比べる（数十秒かかる）。「OK：57 項目すべて同じです」なら変わっていない。`serve.py` は HTTP/1.1 で返し、`Cache-Control: no-cache` を付ける（Windows で読み込みが途中で切れるのと、古い JS がキャッシュから読まれるのを防ぐため）。`python -m http.server` では、これが起きることがある。
3. 動きを**意図して**変えたときは、`regress.html?update` を開く。`serve.py` が PUT を受け付けるので、そのまま `expected.json` に保存される。変わった項目が意図どおりかを、保存する前に必ず確かめる。
4. 終わったらサーバーを止める。
- テストは OPFS に `test/sample/` を写して使い、終わったら消す。localhost の localStorage と IndexedDB の `md-view` も消すが、ユーザーが `file://` で使っているデータとは別の場所なので影響しない。
- 別画面は、アプリの中に作った見えない iframe に差し替えて確かめる（アプリ内のブラウザはポップアップを止めるため。アプリの中に作るので CSP も引き継ぐ）。
- テストは `load`・`renderTree`・`runFind`・`treeText`・`openView` と `window.mdView`（`state` と、ライブラリを読み込んだか）、画面の部品の id を使う。名前を変えるときは `test/regress.js` も直す。
- 公開する前は、`--csp` を付けたサーバーでも回帰テストを流す。

## 改修したら
- `CHANGELOG.md` に版の番号と変更点を書き、`js/core.js` の `VERSION` をそろえる（機能の追加・画面の変更はマイナー、不具合・文言の修正はパッチ）。
- 回帰テストを動かす。新しい機能には、回帰テストの項目も足す。
- 使い方が変わったら `README.md` も直す。
