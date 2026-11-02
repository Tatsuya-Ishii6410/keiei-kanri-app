/* 領収書の写真から経費登録・「誰と」「用件」のテスト
   実行: node tests/receipt-import.test.js

   - gas-code.js はまるごと読む。AIの呼び出し（UrlFetchApp）・PropertiesService・DriveApp はモックに差し替える
   - keiei-kanri.html は「@import-rules-begin」〜「@import-rules-end」の範囲だけを切り出して読む */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

// ---- GAS（モック付き） ----
const gas = {};
vm.createContext(gas);
vm.runInContext(fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8'), gas);
let fetchMock = null;     // (url, opts) => {code, body}
let fetchCalls = [];
gas.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k === 'ANTHROPIC_API_KEY' ? 'sk-ant-test' : null) }) };
gas.UrlFetchApp = {
  fetch: (url, opts) => {
    fetchCalls.push({ url, opts });
    const r = fetchMock(url, opts);
    return { getResponseCode: () => r.code, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
  }
};
const aiReply = text => ({ code: 200, body: { content: [{ type: 'text', text }] } });

// ---- アプリの判定 ----
const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@import-rules-begin');
const end = html.indexOf('@import-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @import-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { nearExpenses, receiptDupOf, expenseEntryError, perPersonAmount, recentValues,
  receiptFormFrom, receiptTaxWarnings, rcptExtId, bankDupFlags };`, app);
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
const CATS = ['家賃（レンタルオフィス利用料）', '通信料', 'システム利用料', '交通費', '交際費', 'その他経費'];

console.log('AIの返答JSONの解析');

test('正常：全項目を読み取り、確信度もそろえる', () => {
  const r = gas.parseReceiptReply_('```json\n' + JSON.stringify({
    date: '2026/11/01', total: 6600, payee: '居酒屋 さくら', item: 'ご飲食代', taxType: '税込',
    taxes: [{ rate: 10, base: 6600, tax: 600 }], invoiceNo: 'T1234-5678-90123', paymentMethod: 'クレジットカード',
    category: '交際費', confidence: { date: 'high', total: '高', payee: '中', item: 'low' }
  }) + '\n```', CATS);
  assert.strictEqual(r.ok, true);
  const d = r.data;
  assert.strictEqual(d.date, '2026-11-01');
  assert.strictEqual(d.total, 6600);
  assert.strictEqual(d.payee, '居酒屋 さくら');
  assert.strictEqual(d.taxType, '税込');
  assert.deepStrictEqual(plain(d.taxes), [{ rate: 10, base: 6600, tax: 600 }]);
  assert.strictEqual(d.invoiceNo, 'T1234567890123');
  assert.strictEqual(d.category, '交際費');
  assert.deepStrictEqual([d.confidence.date, d.confidence.total, d.confidence.payee, d.confidence.item, d.confidence.invoiceNo],
    ['高', '高', '中', '低', '']);
});

test('空欄あり：null・記載なしは空のまま（推測で埋めない）', () => {
  const r = gas.parseReceiptReply_(JSON.stringify({
    date: null, total: null, payee: 'ローソン', item: null, taxType: null, taxes: [],
    invoiceNo: null, paymentMethod: null, category: '存在しない区分'
  }), CATS);
  assert.strictEqual(r.ok, true);
  const d = r.data;
  assert.strictEqual(d.date, '');
  assert.strictEqual(d.total, null);
  assert.strictEqual(d.item, '');
  assert.strictEqual(d.taxType, '');
  assert.strictEqual(d.invoiceNo, '');
  assert.strictEqual(d.category, '');         // 既存の区分にないものは空
  const f = A.receiptFormFrom(d);
  assert.strictEqual(f.date, '');
  assert.strictEqual(f.amount, '');           // 金額も空欄（0 にしない）
  assert.strictEqual(f.type, 'その他経費');
  assert.strictEqual(f.desc, 'ローソン');
});

test('壊れたJSON：ok=false で理由を返す', () => {
  const r = gas.parseReceiptReply_('読み取れませんでした {"date": "2026-11-01", "total": ', CATS);
  assert.strictEqual(r.ok, false);
  assert.ok(/JSON/.test(r.error));
  assert.strictEqual(gas.parseReceiptReply_('', CATS).ok, false);
});

