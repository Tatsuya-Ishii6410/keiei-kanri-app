# keiei-kanri-app

## プロジェクト概要
アスリンク株式会社の経営管理アプリ。
単一HTMLファイル（keiei-kanri.html）で構成。
GitHub Pages（https://tatsuya-ishii6410.github.io/keiei-kanri-app/）で公開。
GitHubリポジトリ：Tatsuya-Ishii6410/keiei-kanri-app

## ★ 作業の決まり（途中で止まらないために。すべての作業で守る）
1. 進行表：リポジトリ直下の PROGRESS.md（進行中の作業／段階ごとのチェックリストとコミット番号／現在の段階／次の一手／未解決の問題）。
   作業の開始時に読む。段階が終わるごとに更新してコミットする。
   止まったあとの再開は「git status → PROGRESS.md を読む → npm test → 次の一手から」の順
2. 編集の大きさ：1回の差分は約80行まで。大きな部品・関数は小さな単位に分けて順に差し込む。
   日本語・バックスラッシュを含む変更は、シェルのヒアドキュメントや Python の文字列を使わず Edit ツールで行う。
   小さな単位（1つの部品・1つのカード）ごとに npm test → コミット。push は段階ごと
3. 出力を短く：途中の説明は1〜2行。完了報告は30行以内の箇条書き。長い表・比較はファイル（scratchpad）に保存してパスだけ示す。
   スクリーンショットは幅800px以下に縮小し、複数の比較は1枚にまとめる
4. 読み込みを軽く：keiei-kanri.html は全体を読まない（grep -n で場所を探し、前後120行以内だけ）。
   テスト・コマンドの出力は末尾30行（tail -n 30）。git diff は --stat のみ。npm test（約1分）はバックグラウンドで実行し、要約だけ読む
   テストの結果は、パイプで tail などに渡して確認しない（パイプの終了コードがテストの失敗を隠す）。
   `npm test > ファイル 2>&1; echo $?` で npm test 自身の終了コードを確認する（または set -o pipefail）。失敗したままコミット・プッシュしない。
   出力を短くしたいときは、ファイルに保存してから末尾30行だけを読む
5. 区切りの提案：読んだファイルやツールの出力が増えて会話が長くなったら、自分から
   「ここまでを PROGRESS.md と CLAUDE.md に書いた。新しいセッションで続けてください」と区切りを提案する

## ★ 必ず守る決まり（アプリ）
- 編集するのは keiei-kanri.html。直したら `cp keiei-kanri.html index.html`。手順は npm test → git diff --stat（削除が多すぎないか）→ コミット → `git pull --rebase` → push
- .github/workflows/deploy.yml は手元で変えない（ユーザーがGitHubの画面で直す）。gas-code.js を変えたら GAS の再デプロイが要る
- 集計は年＋月（絶対月）。売上は案件ベース（発生ベース）、CF管理は口座ベース（ledger）。2系統を混ぜない。実績は isActual で絞る
- APIキーは GAS のスクリプト プロパティだけ。カレンダー・Gmail は読み取りのみ。数字を作らない（データ不足は「データ不足」と出す）
- 判定の範囲（@…-rules-begin〜end）はテストが Node で読む。DOM・S を触らない。body の状態クラスは bs- 接頭辞

## 目次（作業に関係するファイルだけを読む）
- [docs/dev.md](docs/dev.md)：修正後の作業・ファイル構成・テスト（npm test）・データ保存・デプロイ
- [docs/aggregation.md](docs/aggregation.md)：売上・経費・営業利益の集計、収支の区分、期（会計年度）、CF管理は口座ベース
- [docs/reports.md](docs/reports.md)：月次・通年レポート、印刷・PDF、案件予実、融資力診断、月次PL、税金・社会保険
- [docs/projects-billing.md](docs/projects-billing.md)：案件管理の一覧・見込み、月次請求レコード、請求書の同期・下書き・訂正、入金の突合、書類の表示
- [docs/cf-import.md](docs/cf-import.md)：CF管理、固定費、ドライブ・銀行CSV・デビット通知・領収書・受信箱の取込、経費の項目
- [docs/travel.md](docs/travel.md)：交通費（計算・精算・台帳・カレンダー・訪問先の候補・運賃・手段・入力モーダル）
- [docs/ops.md](docs/ops.md)：週次バックアップ、入金遅延、月次締め、ログイン
- [docs/dashboard.md](docs/dashboard.md)：新ダッシュボード（第1〜4次）、朝日凛子、アプリのアイコン
- [docs/ui.md](docs/ui.md)：レイアウト、レスポンシブ、フォント、共通ナビ、一覧の上の操作エリア、スマホの横長ルール
- [docs/ui-cf-projects.md](docs/ui-cf-projects.md)：UI/UX改修指示（CF管理・案件管理）の原文。最重要制約はこれに従う
- [docs/ui-revamp.md](docs/ui-revamp.md)：UI改修（共通部品 uc-：ヒーロー・KPI 2列・明細の行・進捗行・バッジ・差額。新しい画面の部品はこれを使う）
- 進行中の作業：[PROGRESS.md](PROGRESS.md)
