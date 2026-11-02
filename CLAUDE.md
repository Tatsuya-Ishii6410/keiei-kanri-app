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
- tests/debit-import.test.js：取込の判定のテスト。`node tests/debit-import.test.js` で実行する
- tests/invoice-drafts.test.js：請求書の下書き・訂正のテスト。`node tests/invoice-drafts.test.js` で実行する
- tests/receipt-import.test.js：領収書の読み取り・誰と／用件・重複判定のテスト（AIの呼び出しはモック）
- tests/inbox-scan.test.js：受信箱の週次読み取り・取込待ちからの登録・一括登録・重複判定のテスト（AI・Driveはモック）
- tests/ops-checks.test.js：週次バックアップ・入金遅延・月次締めチェックのテスト（Drive・GASはモック）
- tests/travel-suggest.test.js：交通費の訪問先の候補（駅名・訪問先の正規化・自宅駅の除外・並び順）・用件の選択式・帰りの行の自動入力・同じ区間の過去の運賃のテスト
- tests/dashboard-v2.test.js：新ダッシュボードの判定（達成率・マイルストーン・着地予測・KPI・ミッション）と期のKPI目標の往復のテスト
- tests/dashboard-v2-compare.html：新旧ダッシュボードの数字の突き合わせ（ブラウザで開く。手順は「新ダッシュボード」の節）
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
- 出金行は、同額で予定日が前後7日以内の出金予定（planned_out）を突合候補に出す（matchPlannedOut）。
  チェックしたまま登録すると、新しく追加せずにその予定を実績（actual・日付＝取引日）に変える。
  交通費精算（settlementMonth あり）は候補にしない（実績化すると交通費が二重に経費になるため）
- 文字コードは readCsvFile() が UTF-8 → Shift-JIS の順で自動判別する
- 区分の推測・重複判定・認証判定は keiei-kanri.html の「@import-rules-begin〜end」の範囲に集約
  （guessExpenseType / bankGuessType / bankDupFlags / isAuthLike / debitRowsFrom）。
  キーワードは NFKC正規化＋大文字化して部分一致で比べる（半角ｶﾅ・全角英字の表記ゆれを吸収）
  ★ この範囲はテストが切り出して Node で読むので、DOM や S を直接触らないこと（ledger は引数で渡す）
- 重複は2種類。dup＝同日・同金額・同摘要（従来）／mailDup＝同日×同金額のデビット通知取込済み経費
  （calId が 'mail:' で始まる actual の経費）。どちらもチェックOFF。
  mailDup はデビット通知とCSVで摘要の文言が違うため、従来の判定では二重計上になるのを防ぐ
- さらに mailNear＝同額で日付が前後1日のデビット通知取込済み経費（dayDiff、月・年またぎも1日差）。
  デビットの処理日とCSVの取引日が1日ずれることがあるため。
  「重複の可能性（メール取込 {日付}）」バッジ＋チェックOFF。別の利用ならユーザーがチェックして登録する
  同日同額は mailDup だけを立てる（mailNear と二重にしない）
- 10円以下の支出行には「認証の可能性」バッジ（CSVはチェックは外さない。口座から実際に出た記録のため）
- 登録したら bank.lastCsvImportDate を今日（ローカル日付）にする

### 銀行明細の最終取込日（ダッシュボード）
- ダッシュボードの期間メトリクスの下に「🏦 銀行明細 最終取込：{日付}」（renderBankImportStatus）
  7日超＝アンバー／14日超＝赤／未設定＝「未取込」赤
- state の bank.lastCsvImportDate、settingsシートは bank.lastCsvImportDate

## デビット通知から取込（CF管理）
- CF管理の「📧 デビット通知から取込」。GMOあおぞらネット銀行の
  「Visaデビットご利用のお知らせ」メールから経費の実績を作る
- ★ Gmailは読み取りのみ（GmailApp.search と getter だけ。ラベル変更・既読化・削除はしない）。
  メール本文はアプリに返さず、GASの debitMails（doGet）が抽出した
  messageId / datetime / amount / merchant / account だけを返す
  初回はGASエディタで testGmailAccess() を実行して権限を承認する
- 本文は「【ラベル】値」の行ごとに読み、値は改行まで（parseDebitMail_）。
  【ご利用店舗情報】のURLや【メモ欄】は店名に混ぜない。
  店名は NFKC正規化し、前後の空白と末尾の記号を外す（normalizeMerchant_。ＮＥＸＴ→NEXT）
- 金額・日時が取れないメール（為替差額の追加引落しなど）と差出人がGMOあおぞらでないメールは
  「読み取れなかったメール」として件名・受信日時だけを出す（buildDebitResult_）
- 期間は Gmail の after/before を1日広めに取り、本文の処理日時で絞る
- 外部IDは 'mail:{messageId}' を ledger の calId 列に入れる（列は増やさず流用）。
  登録済みの外部IDは取得時に除外する。同日×同金額の経費があれば「重複の可能性あり」でチェックOFF
- 区分は guessExpenseType（銀行明細と共通）。該当なしは「その他経費」＋「要確認」。
  10円以下は「認証の可能性」でチェックOFF
- 登録は status=actual・memo='メール取込'・摘要「{店名}（Visaデビット）」。残高予測の式は従来どおり
- mail.lastDebitSync は取込済みの最終日。既定の期間は「その翌日〜今日」（初回は当月1日〜）。
  ★ 今日の分はまだ通知が届くので、更新するのは最大でも昨日まで
  （今日にしてしまうと、翌日の既定期間から今日の残りの通知が漏れる。登録済みは外部IDで除外される）

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
  対象月は入金日の前月と推定（paymentBillingMonth）し、比較する金額は
  grossAmount(billingAmountForMonth(p, 対象月))。候補には「○月分・税込額」を出す
  登録時はその月の請求レコードも paid にし、入金予定を消す
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
- 収支入力モーダルの備考欄は、区分が「交際費」のときだけ placeholder を変える（同席者・目的は専用欄へ）

## 誰と・用件・人数（経費全般）
- ledger に withWhom（誰と：同席者・相手先）／persons（人数、交際費のみ）を持つ。用件は既存の purpose（交通費と共通）
  GASの ledger シートにも withWhom / persons 列がある（行の変換は ledgerRow_ / ledgerFromRow_）
- 収支入力モーダル（売上・入金予定以外で表示）、デビット通知・銀行CSVの取込プレビュー（交際費の行だけ）、
  領収書の確認画面、CF管理の一覧（摘要の下）、CF管理の「📥 CSV出力」に出す
