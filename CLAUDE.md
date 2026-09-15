# keiei-kanri-app

## プロジェクト概要
アスリンク株式会社の経営管理アプリ。
単一HTMLファイル（keiei-kanri.html）で構成。
GitHub Pages（https://tatsuya-ishii6410.github.io/keiei-kanri-app/）で公開。
GitHubリポジトリ：Tatsuya-Ishii6410/keiei-kanri-app

## ダッシュボード・レポートの集計
- 売上 …… 案件ベース（発生ベース）。monthlyBillings があればその金額、無ければ案件の月額
  `projectSalesAtAbsTotal(abs)` / `salesAtMonth(mi,year)`
- 経費合計・役員報酬・税金・公課 …… CF管理（ledger）の実績（status=actual）
  `cfExpenseByMonth(mi,year)` / `cfLaborByMonth(mi,year)` / `cfTaxByMonth(mi,year)`
  中身はすべて `sumLedgerAbs(abs)`。交通費も経費合計に含める（会計上は当月の経費）
- 入金待ち …… CF管理の入金予定（status=planned_in）の合計。`awaitingPayment()`
  金額は addPlannedInForBilling() が grossAmount() で入れるので税込
  カードをクリックするとCF管理へ（goToPlannedIn／nav-btn[3]）
- ★ 営業利益 ＝ 売上 −（経費合計 ＋ 役員報酬 ＋ 税金・公課）。`operatingProfit()` を必ず使う
  税金・公課も差し引くので、月次PL（Excel）の「当月損益」と一致する
- 年間累計・期間サマリー …… `fiscalTotals(fy)`（＝cfFiscalTotals）。期の全月を絶対月で回す
- ★ 集計は必ず「年＋月」＝絶対月で行う。月インデックス（0=1月）だけで足すと、
  年をまたぐ期（例 2026-03〜2027-02）で別の年のデータを拾う。
  `monthYearOf(mi,fy)` が月インデックスから正しい年を返す
  （`monthYear`＝アクティブな期／`dashMonthYear`＝ダッシュボードで選択中の期）
- ※ salesByMonth / salesYearTotal / salesSeries / calcProjectSalesByMonth /
  projectSalesAmount は、この年またぎの問題があるため廃止した。復活させないこと
- ダッシュボード・月次レポート・通年レポート・月次PL・融資力診断は
  すべて同じ関数を使うので、同じ月なら数字が一致する

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
  ※ ダッシュボードの売上も同じ projectSalesAtAbs なので、両者の数字は一致する
- 経費合計・役員報酬・税金・公課はCF管理の実績（cfExpenseByMonth など）。
  営業利益は operatingProfit()＝売上 −(経費＋役員報酬＋税金)
  （詳しくは「ダッシュボード・レポートの集計」の節を見ること）
- 印刷は @media print で topbar・操作ボタンを隠し、レポート本体のみА4に出力する
  （詳しくは「印刷・PDF出力」の節を見ること）

## 通年レポート
- 月次レポートの月セレクトで「通年（期全体）」を選んで「レポートを生成」。既定は前月のまま
- 対象の期は activeFiscalYear()（無ければ FORECAST_DEFAULT_FY）。月次レポート側に期セレクトは無い
- ★ 集計は案件予実と同じく絶対月（fiscalAbsMonths / projectSalesAtAbs / ledgerSalesAbs）で行う
- 当月まで＝実績（ledger の actual）、翌月以降＝予定（planned_out ＋ すでに入っている実績）。
  annualRows() が月ごとに作る。翌月以降の実績を落とすと
  ダッシュボードの年間累計と合計がずれるため足している
- 売上はどの月も案件ベース（発生ベース）。【4】の入金実績（CFの売上区分）と合計には混ぜない
- 【0】期間サマリーの「合計（売上）」と【2】案件別売上明細の合計は必ず一致する
  （どちらも projectSalesAtAbs / forecastProjectTotal）
- 【3】経費明細の「予定」は翌月以降の planned_out だけ。過去月の未変換の予定は実績と二重になるので数えない
- 見出しの期名は fiscalTitle()。期の名前に「第○期」が入っていればそれを使い、無ければ名前をそのまま出す
  （fiscalYears に期番号を持たせていないので、並び順から推測はしない）