test('金額が文字列：「¥1,234」「1,234円」「１２３４」も数値に。読めない文字列は空', () => {
  const amt = v => gas.parseReceiptReply_(JSON.stringify({ total: v }), CATS).data.total;
  assert.strictEqual(amt('¥1,234'), 1234);
  assert.strictEqual(amt('1,234円'), 1234);
  assert.strictEqual(amt('１２３４'), 1234);
  assert.strictEqual(amt('1234.6'), 1235);
  assert.strictEqual(amt('不明'), null);
  const t = gas.parseReceiptReply_(JSON.stringify({ taxes: [{ rate: '10%', base: '¥3,300', tax: '300' }, { rate: 5, base: 1 }] }), CATS).data.taxes;
  assert.deepStrictEqual(plain(t), [{ rate: 10, base: 3300, tax: 300 }]);   // 8%・10%以外は捨てる
});

console.log('AIの呼び出し（モック）');

test('receiptRead_：画像をAPIに渡し、結果を整えて返す', () => {
  fetchCalls = [];
  fetchMock = () => aiReply('{"date":"2026-11-02","total":"3,300","payee":"カフェ","category":"交際費"}');
  const r = gas.receiptRead_('data:image/jpeg;base64,AAAA', CATS);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.total, 3300);
  const payload = JSON.parse(fetchCalls[0].opts.payload);
  assert.strictEqual(payload.messages[0].content[0].type, 'image');
  assert.strictEqual(payload.messages[0].content[0].source.data, 'AAAA');   // data: の前置きは外す
  assert.ok(payload.messages[0].content[1].text.indexOf('交際費') >= 0);   // 区分の候補を渡している
});

test('receiptRead_：クレジット不足・キー無効は理由を返す', () => {
  fetchMock = () => ({ code: 400, body: { error: { message: 'Your credit balance is too low to access the Anthropic API.' } } });
  const r1 = gas.receiptRead_('AAAA', CATS);
  assert.strictEqual(r1.ok, false);
  assert.ok(/クレジット残高が不足/.test(r1.error), r1.error);
  fetchMock = () => ({ code: 401, body: { error: { message: 'invalid x-api-key' } } });
  assert.ok(/APIキーが無効/.test(gas.receiptRead_('AAAA', CATS).error));
  fetchMock = () => ({ code: 529, body: { error: { message: 'Overloaded' } } });
  assert.ok(/混雑/.test(gas.receiptRead_('AAAA', CATS).error));
  fetchMock = () => aiReply('すみません、読めません');
  assert.strictEqual(gas.receiptRead_('AAAA', CATS).ok, false);
});

test('保存ファイル名：YYYYMMDD_支払先_金額.jpg、年月フォルダ名', () => {
  assert.strictEqual(gas.receiptFileName_('2026-11-02', '居酒屋 さくら', 6600), '20261102_居酒屋 さくら_6600.jpg');
  assert.strictEqual(gas.receiptFileName_('2026-11-02', 'A/B:C', '1,100'), '20261102_A_B_C_1100.jpg');
  assert.strictEqual(gas.receiptFileName_('', '', ''), '日付不明_支払先不明_0.jpg');
  assert.strictEqual(gas.receiptMonthFolderName_('2026-11-02'), '2026年11月');
});

console.log('交際費の必須項目');

test('交際費で「誰と」「用件」が空だと保存できない', () => {
  assert.ok(/誰と.*用件/.test(A.expenseEntryError({ type: '交際費', withWhom: '', purpose: '' })));
  assert.ok(/誰と/.test(A.expenseEntryError({ type: '交際費', withWhom: ' ', purpose: '打合せ' })));
  assert.ok(/用件/.test(A.expenseEntryError({ type: '交際費', withWhom: '山田様', purpose: '' })));
  assert.strictEqual(A.expenseEntryError({ type: '交際費', withWhom: '山田様', purpose: '打合せ' }), '');
  assert.strictEqual(A.expenseEntryError({ type: 'その他経費', withWhom: '', purpose: '' }), '');   // 交際費以外は任意
});

test('1人あたりの金額', () => {
  assert.strictEqual(A.perPersonAmount(10000, 3), 3333);
  assert.strictEqual(A.perPersonAmount(10000, ''), null);
  assert.strictEqual(A.perPersonAmount(10000, 0), null);
});

test('最近使った用件（新しい順・重複なし）', () => {
  const ledger = [
    { id: 1, date: '2026-10-01', purpose: '定例会' },
    { id: 2, date: '2026-10-20', purpose: '新規提案' },
    { id: 3, date: '2026-10-15', purpose: '定例会' },
    { id: 4, date: '2026-10-25', purpose: '' }
  ];
  assert.deepStrictEqual(plain(A.recentValues(ledger, 'purpose', 5)), ['新規提案', '定例会']);
});

console.log('重複判定');