- ★ 区分が「交際費」なら「誰と」「用件」は必須（expenseEntryError）。空だと保存・登録できない。
  人数を入れると1人あたり（perPersonAmount）を表示する
- 入力欄の候補は最近使った値（recentValues → datalist dl-with / dl-purpose）
- 収支一覧では摘要の下に小さいグレー文字で表示する
- 月次PL（Excel）では勘定科目ごとに備考を改行で連結して備考列に出す
  （改行を含むセルは wrapText を有効にする）

## 交通費の計算
- 収支入力で区分「交通費」を選ぶと計算パネルが出る（電車／バス／車）。摘要は「（電車）」「（バス）」「（車）12.3km」
- 運賃は GAS の fare アクション。claude-sonnet-4-6 の web_search（web_search_20260209）で
  ICカード運賃を調べ、回答から数値を取り出す。mode='バス' を渡すと路線バスの運賃を調べる（省略時は電車）
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
- 訪問先・用件は ledger の visit / purpose（任意）。摘要とは別に持つ（摘要の形式は変えない）
  GASの ledger シートにも visit / purpose 列がある。既存データは空のまま（摘要から推測しない）
- 並びは日付昇順・同日は id 昇順（sortTravel）。travelDayGroups() で日付ごとにまとめ、
  一覧・精算モーダル・PDFは日付セルを rowspan で結合する（その日の合計も出す）
  CSVだけは日付を全行に入れる（Excelの並べ替え・フィルター用）
- PDFは同日を1つの tbody にして break-inside:avoid、グレーの交互も日付グループ単位
- 到着が空、または金額0円の行は「⚠要編集」（needsTravelEdit）。「要編集のみ表示」で絞り込める
  台帳の編集モーダルは、既存行なら金額0円・区間なしでも保存できる（新規は従来どおり必須）

## カレンダーから交通費を作成（交通費台帳）
- 「📅 カレンダーから作成」。Googleカレンダーは読み取りのみ（GASの calendarEvents＝doGet）
  カレンダーIDは settings の travel.calendarId（既定 tatsuya-ishii@us-links.com、設定ページで変更可）
  初回はGASエディタで testCalendarAccess() を実行して権限を承認する
- eventId は「予定ID@日付」（繰り返し予定は同じIDを共有するため）。ledger の calId に保存し、
  登録済みの予定は次に取得したとき除外する
- 分類：A 場所あり（到着=場所、出発=モーダルで選んだ自宅駅（既定 青野ヶ原駅。HOME_STATIONS）・電車・往復が既定。手段は行ごとに変えられる）／
  B オンライン（タイトルに「オンライン」か、場所が空で説明に会議URL。折りたたみから復活可）／
  C 場所なし（出発・到着・手段・運賃・用件は空のまま）
- 訪問先の初期値は予定名から先頭の【…】［…］[…] だけ外したもの。名前の加工はしない
- 除外キーワード（既定 病院,クリニック,医院,内科,歯科）はチェックを外すだけで行は消さない
- 重複：同日×同到着、または同日×同金額の交通費があれば「登録済みの可能性」でチェックOFF
- 運賃は GAS の fareBatch（中身は既存の fareLookup_）。1回10区間まで、アプリが分割して呼ぶ
  キャッシュは settings の travel.fareCache（JSON、キー「出発|到着」＝片道）。
  fareBatch はシートに直接書き足し、writeAll_ はシート側にアプリ側を重ねて保存する（手修正が優先）
  信頼度は回答文から fareConfidence_ で判定（low=黄色）。往復は片道×2
- 場所なしで区間を入れなかった行は desc=「（未入力）」（TRAVEL_BLANK_DESC）・金額0円で登録する
  ★ GASの readLedger_ は desc が空の行を捨てるので、desc を空にしないこと
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
- ★ 請求・入金まわりの金額は getBillingForMonth(projectId, 'YYYY-MM') /
  billingAmountForMonth(p, ym) を使う（レコードの amount、無ければ projectDefaultMonthly）。
  p.amount / projectMonthAmount を直接使うと、月ごとに変えた金額が反映されない
  対象：入金確認（請求済のうち一番古い月）／一括請求書（billingYear()の年）／
  一括ステータス変更（billingYm(mi)）／addPlannedInForProject
- 一括請求書を作ると、その月のレコードも invoiced にして invoiceId・支払期限を入れ、
  入金予定を作る（invoiceStatusOf はレコードから導くため、p.invoiceStatus だけでは変わらない）
- ドライブ請求書同期は PDF の小計（税抜）をレコードの amount に反映する。
  同じ顧客の案件が複数あるときは1枚を分けられないので金額は触らない
- レコードの金額を変えたら syncPlannedInAmount() で作成済みの入金予定の金額も揃える
- ★ 入金実績を ledger に登録したら（入金確認・一括で入金済・銀行明細の突合）、
  removePlannedInForBilling(projectId, billingMonth) でその月の入金予定を自動削除する
  （残すと残高予測で二重計上になる）。planned_in を作るときは必ず billingMonth を持たせること
  billingMonth の無い古い予定は、摘要の「(YYYY年)M月分 入金予定」で月を見分けて消す

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
  移動手段は摘要の末尾「（電車）」などの括弧から取り出す（travelModeOf。旧「電車・バス」もそのまま出す）
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

## 請求書の下書き自動作成・編集（訂正・取消）
- quotes（請求書）の status：draft（下書き）／issued（発行済）／cancelled（取消）
  status の無い既存の書類は issued として扱う（normalizeQuoteDoc）。見積書は status を使わない
- 追加項目：revision（枝番。1＝原本）／history（訂正・取消の履歴、配列）／billingMonth（請求月 YYYY-MM）／
  billingKey（二重作成防止キー「請求月|取引先|案件id」）／cancelReason／issuedAt
  GASの quotes シートにも同じ列がある（history は JSON）。行の変換は quoteRow_ / quoteFromRow_
  古いデプロイで列が無くても keepLocalWhenMissing が手元の値を残す
- 判定は keiei-kanri.html の「@invoice-rules-begin〜end」に集約（テストが切り出して Node で読む）
  ★ この範囲は loadState()（mergeState）より前に置くこと。const が初期化前だと起動時に落ちる
  ★ DOM や S を直接触らない（projects / monthlyBillings / quotes は引数で渡す）

