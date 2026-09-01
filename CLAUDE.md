# keiei-kanri-app

## プロジェクト概要
アスリンク株式会社の経営管理アプリ。
単一HTMLファイル（keiei-kanri.html）で構成。
GitHub Pages（https://tatsuya-ishii6410.github.io/keiei-kanri-app/）で公開。
GitHubリポジトリ：Tatsuya-Ishii6410/keiei-kanri-app

## 修正後の作業
コードを修正したら必ず以下を実行：
1. git add .
2. git commit -m "修正内容を簡潔に"
3. git push origin main

## ファイル構成
- keiei-kanri.html：アプリ本体（全機能がこの1ファイルに集約）。編集するのは常にこのファイル
- index.html：keiei-kanri.html のコピー。GitHub Pagesのトップページ用
  ※ keiei-kanri.html を直したら `cp keiei-kanri.html index.html` で揃えてからコミットする
  （揃え忘れてもデプロイ時にワークフローが keiei-kanri.html から作り直すので、公開版は常に最新）
- gas-code.js：Google Apps Script用のコード（GASエディタに貼り付けて使う。ブラウザからは読み込まれない）
- .github/workflows/deploy.yml：GitHub Pagesへの自動デプロイ
- netlify.toml：旧Netlify用の設定（移行後も念のため残している）

## データ保存
- 保存先は Google スプレッドシート（projects / quotes / ledger / settings の4シート）
  https://docs.google.com/spreadsheets/d/1gdtg7q3NwG3FQmWGc7lMpNEKROyvyRwuoIRKNSPsi4k/edit
- keiei-kanri.html 先頭の定数 GAS_URL にGASウェブアプリのURLを設定して連携する
- localStorageはバックアップ。GASの読み込みに失敗したときのフォールバックとして使う
- gas-code.js を修正したら、GAS側で「デプロイを管理」→新バージョンとしてデプロイし直すこと

## 注意事項
- pushすればGitHub Actionsが自動でGitHub Pagesにデプロイする（1〜2分）
  公開URL：https://tatsuya-ishii6410.github.io/keiei-kanri-app/

## 請求書・見積書 デザイン仕様
- メインカラー：#1a2e4a（ネイビー）
- タイトル：中央・letter-spacing:12px・下に2px実線
- 金額末尾に「-」必須（例：¥158,400-）
- テーブルヘッダー・合計行：背景 #1a2e4a / 文字white
- 支払期限は赤字（#e53e3e）
- 書類番号：INV-YYYYMM-001（請求書）/ EST-YYYYMM-001（見積書）
- 振込先は設定ページの銀行情報を自動挿入
- プレビューとHTMLダウンロードは buildDocHtml() の1箇所で組版する
  （色はインライン指定。アプリのダークモードの影響を受けないため）

## 月次決算レポート
- ナビ「📊 月次レポート」。対象月を選んで「レポートを生成」で表示（既定は前月）
- 5セクション：サマリー（損益計算書形式＋計画比）／案件別売上明細／
  収支入力明細（売上区分のみ）／経費明細（勘定科目別）／請求書発行状況
- サマリーの「売上高（案件ベース）」は案件別売上明細と同じ範囲
  （契約済・進行中・完了）で集計する。明細の合計と必ず一致させること
  ※ ダッシュボードの売上（calcProjectSalesByMonth）も同じ範囲なので、両者の数字は一致する
- 印刷は @media print で topbar・操作ボタンを隠し、レポート本体のみА4に出力する

## 固定費（収支管理）
- 収支管理の「🔁 固定費管理」で登録。fixedCosts に {id,type,desc,amount,startMonth,endMonth,enabled}
- 収支ページを開いたとき、または「固定費を反映」で、開始月〜今月のうち
  未登録の月を ledger に自動追加する（計上日はその月の末日）
- 重複防止は ledger の fixedCostId と年月の組み合わせで判定するため、
  ledger シートの fixedCostId 列は消さないこと
- 自動追加された収支を削除しても、次に反映したとき再作成される。
  止めたいときは固定費を無効にするか終了月を設定する

## ドライブ経費取込
- 専用フォルダID：1YLUeZuWj6QAVWaXAOLaKE5sZXz4NQhxA（アスリンク_経費取込フォルダ）
- 処理済みファイルは「処理済み_」プレフィックスでリネーム
- Drive操作・AI読み取り・リネームはすべてGAS側で実行する
  （ブラウザからDrive APIやAnthropic APIは呼べない。APIキーが公開されるため）
- Anthropic APIキーはGASのスクリプト プロパティ ANTHROPIC_API_KEY に保存。
  gas-code.js にも keiei-kanri.html にも書かないこと
- 使用モデル：claude-sonnet-4-6（PDFは type:'document'、画像は type:'image'）
- GASのaction：driveList / driveExtract / driveProcessed

## 融資力診断
- レポートページの「💰 融資力診断」タブ。5項目×20点＝100点で採点
  （売上の継続性／現預金水準／収益性／借入状況／事業計画の精度）