- 通年モードでは月次PL（Excel）ボタンを隠す（onReportMonthChange）。1ヶ月ぶんの帳票のため
- 印刷は月次レポートと同じ @media print。8列の表には .ar-table を付けて印刷時だけ 9px に詰める

## 印刷・PDF出力（レポート3タブ共通）
- @page は A4縦・余白 15mm/14mm/15mm。CSSは keiei-kanri.html の
  「===== 印刷・PDF出力 =====」ブロックに集約する
- セクションは repSection() が付ける .rp-section（＝.report-card）が単位。
  break-inside:avoid でカードの途中では改ページしない
- ★ 行数が RP_LONG_ROWS(14) を超える表には repSection() が .rp-long を付け、
  そのセクションだけ分割を許す。長い表をまるごと次ページに送ると
  前のページが大きく空くため。分割されても
  thead{display:table-header-group} で見出し行が毎ページ出て、
  tr{break-inside:avoid} で行は割れない
  ※ 14なのは案件予実の月別予実（12ヶ月＋合計＝13行）を割らせないため
- 案件予実は8列あってA4の幅に窮屈なので、印刷時だけ 9px＋詰めたpadding にし、
  金額・日付・月は white-space:nowrap で折り返させない
- .print-header（#print-header）に会社名・レポート名・対象月・作成日を出す。
  中身は setPrintHeader() が入れる（generateReport / buildForecastHtml /
  generateLoanReport から呼ぶ）
- ★ 「毎ページの上部」にヘッダーを出すのはブラウザの印刷では実現できない。
  試して駄目だった方法（実機のPDFで確認済み）：
  ・@page の margin-box（@top-center{content:…}）… 各ブラウザ未対応
  ・position:fixed … Chromeの印刷でページ下端に回り込む
  ・display:table-header-group … 1ページ目にしか出ない
  毎ページ入れたいときは Chrome の印刷画面の「ヘッダーとフッター」を使う
- ★ 印刷CSSを変えたら必ず実際のPDFで確認すること。指定どおりに効かない
  書き方が多く、画面のプレビューだけでは分からない

## 税金・社会保険 自動計算
- 設定ページの「税金・社会保険 計算設定」で料率などを設定し、
  「🧮 税金を試算する」で試算モーダルを開く（月次レポートページにも同じボタンがある）
- 設定は state の taxSettings:{consumptionTax, socialInsurance, corporateTax}。
  settingsシートには taxSettings.<グループ>.<項目> で保存する
  （GASは TAX_SETTING_FIELDS / TAX_TEXT_KEYS / TAX_BOOL_KEYS。項目を足すときは
   keiei-kanri.html の defaultState.taxSettings と両方に足すこと）
- 資本金は会社情報（company.capital）から持ってくる。設定ページの上のカードで入力する
- ★ 料率は毎年変わる。既定値は令和7年度・兵庫県（協会けんぽ）
  健康保険10.34% / 厚生年金18.300% / 介護1.60%

### 計算の中身
- 消費税：期内の売上（案件ベース・税抜）× 課税売上割合 × 税率 ＝ 受け取り消費税
  簡易課税ならみなし仕入率（第5種＝50%）をかけたものが支払消費税、
  原則課税なら期内の経費（実績＋出金予定）の税込金額 × 10/110 で概算する
  納付額は100円未満切り捨て
  ※ 受け取り消費税は税抜の課税売上にかける。税込金額にかけると過大になる
- 社会保険：標準報酬月額は STANDARD_PAY_TABLE（協会けんぽ全50等級）から自動判定。
  厚生年金だけ 88,000〜650,000 に収める（PENSION_MIN / PENSION_MAX）
  会社負担は halfPremium()＝全額を円に丸めてから折半（50銭以下切り捨て）
  ★ 標準報酬月額×料率をそのまま書くと浮動小数の誤差で1円ずれるので halfPremium を使うこと
  役員報酬月額は設定が空なら、期の役員報酬（CF管理の実績）の1ヶ月平均から推定する
