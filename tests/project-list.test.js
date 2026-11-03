// 案件管理の一覧の判定（projectListState・projectInMonth）のテスト
// keiei-kanri.html の「@project-rules-begin〜end」と、売上と同じ期間の関数 projectMonthRange を切り出して Node で読む
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@project-rules-begin');
const end = html.indexOf('@project-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @project-rules の範囲が見つかりません');
// 関数を名前で切り出す（波かっこの対応で終わりを探す）
function fnSource(name) {
  const i = html.indexOf('function ' + name + '(');
  assert(i > 0, name + ' が見つかりません');
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1);
}
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + '\n' + fnSource('projectMonthRange') + '\n' + fnSource('normClientName') + `
globalThis.exported = { projectListState, projectInMonth, projectMonthRange, absYm, invoiceProjectCandidates };`, app);
const A = app.exported;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const abs = (y, m) => y * 12 + (m - 1);
const NOV = abs(2026, 11), OCT = abs(2026, 10);
const P = (o) => Object.assign({ id: 1, status: '進行中', contract: 'monthly', start: '', end: '', amount: 100000 }, o);
const st = (p, a, billings, opt) => A.projectListState(p, a, A.projectMonthRange(p), billings || [], Object.assign({ nowAbs: NOV }, opt));

console.log('案件管理の一覧（選んだ月）');

test('前月末で終わった月次の案件 → 翌月に出ない（期間内の月には出る）', () => {
  const p = P({ start: '2026-05-01', end: '2026-10-31', status: '完了' });
  assert.strictEqual(st(p, NOV).show, false);
  assert.strictEqual(st(p, OCT).show, true);
  assert.strictEqual(st(p, OCT).inRange, true);
});

test('年を見る：去年の同じ月を含む案件・去年の単発は、今年の同じ月に出ない', () => {
  assert.strictEqual(st(P({ start: '2025-06-01', end: '2026-10-31', status: '完了' }), NOV).show, false);
  assert.strictEqual(st(P({ contract: 'single', start: '2025-11-10', status: '完了' }), NOV).show, false);
  assert.strictEqual(st(P({ start: '2025-06-01', end: '2026-10-31', status: '完了' }), abs(2025, 11)).show, true);
});

test('単発 → 売上月（開始月）だけに出る', () => {
  const p = P({ contract: 'single', start: '2026-10-15', end: '2026-12-31', status: '完了' });
  assert.strictEqual(st(p, OCT).show, true);
  assert.strictEqual(st(p, NOV).show, false);
  assert.strictEqual(st(p, abs(2026, 9)).show, false);
});

test('年をまたぐ契約期間 → 期間内の月はすべて出る', () => {
  const p = P({ start: '2026-12-01', end: '2027-03-31', status: '契約済' });
  [abs(2026, 12), abs(2027, 1), abs(2027, 3)].forEach(a => assert.strictEqual(st(p, a).show, true, A.absYm(a)));
  assert.strictEqual(st(p, NOV).show, false);
  assert.strictEqual(st(p, abs(2027, 4)).show, false);
});

test('前の月の請求済み・未入金 → 期間外でも「繰越」の印で出る（入金済み・未請求は出さない）', () => {
  const p = P({ id: 7, contract: 'single', start: '2026-09-10', status: '完了' });
  const b = s => [{ projectId: 7, billingMonth: '2026-09', invoiceStatus: s }];
  const r = st(p, NOV, b('invoiced'));
  assert.strictEqual(r.show, true);
  assert.strictEqual(r.inRange, false);
  assert.strictEqual(r.carryMark, true);
  assert.deepStrictEqual([...r.carry], ['2026-09']);
  assert.strictEqual(st(p, NOV, b('paid')).show, false);
  assert.strictEqual(st(p, NOV, b('uninvoiced')).show, false);
  // 期間内の月では繰越の印を付けない（その月の売上として出る）。後の月の請求済みは繰越にしない
  assert.strictEqual(st(p, abs(2026, 9), b('invoiced')).carryMark, false);
  assert.strictEqual(st(p, abs(2026, 8), b('invoiced')).show, false);
  // 別の案件の請求レコードは見ない
  assert.strictEqual(st(P({ id: 8, contract: 'single', start: '2026-09-10', status: '完了' }), NOV, b('invoiced')).show, false);
});

test('期間外の請求レコード（未請求）は、出す理由にしない', () => {
  const p = P({ id: 4, contract: 'single', start: '2026-10-15', status: '完了' });
  assert.strictEqual(st(p, NOV, [{ projectId: 4, billingMonth: '2026-11', invoiceStatus: 'uninvoiced' }]).show, false);
});

test('終了日が空の月次 → 売上と同じく開始月だけ＋「終了日が未設定」の印', () => {
  const p = P({ start: '2026-04-01', end: '' });
  assert.deepStrictEqual([...A.projectMonthRange(p)], [abs(2026, 4), abs(2026, 4)]);
  assert.strictEqual(st(p, abs(2026, 4)).show, true);
  assert.strictEqual(st(p, abs(2026, 4)).noEnd, true);
  assert.strictEqual(st(p, abs(2026, 5)).show, false);
  // 単発・終了日ありは印なし
  assert.strictEqual(st(P({ contract: 'single', start: '2026-04-01' }), abs(2026, 4)).noEnd, false);
  assert.strictEqual(st(P({ start: '2026-04-01', end: '2026-09-30' }), abs(2026, 4)).noEnd, false);
});

