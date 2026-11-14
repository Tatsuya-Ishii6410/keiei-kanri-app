# 計画管理・予実管理・KPI・振り返り（段階1：調査と設計案）

状態：**設計案（承認待ち）。コードは未変更**。段階2（実装）は、4週間の手運用の実験（2026-12-14 に判定）のあとに着手する。

## 0. 方針（ユーザーの指示）
- 最上位の目標は「1人で年商2000万円」。期限は未定（後で入れられる欄）
- 売上1億円・社員7名・役員報酬1000万円は「長期像」。追跡しない（目標の頂点にしない）
- 先行指標は 訪問・商談・提案・紹介依頼 の4つ。訪問・商談・提案はカレンダーから自動集計を検討、紹介依頼は手入力
- 振り返りは二段：週次（数字だけ）・月次（うまくいったこと／課題／来月の打ち手）

## 1. 既存の計画・KPI・予実の棚卸し（keiei-kanri.html の行は 2026-11-14 時点）

| 機能 | 保存の場所 | 画面 | 主な関数 |
|---|---|---|---|
| 月次計画 S.plan（売上・経費・役員報酬・税） | settings `plan.<1-12>.<項目>`（gas readSettings_・normalizePlan_） | CF管理「計画編集」→ #modal-edit-plan | normalizePlan・planOf(mi)・savePlan・planYearTotal・fiscalPlanTotals |
| 期の目標・KPI目標（salesTarget・profitTarget・newCustomerTarget・retentionTarget・winRateTarget） | fiscalYears シート | 設定「期の管理」→ #modal-fiscal | saveFiscal・activeFiscalYear・fiscalAbsMonths |
| 経営ミッション（新ダッシュボード） | ― | #dv2-missions | renderDv2Missions・dashMissionList（売上目標の確定進捗・KPI 3つ・月次締めの解決率） |
| 計画差異（旧ダッシュボード） | ― | #page-dashboard | renderDiffList（売上は案件ベース salesAtMonth、経費は sumLedgerAbs） |
| CF管理「計画 vs 実績」 | ― | #page-ledger | renderLedger・planCardHtml（**売上は口座ベース** sumLedger。見出しに明記） |
| 月次レポートの計画比・累計の目標進捗 | ― | #page-report | generateReport（売上は案件ベース。入金は参考行） |
| 案件予実 | ― | レポート「案件予実」 | buildForecastHtml・forecastRows（比べる相手は salesTarget だけ。S.plan は使わない） |
| 通年レポート | ― | レポート「年間」 | buildAnnualReportHtml・annualRows（salesTarget だけ） |
| 融資力診断「事業計画の精度」 | settings `finance.loan` | レポート「融資力」 | loanMetrics（計画の入力月数・直近3か月の乖離） |
| 月次締め | settings `monthClose.YYYY-MM`（日時だけ。メモ欄なし） | #page-close | closeChecks・completeMonthClose |

気づいた点（今回は変えない）：S.plan は年の区別がない（月0〜11だけ）。sumLedger(mi) は年を見ない（sumLedgerAbs は見る）。振り返り・メモを残す場所は今は無い。

## 2. 自動集計に使える KPI 候補

| KPI | 関数 | 根拠 |
|---|---|---|
| 売上（月・期累計） | salesAtMonth・projectSalesAtAbsTotal・fiscalTotals | 発生主義・案件ベース（monthlyBillings があれば優先）。CF とは混ぜない |
| 営業利益 | operatingProfit・profitOfAbs・dashMonthNumbers | 売上（案件）−経費・役員報酬・税（ledger の実績 isActual） |
| 新規顧客数 | newCustomerCount（名寄せ normClientName） | 期間内に初めて受注案件が始まった取引先 |
| 継続率 | retentionRate | 前期に売上のあった取引先のうち今期も売上がある割合（前期なし→null） |
| 成約率 | winRate | 受注÷（受注＋失注）。失注0件→null（「データ不足」と出す） |
| 月額契約数 | **新規**（contract==='monthly' かつ billableProject の件数）。売上は recurringSalesOfMonth | 案件ベース |
| 売上の集中度（上位2社の比率） | **新規**（projectSalesAtAbs を normClientName で集計） | 案件ベース。期累計で計算 |
| 商談中の見込み額 | pipelineList・renderProjectPipeline | status=商談中 の amount 合計（月額・年額はそのまま。期内に絞る版は buildForecastHtml） |
| 入金遅延 | overdueReceivables・overdueNow | CF の予定（planned_in の期限超過）。売上とは別系統 |
| 月次締めの解決率 | closeChecksFor | 参考（運用） |