- 法人税等：課税所得＝売上 −（経費 ＋ 役員報酬）。bracketTax() で段階税率を計算
  法人税（800万以下15%／超23.2%）＋法人住民税（法人税割10.4%＋均等割70,000円）
  ＋事業税（400万以下3.5%／400〜800万5.3%／超7.0%）
  ※ 交際費の損金不算入・減価償却・繰越欠損金は見ていない概算

### CF管理への登録
- 試算モーダルの「💾 CF管理に出金予定として登録」で planned_out を作る
  消費税 → 区分「消費税（納付）」／摘要「消費税確定申告 {期名}分」
  社会保険 → 区分「社会保険料」／摘要「社会保険料 {YYYY}年{M}月分」／翌月〜期末の各月末
  法人税等 → 区分「法人税・住民税・事業税（納付）」／摘要「法人税等 {期名}分」
- ★ 区分は LEDGER_TYPES にある名前をそのまま使う（ledgerGroup / TAX_TYPES が効かなくなるため）。
  「健康保険・厚生年金の会社負担」といった補足は備考（memo）に入れる
- 納付予定日はモーダルで直せる。既定は「期末の2ヶ月後の末日」（原則の申告期限）。
  期によって実際の期限が違うので、決め打ちにしていない
- 重複判定は hasPlannedOutLike()＝同じ摘要・同じ年月の planned_out があるか。
  一部だけ重複しているときは confirm で「重複分を飛ばして残りだけ登録」を選ばせる
- 社会保険は会社負担分だけを登録する（本人負担は役員報酬から天引きなので口座からは二重に出ない）

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

## 案件予実（レポート）
- レポートページの「📋 案件予実」タブ。期を選ぶと月別予実・案件別明細・商談中を表示する
- ★ 集計はすべて絶対月（年*12＋月）で行う。fiscalAbsMonths() が期の絶対月を返し、
  projectSalesAtAbs() / ledgerSalesAbs() / billingSummaryOfAbs() / expectedPayDatesOfAbs()
  がそれを受け取る。月インデックス（0=1月）だけで集計すると、
  選択した期と違う年の請求レコードやledgerまで拾うため使わないこと
- 金額は monthlyBillings が正。レコードが無い月だけ案件の月額（projectDefaultMonthly）を使う
- ★ 「合計」も各サマリーカードも案件ベース（発生ベース）のみ。
  「収支売上入力」列は入金実績なので合計に混ぜない（売上の基準2系統の原則）
- サマリーの受注済み合計と、案件別明細の合計は必ず一致する（同じ projectSalesAtAbs を使う）
- タブを開くと initForecastPage() が syncMonthlyBillings() を実行するので、
  案件ページを開かなくても請求レコードが揃う
- 期が未登録なら FORECAST_DEFAULT_FY（2026-03〜2027-02）で表示する。
  案件が0件なら「案件がありません」。生成失敗は console.error＋画面にエラー表示
- スマホは rpBoth（rp-table / rp-cards）で表とカードを出し分ける

## 融資力診断
- レポートページの「💰 融資力診断」タブ。5項目×20点＝100点で採点
  （売上の継続性／現預金水準／収益性／借入状況／事業計画の精度）
- 現預金残高は bankBalance（CF管理の口座残高と共通の1つの値）。既存借入残高は
  設定ページの「財務情報」から入力し、finance.loan に保持（settingsシートは finance.loan）
- AIアドバイスはGASの advise アクション経由（claude-sonnet-4-6）。
  ブラウザから直接Anthropic APIは呼ばない

## 収支の区分グループ
- sales（売上）／ expense（経費系）／ labor（役員報酬・旧人件費）／ tax（税金・社会保険料）
- 税金・公課は経費合計には含めない（別枠で表示する）が、営業利益では差し引く
  （operatingProfit）。月次PLの「当月損益」と一致させるため
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
- ダッシュボード・レポート・PLの集計は絶対月（年*12＋月）で行うので、
  年をまたぐ期でも別の年のデータは拾わない（monthYearOf で月→年を導く）
