/* 請求書の下書き自動作成・編集（訂正・取消）のテスト
   実行: node tests/invoice-drafts.test.js

   - keiei-kanri.html は「@invoice-rules-begin」〜「@invoice-rules-end」の範囲だけを切り出して読む
   - gas-code.js はまるごと読み、quotes シートの1行への変換（quoteRow_ / quoteFromRow_）を往復させる */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

const gas = {};
vm.createContext(gas);
vm.runInContext(fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8'), gas);

const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@invoice-rules-begin');
const end = html.indexOf('@invoice-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @invoice-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { docStatusOf, invoiceDisplayNo, normalizeQuoteDoc, invoiceDetectYm,
  missingInvoiceTargets, createDraftInvoices, applyInvoiceEdit, cancelInvoiceDoc, canDeleteQuote,
  invoiceFileName, quoteFileName, invoiceMonthOf, invoiceKey, issueInvoiceDoc, isDraftId };`, app);
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
// vm の中で作った配列・オブジェクトは別レルムなので、JSON で通してから比べる
const plain = v => JSON.parse(JSON.stringify(v));

// 案件3件（進行中2・完了1）＋失注1、2026-10 の請求レコード
function fixture() {
  return {
    projects: [
      { id: 1, name: 'サイト保守', client: '株式会社アルファ', status: '進行中', amount: 100000 },
      { id: 2, name: '広告運用', client: '株式会社ベータ', status: '完了', amount: 50000 },
      { id: 3, name: 'SNS運用', client: '株式会社アルファ', status: '進行中', amount: 30000 },
      { id: 4, name: '失注案件', client: '株式会社ガンマ', status: '失注', amount: 80000 }
    ],
    monthlyBillings: [
      { id: 11, projectId: 1, billingMonth: '2026-10', amount: 100000, invoiceStatus: 'uninvoiced', invoiceId: null },
      { id: 12, projectId: 2, billingMonth: '2026-10', amount: 50000, invoiceStatus: 'uninvoiced', invoiceId: null },
      { id: 13, projectId: 3, billingMonth: '2026-10', amount: 30000, invoiceStatus: 'uninvoiced', invoiceId: null },
      { id: 14, projectId: 4, billingMonth: '2026-10', amount: 80000, invoiceStatus: 'uninvoiced', invoiceId: null },
      { id: 15, projectId: 1, billingMonth: '2026-11', amount: 100000, invoiceStatus: 'uninvoiced', invoiceId: null }
    ],
    quotes: []
  };
}
// 下書きの仮ID（アプリの newDraftId の代わり）
function idMaker() {
  let n = 1;
  return () => 'DRAFT-test-' + (n++);
}
// 請求書番号の採番（アプリの makeDocNumber の代わり）。呼ばれた回数だけ番号が進む
function numberer() {
  let n = 1;
  const f = () => 'INV-202611-' + String(n++).padStart(3, '0');
  f.used = () => n - 1;
  return f;
}

console.log('検出する月（アプリを開いた日）');

test('月末3日前〜月末は当月、翌月1〜10日は前月、それ以外は対象外', () => {
  assert.strictEqual(A.invoiceDetectYm('2026-11-27'), '2026-11');  // 30日の月：27日から
  assert.strictEqual(A.invoiceDetectYm('2026-11-30'), '2026-11');
  assert.strictEqual(A.invoiceDetectYm('2026-11-26'), null);
  assert.strictEqual(A.invoiceDetectYm('2026-12-01'), '2026-11');
  assert.strictEqual(A.invoiceDetectYm('2026-12-10'), '2026-11');
  assert.strictEqual(A.invoiceDetectYm('2026-12-11'), null);
  assert.strictEqual(A.invoiceDetectYm('2027-01-05'), '2026-12');  // 年またぎ
  assert.strictEqual(A.invoiceDetectYm('2028-02-26'), '2028-02');  // うるう年（29日）
  assert.strictEqual(A.invoiceDetectYm('2026-11-02'), '2026-10');
});

console.log('未作成の検出');

test('対象あり：進行中・完了の未請求レコードだけ（失注・別の月は除く）', () => {
  const D = fixture();
  const t = A.missingInvoiceTargets(D, '2026-10');
  assert.deepStrictEqual(plain(t.map(x => x.project.id)), [1, 2, 3]);
  assert.strictEqual(t[0].key, '2026-10|株式会社アルファ|1');
});

test('対象なし：すべて請求済・入金済なら0件', () => {
  const D = fixture();
  D.monthlyBillings.forEach(b => { b.invoiceStatus = b.id === 12 ? 'paid' : 'invoiced'; });
  assert.strictEqual(A.missingInvoiceTargets(D, '2026-10').length, 0);
});

test('作成済み混在：発行済み・下書きの請求書がある案件は除き、取消済みしか無い案件は対象に戻る', () => {
  const D = fixture();
  // 案件1：invoiceId で紐づく発行済み（status の無い既存データ）
  D.quotes.push({ id: 'INV-202610-001', type: '請求書', items: [{ projectId: 1 }] });
  D.monthlyBillings[0].invoiceId = 'INV-202610-001';
  // 案件2：同じキーの下書き
  D.quotes.push({ id: 'INV-202611-009', type: '請求書', status: 'draft',
    billingKey: '2026-10|株式会社ベータ|2', items: [{ projectId: 2 }] });
  // 案件3：取消済みの請求書だけ
  D.quotes.push({ id: 'INV-202610-002', type: '請求書', status: 'cancelled',
    billingMonth: '2026-10', items: [{ projectId: 3 }] });
  D.monthlyBillings[2].invoiceId = 'INV-202610-002';
  const t = A.missingInvoiceTargets(D, '2026-10');
  assert.deepStrictEqual(plain(t.map(x => x.project.id)), [3]);
});

test('見積書は請求書として数えない', () => {
  const D = fixture();
  D.quotes.push({ id: 'EST-1', type: '見積書', billingMonth: '2026-10', items: [{ projectId: 1 }] });
  assert.strictEqual(A.missingInvoiceTargets(D, '2026-10').length, 3);
});

console.log('下書きの作成・二重作成の防止');

test('下書きは status=draft・請求月・キー付きで作り、請求レコードに番号を入れる', () => {
  const D = fixture();
  const made = A.createDraftInvoices(D, '2026-10', { newId: idMaker(), note: '振込手数料はご負担ください' });
  assert.strictEqual(made.length, 3);
  const q = D.quotes[0];
  assert.strictEqual(q.status, 'draft');
  assert.strictEqual(q.type, '請求書');
  assert.strictEqual(q.billingMonth, '2026-10');
  assert.strictEqual(q.billingKey, '2026-10|株式会社アルファ|1');
  assert.strictEqual(q.client, '株式会社アルファ 御中');
  assert.strictEqual(q.date, '2026-10-31');
  assert.strictEqual(q.due, '2026-11-30');      // 請求月の翌月末
  assert.strictEqual(q.amount, 110000);
  assert.strictEqual(q.items[0].name, 'サイト保守（2026年10月分）');
  assert.strictEqual(q.note, '振込手数料はご負担ください');
  assert.strictEqual(D.monthlyBillings[0].invoiceId, q.id);
  assert.strictEqual(D.monthlyBillings[0].invoiceStatus, 'uninvoiced');  // 下書きでは請求済にしない
});

test('2回開いても1通だけ（2回目は0件）', () => {
  const D = fixture();
  const newId = idMaker();
  assert.strictEqual(A.createDraftInvoices(D, '2026-10', { newId }).length, 3);
  assert.strictEqual(A.createDraftInvoices(D, '2026-10', { newId }).length, 0);
  assert.strictEqual(D.quotes.length, 3);
  const keys = D.quotes.map(q => q.billingKey);
  assert.strictEqual(new Set(keys).size, 3);
});

test('請求レコードの invoiceId が消えても、同じキーの下書きがあれば作らない', () => {
  const D = fixture();
  A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  D.monthlyBillings.forEach(b => { b.invoiceId = null; });
  assert.strictEqual(A.createDraftInvoices(D, '2026-10', { newId: idMaker() }).length, 0);
});

test('同じ案件の請求レコードが重複していても1通だけ', () => {
  const D = fixture();
  D.monthlyBillings.push({ id: 99, projectId: 1, billingMonth: '2026-10', amount: 100000, invoiceStatus: 'uninvoiced' });
  const made = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  assert.strictEqual(made.filter(q => q.items[0].projectId === 1).length, 1);
});

console.log('下書きの編集');

test('下書きは自由に書き換えられ、履歴も枝番も付かない', () => {
  const D = fixture();
  const [q] = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  const r = A.applyInvoiceEdit(q, {
    client: '株式会社アルファ 経理部 御中', date: '2026-11-01', due: '2026-12-15', expire: '2026-12-15',
    items: [{ name: '保守', qty: 2, unit: 60000, projectId: 1 }], note: '備考を変更'
  });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.amountChanged, true);
  assert.strictEqual(q.amount, 132000);
  assert.strictEqual(q.items[0].total, 120000);
  assert.strictEqual(q.client, '株式会社アルファ 経理部 御中');
  assert.strictEqual(q.history.length, 0);
  assert.strictEqual(A.invoiceDisplayNo(q), '');     // 下書きは番号を出さない
  assert.strictEqual(q.status, 'draft');
});

test('下書きは削除できる／発行済み・取消済みは削除できない／見積書は従来どおり削除できる', () => {
  assert.strictEqual(A.canDeleteQuote({ type: '請求書', status: 'draft' }), true);
  assert.strictEqual(A.canDeleteQuote({ type: '請求書', status: 'issued' }), false);
  assert.strictEqual(A.canDeleteQuote({ type: '請求書' }), false);              // 既存データ
  assert.strictEqual(A.canDeleteQuote({ type: '請求書', status: 'cancelled' }), false);
  assert.strictEqual(A.canDeleteQuote({ type: '見積書' }), true);
});

console.log('請求書番号は発行時に採番');

test('下書きは仮ID（DRAFT-）で、表示する番号は空。作成しただけでは番号を消費しない', () => {
  const D = fixture();
  const next = numberer();
  const made = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  assert.strictEqual(made.length, 3);
  made.forEach(q => {
    assert.ok(A.isDraftId(q.id), q.id);
    assert.strictEqual(A.invoiceDisplayNo(q), '');
  });
  assert.strictEqual(next.used(), 0);
});

test('発行で番号が付き、請求レコードの invoiceId も付け替わる', () => {
  const D = fixture();
  const next = numberer();
  const [q] = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  const draftId = q.id;
  const r = A.issueInvoiceDoc(q, next(), D.monthlyBillings, '2026-11-02 12:00');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.oldId, draftId);
  assert.strictEqual(q.id, 'INV-202611-001');
  assert.strictEqual(q.status, 'issued');
  assert.strictEqual(q.issuedAt, '2026-11-02 12:00');
  assert.strictEqual(A.invoiceDisplayNo(q), 'INV-202611-001');
  assert.strictEqual(D.monthlyBillings[0].invoiceId, 'INV-202611-001');
  assert.ok(!D.monthlyBillings.some(b => b.invoiceId === draftId));
  // 発行済みをもう一度発行はできない
  assert.strictEqual(A.issueInvoiceDoc(q, next(), D.monthlyBillings, 'x').ok, false);
  // 番号を付け替えても、同じ月・同じ案件の下書きは作り直さない
  assert.strictEqual(A.createDraftInvoices(D, '2026-10', { newId: idMaker() }).length, 0);
});

test('下書きを削除しても欠番が出ない（発行した順に連番）', () => {
  const D = fixture();
  const next = numberer();
  const made = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  // 2通目の下書きを削除（アプリの deleteQuote と同じく、レコードの invoiceId も外す）
  const del = made[1];
  D.quotes = D.quotes.filter(q => q.id !== del.id);
  D.monthlyBillings.forEach(b => { if (b.invoiceId === del.id) b.invoiceId = null; });
  const nos = D.quotes.map(q => { A.issueInvoiceDoc(q, next(), D.monthlyBillings, 't'); return q.id; });
  assert.deepStrictEqual(plain(nos), ['INV-202611-001', 'INV-202611-002']);
  // 削除した案件は未作成に戻り、次に作る下書きも番号なし
  const again = A.createDraftInvoices(D, '2026-10', { newId: idMaker() });
  assert.strictEqual(again.length, 1);
  assert.strictEqual(A.invoiceDisplayNo(again[0]), '');
  A.issueInvoiceDoc(again[0], next(), D.monthlyBillings, 't');
  assert.strictEqual(again[0].id, 'INV-202611-003');
});

test('番号付きで作られていた古い下書きは、発行してもその番号のまま（新しい番号を消費しない）', () => {
  const next = numberer();
  const q = A.normalizeQuoteDoc({ id: 'INV-202611-007', type: '請求書', status: 'draft', items: [] });
  assert.strictEqual(A.invoiceDisplayNo(q), '');
  const r = A.issueInvoiceDoc(q, '', [], 't');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(q.id, 'INV-202611-007');
  assert.strictEqual(next.used(), 0);
});

test('仮IDの下書きに番号が渡されなければ発行しない', () => {
  const q = { id: 'DRAFT-x', type: '請求書', status: 'draft', items: [] };
  assert.strictEqual(A.issueInvoiceDoc(q, '', [], 't').ok, false);
  assert.strictEqual(q.status, 'draft');
});

console.log('発行済みの訂正・取消');

function issued() {
  return A.normalizeQuoteDoc({
    id: 'INV-202610-003', type: '請求書', subject: '10月分 ご請求', client: '株式会社ベータ 御中',
    amount: 55000, date: '2026-10-31', due: '2026-11-30', expire: '2026-11-30',
    items: [{ name: '広告運用', qty: 1, unit: 50000, total: 50000, projectId: 2 }], note: ''
  });
}

test('訂正は理由が必須（理由なしは何も変えない）', () => {
  const q = issued();
  const r = A.applyInvoiceEdit(q, { items: [{ name: '広告運用', qty: 1, unit: 45000 }] }, { reason: '  ' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(q.amount, 55000);
  assert.strictEqual(q.history.length, 0);
});

test('訂正すると履歴（日時・変更前・変更後・理由）が残り、枝番 -2 が付く。番号は変えない', () => {
  const q = issued();
  const r = A.applyInvoiceEdit(q,
    { items: [{ name: '広告運用', qty: 1, unit: 45000, projectId: 2 }] },
    { reason: '値引きの反映漏れ', at: '2026-11-02 10:15' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.beforeAmount, 55000);
  assert.strictEqual(q.amount, 49500);
  assert.strictEqual(q.id, 'INV-202610-003');
  assert.strictEqual(q.revision, 2);
  assert.strictEqual(A.invoiceDisplayNo(q), 'INV-202610-003-2');
  assert.strictEqual(q.history.length, 1);
  const h = q.history[0];
  assert.strictEqual(h.at, '2026-11-02 10:15');
  assert.strictEqual(h.reason, '値引きの反映漏れ');
  assert.strictEqual(h.kind, 'correct');
  assert.strictEqual(h.revision, 2);
  assert.strictEqual(h.before.amount, 55000);
  assert.strictEqual(h.after.amount, 49500);
  assert.strictEqual(h.before.items[0].unit, 50000);
  assert.deepStrictEqual(plain(h.changed), ['items', 'amount']);
  // 2回目の訂正は -3
  A.applyInvoiceEdit(q, { note: '振込先変更のお知らせ' }, { reason: '備考追加', at: '2026-11-03 09:00' });
  assert.strictEqual(A.invoiceDisplayNo(q), 'INV-202610-003-3');
  assert.strictEqual(q.history.length, 2);
  assert.strictEqual(q.history[1].before.note, '');
});

test('変更が無ければ訂正扱いにしない（枝番も履歴も増えない）', () => {
  const q = issued();
  const r = A.applyInvoiceEdit(q, { subject: '10月分 ご請求' }, { reason: 'x' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed.length, 0);
  assert.strictEqual(q.revision, 1);
  assert.strictEqual(q.history.length, 0);
});

test('一括請求書（端数切り捨て）を開いて保存しただけなら、金額は変えず訂正にもしない', () => {
  // 小計 12,345 → 一括請求書は floor(12345*1.1)=13,579、帳票の式なら 13,580
  const q = A.normalizeQuoteDoc({ id: 'INV-202610-010', type: '請求書', subject: 's', client: 'A 御中',
    amount: 13579, date: '2026-10-31', due: '2026-11-30', expire: '2026-11-30', paymentMethod: '',
    items: [{ name: 'x', qty: 1, unit: 12345, total: 12345, projectId: 1 }], note: '' });
  const r = A.applyInvoiceEdit(q, { subject: 's', items: plain(q.items), paymentMethod: '', isMonthly: false,
    contractStart: '', contractEnd: '' }, { reason: '' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.changed.length, 0);
  assert.strictEqual(q.amount, 13579);
  // 備考だけ直す訂正でも金額はそのまま
  A.applyInvoiceEdit(q, { note: '追記' }, { reason: '備考', at: 't' });
  assert.strictEqual(q.amount, 13579);
  assert.deepStrictEqual(plain(q.history[0].changed), ['note']);
});

test('取消は理由必須で status=cancelled・履歴に残る。取消後は編集できない', () => {
  const q = issued();
  assert.strictEqual(A.cancelInvoiceDoc(q, '', 'x').ok, false);
  const r = A.cancelInvoiceDoc(q, '先方の発注取り消し', '2026-11-02 11:00');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(q.status, 'cancelled');
  assert.strictEqual(q.cancelReason, '先方の発注取り消し');
  assert.strictEqual(q.history[0].kind, 'cancel');
  assert.strictEqual(A.applyInvoiceEdit(q, { note: 'x' }, { reason: 'x' }).ok, false);
  assert.strictEqual(A.cancelInvoiceDoc(q, 'もう一度', 'x').ok, false);
});

console.log('既存の請求書を壊さない');

test('status の無い既存データは発行済み・第1版として読む（他の項目は変えない）', () => {
  const old = { id: 'INV-202609-001', type: '請求書', subject: '9月分', client: 'A 御中', amount: 11000,
    date: '2026-09-30', due: '2026-10-31', items: [{ name: 'x', qty: 1, unit: 10000, total: 10000 }], note: 'n',
    source: 'drive_sync', driveFileId: 'abc' };
  const before = JSON.stringify(old);
  const q = A.normalizeQuoteDoc(JSON.parse(before));
  assert.strictEqual(q.status, 'issued');
  assert.strictEqual(q.revision, 1);
  assert.strictEqual(A.invoiceDisplayNo(q), 'INV-202609-001');
  Object.keys(old).forEach(k => assert.deepStrictEqual(plain(q[k]), plain(old[k]), k));
});

test('GASのシート行に書いて読み直しても、状態・履歴・枝番・請求月が消えない', () => {
  const q = issued();
  A.applyInvoiceEdit(q, { items: [{ name: '広告運用', qty: 1, unit: 45000, projectId: 2 }] },
    { reason: '値引き', at: '2026-11-02 10:15' });
  q.billingMonth = '2026-10';
  q.billingKey = '2026-10|株式会社ベータ|2';
  q.issuedAt = '2026-10-31 18:00';
  const row = gas.quoteRow_(q);
  assert.strictEqual(row.length, gas.SHEET_DEFS.quotes.length);
  const obj = {};
  gas.SHEET_DEFS.quotes.forEach((h, i) => { obj[h] = row[i]; });
  const back = gas.quoteFromRow_(obj);
  ['id', 'amount', 'status', 'revision', 'billingMonth', 'billingKey', 'issuedAt', 'client', 'due']
    .forEach(k => assert.deepStrictEqual(plain(back[k]), plain(q[k]), k));
  assert.deepStrictEqual(plain(back.history), plain(q.history));
  assert.deepStrictEqual(plain(back.items), plain(q.items));
  assert.strictEqual(A.invoiceDisplayNo(A.normalizeQuoteDoc(plain(back))), 'INV-202610-003-2');
});

test('GAS：新しい列が空の既存行は発行済み・第1版・履歴なしで読む', () => {
  const obj = { id: 'INV-202609-001', subject: '9月分', client: 'A 御中', amount: 11000, type: '請求書',
    date: '2026-09-30', items: '[{"name":"x","qty":1,"unit":10000,"total":10000}]', note: '' };
  const q = gas.quoteFromRow_(obj);
  assert.strictEqual(q.status, 'issued');
  assert.strictEqual(q.revision, 1);
  assert.deepStrictEqual(plain(q.history), []);
  assert.strictEqual(q.items[0].unit, 10000);
  // 下書き・取消はそのまま往復する
  ['draft', 'cancelled'].forEach(st => {
    const row = gas.quoteRow_(Object.assign({}, q, { status: st }));
    const o = {};
    gas.SHEET_DEFS.quotes.forEach((h, i) => { o[h] = row[i]; });
    assert.strictEqual(gas.quoteFromRow_(o).status, st);
  });
});

console.log('ファイル名');

test('【アスリンク請求書（2026年11月）分】_株式会社○○御中', () => {
  const q = { client: '株式会社テスト 御中', billingMonth: '2026-11', date: '2026-11-30' };
  assert.strictEqual(A.invoiceFileName(q, '2026-11'), '【アスリンク請求書（2026年11月）分】_株式会社テスト御中');
  // ファイル名に使えない文字は _ に
  assert.strictEqual(A.invoiceFileName({ client: 'A/B:C' }, '2026-01'), '【アスリンク請求書（2026年1月）分】_A_B_C御中');
});

test('見積書：【アスリンク見積書（年月）分】_会社名御中（年月は契約開始月 → 請求月 → 見積日の月）', () => {
  assert.strictEqual(A.quoteFileName({ client: '株式会社テスト 御中', contractStart: '2026-10', date: '2026-09-20' }), '【アスリンク見積書（2026年10月）分】_株式会社テスト御中');
  assert.strictEqual(A.quoteFileName({ client: '株式会社テスト', date: '2026-09-20' }), '【アスリンク見積書（2026年9月）分】_株式会社テスト御中');
  assert.strictEqual(A.quoteFileName({ client: '', billingMonth: '2027-01', date: '2026-12-01' }), '【アスリンク見積書（2027年1月）分】_宛先未設定御中');
  assert.strictEqual(A.quoteFileName({ client: 'A/B:C', date: '2026-01-05' }), '【アスリンク見積書（2026年1月）分】_A_B_C御中');
});

test('請求月は 書類の billingMonth → 紐づく請求レコード → 請求日の月 の順', () => {
  assert.strictEqual(A.invoiceMonthOf({ id: 'X', billingMonth: '2026-10', date: '2026-11-05' }, []), '2026-10');
  assert.strictEqual(A.invoiceMonthOf({ id: 'X', date: '2026-11-05' },
    [{ invoiceId: 'X', billingMonth: '2026-10' }]), '2026-10');
  assert.strictEqual(A.invoiceMonthOf({ id: 'X', date: '2026-11-05' }, []), '2026-11');
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