### 下書きの自動作成（アプリを開いたとき。GASのトリガーは使わない）
- bootApp で loadFromGAS().finally(checkInvoiceDraftsOnOpen)。1セッション1回
- 対象月は invoiceDetectYm(今日)：当月の月末3日前〜月末＝当月／翌月1〜10日＝前月／それ以外は検出しない
- 未作成＝missingInvoiceTargets：その月の請求レコード（金額>0）で案件が「進行中」「完了」（一括請求書と同じ）
  のうち、レコードが未請求で、invoiceId の請求書（取消以外）も、同じ billingKey・同じ請求月で同じ案件の
  明細を持つ請求書（下書き含む・取消除く）も無いもの。入金予定（planned_in）は発行後に作られるので対象の判定には使わない
- 確認ダイアログ［作成する］［今は作成しない（今日は再表示しない）］。後者は localStorage の
  bizapp_invoice_prompt_v1 に今日の日付を入れる（このブラウザだけ）
- 作成は createDraftInvoices：案件ごとに1通、請求日＝請求月の末日、支払期限＝レコードの入金予定日か翌月末。
  請求レコードの invoiceId に仮IDを入れるが、ステータスは未請求のまま
- ★ 請求書番号は「発行」で初めて振る（issueInvoiceDoc に makeDocNumber の番号を渡す）。
  下書きの id は仮ID「DRAFT-…」（newDraftId）で、画面・帳票の番号は空（invoiceDisplayNo が ''）、「下書き」とだけ出す。
  下書きを削除しても番号を消費していないので欠番は出ない。発行時に請求レコードの invoiceId も新番号へ付け替える
  （以前の版で番号付きのまま作られた下書きは、その番号のまま発行する）
- ダッシュボードの「🧾 請求書（○月分）：未作成○件／下書き○件」（renderInvoiceDocStatus）。
  検出期間外は当月を数える。押すと goToInvoices で請求書タブへ（下書きがあれば下書きで絞り込む）

### 編集
- 下書き：作成モーダルを編集モードで開き自由に書き換え・削除できる。「✅ 発行」で issued にし、
  紐づく請求レコードを請求済にして入金予定を作る（一括請求書と同じ）。下書きはPDF・HTML出力のボタンを出さない
- 発行済み：「✏️ 訂正」。理由必須。変更前・変更後・日時・理由を history に残し revision を上げる。
  番号（id）は変えず、表示は invoiceDisplayNo（INV-…-2）。帳票に「訂正版」の印。履歴は「🕘 履歴」
  単価・数量・月額固定・契約期間を変えていなければ金額は計算し直さない（一括請求書は切り捨てで1円ずれるため）
- 発行済み・取消済みは削除不可（canDeleteQuote）。「取消」で cancelled＋理由。既定で紐づく請求済レコードを
  未請求に戻して入金予定を消す（入金済みは触らない）
- 金額が変わったら confirm で、紐づく請求レコード（linkedBillingsOf）の金額と入金予定（syncPlannedInAmount）を更新する
- 一覧の合計は発行済みだけ。月次レポートの請求書発行状況も発行済みだけ

### ファイル名・PDF
- 請求書は「【アスリンク請求書（2026年11月）分】_株式会社○○御中」（invoiceFileName。年月は invoiceMonthOf＝
  billingMonth → 紐づく請求レコード → 請求日の月）。見積書は従来どおり
- 「🖨 PDFで保存（印刷）」は別ウィンドウに帳票を書き、フォント読み込み後に print。<title> をファイル名にしてあるので
  「PDFに保存」の既定名になる。HTMLダウンロードも同じ名前
- 帳票のフォントは DOC_JA_FONT（Noto Sans CJK JP → Webフォントの Noto Sans JP）。単体HTMLには DOC_FONT_LINK を入れる

## 領収書の写真から経費登録（CF管理）
- 「📷 領収書から登録」。タッチ端末（pointer:coarse）はカメラ（capture）、PCは画像選択（複数可・1回5枚まで）
- 写真はブラウザで縮小（長辺1600px・JPEG・品質0.8／shrinkReceiptImage）してから送る
- 読み取りは GAS の receiptRead（doPost）。claude-sonnet-4-6（ANTHROPIC_MODEL）に画像を渡し、
  日付・合計・支払先・但し書き・税込/税抜・税率別内訳・インボイス番号（T+13桁）・支払方法・区分の候補・
  項目ごとの確信度（高/中/低）を返す。★ 読めない項目は null／空のまま（プロンプトで推測を禁止し、
  normalizeReceipt_ も推測で埋めない）。区分は既存の経費区分（アプリが categories で渡す）にあるものだけ
- APIの失敗は apiErrorMessage_ で理由にする（クレジット不足・キー無効・上限・混雑）。画面に出して手入力で登録できる
- 確認画面は1枚ずつ。左に写真・右に入力欄。確信度「低」と空の日付・金額は黄色（rc-warn）
  合計と税額の整合は receiptTaxWarnings（税込：対象額の合計＝合計／税抜：対象額＋税額＝合計、1円までの差は許す）
- ★ 登録を押して初めて写真を保存（receiptSave）し ledger に入れる（status=actual、memo は「領収書取込」＋但し書き等）。
  スキップした写真は保存しない。保存先は「領収書/2026年11月」（スクリプト プロパティ RECEIPT_FOLDER_ID があればその下、
  無ければマイドライブ直下に「領収書」を作る）。ファイル名 YYYYMMDD_支払先_金額.jpg（receiptFileName_）
  写真の保存に失敗したら、写真なしで登録するか聞く
- ledger の receiptId にファイルID、calId に外部ID 'rcpt:{ファイルID}'。一覧の 📷 からドライブの写真を開く。
  経費を削除してもドライブの写真は消さない
- 重複：receiptDupOf＝同額で日付が前後1日以内の経費（実績・売上以外。手入力・デビット通知・銀行CSV・領収書すべて）。
  あれば「重複の可能性」でチェックOFF。判定は nearExpenses を銀行CSVの mailNear と共通で使う
- 初回はGASエディタで testReceiptFolder() を実行して、フォルダ作成ができることを確認する

## 受信箱フォルダの週次読み取り（取込待ち）
- 設定ページの「📥 受信箱フォルダ」に「領収書」「受取請求書」のフォルダURL（またはID）を貼る。
  アプリはURLからIDを取り出して（driveFolderIdFrom）settings の inboxFolders.receipt / inboxFolders.invoice に保存する。
  フォルダ名はハードコードしない。2つに同じフォルダは指定できない