- 注意: 案件ページ・見積請求ページの月フィルター（projectHasMonth /
  projectMonthAmount）はいまも月インデックスだけで絞るため、
  同じ月を持つ複数の期は区別できない

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
- 販売管理費には役員報酬と税金・公課も含める。
  アプリの「営業利益」も税金・公課を差し引くので、PLの「当月損益」と一致する
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
- ダッシュボードの「💰 入金待ち」はCF管理の入金予定（planned_in）の合計。
  クリックでCF管理ページへ（請求済にしても入金予定を作らなかった案件は出てこない）

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
  goToInvoiced() が querySelectorAll('.nav-btn')[1]、goToPlannedIn() が [3] を
  使うので順番を変えないこと
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

## 交通費の精算（出金予定）
- CF管理の「🚃 交通費精算を追加」で、対象月の交通費（実績のみ）を合算し
  翌月25日の出金予定（planned_out）として登録する
- 登録済み判定は ledger の settlementMonth（YYYY-MM）。GASの ledger シートにも列がある
- 精算そのものは planned_out なので、翌月の交通費実績には混ざらない
- ★ 交通費の実績（type=交通費 かつ actual）は CF管理の一覧・実績出金・残高予測から除外する
  （isCashRelevant）。都度払いではなく翌月まとめて精算するため。
  PL・ダッシュボード・月次レポートの経費集計には従来どおり含める
- 交通費の金額と精算状況はサマリーカードの下に注記として出す（renderTravelNote）
- CF管理を開いたとき、前月の精算が未登録で交通費があればバナーで知らせる

## 交通費台帳
- CF管理は「💰 キャッシュフロー」「🚃 交通費台帳」の2タブ
- 台帳は ledger の「交通費」区分（actual）をそのまま使う。別データは持たない
- 摘要は「{出発}→{到着}（{移動手段}）」で保存し、表示時に → で分解する
  （出発・到着を別フィールドで持たないので、摘要の形式は崩さないこと）
- 全期間表示では月ごとにグループ化して小計行を出す
- 「🚃 交通費精算を追加」はこのタブに置く（CFメインからは外した）

## CF管理は口座ベース
- CF管理の集計は cfInflow / cfOutflow / cfPlannedIn / cfPlannedOut のみを使う
  （すべて ledger 由来。交通費の実績は除外）
- ★ CF管理で projectSalesAtAbsTotal / salesAtMonth（案件ベースの売上）を使わないこと
  案件ベースの発生売上はダッシュボード・レポート・PL側の話
- 「計画 vs 実績」カードもCF管理内では口座ベース（ledgerの売上のみ）で比較する

## 月次請求レコード（monthlyBillings）
- 案件の月ごとの請求金額・ステータスを持つ。GASは monthlyBillings シート
  {id,projectId,billingMonth(YYYY-MM),amount,invoiceStatus,invoiceId,
   paidDate,paidAmount,expectedPayDate,note}
- syncMonthlyBillings() が不足分だけ自動生成する（既存レコードは絶対に上書きしない）
  対象は契約済・進行中・完了。案件ページを開いたときと案件を保存したときに実行
- projectSalesAtAbs / projectSalesAtAbsTotal はレコードがあればその金額、
  無ければ案件の月額（projectDefaultMonthly）を使う
- invoiceStatusOf(p) はレコードがあればそこから導く（全月入金済→paid、
  1件でも請求済→invoiced）。レコードが無い案件は従来どおり p.invoiceStatus
- 一括ステータス変更・入金確認は対象月のレコードだけを更新する

## 請求書フォルダとの同期
- 請求書関係フォルダID：14QU-Gwgpj-wM6an0i7I8tzF0DoPMoFOP
- 月別サブフォルダ：「請求書/{YYYY}年{M}月」（スラッシュ込みが実際の名前）。
  見つからなければ「{YYYY}年{M}月」でも探す。どちらも直下と1階層下を対象にする