- 現預金残高は bankBalance（CF管理の口座残高と共通の1つの値）。既存借入残高は
  設定ページの「財務情報」から入力し、finance.loan に保持（settingsシートは finance.loan）
- AIアドバイスはGASの advise アクション経由（claude-sonnet-4-6）。
  ブラウザから直接Anthropic APIは呼ばない

## 収支の区分グループ
- sales（売上）／ expense（経費系）／ labor（役員報酬・旧人件費）／ tax（税金・社会保険料）
- 税金・公課は経費合計に含めず、営業利益の計算にも入れない
- バッジ色：売上=緑／役員報酬=アンバー／経費=赤／税金・公課=紫
- 区分を増やすときは LEDGER_TYPES と、税金なら TAX_TYPES にも追加する

## 銀行明細CSV取込
- CSV取込ページの取込種別「🏦 銀行明細取込」。GMOあおぞらネット銀行の明細CSVに対応
  （列: 取引日 / 摘要 / お支払金額 / お預り金額 / 残高 / メモ。残高は使わない）
- お支払金額>0=支出、お預り金額>0=収入（売上）として取り込む
- 区分は摘要のキーワードから推測（BANK_RULES）。該当なしの支出は「その他経費」
- 同じ日付・金額・摘要が既にledgerにあれば「重複の可能性あり」として未選択にする
- 文字コードは readCsvFile() が UTF-8 → Shift-JIS の順で自動判別する

## 期（会計年度）
- fiscalYears:[{id,name,startMonth,endMonth,salesTarget,profitTarget,active}]、
  currentFiscalYearId / nextFiscalYearId。GASは fiscalYears シートに保存
- 期の範囲は月インデックス（0=1月）の並びとして扱う
  例: 2026-03〜2027-02 → [2,3,…,11,0,1]。fiscalMonths() が期の並び順で返す
- ダッシュボードの期セレクト・期間サマリー・月次推移グラフ、
  月次計画の入力月の並び、月次レポートの【0】期間累計サマリーがこれに連動する
- 注意: 集計は「何月か」だけで行うため、同じ月を持つ複数の期は数字を区別できない
  （年をまたぐ複数期のデータを同時に持つ場合は要拡張）

## 見積書の契約期間
- quotes に contractStart / contractEnd（YYYY-MM）/ paymentMethod / isMonthly を保持
- 月額固定（isMonthly）のとき、明細は月額として扱い
  「月額単価」「月額」「月額小計」「月額合計」＋「契約期間合計（税込）」を表示する
- 契約月数は両端を含む（2026-09〜2026-11 = 3ヶ月）。最低契約期間3ヶ月未満は警告
- 一覧の金額（q.amount）は月額固定なら 月額合計×契約月数（契約全体の金額）
- 特記事項（最低契約期間・自動更新・解約予告）は月額固定のときだけ挿入する

## 月次PL（Excel）出力
- 月次レポートの「📥 月次PL（Excel）をダウンロード」。SheetJSでxlsxを生成する
- 書式（色・太字）が必要なため xlsx-js-style を使う
  （公式の xlsx.full.min.js はセル書式に非対応。読めなかった場合の予備として残している）
  ライブラリはボタンを押したときに初めて読み込む
- 販売管理費には役員報酬と税金・公課も含める。したがって
  PLの「当月損益」はアプリの「営業利益」（税金を含まない）とは一致しない
- 「共有先」は設定ページの company.shareWith から取得する

## ログイン認証
- メールアドレス＋パスワード。既定 tatsuya-ishii@us-links.com / uslink2026
- SHA-256（crypto.subtle）のハッシュを localStorage の bizapp_auth_v1 に保存。
  平文もハッシュもソースには持たない。初回アクセス時に既定値から自動生成する
- セッションは bizapp_session_v1 に期限を保存し30日間有効
- 3回連続失敗で30秒ロック。どちらの項目が誤りかは表示しない
- パスワード変更は設定ページの「ログイン設定」から（メールアドレスは変更不可）
- ※ これは画面を隠すだけの簡易ゲート。静的サイトなのでソースを直接見れば回避でき、
  GASウェブアプリ（アクセス「全員」）にはURLだけで到達できる。
  本当に保護するならGAS側の認証が必要

## 売上入金の突合
- projects に invoiceStatus / paidMonth / paidAmount を持つ
  invoiceStatus: uninvoiced=未請求(グレー) / invoiced=請求済(アンバー) /
  paid=入金済(緑) / paid_manual=入金済・手動(青、複数月まとめ入金など突合しないケース)
  paid_manual は 入金確認ボタン・入金待ち・銀行明細の突合の対象外
- 税込金額は 案件金額×1.1 の小数点以下切り捨て（grossAmount）
- 一括請求書を作ると対象案件が uninvoiced → invoiced になる
- 案件ページの「💴 入金確認」（請求済の行のみ表示）で paid にし、
  同時に収支へ「売上」として登録する（ledgerに projectId を持たせる）
- 銀行明細CSVの入金行は、税込金額の±1%以内の未入金案件を突合候補として提示する。
  チェックを入れて登録すると案件も入金済みになる
- ダッシュボードの「💰 入金待ち」は invoiced の税込合計。クリックで案件ページへ