## 3. カレンダーからの自動集計（訪問・商談・提案）
- 今の読み取り：GAS calendarEvents_（doGet action=calendarEvents）が 日付・開始時刻・予定名・場所・終日・オンライン を返す。終了時刻・説明・参加者は返さない。**除外は GAS にもアプリにも無い**（交通費の取込は病院などの語で外すだけ）
- 権限：appsscript.json が無く、CalendarApp の自動判定で**カレンダー全体の権限**（読み取りだけはコードの決まり）。今回の集計も読み取りだけで、新しい承認は要らない見込み
- 分類：予定名の先頭の印【訪問】【商談】【提案】で数える。交通費の calVisitName がすでに先頭の【…】を外しているので、同じ正規表現で印を取る
  - 印が無い予定：**数えない**（推測しない）。「印なし」の件数と、訪問らしい予定（場所あり・時刻あり）の名前を最大5件、参考に出して、印を付け忘れに気づけるようにする
  - 1つの予定に印が2つ（【訪問】【商談】）：両方に1ずつ
- 除外：終日の予定（isAllDay）・予定名に「移動」を含む予定・印のない予定（個人の予定はここで外れる）。繰り返しの予定は1回ずつ（eventId は id@日付）
- 取引先との照合：数えるのに照合は使わない（印だけで数えるのでほぼ100%）。照合は参考（訪問先の内訳）に限る。精度は 予定名＝「【訪問】株式会社X」の形なら normClientName の完全一致で 8〜9割、自由な書き方なら 4〜6割の見込み
- 週の区切り：月曜はじまり（ISO週。2026-W47 の形）。月は予定の日付の月
- GAS の変更：doGet に action=calendarKpi（期間の印つき予定を週・月ごとに数えて返す。約50〜70行）。**再デプロイが必要**、GAS_VERSION を上げる。週次トリガーで保存する案（約40行）は、段階2では採らない（画面を開いた時に数えれば足りる）
- **実験期間の準備（今からできる・コード不要）**：予定名の先頭に【訪問】【商談】【提案】を付けておくと、段階2の実装時にさかのぼって数えられる

## 4. 保存の形（GAS・シート）
- アプリの保存は 7シートの全上書き（settings も全部書き直す）。新しいデータは次のどちらか

### 案A（推奨）：新シート planKpi を SHEET_DEFS に足す
- 列：`id, kind, period, key, value, updatedAt`（period・value は TEXT_COLUMNS）
  - kind＝goal（最上位の目標：金額・期限）／vision（長期像：自由記述の項目）／kpi（KPIの定義：種類・名前・目標・単位・自動/手入力・表示順）／week（週の数字：period=2026-W47、value＝JSON {訪問,商談,提案,紹介依頼,手入力KPI…, 自動の値は控え}）／review（月次：period=2026-11、value＝JSON {数字の控え, よかった, 課題, 打ち手, 確定日}）／action（施策。段階3）
- アプリ：S.planKpi（配列）。mergeState・keepLocalWhenMissing（古いGASで消さない）に足す。古いデータは空の配列
- GAS：readAll_・writeAll_ に1つずつ（約30行）。**再デプロイが必要**・GAS_VERSION を上げる
- 良い点：1行1件で、シートで読める・履歴が増えても settings を太らせない。既存の全上書き・版の比較（古い端末の上書き防止）にそのまま乗る

### 案B：settings のキーに JSON（plan2.goal・plan2.kpis・review.YYYY-MM・week.YYYY-Www）
- GAS の変更は readSettings_・writeAll_ のキーの追加（約20行）で小さい
- 弱い点：週・月ごとにキーが増え続ける。セル1つの文字数の上限（5万字）に近づく項目が出る。シートで読みにくい