- ファイル名：「【アスリンク請求書YYYYMM分】{顧客名}御中.pdf」
- 見積・請求ページの請求書タブ「☁️ ドライブから請求書を同期」から実行
- GASのアクション：invoiceList（月フォルダのPDF一覧）／driveRead（PDFをテキスト化）
  driveList は folderId を渡せる（省略時は経費取込フォルダ）
- PDFのテキスト化は Drive API で一時的にGoogleドキュメントへ変換して読む
  （GASにPDFのテキスト抽出機能が無いため。変換した一時ファイルは毎回ゴミ箱に入れる）
- 同期すると quotes に請求書を追加し、顧客名が一致する案件の
  その月の monthlyBilling を invoiced にして、支払期限で入金予定を作る
- 重複判定は invDupCheck()：請求書番号の一致か同じPDFの同期済み（exact）／
  同じ顧客・同じ月の請求書あり（similar）／なし（none）
  similar のまま同期しようとすると競合モーダルで
  「既存を残す／PDFで上書き／両方残す」を選ぶ
- quotes は source（'manual' / 'drive_sync'）と driveFileId を持つ
  source 未設定の既存データは manual として扱う
- 入金予定日は monthlyBilling の expectedPayDate（月ごとに別々に持てる）。
  未設定のときの既定値は nextMonthEndOf()＝請求月の翌月末日
- CF管理の「前月の請求済み案件を入金予定にする」は
  前月の請求済みレコードを対象に、各レコードの expectedPayDate を使う
- 入金予定の重複判定 hasPlannedIn(projectId, date) は日付も見るので、
  同じ案件でも月が違えば予定を作れる
- 請求レコードを「請求済」にすると addPlannedInForBilling() が
  CF管理に入金予定を作る。重複判定は ledger の projectId × billingMonth
- ★ GASの応答に含まれない項目は keepLocalWhenMissing() で手元の値を残す。
  シート未追加の古いデプロイに読み直されてデータが消えるのを防ぐため
- 交通費台帳はCSV（BOM付き・合計行あり）とPDF（別ウィンドウでprint）を出力できる
  移動手段は摘要の末尾「（電車・バス）」から取り出す
- レポートページのモバイル対応では、予実の表に
  .fc-month-table / .fc-project-table を付けて列の出し分けをしている
  印刷時は @media print で display:table-cell に戻す
- ★ 月次レポートと月次PLの「売上高」は案件ベース（発生ベース）のみ。
  金額は monthlyBilling があればその値を使う（projectSalesAtAbs）。
  収支入力の売上は「入金実績」として別枠に出す（合計には入れない）
  ダッシュボードの売上も同じ案件ベースなので、レポートと数字が一致する
- レポートのスマホ表示は rpBoth(テーブル, カード) で両方を出力し、
  .rp-table / .rp-cards をCSSで出し分ける（768px以下はカード、印刷はテーブル）
  新しい表を足すときも rpBoth で包むこと
  ※ スマホで表の min-width を強制しないこと。包み忘れた表が画面からはみ出し、
    左端の科目名が見切れる。保険として .report-card table{table-layout:fixed} を入れてある
- ★ 売上の基準は2系統。混ぜないこと
  発生ベース（案件・monthlyBilling）… ダッシュボード／月次レポート／通年レポート／月次PL
    projectSalesAtAbsTotal / salesAtMonth / projectSalesAtAbs
  入金ベース（ledgerの売上区分）… CF管理のみ
    cfInflow / cfOutflow / cfPlannedIn / cfPlannedOut
  ※ 経費・役員報酬・税金はどちらのページでもCF管理（ledger の actual）が正
- ★ 表を追加するときはスマホ用のカードも用意すること（横スクロール禁止）
  `<div class="table-wrap mob-table">…</div>` と `<div id="○○-cards" class="mob-cards"></div>`
  を並べ、描画関数で両方に流し込む。769px以上＝表／768px以下＝カード／印刷＝表。
  月次レポートは同じ考え方の rp-table / rp-cards（rpBoth）を使う。
  ※カード側にもチェックボックスや入力欄が入る場合、DOMを querySelectorAll で
    数えると二重に数える。必ずデータ側（例：bankRows[i].checked）を正とすること。
