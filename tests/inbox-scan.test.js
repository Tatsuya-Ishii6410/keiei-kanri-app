/* 受信箱フォルダの週次読み取り（取込待ち）のテスト
   実行: node tests/inbox-scan.test.js

   - gas-code.js はまるごと読む。AIの呼び出し（UrlFetchApp）・DriveApp・PropertiesService はモックに差し替える
     受信箱の走査（runInboxScan_）は Drive・シート・AI を io で受け取るので、io もモックで渡す
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
gas.Utilities = { base64Encode: bytes => Buffer.from(bytes).toString('base64') };
gas.DriveApp = { getFileById: id => ({ getBlob: () => ({ getBytes: () => [1, 2, 3] }), getId: () => id }) };
const aiReply = text => ({ code: 200, body: { content: [{ type: 'text', text }] } });

// ---- アプリの判定 ----
const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@import-rules-begin');
const end = html.indexOf('@import-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @import-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { INBOX_RECEIPT, INBOX_INVOICE, driveFolderIdFrom, payableFormFrom, inboxFormOf, inboxConfOf,
  payableDupOf, inboxDupOf, inboxLedgerEntry, inboxEntryError, inboxBulkBlocker, matchPlannedOut, rcptExtId, mailExtId, isSettlePaid, settlePayRow, settlePayCandidates, settleLinkRow };`, app);
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
const CATS = gas.INBOX_CATEGORIES;

console.log('AIの返答JSONの解析（受取請求書）');

test('正常：請求元・番号・請求日・支払期限・金額・税額・登録番号・内容・区分・確信度', () => {
  const r = gas.parsePayableReply_('以下です\n```json\n' + JSON.stringify({
    issuer: '株式会社クラウドワークス', docNo: 'INV-2026-1101', date: '2026/10/31', dueDate: '2026年11月30日',
    total: '¥55,000', tax: 5000, invoiceNo: 'T 1234-5678-90123', item: 'システム利用料 10月分', category: 'システム利用料',
    confidence: { issuer: '高', docNo: 'high', date: '高', dueDate: '中', total: '高', tax: '高', invoiceNo: '高', item: '高', category: 'low' }
  }) + '\n```');
  assert.strictEqual(r.ok, true);
  const d = plain(r.data);
  assert.strictEqual(d.issuer, '株式会社クラウドワークス');
  assert.strictEqual(d.docNo, 'INV-2026-1101');
  assert.strictEqual(d.date, '2026-10-31');
  assert.strictEqual(d.dueDate, '2026-11-30');
  assert.strictEqual(d.total, 55000);
  assert.strictEqual(d.tax, 5000);
  assert.strictEqual(d.invoiceNo, 'T1234567890123');
  assert.strictEqual(d.item, 'システム利用料 10月分');
  assert.strictEqual(d.category, '');          // CATS を渡していないので区分は空
  assert.strictEqual(d.confidence.docNo, '高');
  assert.strictEqual(d.confidence.category, '低');
  assert.strictEqual(gas.parsePayableReply_(JSON.stringify({ category: 'システム利用料' }), CATS).data.category, 'システム利用料');
});

test('空欄：読めない項目は null/空のまま（支払期限・金額を推測で埋めない）', () => {
  const r = gas.parsePayableReply_(JSON.stringify({ issuer: '○○商事', docNo: null, date: null, dueDate: null,
    total: null, tax: null, invoiceNo: '不明', item: null, category: '接待交際' }), CATS);
  assert.strictEqual(r.ok, true);
  const d = plain(r.data);
  assert.deepStrictEqual([d.docNo, d.date, d.dueDate, d.total, d.tax, d.invoiceNo, d.item, d.category],
    ['', '', '', null, null, '', '', '']);
  const f = A.payableFormFrom(d);
  assert.deepStrictEqual([f.dueDate, f.amount, f.tax, f.payee], ['', '', '', '○○商事']);
});

test('壊れたJSONは ok:false（手入力に回す）', () => {
  const r = gas.parsePayableReply_('{"issuer":"○○", "total": 1000');
  assert.strictEqual(r.ok, false);
  assert(/手入力/.test(r.error));
  assert.strictEqual(gas.parsePayableReply_('読み取れませんでした').ok, false);
});

test('全体の確信度は大事な項目のいちばん低いもの。空の項目は「低」', () => {
  const conf = { issuer: '高', date: '高', dueDate: '高', total: '高' };
  assert.strictEqual(gas.inboxConfidence_('受取請求書', { issuer: 'A', date: '2026-11-01', dueDate: '2026-11-30', total: 100, confidence: conf }), '高');
  assert.strictEqual(gas.inboxConfidence_('受取請求書', { issuer: 'A', date: '2026-11-01', dueDate: '', total: 100, confidence: conf }), '低');
  assert.strictEqual(gas.inboxConfidence_('領収書', { date: '2026-11-01', total: 100, payee: 'X', confidence: { date: '高', total: '中', payee: '高' } }), '中');
  assert.strictEqual(gas.inboxConfidence_('領収書', { date: '2026-11-01', total: 100, payee: 'X', confidence: {} }), '低');
});

console.log('受信箱のファイルの読み取り（Drive・AIはモック）');

test('領収書（JPEG）：領収書と同じ項目で読み、image で送る。壊れたJSON・空欄も扱える', () => {
  fetchCalls = [];
  fetchMock = () => aiReply(JSON.stringify({ date: '2026-11-01', total: 3300, payee: 'カフェ', item: null, taxType: null,
    taxes: [], invoiceNo: null, paymentMethod: null, category: '交際費', confidence: { date: '高', total: '高', payee: '高' } }));
  const r = gas.readInboxFile_({ id: 'F1', kind: '領収書', mimeType: 'image/jpeg' });
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual([r.data.total, r.data.payee, r.data.item, r.data.category, r.data.invoiceNo], [3300, 'カフェ', '', '交際費', '']);
  const body = JSON.parse(fetchCalls[0].opts.payload);
  assert.strictEqual(body.model, gas.ANTHROPIC_MODEL);
  assert.strictEqual(body.messages[0].content[0].type, 'image');
  assert(/領収書/.test(body.messages[0].content[1].text));
  fetchMock = () => aiReply('すみません、読めません');
  assert.strictEqual(gas.readInboxFile_({ id: 'F1', kind: '領収書', mimeType: 'image/png' }).ok, false);
});

test('受取請求書（PDF）：document で送り、請求書用のプロンプトを使う', () => {
  fetchCalls = [];
  fetchMock = () => aiReply(JSON.stringify({ issuer: 'X社', total: 11000, dueDate: '2026-11-30' }));
  const r = gas.readInboxFile_({ id: 'F2', kind: '受取請求書', mimeType: 'application/pdf' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.issuer, 'X社');
  const body = JSON.parse(fetchCalls[0].opts.payload);
  assert.strictEqual(body.messages[0].content[0].type, 'document');
  assert(/支払期限/.test(body.messages[0].content[1].text));
});

test('APIの失敗（クレジット不足）は理由を返す', () => {
  fetchMock = () => ({ code: 400, body: { error: { message: 'Your credit balance is too low' } } });
  const r = gas.readInboxFile_({ id: 'F3', kind: '受取請求書', mimeType: 'application/pdf' });
  assert.strictEqual(r.ok, false);
  assert(/クレジット/.test(r.error));
});

console.log('受信箱の走査（runInboxScan_。io はモック）');

// 受信箱・処理済み・inbox シート・AI をまとめたモック
function fakeInbox(files, opts) {
  opts = opts || {};
  const rows = {};
  const reads = [];
  const io = {
    listFiles: () => files,
    doneIds: () => opts.done || {},
    readRows: () => Object.keys(rows).map(k => rows[k]),
    saveRow: r => { rows[r.fileId] = JSON.parse(JSON.stringify(r)); },
    read: f => { reads.push(f.id); return opts.read ? opts.read(f) : { ok: true, data: { date: '2026-11-01', total: 100, payee: 'X', confidence: {} } }; },
    now: () => '2026-11-02 07:00:00'
  };
  return { io, rows, reads };
}
const file = (id, mime, kind) => ({ id, name: id + '.jpg', mimeType: mime || 'image/jpeg', size: 1000, kind: kind || '領収書', folderId: 'INBOX' });

test('同じファイルを2回読まない（取込待ちにある・処理済みフォルダにある）', () => {
  const m = fakeInbox([file('a'), file('b'), file('c')], { done: { c: true } });
  const r1 = gas.runInboxScan_(m.io);
  assert.deepStrictEqual(m.reads, ['a', 'b']);
  assert.strictEqual(r1.read, 2);
  assert.strictEqual(m.rows.a.status, 'ready');
  assert.strictEqual(m.rows.a.kind, '領収書');
  const r2 = gas.runInboxScan_(m.io);
  assert.strictEqual(r2.read, 0);
  assert.deepStrictEqual(m.reads, ['a', 'b']);
  // 登録・スキップ済みの行も読まない
  m.rows.a.status = 'registered';
  m.rows.b.status = 'skipped';
  gas.runInboxScan_(m.io);
  assert.deepStrictEqual(m.reads, ['a', 'b']);
});

test('8ファイルを超えたら、残りは次の実行に回る', () => {
  const files = [];
  for (let i = 1; i <= 11; i++) files.push(file('f' + i));
  const m = fakeInbox(files);
  const r1 = gas.runInboxScan_(m.io);
  assert.strictEqual(gas.INBOX_MAX_PER_RUN, 8);
  assert.deepStrictEqual([r1.read, r1.remaining], [8, 3]);
  assert.deepStrictEqual(m.reads, ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8']);
  const r2 = gas.runInboxScan_(m.io);
  assert.deepStrictEqual([r2.read, r2.remaining], [3, 0]);
  assert.deepStrictEqual(m.reads.slice(8), ['f9', 'f10', 'f11']);
  assert.strictEqual(Object.keys(m.rows).length, 11);
});

test('HEICなど非対応の形式は読まずに「非対応」で理由を出す（8件の枠に数えない）', () => {
  const files = [file('h', 'image/heic')];
  for (let i = 1; i <= 8; i++) files.push(file('p' + i, 'application/pdf', '受取請求書'));
  const m = fakeInbox(files);
  const r = gas.runInboxScan_(m.io);
  assert.deepStrictEqual([r.read, r.unsupported, r.remaining], [8, 1, 0]);
  assert(m.reads.indexOf('h') < 0);
  assert.strictEqual(m.rows.h.status, 'unsupported');
  assert(/非対応/.test(m.rows.h.error) && /heic/.test(m.rows.h.error));
  assert.strictEqual(m.rows.p1.kind, '受取請求書');
  // 次の実行でも読まない
  gas.runInboxScan_(m.io);
  assert(m.reads.indexOf('h') < 0);
});

test('失敗したファイルは理由つきで残り、読み直しは3回まで', () => {
  let n = 0;
  const m = fakeInbox([file('x')], { read: () => { n++; return { ok: false, error: 'AIが混雑しています' }; } });
  gas.runInboxScan_(m.io);
  assert.deepStrictEqual([m.rows.x.status, m.rows.x.error, m.rows.x.retries], ['failed', 'AIが混雑しています', 0]);
  for (let i = 0; i < 5; i++) gas.runInboxScan_(m.io);
  assert.strictEqual(n, 4);                 // 最初の1回＋読み直し3回
  assert.strictEqual(m.rows.x.retries, 3);
  assert.strictEqual(m.rows.x.status, 'failed');
});

test('読み直しで成功すれば読み取り済みになる。新しいファイルを先に読む', () => {
  let fail = true;
  const m = fakeInbox([file('old')], { read: f => (f.id === 'old' && fail ? { ok: false, error: 'x' } : { ok: true, data: { confidence: {} } }) });
  gas.runInboxScan_(m.io);
  fail = false;
  const files = [file('old')];
  for (let i = 1; i <= 8; i++) files.push(file('n' + i));
  m.io.listFiles = () => files;
  gas.runInboxScan_(m.io);
  assert.strictEqual(m.rows.old.status, 'failed');      // 新しい8件が先なので今回は読まない
  gas.runInboxScan_(m.io);
  assert.deepStrictEqual([m.rows.old.status, m.rows.old.retries], ['ready', 1]);
});

test('処理済みのファイル名は YYYYMMDD_支払先_金額.拡張子（日付も金額も無ければ元の名前）', () => {
  assert.strictEqual(gas.inboxDoneName_('scan.pdf', 'application/pdf', '2026-10-31', '株式会社X', 55000), '20261031_株式会社X_55000.pdf');
  assert.strictEqual(gas.inboxDoneName_('a.png', 'image/png', '2026-11-01', 'カフェ/駅前', 880), '20261101_カフェ_駅前_880.png');
  assert.strictEqual(gas.inboxDoneName_('IMG_1.HEIC', 'image/heic', '', '', 0), 'IMG_1.HEIC');
});

test('inbox シートの行：data は JSON。壊れていれば null', () => {
  const r = gas.inboxFromRow_({ fileId: 'a', kind: '領収書', data: '{"total":100}', retries: '2', status: 'ready' });
  assert.deepStrictEqual([r.data.total, r.retries], [100, 2]);
  assert.strictEqual(gas.inboxFromRow_({ fileId: 'a', data: '{壊れ' }).data, null);
});

console.log('登録（取込待ち → CF管理）');

const inv = (data, extra) => Object.assign({ fileId: 'PDF1', kind: '受取請求書', status: 'ready', confidence: '高',
  data: Object.assign({ issuer: '株式会社X', docNo: 'No.100', date: '2026-10-31', dueDate: '2026-11-30', total: 55000, tax: 5000,
    invoiceNo: 'T1234567890123', item: '保守費 10月分', category: 'システム利用料', confidence: {} }, data || {}) }, extra || {});
const rcpt = (data, extra) => Object.assign({ fileId: 'IMG1', kind: '領収書', status: 'ready', confidence: '高',
  data: Object.assign({ date: '2026-11-01', total: 3300, payee: '文具店', item: '事務用品', taxType: '税込', taxes: [],
    invoiceNo: '', paymentMethod: '現金', category: 'その他経費', confidence: {} }, data || {}) }, extra || {});

test('受取請求書は planned_out・予定日＝支払期限・案件なしで入る', () => {
  const e = A.inboxLedgerEntry(A.INBOX_INVOICE, A.inboxFormOf(inv()), 'PDF1', 42);
  assert.deepStrictEqual(plain([e.id, e.status, e.expectedDate, e.date, e.projectId, e.amount, e.type]),
    [42, 'planned_out', '2026-11-30', '2026-10-31', null, 55000, 'システム利用料']);
  assert.deepStrictEqual([e.payee, e.docNo, e.receiptId, e.calId], ['株式会社X', 'No.100', 'PDF1', 'rcpt:PDF1']);
  assert.strictEqual(e.desc, '株式会社X（保守費 10月分）');
  assert(/^受取請求書／請求書番号:No.100／登録番号:T1234567890123／税額:5000/.test(e.memo));
  // 請求日が読めなければ date も支払期限
  const e2 = A.inboxLedgerEntry(A.INBOX_INVOICE, A.inboxFormOf(inv({ date: '' })), 'PDF1', 43);
  assert.deepStrictEqual([e2.date, e2.expectedDate], ['2026-11-30', '2026-11-30']);
});

test('支払期限が読めない受取請求書は空欄のまま。入力するまで登録できない', () => {
  const x = inv({ dueDate: '' });
  const f = A.inboxFormOf(x);
  assert.strictEqual(f.dueDate, '');
  assert(/支払期限/.test(A.inboxEntryError(A.INBOX_INVOICE, f)));
  f.dueDate = '2026-12-15';
  assert.strictEqual(A.inboxEntryError(A.INBOX_INVOICE, f), '');
  assert.strictEqual(A.inboxLedgerEntry(A.INBOX_INVOICE, f, 'PDF1', 1).expectedDate, '2026-12-15');
});

test('領収書は経費の実績（memo は「領収書取込」から）。交際費は誰と・用件が必要', () => {
  const f = A.inboxFormOf(rcpt());
  const e = A.inboxLedgerEntry(A.INBOX_RECEIPT, f, 'IMG1', 5);
  assert.deepStrictEqual([e.status, e.date, e.expectedDate, e.amount, e.payee, e.docNo], ['actual', '2026-11-01', '', 3300, '文具店', '']);
  assert(/^領収書取込/.test(e.memo));
  const g = A.inboxFormOf(rcpt({ category: '交際費' }));
  assert(/誰と/.test(A.inboxEntryError(A.INBOX_RECEIPT, g)));
  g.withWhom = 'A社 田中様'; g.purpose = '打合せ';
  assert.strictEqual(A.inboxEntryError(A.INBOX_RECEIPT, g), '');
});

test('読み取り失敗・確信度の名前：失敗は空欄、受取請求書の issuer は payee の欄に', () => {
  const f = A.inboxFormOf({ kind: '領収書', status: 'failed', data: null });
  assert.deepStrictEqual([f.date, f.amount, f.payee], ['', '', '']);
  const c = A.inboxConfOf(inv({ confidence: { issuer: '低', dueDate: '中' } }));
  assert.deepStrictEqual([c.payee, c.dueDate], ['低', '中']);
});

console.log('一括登録の対象外条件');

test('確信度が高で問題なければ対象', () => {
  assert.strictEqual(A.inboxBulkBlocker(rcpt(), []), '');
  assert.strictEqual(A.inboxBulkBlocker(inv(), []), '');
});

test('交際費・金額や日付が空・支払期限が空・確信度が高でない・失敗は対象外', () => {
  assert(/交際費/.test(A.inboxBulkBlocker(rcpt({ category: '交際費' }), [])));
  assert(/金額・日付/.test(A.inboxBulkBlocker(rcpt({ total: null }), [])));
  assert(/金額・日付/.test(A.inboxBulkBlocker(rcpt({ date: '' }), [])));
  assert(/金額・日付/.test(A.inboxBulkBlocker(inv({ date: '' }), [])));
  assert(/支払期限/.test(A.inboxBulkBlocker(inv({ dueDate: '' }), [])));
  assert(/確信度/.test(A.inboxBulkBlocker(rcpt({}, { confidence: '中' }), [])));
  assert(A.inboxBulkBlocker({ fileId: 'z', kind: '領収書', status: 'failed', data: null }, []));
  assert(A.inboxBulkBlocker({ fileId: 'z', kind: '領収書', status: 'unsupported', data: null }, []));
});

test('重複の可能性・登録済みは対象外', () => {
  const debit = [{ id: 1, date: '2026-10-31', type: 'その他経費', desc: '文具店（Visaデビット）', amount: 3300, status: 'actual', calId: A.mailExtId('m1') }];
  assert(/重複/.test(A.inboxBulkBlocker(rcpt(), debit)));
  const planned = [{ id: 2, date: '2026-10-31', type: 'システム利用料', desc: 'x', amount: 1, status: 'planned_out', payee: '株式会社X', docNo: 'No.100' }];
  assert(/重複/.test(A.inboxBulkBlocker(inv(), planned)));
  const done = [{ id: 3, date: '2025-01-01', type: '通信料', desc: 'y', amount: 9, status: 'actual', calId: 'rcpt:IMG1' }];
  assert(/登録済み/.test(A.inboxBulkBlocker(rcpt(), done)));
});

console.log('重複判定');

test('領収書：同額で前後1日（デビット通知・銀行CSVの経費も）なら重複。2日離れていれば別', () => {
  const ledger = [
    { id: 1, date: '2026-11-02', type: 'その他経費', desc: 'ﾌﾞﾝｸﾞ', amount: 3300, status: 'actual' },
    { id: 2, date: '2026-11-01', type: '売上', desc: '入金', amount: 3300, status: 'actual' }
  ];
  assert.strictEqual(A.inboxDupOf(ledger, A.INBOX_RECEIPT, { date: '2026-11-01', amount: 3300 }).id, 1);
  assert.strictEqual(A.inboxDupOf(ledger, A.INBOX_RECEIPT, { date: '2026-10-31', amount: 3300 }), null);
  assert.strictEqual(A.inboxDupOf(ledger, A.INBOX_RECEIPT, { date: '2026-11-01', amount: 3301 }), null);
});

test('受取請求書：同じ請求元＋同じ請求書番号、または同じ請求元＋同額＋同じ月なら重複', () => {
  const ledger = [{ id: 9, date: '2026-10-31', expectedDate: '2026-11-30', type: 'システム利用料', desc: 'X', amount: 55000,
    status: 'planned_out', payee: '株式会社Ｘ', docNo: 'No.100' }];
  assert.strictEqual(A.payableDupOf(ledger, { payee: '株式会社 X', docNo: 'No.100', amount: 1, date: '2026-12-01' }).id, 9);
  assert.strictEqual(A.payableDupOf(ledger, { payee: '株式会社X', docNo: 'No.200', amount: 55000, date: '2026-10-15' }).id, 9);
  assert.strictEqual(A.payableDupOf(ledger, { payee: '株式会社X', docNo: 'No.200', amount: 55000, date: '2026-11-30' }), null);
  assert.strictEqual(A.payableDupOf(ledger, { payee: '別の会社', docNo: 'No.100', amount: 55000, date: '2026-10-31' }), null);
  assert.strictEqual(A.payableDupOf(ledger, { payee: '', docNo: 'No.100', amount: 55000, date: '2026-10-31' }), null);
});

console.log('銀行明細CSVとの突合・設定');

test('出金予定は、同額で予定日の前後7日以内なら銀行CSVの出金と突合できる（近いものを優先・交通費精算は除く）', () => {
  const ledger = [
    { id: 1, status: 'planned_out', amount: 55000, date: '2026-10-31', expectedDate: '2026-11-30', desc: '株式会社X' },
    { id: 2, status: 'planned_out', amount: 55000, date: '2026-11-20', expectedDate: '2026-11-25', desc: '別' },
    { id: 3, status: 'planned_out', amount: 8000, date: '2026-11-25', expectedDate: '2026-11-25', desc: '交通費精算', settlementMonth: '2026-10' },
    { id: 4, status: 'actual', amount: 55000, date: '2026-11-30', desc: '実績' }
  ];
  assert.strictEqual(A.matchPlannedOut(ledger, '2026-11-29', 55000).id, 1);
  assert.strictEqual(A.matchPlannedOut(ledger, '2026-11-24', 55000).id, 2);
  assert.strictEqual(A.matchPlannedOut(ledger, '2026-12-08', 55000), null);
  assert.strictEqual(A.matchPlannedOut(ledger, '2026-11-25', 8000), null);
  assert.strictEqual(A.matchPlannedOut(ledger, '2026-11-30', 54999), null);
});

test('交通費精算を振込済みにする：同じ行が実績（区分 交通費精算）になり、精算月の印は残る（実例：9月分 48,630円を 2026-11-03 に振込）', () => {
  const l = { id: 7, type: '交通費', desc: '交通費精算 2026年9月分', amount: 48630, status: 'planned_out', date: '2026-11-03', expectedDate: '2026-11-03', settlementMonth: '2026-09', memo: '9月分交通費 12件の合計' };
  A.settlePayRow(l, '2026-11-03', 48630, '振込済み（2026-11-03）');
  assert.deepStrictEqual([l.status, l.type, l.date, l.expectedDate, l.amount, l.settlementMonth], ['actual', '交通費精算', '2026-11-03', '', 48630, '2026-09']);
  assert(A.isSettlePaid(l) && l.memo.includes('振込済み'));
  assert(!A.isSettlePaid({ type: '交通費精算', status: 'planned_out' }) && !A.isSettlePaid({ type: '交通費', status: 'actual' }));
});
test('振込済みにする時の二重の検知：前後7日・差1,000円以内の実績の出金。入金・日々の交通費・精算の支払いは除く', () => {
  const ledger = [
    { id: 1, type: 'その他経費', desc: 'ﾌﾘｺﾐ ｲｼｲ', amount: 48630, status: 'actual', date: '2026-11-04' },
    { id: 2, type: 'その他経費', desc: '近い額', amount: 49200, status: 'actual', date: '2026-11-03' },
    { id: 3, type: '売上', desc: '入金', amount: 48630, status: 'actual', date: '2026-11-03' },
    { id: 4, type: '交通費', desc: '日々の交通費', amount: 48630, status: 'actual', date: '2026-11-03' },
    { id: 5, type: '交通費精算', desc: '別の精算', amount: 48630, status: 'actual', date: '2026-11-03', settlementMonth: '2026-08' },
    { id: 6, type: 'その他経費', desc: '遠い日', amount: 48630, status: 'actual', date: '2026-11-11' },
    { id: 7, type: 'その他経費', desc: '予定', amount: 48630, status: 'planned_out', date: '2026-11-03' },
  ];
  assert.deepStrictEqual(A.settlePayCandidates(ledger, '2026-11-03', 48630).map(x => x.id), [2, 1]);
  assert.deepStrictEqual(A.settlePayCandidates(ledger, '2026-11-20', 48630).map(x => x.id), []);
});
test('既存の実績に紐付ける：その行が精算の支払いになり、精算月の印が移る。金額・日付は口座の実績のまま', () => {
  const bank = { id: 1, type: 'その他経費', desc: 'ﾌﾘｺﾐ', amount: 48630, status: 'actual', date: '2026-11-04' };
  A.settleLinkRow(bank, { desc: '交通費精算 2026年9月分', settlementMonth: '2026-09' });
  assert.deepStrictEqual([bank.type, bank.settlementMonth, bank.amount, bank.date], ['交通費精算', '2026-09', 48630, '2026-11-04']);
  assert(bank.memo.includes('元の区分：その他経費'));
});
test('受信箱フォルダの URL から ID を取り出す', () => {
  assert.strictEqual(A.driveFolderIdFrom('https://drive.google.com/drive/folders/1AbC-def_GhIjKlMn?usp=sharing'), '1AbC-def_GhIjKlMn');
  assert.strictEqual(A.driveFolderIdFrom('https://drive.google.com/drive/u/0/folders/1AbCdefGhIjK'), '1AbCdefGhIjK');
  assert.strictEqual(A.driveFolderIdFrom('https://drive.google.com/open?id=1AbCdefGhIjK'), '1AbCdefGhIjK');
  assert.strictEqual(A.driveFolderIdFrom(' 1AbCdefGhIjK '), '1AbCdefGhIjK');
  assert.strictEqual(A.driveFolderIdFrom('領収書'), '');
  assert.strictEqual(A.driveFolderIdFrom(''), '');
});

test('GASとの往復：ledger の payee・docNo、settings の受信箱フォルダが消えない', () => {
  const l = { id: 7, date: '2026-10-31', expectedDate: '2026-11-30', type: 'システム利用料', desc: '株式会社X', amount: 55000,
    status: 'planned_out', payee: '株式会社X', docNo: '00123', receiptId: 'PDF1', calId: 'rcpt:PDF1', projectId: null };
  const row = gas.ledgerRow_(l);
  assert.strictEqual(row.length, gas.SHEET_DEFS.ledger.length);
  const o = {};
  gas.SHEET_DEFS.ledger.forEach((h, i) => { o[h] = row[i]; });
  const back = gas.ledgerFromRow_(o);
  ['payee', 'docNo', 'status', 'expectedDate', 'projectId', 'receiptId', 'calId'].forEach(k => assert.deepStrictEqual(back[k], l[k], k));
  assert(gas.TEXT_COLUMNS.indexOf('docNo') >= 0);   // 「00123」が数値にならない
  // settings シート（key/value）
  const sheet = { getLastRow: () => 3, getLastColumn: () => 2, getRange: () => ({ getValues: () => [['key', 'value'],
    ['inboxFolders.receipt', 'FOLDER_R'], ['inboxFolders.invoice', 'FOLDER_I']] }) };
  assert.deepStrictEqual(plain(gas.readSettings_(sheet).inboxFolders), { receipt: 'FOLDER_R', invoice: 'FOLDER_I' });
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
