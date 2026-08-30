# keiei-kanri-app

## プロジェクト概要
アスリンク株式会社の経営管理アプリ。
単一HTMLファイル（keiei-kanri.html）で構成。
Netlify（keiei-kanri-app.netlify.app）にデプロイ済み。
GitHubリポジトリ：Tatsuya-Ishii6410/keiei-kanri-app

## 修正後の作業
コードを修正したら必ず以下を実行：
1. git add .
2. git commit -m "修正内容を簡潔に"
3. git push origin main

## ファイル構成
- keiei-kanri.html：アプリ本体（全機能がこの1ファイルに集約）
- gas-code.js：Google Apps Script用のコード（GASエディタに貼り付けて使う。ブラウザからは読み込まれない）

## データ保存
- 保存先は Google スプレッドシート（projects / quotes / ledger / settings の4シート）
  https://docs.google.com/spreadsheets/d/1gdtg7q3NwG3FQmWGc7lMpNEKROyvyRwuoIRKNSPsi4k/edit
- keiei-kanri.html 先頭の定数 GAS_URL にGASウェブアプリのURLを設定して連携する
- localStorageはバックアップ。GASの読み込みに失敗したときのフォールバックとして使う
- gas-code.js を修正したら、GAS側で「デプロイを管理」→新バージョンとしてデプロイし直すこと

## 注意事項
- pushすればNetlifyが自動でデプロイする（1〜2分）

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
- 現預金残高・既存借入残高は設定ページの「財務情報」から入力し、
  state の finance:{cash,loan} に保持。settingsシートには finance.cash / finance.loan で保存
- AIアドバイスはGASの advise アクション経由（claude-sonnet-4-6）。
  ブラウザから直接Anthropic APIは呼ばない