- ★ 受信箱と「📷 領収書から登録」の保存先（領収書/年月）は別フォルダ。receiptRootFolder_ は「領収書」という名前の
  フォルダを探すとき、受信箱に指定したフォルダを飛ばす。受信箱は直下のファイルだけを読む（サブフォルダは見ない）
- GAS：weeklyInboxScan()。毎週月曜 7〜8時の時間トリガーは GASエディタで setupWeeklyTrigger() を1回実行して作る
  （すでにあれば作らない）。止めるときは deleteWeeklyTrigger()。アプリの「📥 今すぐ読み取る」（action inboxScan）も同じ関数
- 1回で読むのは8ファイルまで（INBOX_MAX_PER_RUN。GASの6分制限）。残りは次の実行へ（結果の remaining）。新しいファイルが先、
  失敗したファイルの読み直しは後。二重実行はスクリプト プロパティ INBOX_SCAN_RUNNING で防ぐ（保存用のロックは長く握らない）
- 対象は JPEG・PNG・PDF。それ以外（HEICなど）と4MB超はAIを呼ばず status=unsupported＋理由で取込待ちに出す
- AIは callClaude_（ドライブ経費取込・領収書・受信箱で共通）。領収書は receiptPrompt_ / parseReceiptReply_（写真の領収書と同じ項目）、
  受取請求書は payablePrompt_ / parsePayableReply_（請求元・請求書番号・請求日・支払期限・請求金額（税込）・税額・
  インボイス登録番号・内容・区分・確信度）。★ 読めない項目は null／空のまま（推測しない）
- 結果は inbox シート（取込待ち）：fileId / kind（領収書・受取請求書）/ fileName / mimeType / data（抽出JSON）/
  confidence（大事な項目のいちばん低い確信度。inboxConfidence_）/ status / error（失敗理由）/ readAt / retries / folderId /
  doneName / updatedAt。status は ready（読み取り済み）・failed・unsupported・registered・skipped
  ★ inbox シートは SHEET_DEFS に入れない（writeAll_ の全置換で消えないように）。足りない列は右端に足すだけ（inboxSheet_）
- 同じファイルを2回読まない：inbox シートにある行（状態を問わず）と、受信箱の「処理済み」サブフォルダにあるファイルは読まない
  （planInboxScan_）。失敗した行だけ読み直す。読み直し（自動・アプリの「🔄 読み直す」＝inboxRetry）は3回まで
- 走査の本体 runInboxScan_ は Drive・シート・AI を io で受け取る（テストでモックにするため）
- ★ GASがするのは受信箱の読み取り・「処理済み」への移動と名前の変更・inbox シートへの書き込みだけ。ファイルは削除しない
- アプリ：ダッシュボード「📥 取込待ち ○件」（renderInboxStatus）と CF管理の「📥 取込待ち」で一覧（modal-inbox）。
  一覧は load の inboxItems（開いたとき inboxList で読み直す）。S には入れない（inboxItems はグローバル変数）
- 確認画面は領収書の写真の確認画面（modal-receipt / rcQueue / renderReceipt）を流用。src:'inbox' の項目は
  左に Drive のプレビュー（iframe）、受取請求書は入力欄を切り替える（請求元・請求書番号・請求日・支払期限・請求金額・税額）。
  支払期限が空・確信度「低」は黄色。誰と・用件・人数も入れられる（交際費は必須のまま）
- 登録（inboxLedgerEntry）：領収書＝経費の実績（memo「領収書取込…」）／受取請求書＝ status=planned_out・
  expectedDate＝支払期限・date＝請求日（無ければ支払期限）・projectId 空。どちらも receiptId＝ファイルID、
  calId＝'rcpt:{ファイルID}'、payee（請求元・支払先）、docNo（請求書番号）。ledger シートに payee / docNo 列がある
- 登録・スキップしたら inboxDone で受信箱の「処理済み」（無ければ作る）へ移動し、名前を YYYYMMDD_支払先_金額.拡張子にする
  （inboxDoneName_。日付も金額も無ければ元の名前）。「あとで（次へ）」は何もしない。「✍ 手入力に切り替え」は空欄から入力
- 「確信度が高のものを一括登録」（inboxBulkBlocker が空のもの）。対象外：確信度が高でない／金額・日付が空／
  受取請求書で支払期限が空／交際費／重複の可能性／登録済み
- 重複：領収書は receiptDupOf（同額・前後1日。デビット通知・銀行CSVの経費も）。受取請求書は payableDupOf
  （同じ請求元で、同じ請求書番号、または同額・同じ月）。どちらも「重複の可能性」でチェックOFF
- 受取請求書の出金予定は、銀行明細CSVの出金と突合できる（matchPlannedOut。「銀行明細CSV取込」の節）

## スプレッドシートの週次バックアップ
- GAS：weeklyBackup()。データのスプレッドシート全体を、マイドライブ直下の「経営管理アプリ_バックアップ」（無ければ作る）に
  「appデータ_YYYYMMDD_HHmm」でコピーする（makeCopy）
- 世代管理：直近8件（BACKUP_KEEP）を残し、古いものはゴミ箱へ（setTrashed。完全削除はしない）
  ★ 対象は「そのフォルダの直下にある、名前が BACKUP_NAME_RE（appデータ_8桁_4桁）に合うスプレッドシート」だけ
  （backupTrashTargets_）。ほかのファイルには触らない
- 時間トリガー：毎週日曜 21〜22時。GASエディタで setupBackupTrigger() を1回実行して作る（同じ関数のトリガーがあれば作らない）。
  止めるときは removeBackupTrigger()。トリガーの作成・削除は ensureWeeklyTrigger_ / removeTriggers_（受信箱の週次読み取りと共通）
- 本体 runBackup_ は Drive を io で受け取る（テストでモックにするため）
- 結果は settings シートの backup.lastAt（'YYYY-MM-DD HH:mm'）/ backup.lastFile / backup.lastError / backup.lastErrorAt。
  失敗（容量不足・権限など）は backupErrorMessage_ で理由にして lastError に入れる（前回の成功の lastAt は残す）
  書き込みは setSettingValues_（その行だけ書き換え。スクリプトロックを取る）
  ★ writeAll_ は backup.* をアプリの値ではなくシート側の値のまま書き戻す（アプリの保存で記録が消えない・古い値で上書きしない）
- アプリ：ダッシュボードの「💾 最終バックアップ：○月○日」（renderBackupStatus / backupStatusOf）。10日超＝アンバー／
  20日超・未実行＝赤。失敗していれば理由を赤で出す（失敗のあとで成功していれば出さない）
  「💾 今すぐバックアップ」は action backupNow（中身は weeklyBackup）