test('見込み（商談中）・失注 → 案件のタブに出ない（全期間でも）', () => {
  ['商談中', '失注'].forEach(s => {
    const p = P({ status: s, start: '2026-11-01', end: '2027-03-31' });
    assert.strictEqual(st(p, NOV).show, false, s);
    assert.strictEqual(st(p, null).show, false, s);
  });
});

test('終了した案件も表示：オンのときだけ、期間が終わった案件を「終了」で出す（期間前の案件は出さない）', () => {
  const ended = P({ start: '2026-05-01', end: '2026-10-31', status: '完了' });
  assert.strictEqual(st(ended, NOV, [], { showEnded: true }).show, true);
  assert.strictEqual(st(ended, NOV, [], { showEnded: true }).ended, true);
  const future = P({ start: '2026-12-01', end: '2027-03-31', status: '契約済' });
  assert.strictEqual(st(future, NOV, [], { showEnded: true }).show, false);
});

console.log('全期間');

test('全期間：今月より前に終わった案件と「完了」はオフでは出さない。繰越があれば出す', () => {
  assert.strictEqual(st(P({ start: '2026-05-01', end: '2026-10-31', status: '進行中' }), null).show, false);
  assert.strictEqual(st(P({ start: '2026-05-01', end: '2027-03-31', status: '完了' }), null).show, false);
  assert.strictEqual(st(P({ start: '2026-05-01', end: '2027-03-31', status: '進行中' }), null).show, true);
  assert.strictEqual(st(P({ start: '2026-05-01', end: '2026-10-31', status: '完了' }), null, [], { showEnded: true }).show, true);
  const c = st(P({ id: 3, start: '2026-05-01', end: '2026-10-31', status: '完了' }), null, [{ projectId: 3, billingMonth: '2026-10', invoiceStatus: 'invoiced' }]);
  assert.strictEqual(c.show, true);
  assert.strictEqual(c.carryMark, true);
  // 開始日が無い案件（期間が分からない）は、全期間でだけ出す
  assert.strictEqual(st(P({ start: '' }), null).show, true);
  assert.strictEqual(st(P({ start: '' }), NOV).show, false);
});

console.log('一括請求書作成・一括ステータス変更の対象（projectInMonth）');

test('年＋月で、その月が契約期間に入るときだけ', () => {
  const r = A.projectMonthRange(P({ start: '2025-06-01', end: '2026-10-31' }));
  assert.strictEqual(A.projectInMonth(r, abs(2025, 11)), true);
  assert.strictEqual(A.projectInMonth(r, NOV), false);
  assert.strictEqual(A.projectInMonth(null, NOV), false);
});

console.log('ドライブの請求書同期：付ける案件の候補（invoiceProjectCandidates）');
const cands = (projects, client, a) => [...A.invoiceProjectCandidates(projects, client, a, A.projectMonthRange)].map(p => p.id);

test('同じ取引先に古い案件と今の案件 → その月が契約期間に入る今の案件だけ', () => {
  const ps = [P({ id: 1, client: '株式会社フラックスブルーム', start: '2025-04-01', end: '2026-03-31', status: '完了' }),
    P({ id: 2, client: '株式会社フラックスブルーム', start: '2026-04-01', end: '2027-03-31', status: '進行中' })];
  assert.deepStrictEqual(cands(ps, '株式会社フラックスブルーム', OCT), [2]);
  assert.deepStrictEqual(cands(ps, '株式会社フラックスブルーム', abs(2026, 1)), [1]);
});

test('商談中・失注には付けない（契約済・進行中・完了だけ）', () => {
  ['商談中', '失注'].forEach(s => assert.deepStrictEqual(cands([P({ id: 3, client: 'A社', start: '2026-10-01', end: '2027-03-31', status: s })], 'A社', OCT), [], s));
  ['契約済', '進行中', '完了'].forEach(s => assert.deepStrictEqual(cands([P({ id: 3, client: 'A社', start: '2026-10-01', end: '2027-03-31', status: s })], 'A社', OCT), [3], s));
});

test('部分一致の別会社には付けない。表記ゆれ（株式会社・(株)・全角半角・空白・御中）はそろえて完全一致', () => {
  const ps = [P({ id: 5, client: 'テスト商事', start: '2026-10-01', end: '2027-03-31' })];
  assert.deepStrictEqual(cands(ps, 'テスト', OCT), []);
  assert.deepStrictEqual(cands(ps, 'テスト商事ホールディングス', OCT), []);
  assert.deepStrictEqual(cands([P({ id: 6, client: '株式会社ＡＢＣ', start: '2026-10-01', end: '2027-03-31' })], '(株) ABC 御中', OCT), [6]);
});

test('候補が0件（取引先の案件が無い・期間外）／2件以上（同じ取引先で期間内の案件が複数）', () => {
  const ps = [P({ id: 7, client: 'B社', start: '2026-01-01', end: '2026-06-30' }),
    P({ id: 8, client: 'C社', start: '2026-10-01', end: '2027-03-31' }), P({ id: 9, client: 'C社', contract: 'single', start: '2026-10-20', status: '完了' })];
  assert.deepStrictEqual(cands(ps, 'B社', OCT), []);
  assert.deepStrictEqual(cands(ps, 'D社', OCT), []);
  assert.deepStrictEqual(cands(ps, 'C社', OCT), [8, 9]);
  assert.deepStrictEqual(cands(ps, '', OCT), []);
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