## 入金ステータスの自動更新・一括変更
- 請求書を作ると案件が uninvoiced → invoiced になる
  一括請求書は選択した案件、単票は明細の projectId で紐づいた案件が対象
  （quickQuote と一括請求書の明細に projectId を持たせている）
- 案件ページの「📋 一括ステータス変更」で
  「未請求→請求済」「請求済→入金済」をまとめて処理できる
  入金済にするときは入金日と入金額を指定し、収支への一括登録も選べる
- 一括ステータス変更は4パターン：未請求→請求済／請求済→入金済／
  入金済（突合不要）に変更／請求済→未請求（取消）
  取消では paidMonth・paidAmount もクリアする（請求書自体は削除しない）
  対象一覧に出るのは案件ステータスが「進行中」「完了」のものだけ
  （商談中・契約済・失注は全モードで除外）

## UI（サイドバー型レイアウト）
- メインカラー：ネイビー --navy #1a2e4a ／ アクセント：オレンジ --orange #E8832A
- 構造：.app > (.sidebar[fixed] + .main) 、.main > .topbar + .content
  サイドバー幅220px。.main は margin-left:220px で逃がす
- ナビは .nav-btn。DOM順は ダッシュボード/案件/見積請求/収支/CSV/レポート/設定。
  goToInvoiced() が querySelectorAll('.nav-btn')[1] を使うので順番を変えないこと
- ページ名は PAGE_TITLES を見て topbar-title に出す
- 768px以下はサイドバーを隠し、トップバーの「☰ メニュー」で toggleSidebar()
- 同期表示はトップバーとサイドバー下部の2箇所（save-indicator / save-indicator-side）
- グラフ：売上=オレンジ／営業利益=ネイビー／利益率=グリーン
- 入金待ちカードは .metric-card.accent（オレンジ背景・白文字）

## レスポンシブ
- ブレークポイントは 768px（タブレット）と 480px（スマホ）
- 768px以下：サイドバーをスライドイン式に、表とタブを横スクロール、
  ボタン min-height:44px、入力欄 font-size:16px（iOSの自動ズーム防止）
- 480px以下：メトリクスカードとフォームを1列、セレクトとボタンを縦積み、
  表内の操作ボタンを縦積み、見積・請求の一覧は番号と顧客の列を隠す
- 表を潰さず横スクロールさせるため .table-wrap table{min-width:560px}
- 見積・請求のタブは .tab-full / .tab-short で表記を切り替える

## フォント
- Google Fonts の Inter（数字・欧文）と Noto Sans JP（和文）を読み込む
- --font-body（本文）／--font-ja（和文）／--font-num（数値）の3変数で使い分ける
  --font-num は 'Inter','Noto Sans JP',sans-serif。Interに和文グリフが無いため
  Noto を続けて指定し、和文が入る箇所（バッジなど）でも崩れないようにしている
- 見出し・数値・th・合計行は 700、ラベルとナビは 500、本文は 400
- 帳票（buildDocHtml）はダウンロード後も同じ見た目にするため、
  CSS変数ではなく DOC_NUM_FONT の実名フォントを使い、
  ダウンロードするHTMLにも Google Fonts の link を入れている

## 収支の備考
- ledger の各エントリに memo（任意）を持つ。GASの ledger シートにも memo 列がある
- 収支入力モーダルの備考欄は、区分が「交際費」のときだけ placeholder を変える
- 収支一覧では摘要の下に小さいグレー文字で表示する
- 月次PL（Excel）では勘定科目ごとに備考を改行で連結して備考列に出す
  （改行を含むセルは wrapText を有効にする）

## 交通費の計算
- 収支入力で区分「交通費」を選ぶと計算パネルが出る（電車・バス／車）
- 運賃は GAS の fare アクション。claude-sonnet-4-6 の web_search（web_search_20260209）で
  ICカード運賃を調べ、回答から数値を取り出す
- 車は GAS の distance アクション。Google Maps Distance Matrix API で距離を取り、
  距離 ×（ガソリン単価 ÷ 燃費）で算出する
  ※ どちらもブラウザから直接は呼べない（APIキーの露出とCORS）ためGAS経由
- 設定は state の travel:{googleMapsApiKey,gasolinePrice,fuelEfficiency}
  settingsシートには travel.* で保存。APIキー未設定なら車モードは選べない

## キャッシュフロー管理（旧・収支管理）
- ledger の status で3種類を持つ：actual（実績）／planned_in（入金予定）／planned_out（出金予定）
  status が無い既存データは actual として扱う。予定日は expectedDate
- ★ ダッシュボード・レポート・PLの集計は必ず isActual() で実績のみに絞ること
  （sumLedger / sumLedgerYear / レポート各明細 / buildMonthlyPL に組み込み済み）
- 月末残高予測 = bankBalance ＋実績(入−出) ＋予定(入−出)
- 「前月の請求済み案件を入金予定にする」は hasPlannedIn() で案件ごとの重複を防ぐ
- 案件を請求済にするとき（一括・個別とも）入金予定日を入れると planned_in を自動作成する
