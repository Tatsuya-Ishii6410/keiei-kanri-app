/* 新ダッシュボード（第1段階）のテスト
   実行: node tests/dashboard-v2.test.js

   - keiei-kanri.html の「@dash-rules-begin」〜「@dash-rules-end」（あいさつ・マイルストーン・着地予測・KPI・ミッション・ひとこと）を切り出して読む
   - gas-code.js はまるごと読み、期（fiscalYears）の KPI 目標がシートとの往復で消えないことを確かめる（シートはモック）
   ※ 旧ダッシュボードと新画面の数字の一致は、両方が同じ関数（dashMonthNumbers・fiscalTotals・pct）を使うことで保っている。
     画面での突き合わせは tests/dashboard-v2-compare.html（ブラウザで開く）で確認する */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@dash-rules-begin');
const end = html.indexOf('@dash-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @dash-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
const pctSrc = /function pct\(actual,target\)\{[\s\S]*?\n\}/.exec(html);
assert(pctSrc, 'keiei-kanri.html に pct() が見つかりません');
vm.runInContext(pctSrc[0] + '\n' + html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { dashGreeting, monthOverMonth, dashMilestones, routePoint, forecastSplit,
  normClientName, newCustomerCount, retentionRate, winRate, ringState,
  heroProgress, msLabelPos, niceAxis, pct, plannedWindow, dashCondition, milestoneCelebration, recordMonth, bigChanges,
  actionItems, dashMissionList, deadlineLabel, dashInsights, paceLevel, nextMilestone, withinDays, overdueZeroRecord, dashHighlights };`, app);
const A = app.exported;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (e) {
    console.error('  ✗ ' + name + '\n    ' + e.message);
    process.exitCode = 1;
  }
}
const plain = v => JSON.parse(JSON.stringify(v));
const abs = (y, m) => y * 12 + (m - 1);

console.log('ヘッダー');

test('時間帯のあいさつ', () => {
  assert.strictEqual(A.dashGreeting(5), 'おはようございます');
  assert.strictEqual(A.dashGreeting(10), 'おはようございます');
  assert.strictEqual(A.dashGreeting(11), 'こんにちは');
  assert.strictEqual(A.dashGreeting(17), 'こんにちは');
  assert.strictEqual(A.dashGreeting(18), 'お疲れさまです');
  assert.strictEqual(A.dashGreeting(2), 'お疲れさまです');
});

console.log('ヒーロー（山頂）');

test('マイルストーン 25・50・75・100% の到達（目標未設定は全部未到達）', () => {
  assert.deepStrictEqual(plain(A.dashMilestones(49.9)).map(m => m.done), [true, false, false, false]);
  assert.deepStrictEqual(plain(A.dashMilestones(50)).map(m => m.done), [true, true, false, false]);
  assert.deepStrictEqual(plain(A.dashMilestones(100)).map(m => m.done), [true, true, true, true]);
  assert.deepStrictEqual(plain(A.dashMilestones(120)).map(m => m.done), [true, true, true, true]);
  assert.deepStrictEqual(plain(A.dashMilestones(null)).map(m => m.done), [false, false, false, false]);
  assert.deepStrictEqual(plain(A.dashMilestones(0)).map(m => m.p), [25, 50, 75, 100]);
});

test('現在地はルート上の割合の位置（0%＝ふもと、100%＝山頂、はみ出さない）', () => {
  const pts = [[0, 100], [100, 100], [100, 0]];      // 長さ200
  assert.deepStrictEqual(plain(A.routePoint(pts, 0)), [0, 100]);
  assert.deepStrictEqual(plain(A.routePoint(pts, 0.25)), [50, 100]);
  assert.deepStrictEqual(plain(A.routePoint(pts, 0.75)), [100, 50]);
  assert.deepStrictEqual(plain(A.routePoint(pts, 1)), [100, 0]);
  assert.deepStrictEqual(plain(A.routePoint(pts, 1.8)), [100, 0]);
  assert.deepStrictEqual(plain(A.routePoint(pts, -1)), [0, 100]);
});

console.log('着地予測');

test('確定（期首から当月まで＝推移の「実績」と同じ）＋予測（翌月から期末）＝期の合計（期間サマリーと同じ関数の結果をそのまま足す）', () => {
  const months = []; for (let a = abs(2026, 3); a <= abs(2027, 2); a++) months.push(a);
  const sales = a => (a - abs(2026, 3) + 1) * 1000;          // 1000, 2000, ... 12000
  const r = A.forecastSplit(months, abs(2026, 11), sales);
  assert.strictEqual(r.confirmedMonths.length, 9);           // 3月〜11月（当月を含む）
  assert.strictEqual(r.plannedMonths.length, 3);             // 12月〜2月
  assert.strictEqual(r.confirmed, 45000);                    // 1000〜9000
  assert.strictEqual(r.planned, 33000);                      // 10000〜12000
  assert.strictEqual(r.total, months.reduce((a, m) => a + sales(m), 0));
  // 期が終わっていれば全部が確定
  assert.strictEqual(A.forecastSplit(months, abs(2027, 4), sales).planned, 0);
});

test('★ 達成率は確定だけ：確定が25%未満・予測込みが75%以上でも、チェックマークは付かない（着地見込みは別）', () => {
  const split = { confirmed: 1400000, planned: 3500000, total: 4900000 };   // 目標600万：確定23.3%・見込み81.7%
  const h = A.heroProgress(split, 6000000, A.pct);
  assert.strictEqual(h.rate, 23.3);
  assert.strictEqual(h.landing, 81.7);
  assert.deepStrictEqual(plain(h.milestones).map(m => m.done), [false, false, false, false]);
  assert.strictEqual(h.reached, false);
  // 予測込みで100%を超えても、確定が届かなければ達成（お祝い）にしない
  assert.strictEqual(A.heroProgress({ confirmed: 5000000, planned: 2000000, total: 7000000 }, 6000000, A.pct).reached, false);
  assert.strictEqual(A.heroProgress({ confirmed: 6000000, planned: 0, total: 6000000 }, 6000000, A.pct).reached, true);
  // 目標が無ければどちらも出さない
  const n = A.heroProgress(split, 0, A.pct);
  assert.strictEqual(n.rate, null); assert.strictEqual(n.landing, null);
  // ミッションも確定で：あと ¥4,600,000
  const m = A.dashMissionList({ target: 6000000, confirmed: split.confirmed, rate: h.rate, kpis: [], closeTotal: 0, closeOk: 0, today: '2026-11-03' }).list;
  assert.strictEqual(m[0].title, '売上目標まであと ¥4,600,000（確定）');
  assert.strictEqual(m[0].progress, 23.3);
});

test('マイルストーンの文字はマーカーと重ならない側へ（山頂の100%は右に出さない）', () => {
  // マーカーがない → 右
  assert.deepStrictEqual(plain(A.msLabelPos([100, 100], [], 50)), { x: 111, y: 104, anchor: 'start' });
  // 文字のすぐ右にマーカー → 左
  assert.strictEqual(A.msLabelPos([100, 100], [[118, 101]], 75).anchor, 'end');
  // 左右どちらもマーカー → 上
  assert.strictEqual(A.msLabelPos([100, 100], [[118, 101], [82, 101]], 75).anchor, 'middle');
  // 100% は右端で切れるので左
  assert.strictEqual(A.msLabelPos([230, 26], [], 100).anchor, 'end');
});

test('グラフの縦軸：0を含む区切りのよい目盛り', () => {
  assert.deepStrictEqual(plain(A.niceAxis(-380000, 560000, 4)), { min: -500000, max: 750000, step: 250000, ticks: [-500000, -250000, 0, 250000, 500000, 750000] });
  const a = A.niceAxis(0, 500000, 4);
  assert.deepStrictEqual(plain(a.ticks), [0, 200000, 400000, 600000]);            // 0・20万・40万・60万
  assert.deepStrictEqual(plain(A.niceAxis(-400000, 600000, 5).ticks), [-400000, -200000, 0, 200000, 400000, 600000]);
  assert(A.niceAxis(120000, 480000, 4).ticks.indexOf(0) >= 0);           // 正の値だけでも0から
  assert.deepStrictEqual(plain(A.niceAxis(0, 0, 4).ticks), [0, 0.25, 0.5, 0.75, 1]);
  // 区切りの数を省くと、いちばん幅の狭い目盛り：−60万〜50万 → −60万〜60万（20万刻み）。−100万まで広げない
  assert.deepStrictEqual(plain(A.niceAxis(-600000, 500000)), { min: -600000, max: 600000, step: 200000, ticks: [-600000, -400000, -200000, 0, 200000, 400000, 600000] });
});

console.log('重要KPI');

const info = [
  { client: '株式会社A', startAbs: abs(2025, 6), billable: true, status: '完了' },
  { client: 'A', startAbs: abs(2026, 5), billable: true, status: '進行中' },        // 前の期からの取引先
  { client: '（株）B商事', startAbs: abs(2026, 4), billable: true, status: '契約済' },
  { client: 'B商事 ', startAbs: abs(2026, 9), billable: true, status: '進行中' },      // 表記ゆれ・同じ取引先
  { client: 'C社', startAbs: abs(2026, 10), billable: false, status: '商談中' },       // 受注していない
  { client: 'D社', startAbs: abs(2026, 7), billable: false, status: '失注' },
  { client: 'E社', startAbs: abs(2027, 1), billable: true, status: '進行中' },
  { client: 'F社', startAbs: abs(2027, 4), billable: true, status: '進行中' }          // 期の外
];
const S0 = abs(2026, 3), E0 = abs(2027, 2);

test('新規顧客数：期に初めて案件が始まった取引先（表記ゆれをまとめ、前の期からの取引先・受注前は数えない）', () => {
  assert.strictEqual(A.newCustomerCount(info, S0, E0), 2);  // B商事・E社
  assert.strictEqual(A.normClientName('㈱Ｂ商事'), A.normClientName('B商事 株式会社'));
  assert.strictEqual(A.newCustomerCount([], S0, E0), 0);
});

test('継続率：前の期に売上があった取引先のうち今期も売上がある割合。前の期が無ければデータ不足', () => {
  assert.strictEqual(A.retentionRate(['株式会社A', 'G社', 'H社'], ['A', 'B商事', 'H社 ']), 66.7);
  assert.strictEqual(A.retentionRate(null, ['A']), null);
  assert.strictEqual(A.retentionRate([], ['A']), null);
});

test('成約率：(契約済＋進行中＋完了)÷(＋失注)。商談中は数えない。失注が無ければデータ不足（100%にしない）', () => {
  const r = A.winRate(info, S0, E0);
  assert.deepStrictEqual(plain(r), { rate: 80, won: 4, lost: 1, reason: '' });
  const noLost = A.winRate(info.filter(x => x.status !== '失注'), S0, E0);
  assert.strictEqual(noLost.rate, null);
  assert.strictEqual(noLost.reason, 'データ不足（失注の記録なし）');
  assert.strictEqual(A.winRate([], S0, E0).reason, 'データ不足');
});

test('リングの状態：目標未設定はリングを描かない。進捗で色と文字（達成・あと少し・要注意）', () => {
  assert.deepStrictEqual(plain(A.ringState(3, 0)), { level: 'none', pct: null, label: '目標未設定' });
  assert.deepStrictEqual(plain(A.ringState(null, 5)), { level: 'nodata', pct: null, label: 'データ不足' });
  assert.deepStrictEqual(plain(A.ringState(5, 5)), { level: 'good', pct: 100, label: '達成' });
  assert.deepStrictEqual(plain(A.ringState(70, 100)), { level: 'caution', pct: 70, label: 'あと少し' });
  assert.deepStrictEqual(plain(A.ringState(1, 3)), { level: 'warn', pct: 33.3, label: '要注意' });
});


const mx = { target: 6500000, sales: 5200000, rate: 80, overdue: 2, overdueTotal: 330000, missingInvoices: 1, draftInvoices: 2,
  inbox: 3, closeOpen: 4, closeYmLabel: '2026年10月分' };

console.log('第2弾：経営コンディション');

const ow = (total, count, overdue) => ({ total, count, overdue: overdue || 0, until: '2026-12-03' });
const cond = x => A.dashCondition(Object.assign({ cash: null, outSoon: ow(0, 0), overdue: 0, rate: null, elapsed: null }, x));

test('優先順位：資金繰り → 入金遅延 → 目標ペース → 判定材料不足（最初に当てはまる1つ）', () => {
  const c1 = cond({ cash: 300000, outSoon: ow(300001, 3, 1), overdue: 2, rate: 10, elapsed: 50 });
  assert.deepStrictEqual([c1.key, c1.level, c1.title], ['cash', 'warn', '資金繰りに注意']);
  assert.deepStrictEqual(plain(c1.rules.map(r => r.state)), ['hit', 'skip', 'skip']);
  const c2 = cond({ cash: 300000, outSoon: ow(300000, 3), overdue: 2, rate: 10, elapsed: 50 });   // 残高＝出金予定は注意にしない
  assert.deepStrictEqual([c2.key, c2.title], ['overdue', '入金の確認が必要です']);
  const c3 = cond({ cash: null, outSoon: ow(9999999, 9), overdue: 0, rate: 50, elapsed: 50 });     // 残高未設定は資金繰りを飛ばす
  assert.strictEqual(c3.key, 'pace');
  assert.strictEqual(c3.rules[0].state, 'skip');
  const c4 = cond({});
  assert.deepStrictEqual([c4.key, c4.level, c4.title], ['none', 'none', '判定材料が不足しています']);
});

test('目標ペースの境界：差がちょうど−5pt は順調、ちょうど−15pt は少し遅れ、−15pt未満は遅れ', () => {
  const lv = (rate, elapsed) => { const c = cond({ rate, elapsed }); return [c.level, c.title]; };
  assert.deepStrictEqual(lv(45, 50), ['good', '順調です']);                       // −5.0
  assert.deepStrictEqual(lv(44.9, 50), ['caution', '目標より少し遅れています']);   // −5.1
  assert.deepStrictEqual(lv(35, 50), ['caution', '目標より少し遅れています']);      // −15.0
  assert.deepStrictEqual(lv(34.9, 50), ['warn', '目標より遅れています']);           // −15.1
  assert.deepStrictEqual(lv(80, 50), ['good', '順調です']);
});

test('出金予定の合計は「期限超過＋今日から30日以内」の planned_out だけ（入金予定・31日以降は入れない）', () => {
  const L = [
    { status: 'planned_out', expectedDate: '2026-10-20', amount: 100 },   // 期限超過
    { status: 'planned_out', expectedDate: '2026-11-03', amount: 200 },   // 今日
    { status: 'planned_out', expectedDate: '2026-12-03', amount: 400 },   // 30日後
    { status: 'planned_out', expectedDate: '2026-12-04', amount: 800 },   // 31日後（入れない）
    { status: 'planned_in', expectedDate: '2026-11-10', amount: 1600 },
    { status: 'actual', date: '2026-11-01', amount: 3200 }];
  assert.deepStrictEqual(plain(A.plannedWindow(L, 'planned_out', '2026-11-03', 30)), { total: 700, count: 3, overdue: 1, until: '2026-12-03' });
  assert.strictEqual(A.plannedWindow(L, 'planned_in', '2026-11-03', 30).total, 1600);
});

console.log('第2弾：祝福・過去最高・大きな変化');

test('祝福：初めては到達済みを記録だけ（祝福しない）。記録のあとに新しく到達したものだけ', () => {
  assert.deepStrictEqual(plain(A.milestoneCelebration(null, [25, 50])), { celebrate: [], store: [25, 50] });
  assert.deepStrictEqual(plain(A.milestoneCelebration([25, 50], [25, 50])), { celebrate: [], store: [25, 50] });
  assert.deepStrictEqual(plain(A.milestoneCelebration([25, 50], [25, 50, 75])), { celebrate: [75], store: [25, 50, 75] });
  assert.deepStrictEqual(plain(A.milestoneCelebration([], [25])), { celebrate: [25], store: [25] });
});

test('過去最高：売上のある確定月が3か月以上のときだけ。同額は新しい月', () => {
  assert.strictEqual(A.recordMonth([{ a: 1, sales: 100 }, { a: 2, sales: 300 }]), null);
  assert.strictEqual(A.recordMonth([{ a: 1, sales: 100 }, { a: 2, sales: 0 }, { a: 3, sales: 300 }]), null);   // 売上のある月は2か月
  assert.strictEqual(A.recordMonth([{ a: 1, sales: 100 }, { a: 2, sales: 300 }, { a: 3, sales: 200 }]), 2);
  assert.strictEqual(A.recordMonth([{ a: 1, sales: 300 }, { a: 2, sales: 100 }, { a: 3, sales: 300 }]), 3);
});

test('大きな変化：前月比±30%以上 かつ 差10万円以上（ちょうどの値は対象）。当月・前月0は対象外', () => {
  const rows = [{ a: 10, sales: 1000000 }, { a: 11, sales: 1300000 }, { a: 12, sales: 1000000 }, { a: 13, sales: 700000 },
    { a: 14, sales: 300000 }, { a: 15, sales: 390000 }, { a: 16, sales: 0 }, { a: 17, sales: 500000 }, { a: 18, sales: 2000000 }];
  const r = plain(A.bigChanges(rows, 18));
  assert.deepStrictEqual(r[11], { dir: 'up', pct: 30, diff: 300000 });          // ちょうど+30%・30万
  assert.strictEqual(r[12], undefined);                                         // −23.1%
  assert.deepStrictEqual(r[13], { dir: 'down', pct: -30, diff: -300000 });      // ちょうど−30%
  assert.deepStrictEqual(r[14], { dir: 'down', pct: -57.1, diff: -400000 });
  assert.strictEqual(r[15], undefined);                                         // +30% だが差は9万円
  assert.deepStrictEqual(r[16], { dir: 'down', pct: -100, diff: -390000 });
  assert.strictEqual(r[17], undefined);                                         // 前月0は比べない
  assert.strictEqual(r[18], undefined);                                         // 当月は対象外
  assert.deepStrictEqual(plain(A.bigChanges([{ a: 1, sales: 200000 }, { a: 2, sales: 300000 }], 9))[2], { dir: 'up', pct: 50, diff: 100000 });  // ちょうど10万円
});

console.log('第2弾：アクションセンター・ミッション・インサイト');

const ax = { overdue: { count: 2, total: 330000 }, closeOpen: 3, closeYmLabel: '2026年10月分', invoice: { missing: 1, drafts: 1, ymLabel: '2026年11月分' },
  inbox: 0, backup: { ok: false, label: '最終 未実行' }, bank: { ok: true, label: '最終取込 2日前' } };

test('重要度：赤（入金遅延・月次締め）→ 橙（請求書・取込待ち・バックアップ・銀行明細）→ 緑（完了）', () => {
  const r = A.actionItems(ax);
  assert.deepStrictEqual(plain(r.map(x => [x.key, x.sev])), [['overdue', 'red'], ['close', 'red'], ['invoice', 'orange'], ['backup', 'orange'], ['inbox', 'green'], ['bank', 'green']]);
  assert.deepStrictEqual([r[0].title, r[0].detail], ['入金遅延 2件', '合計 ¥330,000']);
  // 件数は受け取った集計そのまま（数え直さない）
  assert.strictEqual(r.find(x => x.key === 'close').count, 3);
  // 全部片付けば全部が緑。取込待ちの機能が無ければ出さない
  const ok = A.actionItems({ overdue: { count: 0, total: 0 }, closeOpen: 0, invoice: { missing: 0, drafts: 2 }, inbox: null, backup: { ok: true }, bank: { ok: true } });
  assert(ok.every(x => x.sev === 'green' && x.done));
  assert(!ok.some(x => x.key === 'inbox'));
});

test('ミッション：売上目標は確定ベース、目標を設定したKPIだけ、月次締めの解決率。月次締めには期限を出さない', () => {
  const M = A.dashMissionList({ target: 6000000, confirmed: 1500000, rate: 25, today: '2026-11-03', deadline: '2026-10-31',
    kpis: [{ key: 'new', label: '新規顧客数', value: 3, target: 3, unit: '社' }, { key: 'ret', label: '継続率', value: null, target: 80, unit: '%' },
      { key: 'win', label: '成約率', value: 40, target: 0, unit: '%' }], closeTotal: 8, closeOk: 6 });
  assert.deepStrictEqual(plain(M.list.map(m => m.key)), ['target', 'new', 'ret', 'close']);   // 成約率は目標未設定なので出さない
  assert.strictEqual(M.list[0].title, '売上目標まであと ¥4,500,000（確定）');
  assert.deepStrictEqual([M.list[1].done, M.list[2].title, M.list[2].done], [true, '継続率 データ不足／目標 80%', false]);
  assert.deepStrictEqual([M.list[3].progress, M.list[3].done], [75, false]);
  assert.strictEqual(M.list[3].deadline, null);                                                 // 月次締めには固有の期限が無い（古い入金予定日を混ぜない）
  assert(M.list.every(m => m.deadline === null));                                               // いまのミッションはどれも自分の期限データを持たない
  // 未完了のミッションにチェックのアイコンを使わない（月次締めはクリップボード）
  assert.strictEqual(M.list[3].icon, '📋');
  assert(M.list.filter(m => !m.done).every(m => !/[✓✔☑✅]/.test(m.icon)));
  assert.deepStrictEqual([M.done, M.total], [1, 4]);
  // 期限の表示（期限データのあるミッション用）
  assert.deepStrictEqual(plain(A.deadlineLabel('2026-11-10', '2026-11-03')), { text: '期限 11/10', overdue: false });
  assert.deepStrictEqual(plain(A.deadlineLabel('2026-10-31', '2026-11-03')), { text: '3日超過', overdue: true });
});

test('気をつけたい変化：数字の変化だけ（前月比−20%以下・ペース−5pt以下）、最大2つ。良い変化・運用タスクは書かない', () => {
  const base = { salesThis: 0, salesPrev: 0, rate: null, elapsed: null };
  const ins = x => plain(A.dashInsights(Object.assign({}, base, x)));
  assert.deepStrictEqual(ins({ salesThis: 110, salesPrev: 100 }), []);                              // 良い変化はハイライトへ
  assert.deepStrictEqual(ins({ salesThis: 80, salesPrev: 100 }).map(c => [c.title, c.lines[0]]), [['気をつけたい変化', '売上が前月より -20.0% 減りました']]);  // ちょうど−20%
  assert.deepStrictEqual(ins({ salesThis: 81, salesPrev: 100 }), []);
  assert.deepStrictEqual(ins({ rate: 45, elapsed: 50 }).map(c => c.kind), ['warn']);                // ちょうど−5pt
  assert.deepStrictEqual(ins({ rate: 45.1, elapsed: 50 }), []);
  assert.deepStrictEqual(ins({ rate: 50, elapsed: 50 }), []);
  assert.deepStrictEqual(ins({ overdue: 3, closeOpen: 2, overdueResolved: true, topAction: { title: '入金遅延 3件' } }), []);
  const both = ins({ salesThis: 70, salesPrev: 100, rate: 20, elapsed: 50 });
  assert.strictEqual(both.length, 1);
  assert.strictEqual(both[0].lines.length, 2);
  assert(!JSON.stringify(both).match(/入金遅延|月次締め|バックアップ|請求書|銀行明細|取込待ち|次の行動/));
});

test('目標ペースの段階はコンディションと達成率のKPIで同じ（paceLevel）', () => {
  assert.deepStrictEqual(plain(A.paceLevel(45, 50)), { level: 'good', label: '順調', title: '順調です', diff: -5 });
  assert.deepStrictEqual([A.paceLevel(44.9, 50).label, A.paceLevel(35, 50).label, A.paceLevel(34.9, 50).label], ['少し遅れ', '少し遅れ', '遅れ']);
  [[45, 50], [40, 50], [30, 50]].forEach(([r, e]) => {
    const c = A.dashCondition({ cash: null, outSoon: { total: 0, count: 0, overdue: 0, until: '' }, overdue: 0, rate: r, elapsed: e });
    assert.strictEqual(c.level, A.paceLevel(r, e).level);
    assert.strictEqual(c.title, A.paceLevel(r, e).title);
  });
});

console.log('第3次：次の目標地点・今月のハイライト');

test('次の目標地点の「あと ¥○」は確定ベース（目標×次の%−確定の累計）。確定で100%以上なら出さない', () => {
  assert.deepStrictEqual(plain(A.nextMilestone(40, 2400000, 6000000)), { p: 50, left: 600000 });
  assert.deepStrictEqual(plain(A.nextMilestone(24.9, 1494000, 6000000)), { p: 25, left: 6000 });
  assert.deepStrictEqual(plain(A.nextMilestone(25, 1500000, 6000000)), { p: 50, left: 1500000 });    // ちょうど25%なら次は50%
  assert.deepStrictEqual(plain(A.nextMilestone(99.9, 5994000, 6000000)), { p: 100, left: 6000 });
  assert.strictEqual(A.nextMilestone(100, 6000000, 6000000), null);
  assert.strictEqual(A.nextMilestone(120, 7200000, 6000000), null);
  assert.strictEqual(A.nextMilestone(null, 0, 0), null);
  // 予測込み（着地見込み）が届いていても、確定で届いていなければ次の地点はそのまま
  const h = A.heroProgress({ confirmed: 1400000, planned: 4700000, total: 6100000 }, 6000000, A.pct);
  assert.deepStrictEqual(plain(A.nextMilestone(h.rate, 1400000, 6000000)), { p: 25, left: 100000 });
});

const T = '2026-11-03';
const hl = x => plain(A.dashHighlights(Object.assign({ hist: [], done: 0, month: 1, today: T, fyId: 1, newCustomers: 0, msDates: {},
  overdueCount: 0, overdueZeroAt: '', rate: null, elapsed: null }, x)));
const H = (a, sales, profit) => ({ a, sales, profit: profit === undefined ? 0 : profit });

test('売上の最高記録：完了した月（前月）がそれ以前の売上のある月（2か月以上）より高いときだけ。同額は出さない', () => {
  const hist = [H(1, 300), H(2, 500), H(3, 400), H(4, 501)];
  assert.deepStrictEqual(hl({ hist, done: 4, month: 5 }).map(x => x.key), ['record:4']);
  assert.deepStrictEqual(hl({ hist: [H(1, 300), H(2, 500), H(3, 400), H(4, 500)], done: 4, month: 5 }), []);     // 同額
  assert.deepStrictEqual(hl({ hist: [H(2, 500), H(4, 900)], done: 4, month: 5 }), []);                         // それ以前が1か月だけ
  assert.deepStrictEqual(hl({ hist: [H(1, 0), H(2, 500), H(3, 400), H(4, 900)], done: 4, month: 5 }).map(x => x.key), ['record:4']);
  // 選んでいる月が当月でも、判定は完了した月（前月）
  assert.deepStrictEqual(hl({ hist: [H(1, 300), H(2, 500), H(3, 400), H(4, 501), H(5, 9999)], done: 4, month: 5 }).map(x => x.key), ['record:4']);
});

test('利益率の改善：完了した月どうしで営業利益率が+5pt以上（ちょうど5ptは出す）。売上の無い月は比べない', () => {
  const mk = (p3, p4) => hl({ hist: [H(3, 1000, p3), H(4, 1000, p4)], done: 4, month: 5 });
  assert.deepStrictEqual(mk(100, 150).map(x => x.key), ['margin:4']);           // 10% → 15%（+5.0pt）
  assert.deepStrictEqual(mk(100, 149), []);                                     // +4.9pt
  assert.strictEqual(mk(100, 150)[0].text, '5月の営業利益率が前月より +5.0pt（15.0%）');   // 絶対月4＝5月
  assert.deepStrictEqual(hl({ hist: [H(3, 0, -100), H(4, 1000, 300)], done: 4, month: 5 }), []);   // 前月の売上が0
});

test('新規顧客：選んでいる月に初めて受注案件が始まった取引先が1社以上（全期間で判定・表記ゆれをまとめる）', () => {
  assert.deepStrictEqual(hl({ newCustomers: 1, month: 10 }).map(x => [x.key, x.text]), [['new:10', '新規顧客 1社（11月）']]);
  assert.deepStrictEqual(hl({ newCustomers: 0 }), []);
  const info = [{ client: '株式会社A', startAbs: 100, billable: true }, { client: 'A', startAbs: 120, billable: true },   // 前の期に案件あり → 新規ではない
    { client: '（株）B', startAbs: 120, billable: true }, { client: 'B 株式会社', startAbs: 121, billable: true },
    { client: 'C', startAbs: 120, billable: false }];                                                                      // 受注前は数えない
  assert.strictEqual(A.newCustomerCount(info, 120, 120), 1);
  assert.strictEqual(A.newCustomerCount(info, 121, 121), 0);
});

test('マイルストーン：確定で新しく届いたものを、届いた日から7日間（当日を含む）。日付の無い記録は出さない', () => {
  assert.deepStrictEqual(hl({ msDates: { 50: '2026-10-28' } }).map(x => x.key), ['ms:1:50']);    // 6日前
  assert.deepStrictEqual(hl({ msDates: { 50: '2026-10-27' } }), []);                              // 7日前
  assert.deepStrictEqual(hl({ msDates: { 50: T } }).map(x => x.key), ['ms:1:50']);
  assert.deepStrictEqual(hl({ msDates: {} }), []);
});

test('入金遅延が0件になった：前は1件以上で、いま0件になった日から7日間。記録が無い（初めて）ときは出さない', () => {
  assert.deepStrictEqual(plain(A.overdueZeroRecord(null, 0, T)), { n: 0, zeroAt: '' });          // 初めては記録だけ
  assert.deepStrictEqual(plain(A.overdueZeroRecord({ n: 2, zeroAt: '' }, 0, T)), { n: 0, zeroAt: T });
  assert.deepStrictEqual(plain(A.overdueZeroRecord({ n: 0, zeroAt: '2026-11-01' }, 0, T)), { n: 0, zeroAt: '2026-11-01' });
  assert.deepStrictEqual(plain(A.overdueZeroRecord({ n: 0, zeroAt: '2026-11-01' }, 1, T)), { n: 1, zeroAt: '' });
  assert.deepStrictEqual(hl({ overdueCount: 0, overdueZeroAt: '2026-10-28' }).map(x => x.text), ['入金遅延が0件になりました']);
  assert.deepStrictEqual(hl({ overdueCount: 0, overdueZeroAt: '2026-10-27' }), []);
  assert.deepStrictEqual(hl({ overdueCount: 1, overdueZeroAt: T }), []);
  assert.deepStrictEqual(hl({ overdueCount: 0, overdueZeroAt: '' }), []);
});

test('目標ペース：確定達成率≧期の経過率（ちょうど同じは出す）。最大3件', () => {
  assert.deepStrictEqual(hl({ rate: 50, elapsed: 50 }).map(x => x.key), ['pace:1']);
  assert.deepStrictEqual(hl({ rate: 49.9, elapsed: 50 }), []);
  const many = hl({ hist: [H(1, 300), H(2, 500), H(3, 1000, 100), H(4, 1001, 300)], done: 4, month: 5, newCustomers: 2,
    msDates: { 25: T }, overdueZeroAt: T, rate: 60, elapsed: 50 });
  assert.strictEqual(many.length, 3);
  assert.deepStrictEqual(many.map(x => x.key), ['record:4', 'margin:4', 'new:5']);
  assert(!JSON.stringify(many).match(/月次締め|バックアップ|請求書|銀行明細|取込待ち/));
});

console.log('GASとの往復（期の KPI 目標）');

test('fiscalYears の新規顧客目標数・継続率目標・成約率目標が、保存・読み込みで消えない（空は空のまま）', () => {
  const gas = {};
  vm.createContext(gas);
  vm.runInContext(fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8'), gas);
  const headers = gas.SHEET_DEFS.fiscalYears;
  ['newCustomerTarget', 'retentionTarget', 'winRateTarget'].forEach(h => assert(headers.indexOf(h) >= 0, h));
  const fys = [
    { id: 1, name: '第1期', startMonth: '2026-03', endMonth: '2027-02', salesTarget: 6500000, profitTarget: 1060000, active: true,
      newCustomerTarget: 5, retentionTarget: 82.5, winRateTarget: 40 },
    { id: 2, name: '第2期', startMonth: '2027-03', endMonth: '2028-02', salesTarget: 0, profitTarget: 0, active: false,
      newCustomerTarget: '', retentionTarget: '', winRateTarget: '' }
  ];
  // writeAll_ と同じ行の作り方で書いて、readFiscalYears_ で読む
  let rows = null;
  const sheet = { getLastRow: () => rows.length, getLastColumn: () => headers.length,
    getRange: () => ({ getValues: () => rows }) };
  const src = fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8');
  const m = /var fiscalYears = \(data\.fiscalYears \|\| \[\]\)\.map\((function \(f\) \{[\s\S]*?\n  \})\);/.exec(src);
  assert(m, 'writeAll_ の fiscalYears の行の作り方が見つかりません');
  const toRow = vm.runInContext('(' + m[1] + ')', gas);
  rows = [headers.slice()].concat(fys.map(toRow));
  assert.strictEqual(rows[1].length, headers.length);
  const back = plain(gas.readFiscalYears_(sheet));
  assert.deepStrictEqual(back.map(f => [f.newCustomerTarget, f.retentionTarget, f.winRateTarget]), [[5, 82.5, 40], ['', '', '']]);
  assert.deepStrictEqual(back.map(f => [f.salesTarget, f.startMonth, f.active]), [[6500000, '2026-03', true], [0, '2027-03', false]]);
  // 列が無い古いシートでも読める（目標は空）
  const old = headers.filter(h => ['newCustomerTarget', 'retentionTarget', 'winRateTarget'].indexOf(h) < 0);
  rows = [old, [3, '第3期', '2028-03', '2029-02', 1, 1, false]];
  const sheetOld = { getLastRow: () => rows.length, getLastColumn: () => old.length, getRange: () => ({ getValues: () => rows }) };
  assert.strictEqual(gas.readFiscalYears_(sheetOld)[0].newCustomerTarget, '');
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