- 判定は keiei-kanri.html の「@ops-rules-begin〜end」に集約（テストが @import-rules と一緒に切り出して Node で読む。DOM・S を触らない）

## 入金遅延アラート
- 定義：status='planned_in' で、予定日（expectedDate、無ければ date）が今日より前のもの（overdueReceivables）。当日はまだ遅延ではない
  ★ 取消した請求書の入金予定は対象外。紐づく請求書（請求レコードの invoiceId、または同じ請求月で同じ案件の明細を持つ請求書）が
  すべて取消のとき外す（取消で入金予定を残す選択をしたときのため）。発行し直した請求書があれば、そちらの番号で出す
- ダッシュボードの「⏰ 入金遅延 ○件・合計 ¥○」（赤。renderOverdueStatus）。0件なら「なし」。押すと一覧（modal-overdue）
- 一覧：取引先（案件の取引先 → 請求書の宛名 → 摘要）・請求書番号（訂正版は枝番つき）・金額・入金予定日・遅延日数。遅延日数の長い順
  色分けは overdueLevel：1〜7日＝アンバー／8〜30日＝赤／31日以上＝赤・太字・行を赤背景（既存の badge-amber / badge-red / --red-bg）
- 操作
  - 「入金済みにする」：CF管理の「✓ 実績に変換」と同じ openPlanConfirm → confirmPlanned（別の処理は作らない）
  - 「予定日を変更」：新しい日付（今日以降）と理由が必須（reschedulePlannedIn）。expectedDate と date を変え、
    備考に「【予定日変更 変更日】元→新：理由」を足していく。請求レコードの expectedPayDate も揃える
  - 「催促文をコピー」：ひな形（settings の reminder.template。空なら REMINDER_TEMPLATE_DEFAULT）に
    {宛名} {請求書番号} {金額} {期日} {遅延日数} {会社名} を差し込んでクリップボードへ（fillReminder）。メールは送らない
    ひな形は設定ページの「✉ 入金の催促文（ひな形）」で編集する。初期の文面と同じなら空で保存する

## 月次締めチェック
- 画面「月次締め」（page-close。ナビには出さない）。ダッシュボードの「✅ 月次締め（前月分）：未解決 ○件」から開く（openClosePage）。
  ★ ナビ（.nav-btn）は増やしていない（goToInvoiced などが添字で参照しているため）
- 対象月はセレクト（今月〜24ヶ月前）。初期値は前月。上部に「未解決 ○件」（要対応の項目数）
- 項目は closeChecks（@ops-rules）。状態は ok（緑）／ng＝要対応（赤）／info＝参考（灰。未解決に数えない）。押すと該当の一覧へ
  1. 請求書：未作成（missingInvoiceTargets）＋下書きのまま（請求月＝invoiceMonthOf が対象月）→ 請求書タブ
  2. 入金遅延（今日時点。overdueReceivables）→ 入金遅延の一覧
  3. 出金予定の支払期限超過（今日時点。overduePayables）→ 一覧（modal-close-list）
  4. 交通費：要編集（needsTravelEdit）→ 交通費台帳（対象月・要編集のみ）／精算がまだ（交通費があり、settlementFor が無く、月が終わっている）
  5. 交際費で「誰と」「用件」が空（entertainMissingIn）→ 一覧
  6. 「認証の可能性」「重複の可能性」が未解決（reviewCandidates）→ 一覧（下記）
  7. 銀行明細の最終取込日（bank.lastCsvImportDate）が対象月の末日より前、または未取込 → CSV取込（銀行明細）
  8. 取込待ち（inboxItems の件数）→ 取込待ちの一覧。★ 機能がある場合だけ出す（closeChecks の features.inbox）
  9. 参考：領収書の写真リンク（receiptId）がない経費（交通費は除く）→ 一覧
- 「この月の確認を完了」で settings の monthClose.YYYY-MM に日時（'YYYY-MM-DD HH:mm'）を保存し「確認済み（日時）」と出す。
  未解決があれば確認してから。月のロック（編集禁止）はしない

### 認証・重複の可能性（項目6）
- 取込の画面の印は ledger に残らないので、収支から計算し直す（reviewCandidates）
- 認証の可能性：10円以下の経費（実績）。確認済みは除く
- 重複の可能性：同額で日付が前後1日以内の経費2件のうち、すべて満たすものだけ
  区分が交通費でない／金額100円以上／片方がメール取込・領収書取込・銀行明細CSVで、もう片方と取込元が違う
- 取込元は ledgerSourceOf：calId の接頭辞 mail: / rcpt: / bank:、備考の先頭「メール取込」「領収書取込」。
  それ以外の calId はカレンダー、fixedCostId は固定費、残りは手入力など
  ★ 銀行明細CSVの登録に calId 'bank:{日付}|{金額}'（bankExtId）を付けるようにした。外部IDとしての一意性は持たない（判定にだけ使う）。
  それより前に登録した銀行明細の行は見分けられないので「手入力など」として扱う（銀行どうし・手入力との組は数えない）
- 確認済みの印は ledger の reviewed 列（確認した日）。ペアは両方に付ける（setReviewed）。2件とも確認済みのペアだけ解決扱い
  （確認済みの行と別の行が新しく組になれば、また出る）。一覧の「確認済みも表示」から解除できる
- 一覧ではペアの2行を並べ、それぞれ「編集」「削除」（deleteLedger）を出す
- GASの ledger シートに reviewed 列（TEXT_COLUMNS）。keepLocalWhenMissing でも残す

## 自宅駅（HOME_STATIONS）
- ★ 自宅駅は keiei-kanri.html の「@travel-rules-begin」の直後にある `HOME_STATIONS=['青野ヶ原駅','天神橋筋六丁目駅']` の1か所だけ。
  変える・増やすときはここだけ直す（settings には持たない）
- 参照しているところ：カレンダーから作成の出発駅（CAL_DEFAULT_FROM＝HOME_STATIONS[0]。モーダルの「出発駅」セレクト ci-home の初期値）／
  交通費の入力モーダルの自宅駅ボタン（te-home-btns。押すと出発地に入る）／訪問先の候補（自宅駅の判定 isHomeStation）
- 比較は normStation（NFKC・空白を除く・末尾の「駅」を外す）で行う。「天神橋筋六丁目」と「天神橋筋六丁目駅」は同じ
- カレンダーから作成で出発駅を変えると、出発地が自宅駅のままの行だけ新しい駅にする（手で変えた出発地は触らない。推定運賃は消す）

