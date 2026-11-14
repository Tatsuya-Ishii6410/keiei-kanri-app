# 開発・テスト・デプロイ・データ保存

（CLAUDE.md から移した詳しい仕様。作業の決まり・目次は CLAUDE.md の先頭）

## 修正後の作業
コードを修正したら必ず以下を実行：
1. `npm test`（tests/*.test.js をすべて実行。下の静的チェックと画面の実行テストを含む）。1つでも失敗したら直してから進む
2. `git diff --stat` で削除された行数を見る。★ 置き換えるつもりの範囲より削除が多いときは、止まって `git diff` で中身を確認する
   （2026-11-03、ドライブ取込の範囲の置き換えで、すぐ下のデビット通知の取込と localYmd などまで消し、
   公開版で請求書の発行・月次締めの完了・デビット通知の取込・銀行明細CSV・ダッシュボードの一部が止まった）
3. `cp keiei-kanri.html index.html`
4. git add . → git commit -m "修正内容を簡潔に"
5. `git pull --rebase origin main`（GitHubの画面で直した deploy.yml などを取り込む）→ `npm test` が通ることを確かめて `git push origin main`

### 自動のチェック（npm test）
- ルートの package.json は `npm test`（node tests/run-all.js）のためだけ。アプリ本体には依存も、ビルドも無い
- tests/no-undef.test.js：静的チェック。keiei-kanri.html のインラインのスクリプトと、HTMLの on○○="…" 属性
  （JSのテンプレート文字列の中で作るものも。${…} は値に置き換えて読む）を ESLint の no-undef で調べ、未定義の関数・変数があれば失敗
  ブラウザの標準の名前は globals.browser。それ以外で意図して使うグローバル（XLSX など）は ALLOWED_GLOBALS に足す
  ESLint は tests/package.json の開発用の依存（tests/node_modules。.gitignore 済み）。無ければ run-all.js が最初に `npm ci` で入れる
- tests/app-smoke.test.js：画面の実行テスト。ヘッドレスの Chrome を起動し（追加の依存なし。DevTools Protocol を Node の WebSocket で使う）、
  fetch を差し替えて GAS の偽の応答を返す（シート・Drive・Gmail には触らない。Anthropic API を呼ぼうとしたら失敗）。外部のフォント・CDN は読まない
  順に行う操作：ダッシュボード（新・旧、月・期の切替）／案件管理／請求書の下書き作成→発行（GASへの save まで）／見積・請求の一覧と表示／CF管理／
  ドライブから取込（inboxScan まで）／デビット通知から取込（debitMails まで）／銀行明細CSVのプレビュー／交通費台帳（PDFの表示）／
  月次締めの「確認を完了」／月次レポート（月・通年・案件予実・融資力診断）／設定
  ページの例外・Promise の例外・console.error を、その時の段の名前つきで集め、1件でもあれば失敗。各段の最低限の結果（下書きができた・発行済みになった など）も確かめる
  画面・操作を足したら SCENARIO に段を足す。偽の応答は PRELUDE の gasReply、初期データは SEED
  Chrome の場所は CHROME_PATH で指定できる。どうしても無い環境だけ SKIP_BROWSER_TEST=1（飛ばしたことを表示する）
  別の版のHTMLを調べるときは APP_FILE=パス（no-undef.test.js も同じ）
- 確かめたこと：localToday を消すと両方が失敗する（静的チェックは呼び出し箇所を行番号つきで出す）。1f7d7a3 の版も両方が失敗する

## ファイル構成
- keiei-kanri.html：アプリ本体（全機能がこの1ファイルに集約）。編集するのは常にこのファイル
- index.html：keiei-kanri.html のコピー。GitHub Pagesのトップページ用
  ※ keiei-kanri.html を直したら `cp keiei-kanri.html index.html` で揃えてからコミットする
  （揃え忘れてもデプロイ時にワークフローが keiei-kanri.html から作り直すので、公開版は常に最新）
- gas-code.js：Google Apps Script用のコード（GASエディタに貼り付けて使う。ブラウザからは読み込まれない）
- tests/debit-import.test.js：取込の判定のテスト。`node tests/debit-import.test.js` で実行する
- tests/invoice-drafts.test.js：請求書の下書き・訂正のテスト。`node tests/invoice-drafts.test.js` で実行する
- tests/receipt-import.test.js：領収書の読み取り・誰と／用件・重複判定のテスト（AIの呼び出しはモック）
- tests/inbox-scan.test.js：受信箱の週次読み取り・取込待ちからの登録・一括登録・重複判定のテスト（AI・Driveはモック）
- tests/ops-checks.test.js：週次バックアップ・入金遅延・月次締めチェックのテスト（Drive・GASはモック）
- tests/travel-suggest.test.js：交通費の訪問先の候補（駅名・訪問先の正規化・自宅駅の除外・並び順）・用件の選択式・帰りの行の自動入力・同じ区間の過去の運賃のテスト
- tests/dashboard-v2.test.js：新ダッシュボードの判定（達成率・コンディション・過去最高・大きな変化・アクション・ミッション・インサイト）と期のKPI目標の往復のテスト
- tests/dashboard-v2-compare.html：新旧ダッシュボードの数字の突き合わせ（ブラウザで開く。手順は「新ダッシュボード」の節）
- tests/project-list.test.js：案件管理の一覧の判定（projectListState・projectInMonth。年＋月・繰越・終了日なし・見込み／失注）のテスト
- tests/no-undef.test.js：未定義の名前の静的チェック／tests/app-smoke.test.js：画面の実行テスト（ヘッドレスの Chrome）／
  tests/run-all.js：npm test の本体（「修正後の作業」の節）
- .github/workflows/deploy.yml：GitHub Pagesへの自動デプロイ
  ★ 手元では変更しない（pushの認証に workflow の権限が無く、GitHubに拒否される）。直すときは変更内容をユーザーに伝え、
  ユーザーがGitHubの画面で直す。そのあとの push の前に git pull --rebase で取り込む
  公開されるのは index.html（keiei-kanri.html のコピー）と images/ だけ。ほかの公開ファイル（新しいフォルダなど）を足すときは deploy.yml の変更が要る
- netlify.toml：旧Netlify用の設定（移行後も念のため残している）

## データ保存
- 保存先は Google スプレッドシート（projects / quotes / ledger / settings の4シート）
  https://docs.google.com/spreadsheets/d/1gdtg7q3NwG3FQmWGc7lMpNEKROyvyRwuoIRKNSPsi4k/edit
- keiei-kanri.html 先頭の定数 GAS_URL にGASウェブアプリのURLを設定して連携する
- localStorageはバックアップ。GASの読み込みに失敗したときのフォールバックとして使う
- gas-code.js を修正したら、GAS側で「デプロイを管理」→新バージョンとしてデプロイし直すこと
- 保存は7シートの全上書き。古い端末の上書きを防ぐため、版を比べる：
  - 版＝settings の updatedAt（ミリ秒まで）。読み込みで syncVersion として返し、アプリは S に入れず覚える（localStorage の bizapp_sync）
  - 保存で baseVersion と画面のID（writer）を送る。GASは版が違い、最後に保存したのが別の画面なら断る（{ok:false, conflict:true}）。同じ画面の再試行（応答が届かなかった保存）は通す
  - baseVersion を送らない古いアプリ・updatedAt の無い古いシートは、今までどおり保存できる
- 未送信の印（bizapp_sync の unsent）：saveState で立て、送れたら消す。印があるまま読み込みが成功したら、黙って置き換えず、送る／置き換えるを選ばせる。選ばなかった方は控え（bizapp_stash。30日・5件。設定の「同期の控え」からダウンロード・コピー。JSONは「データをインポート」で戻せる）
- 同期エラーの表示を押すと理由のモーダル（modal-sync-err）。再試行は失敗した方（読み込み／保存）。断られた保存は「読み込み直す」
- 今日の日付は today()＝localToday()（端末のローカル日付）。toISOString で日付を作らない

## 注意事項
- pushすればGitHub Actionsが自動でGitHub Pagesにデプロイする（1〜2分）
  公開URL：https://tatsuya-ishii6410.github.io/keiei-kanri-app/
