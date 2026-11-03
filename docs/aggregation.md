# 集計の基準（売上・経費・期・CF）

（CLAUDE.md から移した詳しい仕様。作業の決まり・目次は CLAUDE.md の先頭）

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

## 収支の区分グループ
- sales（売上）／ expense（経費系）／ labor（役員報酬・旧人件費）／ tax（税金・社会保険料）
- 税金・公課は経費合計には含めない（別枠で表示する）が、営業利益では差し引く
  （operatingProfit）。月次PLの「当月損益」と一致させるため
- バッジ色：売上=緑／役員報酬=アンバー／経費=赤／税金・公課=紫
- 区分を増やすときは LEDGER_TYPES と、税金なら TAX_TYPES にも追加する

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

## CF管理は口座ベース
- CF管理の集計は cfInflow / cfOutflow / cfPlannedIn / cfPlannedOut のみを使う
  （すべて ledger 由来。交通費の実績は除外）
- ★ CF管理で projectSalesAtAbsTotal / salesAtMonth（案件ベースの売上）を使わないこと
  案件ベースの発生売上はダッシュボード・レポート・PL側の話
- 「計画 vs 実績」カードもCF管理内では口座ベース（ledgerの売上のみ）で比較する
