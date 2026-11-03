# 案件・請求（案件管理・月次請求・請求書・見積書・入金の突合）

（CLAUDE.md から移した詳しい仕様。作業の決まり・目次は CLAUDE.md の先頭）

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

## 見積書の契約期間
- quotes に contractStart / contractEnd（YYYY-MM）/ paymentMethod / isMonthly を保持
- 月額固定（isMonthly）のとき、明細は月額として扱い
  「月額単価」「月額」「月額小計」「月額合計」＋「契約期間合計（税込）」を表示する
- 契約月数は両端を含む（2026-09〜2026-11 = 3ヶ月）。最低契約期間3ヶ月未満は警告
- 一覧の金額（q.amount）は月額固定なら 月額合計×契約月数（契約全体の金額）
- 特記事項（最低契約期間・自動更新・解約予告）は月額固定のときだけ挿入する

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
- 同期すると quotes に請求書を追加し、付ける案件の
  その月の monthlyBilling を invoiced にして、支払期限で入金予定を作る（invSyncApply）
- ★ 付ける案件は invoiceProjectCandidates（@project-rules。2026-11〜）：同じ取引先（normClientName で表記をそろえて完全一致。部分一致はしない）・
  受注済み（契約済・進行中・完了。商談中・失注には付けない）・その月が契約期間内（projectInMonth。終わった古い案件には付けない）。
  以前は部分一致で、登録順の最初の1件に付けていた（古い案件に期間外の請求レコード・入金予定ができた）
  ・候補1件 → 自動で付ける。金額をPDFの小計（税抜）に合わせるのはこのときだけ
  ・候補0件・2件以上 → 保留（invPending。このセッションだけ・保存しない。ファイル・宛名・金額・日付など読み取った内容だけ）。
    案件を選んで確定するまで、請求書（番号も振らない）・請求レコード・請求済みの状態・入金予定を作らない。同じPDFは次の同期でも改めて保留になる
  ・同期の画面の上に「案件を決められない請求書 N件」と一覧（renderInvPending）。案件を選んで「確定」（confirmInvPending）で通常の同期と同じ処理。
    選択肢は 候補 → 同じ取引先のほかの受注済み → ほかの受注済み、と「案件に付けずに請求書だけ登録」。同期のあと保留があれば、同期の画面は開いたまま
  ・「あとで決める」（保留の見出しの中）・✕・閉じる・背景の押下・スマホの戻る操作は、すべて closeInvoiceSync：保留のまま閉じる（何も作らない）。
    保留があれば「N件は保留のままです。次の同期で、もう一度出ます」を画面の下に4秒（showToast）。戻る操作のため、画面を開くと履歴に1つ積む（invSyncHist）
  ・テスト：tests/project-list.test.js（候補の判定）／tests/app-smoke.test.js の「ドライブの請求書同期（保留・確定）」（保留でレコード・入金予定ができない、「あとで決める」・戻る操作で閉じられ何も作られない、次の同期で同じPDFがもう一度保留に出る、確定＝自動と同じ）
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
- 交通費台帳はCSV（BOM付き・合計行あり）とPDF（書類の全画面表示から印刷。ファイル名「交通費台帳 {期間}」）を出力できる
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
- 見積書は「【アスリンク見積書（2026年10月）分】_株式会社○○御中」（quoteFileName。年月は契約開始月 → 請求月 → 見積日の月）
- 表示・「印刷・PDF保存」は書類の全画面表示（#doc-viewer。下の節）。開いている間 document.title をファイル名にするので
  「PDFに保存」の既定名になる。HTMLダウンロード（docStandaloneHtml）も同じ名前