## 交通費：訪問先の候補（到着駅から過去の訪問先を選ぶ）
- 交通費の入力モーダル（openTravelEntry。カレンダーから作った要編集の行の編集も同じ）の訪問先欄 te-visit を候補つきにする
- 候補は保存しない。実績の交通費の行から実行時に集計する（buildVisitIndex）。対象外：訪問先が空・「（未入力）」、摘要が「（未入力）」、予定の行
  集計は saveState（travelIndexDirty）と読み込み（S.ledger が替わる）のあと、モーダルを開いたときに1回だけ作り直す
- 訪問先側の駅（visitSideStation）：出発・到着のうち自宅駅でない方。両方とも自宅駅でなければ到着。
  両方とも自宅駅（自宅駅どうし）は集計しない。帰りの行（到着が自宅駅）は出発駅になる
- 訪問先は normVisit でまとめる（NFKC・空白、前後の「株式会社」「(株)」「㈱」、末尾の「様」「御中」を除いて比べる）。
  表示はいちばん使われている表記（同数なら最近）
- 候補は2段：「この駅の訪問先」（visitSuggestions。最大8件・回数の多い順、同数は最近の順。「5回・最終 10/28」を併記）／
  「取引先から」（clientSuggestions。案件の取引先名で1段目と重複しないもの。新しい案件から最大5件）。駅が空・駅の候補なしは2段目だけ
- 訪問先を選んで用件が未選択なら、前回の用件を薄く出す（「交通費の用件（選択式）」の節）
- 判定は「@travel-rules-begin〜end」（tests/travel-suggest.test.js が切り出して読む。DOM・S を触らない。TRAVEL_BLANK_DESC もここ）

## 部品：候補つき入力欄 suggestCombo
- suggestCombo(input,{sections,onPick}) → {open,close,isOpen}。交通費専用にしない（ほかの欄にも使える）
  sections() は開くたびに呼ぶ [{title,items:[{value,label,meta}]}]。入力中の文字で絞り込む
- 欄のタップ・フォーカスで開く。↑↓で選択・Enterで決定・Escで閉じる・外を押すと閉じる。候補が1件も無ければ何も出さない（普通の入力欄）
- 見た目は CSS 変数 --ui-*（背景 #FFFFFF／本文 #17233D／補助 #64748B／強調 #3976F6／リストの角丸 12px など）。
  ★ 変数は .ui-scope（部品の外枠）の中だけで定義する。既存の画面の色は変えない（今後のデザイン刷新用）
- 件数・日付は tabular-nums。開閉は150ms、prefers-reduced-motion のときはアニメーションなし。768px以下は候補の高さ44px以上

## 交通費の用件（選択式）
- 対象は交通費の入力モーダル（openTravelEntry / saveTravelEntry）の用件だけ。★ 経費（交際費など）の用件は自由入力のまま
- 選択肢は TRAVEL_PURPOSES（打ち合わせ・商談・現地作業・帰宅）＋「その他」（@travel-rules）。横並びのチップ（te-purpose-chips）で1つ選ぶ。
  もう一度押すと外れる（未選択でも保存できる）。「その他」のときだけ下に自由入力（te-purpose-other）を出す
- 保存は purpose 列に文字列のまま（列は増やさない）：選択肢 → その文字列／その他 → 「その他：○○」（purposeFromState）。
  「その他」でテキストが空なら保存しない（理由を alert）
- 復元（purposeToState）：選択肢と一致 → そのチップ／「その他：」で始まる → その他＋続きの文字列／
  それ以外（これまでの自由入力）→ その他＋元の文字列。既存データは編集して保存し直すまで書き換えない
- 一覧・スマホのカード・PDF・CSV・精算モーダルは purpose をそのまま表示する（変更なし）
- 訪問先を選んで用件が未選択なら、その訪問先の最後の用件を「前回：○○」として薄く出す（travelPurposeHintFor）。
  最後の用件が選択肢と一致するときだけ。タップで選ぶ（自動では選ばない）
- 見た目は部品の選択チップ（.ui-chips / .ui-chip。--ui- 変数を使う）：通常は白背景に薄い境界、選択中は強調色 #3976F6 の背景に白文字・太字
  （色だけに頼らない）。高さ44px以上、480px以下は文字12pxで1行に収める。切り替えは150ms、prefers-reduced-motion のときはなし

## 交通費：帰りの行の自動入力（訪問先＝自宅、用件＝帰宅）
- 用件の選択肢は 打ち合わせ／商談／現地作業／帰宅（TRAVEL_PURPOSES）＋その他。「帰宅」はそのまま「帰宅」で保存・復元する。
  チップは折り返してよい（.ui-chips は flex-wrap:wrap。各ボタン44px以上）
- 交通費の入力モーダルで出発地・到着地が変わったとき（travelStationChanged）、帰りの行（isReturnTrip：到着が HOME_STATIONS のどれかで、
  出発が空でなく自宅駅でもない）なら applyReturnAutofill で、空の訪問先に「自宅」（VISIT_HOME）、未選択の用件に「帰宅」（PURPOSE_HOME）を入れる。
  2つの欄は別々に判定し、入っている欄は上書きしない。自宅駅どうしの移動では入れない
- 自動入力かどうかはモーダルの中の travelAuto で持つ（保存しない）。訪問先を手で入力・候補から選ぶ、用件のチップを押すと、その欄は自動入力ではなくなる。
  帰りの行でなくなったら、自動入力のままの欄だけ空に戻す（手で触った欄は消さない）
- ★ モーダルを開いたときは自動入力しない（過去の行は書き換えない。一括で入力する処理も作らない）
- 帰りの行では訪問先の候補を自動で開かない（開いていれば閉じる）。欄をタップすれば、これまでどおり出発駅から候補を引く
- 訪問先が「自宅」（isHomeVisit。normVisit で比べる）の行は候補の集計に入れず、取引先の候補にも出さない。
  過去の帰りの行（訪問先が出発地の訪問先）はこれまでどおり集計する。「前回の用件」の提案に「帰宅」は出さない（travelPurposeHintFor）
- 月次締めの「要編集」（needsTravelEdit）は到着と金額だけを見るので、訪問先「自宅」・用件「帰宅」の行は要編集に数えない（変更なし）
- 一覧・スマホのカード・PDF・CSV・精算モーダルは保存した値をそのまま出す（変更なし）

