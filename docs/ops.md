# 運用（バックアップ・入金遅延・月次締め・ログイン）

（CLAUDE.md から移した詳しい仕様。作業の決まり・目次は CLAUDE.md の先頭）

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