- 帳票のフォントは DOC_JA_FONT（Noto Sans CJK JP → Webフォントの Noto Sans JP）。単体HTMLには DOC_FONT_LINK を入れる
- 印刷（A4・倍率100%で1ページ）：@page は A4・余白12mm（DOC_PAGE_MARGIN。書類の全画面表示は pageMargin で渡す。交通費台帳などは従来どおり0）。
  印刷では本文（.doc-sheet）の内側の余白を0、色・背景は print-color-adjust:exact。行（tr）と枠（.doc-keep：金額・契約・特記事項・振込先・備考・合計欄）は
  途中で切らず、表の見出しはページごとに繰り返す。合計欄は tfoot ではなく最後の tbody（tfoot はページごとに繰り返されるため）。DOC_PRINT_CSS を表示と単体HTMLの両方に入れる。
  詰めたのは余白・行の高さ・枠の内側だけ（文字の大きさ・項目・金額・文面は同じ）。テスト：tests/doc-print.test.js（明細3行は1ページ、25行は2ページ以上）
- PDF はブラウザの印刷だけで作る（GAS は請求書のPDFを作らない。ドライブの請求書同期は読むだけ）

## 書類の全画面表示（#doc-viewer。請求書・見積書・交通費台帳のPDF）
- ★ 別ウィンドウ（window.open＋document.write）は使わない。ホーム画面から開いたアプリ（standalone）では戻る操作がなく、アプリに戻れなかった
- アプリの中に重ねて開く（openDocViewer / closeDocViewer）。下のアプリはそのまま（ログイン・一覧のスクロール位置・選択中の月を失わない）
  開くと履歴に1つ積む（history.pushState）。端末の「戻る」（popstate）・Esc でも閉じる
- 上部の固定バー（.dvw-bar。56px＋safe-area-inset-top・白・薄い境界線）：左「← 戻る」（44px）、真ん中に書類名（400px以下は隠す）、右に操作
  請求書の下書き：［編集］［発行する］（下書きは出力しない。発行するとこの画面のまま発行済みの表示に替わり、発行のボタンは消える）
  発行済み・取消・見積書：［その他 ▾：HTMLダウンロード］［印刷・PDF保存］／交通費台帳：［印刷・PDF保存］
- 本文は shadow DOM（#dvw-sheet）に入れる。アプリのCSSが帳票に混ざらず、帳票のCSS（交通費台帳の table・h1 など）もアプリに漏れない
  交通費台帳の以前の body の指定は .tl-doc に付けている
- 紙の見た目は以前の別ウィンドウと同じ：開いている間だけ <style id="dvw-page">@page{size:A4 portrait;margin:0}</style> を head の最後に足し、
  アプリの @page（余白15mm）を上書きする（閉じたら外す）。幅794px。@media print では body.bs-docview の #doc-viewer 以外とバーを隠す
  （実際のPDFで、交通費台帳は以前とピクセル一致、請求書・見積書は下の折り返しの修正だけが違う）
- 印刷は printDocViewer（フォントの読み込みを待って window.print()）。ファイル名は開いている間の document.title
  （請求書 invoiceFileName／見積書 quoteFileName／交通費台帳「交通費台帳 {期間}」）。閉じたら元のタイトルに戻す
- スマホは本文（794px）を画面の幅に縮小して表示（fitDocViewer の zoom。リサイズで計算し直す）。ピンチで拡大できる（viewport で拡大を禁止していない）
- 合計の見出し（小計・消費税・合計金額（税込）・月額合計・契約期間合計）は white-space:nowrap。以前は紙でも「合計金額（税 / 込）」と折り返していた
- 月次レポート・案件予実・融資力診断の印刷は、もともとアプリの画面のまま window.print() なので対象外（別ウィンドウを開かない）

## 案件管理の一覧（表示する案件の判定）
- ★ 判定は keiei-kanri.html の「@project-rules-begin〜end」の projectListState(p,abs,range,billings,opt)（表示だけ。tests/project-list.test.js が切り出して読む。DOM・S を触らない）
  期間は売上と同じ projectMonthRange の結果（range）を受け取る。★ 売上・請求・予測の判定（projectMonthRange／projectCoversAbs／billableProject）は変えない