## 交通費：同じ区間の過去の運賃を自動で反映
- 参照元（pastFares。@travel-rules。保存データは増やさない）：同じ出発駅・到着駅（normStation）・同じ運賃の手段（電車／バス。rowFareModeOf）の、
  実績の交通費で金額が0より大きい行。タクシー・車・その他・手段が空の行は反映しない。予定の行・摘要「（未入力）」は除く。金額は片道（往復の行は半分）
- ★ AI推定のまま人が確認していない運賃は参照元にしない（isFareConfirmed）。
  カレンダーから作った行（isCalendarTravel：calId が予定ID。mail: / rcpt: / bank: ではない）は、運賃キャッシュ travel.fareCache の
  その区間が confidence='manual' で片道の金額が一致するときだけ確認済み。それ以外の行（手入力・入力モーダルで追加）は確認済み
  キャッシュのキーは入力どおりなので、normFareCache で駅名（と手段）をそろえて引く
- 同じ区間に複数の金額 → 新しい順に最大3つ（先頭を採用）。逆区間は電車だけ、同じ区間の行が1件も無いときだけ参照する（バスは同じ区間だけ）
- 入力モーダル（fareAutofill。状態 travelFare はモーダルの中だけ）：出発・到着・手段が変わったとき、運賃が空・0円か自動反映のままなら入れる。
  手で入れた運賃は上書きしない。参照元が無くなったら自動反映のままの金額だけ空に戻す。往復で登録済みの行（editTravelRound）は2倍で入れる
  運賃の下に「過去の運賃：230円（最終 10/28）」／「逆区間から参照（最終 10/28）」、金額が複数なら「230円 ／ 210円」のボタン（タップで差し替え）。
  運賃欄を手で書き換えると表示を消す。0円のまま開いた行（カレンダーの要編集など）も、区間が入っていれば開いたときに入れる（保存するまで台帳は変えない）
- 運賃の確認（カレンダーから作った行だけ）：開いたとき運賃が未確認なら「運賃：推定（未確認）」と「✓ 運賃を確認した」を出す。
  キャッシュをその区間の manual（片道の金額。confirmFareInCache。同じ区間の既存キーがあればそれを書き換える）にするのは、
  運賃欄を手で書き換えて保存したとき、または「運賃を確認した」を押して保存したときだけ（shouldConfirmFare）。
  到着地や訪問先だけを直した保存は確認とみなさない。manual のキャッシュと金額が一致する行は最初から確認済み（表示なし）
- カレンダーからの「🔍 運賃を計算」（calcFareSources）：1. 過去の実績（信頼度「高」）→ 2. 運賃キャッシュ → 3. AI検索（fareBatch）の順。
  1・2で取れた行は AI検索に回さない（GASの6分制限・API費用）。プレビューの運賃の下に出どころ（過去実績／キャッシュ／検索）を出す
  過去実績から入れた運賃はキャッシュに書かない（キャッシュは検索結果と人の確認だけ）
- GASの変更はなし（運賃キャッシュは writeAll_ がシート側にアプリ側を重ねて保存する。これまでどおり）

## 交通費の移動手段（電車／バス）
- 手段は摘要「出発→到着（手段）」の括弧の中（列は持たない）。新しく入力できるのは TRAVEL_MODES＝電車／バス／タクシー／車／その他
  （交通費の入力モーダル・カレンダーから作成のプレビュー）。収支入力モーダルの計算パネルは 電車／バス／車
- ★ 旧「電車・バス」（LEGACY_TRAIN_BUS）は選べない。保存済みの行は書き換えない。入力モーダルで旧の行を開いたときだけ
  選択肢に「電車・バス（旧）」を出し（travelModeChoices）、そのまま保存しても値は変わらない。電車かバスを選んだときだけ変わる
- 摘要は buildTravelDesc で作る（入力モーダル・カレンダーの登録・計算パネル）。カレンダーから作成の手段の初期値は「電車」
- 運賃の手段（fareModeOf / rowFareModeOf）：電車・バスを選んだ行はそのまま。旧「電車・バス」と「（電車）」の過去の行
  （収支入力モーダルから登録したもの）は、駅名に「バス」「停留所」があればバス、それ以外は電車（guessTrainOrBus）。
  タクシー・車・その他・手段が空の行は運賃の対象外。収支入力モーダルの「（電車）」の行も確認済みとして参照元に入れる。「（車）」は入れない
- 運賃検索（入力モーダル・計算パネル・カレンダーの fareBatch）は電車・バス・旧「電車・バス」が対象。GASに mode（電車／バス）を渡す。
  カレンダーの fareBatch は結果を送った順で受け取り、キーは送った側で決める（古いデプロイは mode を返さないため）
- 運賃キャッシュ travel.fareCache のキー：電車「出発|到着」（これまでのキー。既存のキーは電車として読む。移し替えなし）／
  バス「出発|到着|バス」（fareCacheKey。GASの fareBatch_ も同じ）
- 交通費台帳の「🔀 旧「電車・バス」の手段を整理」（任意の操作）：旧「電車・バス」の実績の行を一覧にし、行ごとに電車／バスを提案（legacyModeRows）。
  精算（settlementMonth）が登録されている月の行と日付が読めない行は対象外（安全側）。「適用」で件数を確認してから、
  摘要の（手段）だけを書き換える（relabelTravelMode。往復の印・区間はそのまま）。適用するまでデータは変えない
- 一覧・スマホのカード・PDF・CSV・精算モーダル・月次締めは、保存された手段をそのまま表示する

## 新ダッシュボード（デザイン刷新・第1段階）
- ダッシュボードのページだけ。サイドバー・他のタブ・モーダルは変えていない。見た目は .dash-v2（.ui-scope）の中だけに効かせる
- 右上の「旧ダッシュボードに切り替え」／旧の「✨ 新ダッシュボードに切り替え」で切り替える。どちらを出すかは
  このブラウザの localStorage（bizapp_dash_version_v1）に記憶（既定は新）。setDashVersion / initDashVersion
- ★ 旧の表示項目は消していない。要素ごと新画面の枠へ移す（placeDashboard）。中身を描く関数・押したときの遷移先は旧のまま
  #dv-status（状態の行6つ：銀行明細・バックアップ・入金遅延・月次締め・取込待ち・請求書）→「要対応」の帯
  #dv-metrics（メトリクス7枚）→ 帯の「詳細指標」／ #dv-summary（期間サマリー）・#dv-rest（計画差異・月次推移・進行中の案件・更新アラート）→ 下の「旧ダッシュボードの詳細」
  旧に戻すと #dvh-* の元の場所に戻る。月次推移の Canvas は「詳細」を開いたときに描き直す