const LEDGER = [
  { id: 1, date: '2026-11-01', type: '交際費', desc: '居酒屋', amount: 6600, status: 'actual' },
  { id: 2, date: '2026-11-03', type: 'その他経費', desc: 'NEXT（Visaデビット）', amount: 4323, status: 'actual', calId: 'mail:abc' },
  { id: 3, date: '2026-11-02', type: '売上', desc: '入金', amount: 9999, status: 'actual' },
  { id: 4, date: '2026-11-02', type: 'その他経費', desc: '予定', amount: 5000, status: 'planned_out' }
];

test('同日・同額は重複の可能性', () => {
  const d = A.receiptDupOf(LEDGER, '2026-11-01', 6600);
  assert.strictEqual(d && d.id, 1);
});

test('前後1日・同額も重複の可能性（デビット通知の取込分も対象）', () => {
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-02', 6600).id, 1);
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-02', '4323').id, 2);
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-03', 6600), null);   // 2日ずれは対象外
});

test('別金額・売上・予定は重複にしない', () => {
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-01', 6601), null);
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-02', 9999), null);
  assert.strictEqual(A.receiptDupOf(LEDGER, '2026-11-02', 5000), null);
  assert.strictEqual(A.receiptDupOf(LEDGER, '', 6600), null);
});

test('銀行CSVの判定（共通化後も従来どおり）', () => {
  const f = A.bankDupFlags(LEDGER, '2026-11-02', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false);
  assert.deepStrictEqual([f.dup, f.mailDup, f.mailNear, f.mailNearDate], [false, false, true, '2026-11-03']);
  const g = A.bankDupFlags(LEDGER, '2026-11-01', 6600, 'x', false);
  assert.strictEqual(g.mailNear, false);   // メール取込でない経費は mailNear にしない
});

console.log('合計と税額の整合');

test('税込：対象額の合計＝合計金額、税額＝対象額×10/110', () => {
  assert.deepStrictEqual(plain(A.receiptTaxWarnings({ amount: 6600, taxType: '税込', tax10base: 6600, tax10: 600 })), []);
  assert.strictEqual(A.receiptTaxWarnings({ amount: 7000, taxType: '税込', tax10base: 6600, tax10: 600 }).length, 1);
  assert.strictEqual(A.receiptTaxWarnings({ amount: 6600, taxType: '税込', tax10base: 6600, tax10: 660 }).length, 1);
  // 8%と10%の混在（軽減税率）
  assert.deepStrictEqual(plain(A.receiptTaxWarnings({ amount: 1648, taxType: '税込', tax10base: 1100, tax10: 100, tax8base: 548, tax8: 40 })), []);
});

test('税抜：対象額＋税額の合計＝合計金額。内訳が無ければ確認しない', () => {
  assert.deepStrictEqual(plain(A.receiptTaxWarnings({ amount: 1100, taxType: '税抜', tax10base: 1000, tax10: 100 })), []);
  assert.strictEqual(A.receiptTaxWarnings({ amount: 1000, taxType: '税抜', tax10base: 1000, tax10: 100 }).length, 1);
  assert.deepStrictEqual(plain(A.receiptTaxWarnings({ amount: 1234 })), []);
});

console.log('GASとの往復');

test('ledger の withWhom・persons・receiptId・purpose がシートに書いて読み直しても消えない', () => {
  const l = { id: 7, date: '2026-11-01', type: '交際費', desc: '居酒屋 さくら', amount: 6600, memo: '領収書取込',
    status: 'actual', calId: A.rcptExtId('FILE123'), withWhom: '株式会社○○ 山田様・2名', persons: 3,
    purpose: '新規提案の打合せ', receiptId: 'FILE123' };
  const row = gas.ledgerRow_(l);
  assert.strictEqual(row.length, gas.SHEET_DEFS.ledger.length);
  const o = {};
  gas.SHEET_DEFS.ledger.forEach((h, i) => { o[h] = row[i]; });
  const back = gas.ledgerFromRow_(o);
  ['withWhom', 'persons', 'receiptId', 'purpose', 'calId', 'memo', 'amount', 'type'].forEach(k =>
    assert.deepStrictEqual(back[k], l[k], k));
  assert.strictEqual(back.calId, 'rcpt:FILE123');
});

test('新しい列が空の既存行は空のまま読む', () => {
  const back = gas.ledgerFromRow_({ id: 1, date: '2026-10-01', type: '通信料', desc: 'x', amount: 100 });
  assert.deepStrictEqual([back.withWhom, back.persons, back.receiptId], ['', '', '']);
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