- 年＋月で比べる（以前の projectHasMonth は月だけで比べていたので、去年の同じ月に掛かる終了案件・去年の単発が出ていた）。選んだ月の年は今の期から（monthYear。billingYm と同じ）
  ・出すのは 契約済・進行中・完了 だけ（商談中＝見込み、失注は出さない）
  ・月次・年次：開始月 ≦ 選択月 ≦ 終了月。終了日が空なら、売上と同じく開始月だけ
  ・単発：開始月（＝売上月）だけ
  ・繰越：選択月より前の請求レコードが請求済み・未入金（invoiced）なら、期間外でも「繰越（○月分 請求済・未入金）」の印で出す（表示だけ。合計には足さない）
  ・期間外の請求レコード（未請求など）は、出す理由にしない（以前は「その月の請求レコードがあれば出す」だった）
- 印（projectMarksHtml。表示だけ）：「繰越（○月分 請求済・未入金）」／「終了」（「終了した案件も表示」で出した案件）／
  「終了日が未設定（売上は開始月のみ）」（月次・年次で終了日が空。売上の計算は変えていない）
- 「終了した案件も表示」（#project-show-ended。初期はオフ・保存しない）：オンで、選んだ月より前に期間が終わった案件も出す。全期間では、今月より前に終わった案件・「完了」の案件をオンのときだけ出す
- 合計カード（表示だけ）：選んだ月は、期間内の案件のその月の売上（projectSalesAtAbs＝ダッシュボードと同じ）。全期間は従来どおり projectMonthAmount
- projectHasMonth は消していない（一括請求書作成・一括ステータス変更の「期間外の案件 N件」の数え方と、点検の画面の「修正前の安定売上」の再現にだけ使う）
- 案件データの点検（設定ページの「案件データの点検」→ 点検する。modal-project-audit。読み取りのみ・データは変更しない。projectAuditData）：
  期間外の請求レコード（案件の契約期間に入らない月。売上には入っていない）／終了日が未設定の月次・年次の案件／終了済み（今月より前に期間が終わった）で、
  期間内に未請求の請求レコードが残る案件／融資力診断の安定売上（修正前を月だけの判定で再現した値と、いまの値）
- 一括請求書作成（bulkInvoiceTargets。年は bulkInvoiceYm と同じ billingYear）・一括ステータス変更の「未請求→請求済」（bulkStatusTargets。年は billingYm と同じ今の期）の対象も、
  年＋月で契約期間に入る案件だけ（projectInMonth）。期間外の請求レコードがあっても対象にしない（以前はそれが入口になって、期間外の月に請求レコード・請求書・入金予定ができた）。
  以前の判定なら対象だった案件の数を「期間外の案件 N件は対象外」と一覧の上に小さく出す（bulkInvoiceExcluded／bulkStatusExcluded）
- ★ 見込みタブ（第2のタブ［案件］［見込み］。switchProjectTab）：状態＝商談中の案件。案件のタブには出さない。月の選択・入金の絞り込み・一括操作は出さない（全期間）
  一覧は会社名・案件名・見込み金額（月次は /月、年次は /年）・種別・想定開始（＝開始日。新しい項目は足していない）・状態。想定開始の昇順（未設定は最後）。
  先頭に「N件・合計 ¥…」（商談中だけ。失注は含めない）。「失注を含める」（#pipe-show-lost。初期はオフ）。タブに商談中の件数
  操作は既存の編集（openProjectModal → saveProject）をそのまま使う：「契約にする」（pipeContract：状態を契約済にした編集画面。開始日が空なら入力を求める。
  保存すると従来の契約済みの案件と同じ＝請求レコード・売上・予測に入り、案件タブのその開始月へ）／「失注にする」（pipeLost：状態だけ変えて saveProject）／編集／
  「見込みを追加」（openProjectModal(null,'商談中')）。案件タブの「案件追加」は状態の初期値を契約済にした（見込みは見込みタブで追加）
  見込みは売上・CF・予測・請求の計算に入らない（billableProject のまま。変更なし）
