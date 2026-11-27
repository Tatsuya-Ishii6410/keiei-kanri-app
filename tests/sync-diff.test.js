// 未送信モーダルの比較（buildSyncDiff）のテスト。keiei-kanri.html の「@sync-diff-rules-begin〜end」を切り出して Node で読む
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@sync-diff-rules-begin');
const end = html.indexOf('@sync-diff-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @sync-diff-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + '\nglobalThis.exported = { buildSyncDiff };', app);
const { buildSyncDiff } = app.exported;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}
const row = (d, key) => d.rows.find(r => r.key === key);
const base = () => ({
  projects: [{ id: 1, name: 'A案件', amount: 100000 }], quotes: [{ id: 'Q1', client: 'X社 御中', amount: 55000 }],
  ledger: [{ id: 1, date: '2026-11-01', desc: '売上入金', amount: 1000 }], monthlyBillings: [{ id: 1 }], fixedCosts: [], fiscalYears: [{ id: 1 }]
});

console.log('端末とシートの比較（buildSyncDiff）');

test('件数の差：項目ごとの件数が出て、違う行だけ diff', () => {
  const l = base(), r = base();
  l.projects.push({ id: 2, name: 'B案件', amount: 20000 }); r.ledger.push({ id: 2, date: '2026-11-02', desc: '経費', amount: 500 });
  const d = buildSyncDiff(l, r);
  assert.deepStrictEqual([...d.rows.map(x => x.key)], ['projects', 'quotes', 'ledger', 'monthlyBillings', 'fixedCosts', 'fiscalYears']);
  assert.strictEqual(row(d, 'projects').local, 2); assert.strictEqual(row(d, 'projects').remote, 1); assert.strictEqual(row(d, 'projects').diff, true);
  assert.strictEqual(row(d, 'ledger').diff, true); assert.strictEqual(row(d, 'quotes').diff, false);
  assert.strictEqual(d.same, false);
});

test('片方だけの項目：id の集合差。ラベルは 案件＝名前＋金額／見積＝宛先＋金額／収支＝日付＋内容＋金額。最大3件＋総数', () => {
  const l = base(), r = base();
  l.projects.push({ id: 2, name: 'B案件', amount: 20000 });
  r.quotes.push({ id: 'Q2', client: 'Y社 御中', amount: 11000 });
  for (let i = 10; i < 15; i++) l.ledger.push({ id: i, date: '2026-11-1' + (i - 10), desc: '交通費' + i, amount: i * 100 });
  const d = buildSyncDiff(l, r);
  assert.deepStrictEqual([...d.onlyLocal.projects.items], ['B案件（¥20,000）']);
  assert.deepStrictEqual([...d.onlyRemote.quotes.items], ['Y社 御中（¥11,000）']);
  assert.strictEqual(d.onlyLocal.ledger.n, 5); assert.strictEqual(d.onlyLocal.ledger.items.length, 3);
  assert.strictEqual(d.onlyLocal.ledger.items[0], '2026-11-10 交通費10（¥1,000）');
  assert.strictEqual(d.onlyRemote.projects.n, 0);
  assert.strictEqual(d.same, false);
});

test('差なし：件数も片方だけの項目も無い（金額や内容だけの違いは same＝true）', () => {
  const l = base(), r = base(); r.projects[0].amount = 999;   // 内容の違いは件数では見えない
  const d = buildSyncDiff(l, r);
  assert.strictEqual(d.same, true);
  assert.ok(d.rows.every(x => !x.diff));
  assert.strictEqual(d.onlyLocal.projects.n + d.onlyRemote.projects.n + d.onlyLocal.ledger.n, 0);
});

test('欠けた項目・空のデータでも落ちない（配列でなければ0件）', () => {
  const d = buildSyncDiff({}, null);
  assert.ok(d.rows.every(x => x.local === 0 && x.remote === 0)); assert.strictEqual(d.same, true);
  assert.strictEqual(row(buildSyncDiff({ projects: [{ id: 1, name: 'a', amount: 1 }] }, { projects: 'x' }), 'projects').remote, 0);
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