- ★ 数字は既存の関数だけ。dashMonthNumbers(abs)＝projectSalesAtAbsTotal＋sumLedgerAbs＋operatingProfit
  （旧の updateDashboard もこれを使うので、旧の「売上」「営業利益」と新のKPIは必ず一致する）。
  期の累計・達成率＝fiscalTotals(fy).sales と pct()（期間サマリーと同じ）。入金待ち＝awaitingPayment、入金遅延＝overdueNow、
  未作成の請求書＝missingInvoiceTargets（renderInvoiceDocStatus と同じ請求月）、月次締め＝closeChecksFor(前月)、取込待ち＝inboxItems
- 期・月のセレクトは旧の #fiscal-select / #month-select が正。新画面のセレクトは写し（dv2SyncSelects / dv2SetPeriod）
- ヘッダー：あいさつ（dashGreeting）・一言（dashHeadline：入金遅延 → 前月比±5%）・🔔要対応の件数（未完了のミッション。売上目標は除く）・
  代表者名（company.rep）の頭文字
- ヒーロー（山頂）：山頂＝選択中の期の売上目標（fiscalYears.salesTarget。新しい設定は作らない）。未設定なら「期の設定で目標を入れる」（dv2GoFiscal）
  ★ 達成率は確定ベース：達成率・現在地・マイルストーン（25・50・75・100%）のチェック・KPIの「売上目標達成率（確定）」・
  ミッションの「売上目標まであと○円」・100%のお祝いは、すべて確定の累計 ÷ 目標（heroProgress。pct で小数1桁）
  確定＝期首から当月まで（売上・利益の推移の「実績」と同じ。forecastSplit）、予測＝翌月から期末の契約の予定額
  ★ 予測込みは「着地見込み」：（確定＋予測）÷ 目標。期間サマリーの達成率と同じ値。山頂のイラストでは点線の中抜きマーカー
  表記は「確定の累計」。確定と予測の内訳を色とラベルで出す。マイルストーンの文字はマーカーと重ならない側へ（msLabelPos）
  お祝いは確定が100%に達したとき、期ごとに1回（localStorage）・動きを減らす設定では出さない
- KPIカード4枚：月間売上・営業利益（前月比）、売上目標達成率（確定。下に着地見込み）、現預金残高（bankBalance。履歴が無いので推移・前月比は「推移データなし」）。
  対象月が当月なら、営業利益に「月途中（経費は入力済みの分のみ）」と出し、前月比は色・矢印を付けない（dv2DeltaQuiet）。
  ★ 残高は数値で保存している（アプリ parseInt||0、GAS num_）ので、未設定と0円を区別できない。0 は「未設定（または0円）」と出し、
  CF管理の口座残高へ案内する（dv2GoCash）。区別するには保存形式の変更が必要
  小さな推移グラフは直近6か月（SVG）。押すと案件／CF管理／レポートの案件予実／CF管理へ。「計算根拠」で期間と使った項目を出す。
  カウントアップは400ms・1回だけ（dv2Counted）
- 売上・利益の推移（SVG）：縦軸は0を含む区切りのよい目盛り（niceAxis。4〜6区切りでいちばん幅の狭いもの）、棒は0の線から。
  12か月＝選択中の期の月、6か月＝選択中の月までの6か月。当月より後の月は「予測」（契約の予定額）として色と「*」で分ける。
  営業利益の線は実績の月だけ。前年同月（projectSalesAtAbsTotal(abs-12)）は、どこかの月にデータがあるときだけ出す（無ければ「データ不足」）
- 重要KPI（@dash-rules）：新規顧客数（newCustomerCount：期に初めて受注案件が始まった取引先。normClientName で表記ゆれをまとめる）、
  継続率（retentionRate：前の期に売上があった取引先のうち今期も売上がある割合。前の期が無ければデータ不足）、
  成約率（winRate：(契約済＋進行中＋完了)÷(＋失注)、開始月で期に絞る。★ 失注が0件なら「データ不足（失注の記録なし）」）。
  目標は期の newCustomerTarget / retentionTarget / winRateTarget（任意。空なら「目標未設定」でリングを描かない）。ringState で色と文字（達成・あと少し・要注意）
- 着地予測：案件ベースだけ（入金予定は混ぜない）。確定（当月まで）＋予測（翌月から期末：請求レコード、無い月は案件の月額）＝fiscalTotals と同じ合計。
  統計的な外挿はしない。「予測の前提」で範囲と元データを出す
- 経営ミッション（dashMissions）：売上目標まであと○円／入金遅延／未作成の請求書／取込待ち／月次締めの未解決。件数は上の既存の集計をそのまま渡す
- 自動チェックのひとこと（dashAdvice）：前月比・入金待ち・入金遅延・確定売上のペース（期の経過と比べる）。「自動チェック（AI分析ではありません）」と出す
- 期の設定（modal-fiscal）に「新規顧客目標数」「継続率目標（%）」「成約率目標（%）」。GASの fiscalYears シートに列を足した（optNum_：空は空のまま、小数可）
- --ui- 変数は .ui-scope に足した（--ui-page / --ui-purple / --ui-good* / --ui-caution* / --ui-warn* / --ui-plan* / --ui-radius-card / --ui-shadow-card /
  --ui-border-solid / --ui-line）
- 表示の文言は「要対応・状況」「詳細指標」「詳細データ」（「旧ダッシュボード」と出すのは切り替えボタンだけ）
- ★ iOS Safari 対策：要対応の帯は不透明の1色の枠＋左の帯を inset の影で描く（太さの違う半透明の枠線を角丸で重ねると、角に暗い曲線が出るため）。
  区切り線も不透明の実線。.dash-v2 の button / select は -webkit-appearance:none（既定の影・グラデーションを出さない）。
  「→ 一覧へ」などの矢印リンクとバッジは折り返さず1つのかたまりで次の行へ
- テスト：tests/dashboard-v2.test.js（@dash-rules と GAS の期の往復）。新旧の数字の突き合わせは tests/dashboard-v2-compare.html
  （リポジトリ直下で `python -m http.server 8765` → http://localhost:8765/tests/dashboard-v2-compare.html。GAS_URL を空にして読むのでシートには触らない。
  ?narrow でスマホ幅、?tall で縦長）