## 5. 画面（新しいタブ「計画」）
既存の計画・予実・レポート・ミッションは変えない。新しいタブは既存の関数を読むだけ（数字を作らない。足りない時は「データ不足」）。

1. 目標（ヒーロー uc-hero）：「1人で年商2000万円」・期累計の売上（案件ベース）と達成率・期限（未入力なら「期限：未定（入力）」）。年の見込み＝確定＋予測（forecastSplit）を細く
   - 長期像：折りたたみの小さな欄（売上1億円・社員7名・役員報酬1000万円）。数字は追跡しない
2. KPI（ucKpis 2列）：自動は最大6・手入力は最大5。分類 財務／営業の先行／運用。各カードに今月の値・目標・達成率・信号
3. 予実（進捗行 ucProgress）：計画・実績・差・達成率・信号
   - 信号：達成率 100%以上＝達成、80〜99%＝注意、80%未満＝遅れ（色だけでなく文字でも）。月の途中は「経過日数で按分した目標」と比べる
4. 週次（今週の数字）：訪問・商談・提案（カレンダーの数を初期値、直せる）・紹介依頼（手入力）・手入力KPI。保存は固定フッター。直近8週の表
5. 月次の振り返り：月末（または月次締めの完了時）に、財務・KPI・週の合計から数字の下書きを作る → よかったこと／課題／来月の打ち手 を書いて確定。確定した数字は控えとして残る（あとで実績が変わっても、当時の数字が読める）。履歴は月の一覧
6. 施策（段階3）：打ち手の一覧・担当・期限・結果

- スマホ（375px）：1列。ヒーロー → KPI 2列 → 予実の進捗行 → 週次 → 振り返り。入力は 3層のモーダル（見出し／本文／固定フッター）。タップ 44px
- PC（1440px）：2列。左＝目標・予実、右＝KPI・週次。振り返りは下に全幅
- デザインの決まり：共通部品 uc-（ヒーロー・KPI・進捗行・バッジ・差額）、1〜3色、絵文字なし、赤は #DC2626

## 6. 既存画面との境界
- 変えない：S.plan と計画編集、fiscalYears の目標、経営ミッション、計画差異、CF管理の計画対実績、月次・通年・案件予実レポート、融資力診断
- 読むだけ：salesAtMonth・fiscalTotals・forecastSplit・newCustomerCount・retentionRate・winRate・pipelineList・overdueReceivables
- 年商2000万円の「年」は**期**（fiscalYears）で数える。期の売上目標（salesTarget）とは別の欄（最上位の目標は期をまたぐため）

## 7. テストの方針
- 判定の範囲 @plan-rules（DOM・S を触らない）を Node でテスト：ISO週・予定名の印の取り出し・除外（終日・移動・印なし）・週と月の集計・按分した目標と信号・上位2社の比率・月額契約数・振り返りの下書き・手入力5／自動6の上限
- GAS：planKpi シートの往復（案A）・古いアプリの保存で消えない・calendarKpi の集計（モックのカレンダー）・GAS_VERSION とアプリの期待する版の一致
- 画面の実行テスト：計画タブ（375px で 44px・横スクロールなし・絵文字なし）・週次の保存・月次の下書きと確定・カレンダーの偽の応答・「データ不足」の表示

## 8. 段階の分け方（段階2＝実装。12/14 の判定のあと）
| 段階 | 内容 | GAS | 目安 |
|---|---|---|---|
| 2-a | データの形（S.planKpi・mergeState・案Aのシート）と @plan-rules の関数 | 変更・再デプロイ | アプリ80行・GAS30行・テスト |
| 2-b | 計画タブ：目標・長期像・KPI（自由設定：自動6／手入力5）・予実と信号 | なし | 2〜3コミット |
| 2-c | 週次の数字（手入力）と直近8週 | なし | 1〜2コミット |
| 2-d | 月次の振り返り（下書きの自動生成・確定・履歴） | なし | 2コミット |
| 2-e | カレンダーの自動集計（action=calendarKpi。週次の初期値に入れる） | 変更・再デプロイ | GAS 60行・アプリ40行・テスト |
| 3 | 施策 | ― | ― |

推奨の順：2-a → 2-b → 2-c → 2-d → 2-e（カレンダーは最後。手入力だけでも回るようにしてから足す）。
