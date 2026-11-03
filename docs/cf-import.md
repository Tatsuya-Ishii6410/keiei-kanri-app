# CF管理と取込（固定費・ドライブ・銀行CSV・デビット・領収書・受信箱・経費の項目）

（CLAUDE.md から移した詳しい仕様。作業の決まり・目次は CLAUDE.md の先頭）

## 固定費（収支管理）
- 収支管理の「🔁 固定費管理」で登録。fixedCosts に {id,type,desc,amount,startMonth,endMonth,enabled}
- 収支ページを開いたとき、または「固定費を反映」で、開始月〜今月のうち
  未登録の月を ledger に自動追加する（計上日はその月の末日）
- 重複防止は ledger の fixedCostId と年月の組み合わせで判定するため、
  ledger シートの fixedCostId 列は消さないこと
- 自動追加された収支を削除しても、次に反映したとき再作成される。
  止めたいときは固定費を無効にするか終了月を設定する

## ドライブ経費取込（CF管理の「ドライブから取込」）
- ★ 2026-11-03から、週次の取込（受信箱フォルダの読み取り）の入口。処理は「今すぐ読み取る」と共通（callInboxScan → GASの inboxScan＝weeklyInboxScan）。
  結果は取込待ち（inbox シート）に入り、登録は取込待ちの一覧から（領収書→実績、受取請求書→出金予定）。登録・スキップしたファイルは受信箱の「処理済み」フォルダへ
  移り、名前は YYYYMMDD_支払先_金額（inboxDone。「受信箱フォルダの週次読み取り」の節）
- フォルダは settings の inboxFolders.receipt / inboxFolders.invoice（設定ページの「受信箱フォルダ」）。モーダルにはその2つのリンク（renderDriveFolders）。
  未設定なら「設定でフォルダを指定してください」と設定への導線（goInboxSettings）。結果は「領収書 N件／受取請求書 N件・取込待ち N件」（inboxCounts。取込待ちの一覧と同じ inboxItems を数える）
- 旧フォルダ（アスリンク_経費取込フォルダ 1YLUeZuWj6QAVWaXAOLaKE5sZXz4NQhxA。GASの EXPENSE_FOLDER_ID とモーダルのリンクは残してある）は、
  未処理（名前が「処理済み_」で始まらない）のファイルがあるときだけ、リンクと件数と「新しい領収書フォルダへ移してください」を出す（driveOldCheck。driveList で数える）
- GASの変更はなし（inboxScan / inboxList / driveList は既存のまま。driveExtract / driveProcessed はアプリから呼ばなくなった。GAS側には残してある）
- 以下はこれまでの旧フォルダの取込の記録：
- 処理済みファイルは「処理済み_」プレフィックスでリネーム
- Drive操作・AI読み取り・リネームはすべてGAS側で実行する
  （ブラウザからDrive APIやAnthropic APIは呼べない。APIキーが公開されるため）
- Anthropic APIキーはGASのスクリプト プロパティ ANTHROPIC_API_KEY に保存。
  gas-code.js にも keiei-kanri.html にも書かないこと
- 使用モデル：claude-sonnet-4-6（PDFは type:'document'、画像は type:'image'）
- GASのaction：driveList / driveExtract / driveProcessed

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

## キャッシュフロー管理（旧・収支管理）
- ledger の status で3種類を持つ：actual（実績）／planned_in（入金予定）／planned_out（出金予定）
  status が無い既存データは actual として扱う。予定日は expectedDate
- ★ ダッシュボード・レポート・PLの集計は必ず isActual() で実績のみに絞ること
  （sumLedger / sumLedgerYear / レポート各明細 / buildMonthlyPL に組み込み済み）
- 月末残高予測 = bankBalance ＋実績(入−出) ＋予定(入−出)
- 「前月の請求済み案件を入金予定にする」は hasPlannedIn() で案件ごとの重複を防ぐ
- 案件を請求済にするとき（一括・個別とも）入金予定日を入れると planned_in を自動作成する

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
