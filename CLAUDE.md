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
