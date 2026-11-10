/* デビット通知メール取込・銀行明細CSV取込の判定テスト
   実行: node tests/debit-import.test.js

   - gas-code.js はトップレベルが宣言だけなので、vm でまるごと読み込む
     （GmailApp などは関数の中でしか触らないので、読み込むだけなら不要）
   - keiei-kanri.html は「@import-rules-begin」〜「@import-rules-end」の範囲だけを切り出して読む */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

const gas = {};
vm.createContext(gas);
vm.runInContext(fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8'), gas);

const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@import-rules-begin');
const end = html.indexOf('@import-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @import-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
// const はコンテキストのプロパティにならないので、使う名前を最後に globalThis へ出す
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { normKey, guessExpenseType, bankGuessType, isAuthLike, mailExtId,
  bankDupFlags, debitRowsFrom, deletedExtIdOf, knownExtIds };`, app);
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

const SUBJECT = '【GMOあおぞらネット銀行】Visaデビットご利用のお知らせ';
const FROM = 'GMOあおぞらネット銀行 <info@gmo-aozora.com>';
const mail = (id, body, extra) => Object.assign(
  { id, subject: SUBJECT, from: FROM, received: '2026-11-02 14:05:00', body }, extra || {});

const BODY_REAL = [
  'いつもGMOあおぞらネット銀行をご利用いただきありがとうございます。',
  'Visaデビットのご利用がありましたのでお知らせします。',
  '',
  '【処理日時】 2026/11/02 14:04:40',
  '【引落し金額】 4,323 円',
  '【ご利用店名】 ＮＥＸＴ',
  '【ご利用口座】 ****016',
  '',
  '※本メールは送信専用です。'
].join('\r\n');

const BODY_VERCEL = [
  '【処理日時】 2026/11/01 22:04:18',
  '【引落し金額】 1 円',
  '【ご利用店名】 VERCEL INC.',
  '【ご利用口座】 ****016',
  '【ご利用店舗情報】 https://www.google.com/search?q=VERCEL+INC.',
  '【メモ欄】',
  ''
].join('\n');

console.log('メール本文の抽出（GAS: parseDebitMail_）');

test('実物形式：4,323円・NEXT・2026-11-02', () => {
  const p = gas.parseDebitMail_(BODY_REAL);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.amount, 4323);
  assert.strictEqual(p.merchant, 'NEXT');
  assert.strictEqual(p.date, '2026-11-02');
  assert.strictEqual(p.datetime, '2026-11-02 14:04:40');
  assert.strictEqual(p.account, '****016');
});

test('店舗情報・メモ欄つき：2026-11-01・1円・VERCEL INC（URLが混入しない）', () => {
  const p = gas.parseDebitMail_(BODY_VERCEL);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.date, '2026-11-01');
  assert.strictEqual(p.amount, 1);
  assert.strictEqual(p.merchant, 'VERCEL INC');
  assert(p.merchant.indexOf('http') < 0 && p.merchant.indexOf('google') < 0, 'URLが店名に入っている');
});

test('金額のカンマ・全角半角の混在', () => {
  const body = '【処理日時】 ２０２６/１１/０３ ０９:０５:０１\n【引落し金額】 １２,３４５ 円\n【ご利用店名】 ＡＭＡＺＯＮ．ＣＯ．ＪＰ\n【ご利用口座】 ＊＊＊＊016';
  const p = gas.parseDebitMail_(body);
  assert.strictEqual(p.ok, true);
  assert.strictEqual(p.amount, 12345);
  assert.strictEqual(p.datetime, '2026-11-03 09:05:01');
  assert.strictEqual(p.merchant, 'AMAZON.CO.JP');
  assert.strictEqual(gas.parseDebitMail_('【処理日時】 2026/11/03 9:05:01\n【引落し金額】 1，234，567円').amount, 1234567);
});

test('店名の末尾記号と前後の空白を外す', () => {
  assert.strictEqual(gas.normalizeMerchant_('  VERCEL INC.  '), 'VERCEL INC');
  assert.strictEqual(gas.normalizeMerchant_('ＮＥＸＴ，'), 'NEXT');
  assert.strictEqual(gas.normalizeMerchant_('GITHUB, INC.'), 'GITHUB, INC');
});

console.log('メールの振り分け（GAS: buildDebitResult_）');

test('形式が違うメール（為替差額など）は「読み取れなかったメール」になる', () => {
  const fx = mail('m-fx', '為替差額により追加でお引落しいたしました。\n【ご利用店名】 OPENAI\n詳細は会員ページでご確認ください。',
    { received: '2026-11-04 08:00:00' });
  const r = gas.buildDebitResult_([mail('m1', BODY_REAL), fx], '2026-11-01', '2026-11-30');
  assert.strictEqual(r.items.length, 1);
  assert.strictEqual(r.items[0].messageId, 'm1');
  assert.strictEqual(r.unreadable.length, 1);
  assert.strictEqual(r.unreadable[0].subject, SUBJECT);
  assert.strictEqual(r.unreadable[0].received, '2026-11-04 08:00:00');
  assert.strictEqual(r.unreadable[0].body, undefined, '本文を返してはいけない');
});

test('返す項目は messageId / datetime / amount / merchant / account だけ（本文を含まない）', () => {
  const r = gas.buildDebitResult_([mail('m1', BODY_REAL)], '2026-11-01', '');
  assert.deepStrictEqual(Object.keys(r.items[0]).sort(), ['account', 'amount', 'datetime', 'merchant', 'messageId']);
});

test('期間外・件名違い・差出人違いの扱い', () => {
  const r = gas.buildDebitResult_([
    mail('old', BODY_REAL.replace('2026/11/02', '2026/10/31')),
    mail('other', BODY_REAL, { subject: 'ご利用明細のお知らせ' }),
    mail('spoof', BODY_REAL, { from: 'someone@example.com' })
  ], '2026-11-01', '2026-11-30');
  assert.strictEqual(r.items.length, 0);
  assert.strictEqual(r.unreadable.length, 1);
  assert.strictEqual(r.unreadable[0].messageId, 'spoof');
});

console.log('区分の推測（アプリ: guessExpenseType）');

test('VERCEL / NETLIFY / GITHUB / CLOUDFLARE / OPENAI / ANTHROPIC / GOOGLE → システム利用料', () => {
  ['VERCEL INC', 'Netlify', 'ＧＩＴＨＵＢ', 'CLOUDFLARE', 'OPENAI *CHATGPT', 'ANTHROPIC', 'GOOGLE*WORKSPACE'].forEach(m => {
    const g = A.guessExpenseType(m);
    assert.strictEqual(g.type, 'システム利用料', m);
    assert.strictEqual(g.matched, true, m);
  });
});

test('該当なしは「その他経費」で要確認', () => {
  const g = A.guessExpenseType('NEXT');
  assert.strictEqual(g.type, 'その他経費');
  assert.strictEqual(g.matched, false);
});

test('銀行明細の半角カナ摘要も従来どおり判定できる', () => {
  assert.strictEqual(A.bankGuessType('ｿﾌﾄﾊﾞﾝｸ', false), '通信料');
  assert.strictEqual(A.bankGuessType('ﾀｸｼｰ', false), '交通費');
  assert.strictEqual(A.bankGuessType('ﾌﾘｺﾐ ｶ)ｴｰﾋﾞｰｼｰ', true), '売上');
});

console.log('プレビュー行と重複防止（アプリ: debitRowsFrom / bankDupFlags）');

const vercelItem = gas.buildDebitResult_([mail('m-vercel', BODY_VERCEL)], '2026-11-01', '').items[0];
const nextItem = gas.buildDebitResult_([mail('m-next', BODY_REAL)], '2026-11-01', '').items[0];

test('VERCEL 1円：システム利用料・認証の可能性・チェックOFF', () => {
  const r = A.debitRowsFrom([vercelItem], []).rows[0];
  assert.strictEqual(r.date, '2026-11-01');
  assert.strictEqual(r.amount, 1);
  assert.strictEqual(r.merchant, 'VERCEL INC');
  assert.strictEqual(r.type, 'システム利用料');
  assert.strictEqual(r.auth, true);
  assert.strictEqual(r.checked, false);
  assert.strictEqual(r.desc, 'VERCEL INC（Visaデビット）');
  assert.strictEqual(r.extId, 'mail:m-vercel');
});

test('NEXT 4,323円：その他経費・要確認・チェックON', () => {
  const r = A.debitRowsFrom([nextItem], []).rows[0];
  assert.strictEqual(r.type, 'その他経費');
  assert.strictEqual(r.needsCheck, true);
  assert.strictEqual(r.auth, false);
  assert.strictEqual(r.checked, true);
});

test('外部IDが登録済みのメールは除外（二重登録しない）', () => {
  const ledger = [{ id: 1, date: '2026-11-02', type: 'その他経費', desc: 'NEXT（Visaデビット）', amount: 4323, status: 'actual', calId: 'mail:m-next' }];
  const r = A.debitRowsFrom([nextItem, vercelItem], ledger);
  assert.strictEqual(r.skipped, 1);
  assert.deepStrictEqual(Array.from(r.rows, x => x.messageId), ['m-vercel']); // vm の配列は別レルムなので作り直して比べる
});

test('削除済みの印（deletedExtIds）のメールは次の取込で出さない／消していないメールは出る', () => {
  const r = A.debitRowsFrom([nextItem, vercelItem], [], ['mail:m-next']);
  assert.strictEqual(r.skipped, 1);
  assert.deepStrictEqual(Array.from(r.rows, x => x.messageId), ['m-vercel']);
  // 印が無い古いデータ（第3引数なし）は従来どおり
  assert.strictEqual(A.debitRowsFrom([nextItem, vercelItem], []).rows.length, 2);
});

test('削除で残す外部ID：カレンダー・mail:・rcpt: は残す、bank:・手入力は残さない', () => {
  assert.strictEqual(A.deletedExtIdOf({ calId: 'abc@2026-07-03' }), 'abc@2026-07-03');
  assert.strictEqual(A.deletedExtIdOf({ calId: 'mail:m1' }), 'mail:m1');
  assert.strictEqual(A.deletedExtIdOf({ calId: 'rcpt:f1' }), 'rcpt:f1');
  assert.strictEqual(A.deletedExtIdOf({ calId: 'bank:2026-07-03:1000' }), '');
  assert.strictEqual(A.deletedExtIdOf({ calId: '' }), '');
  assert.strictEqual(A.deletedExtIdOf(null), '');
  const k = A.knownExtIds([{ calId: 'a' }, { calId: '' }], ['b']);
  assert(k.a && k.b && !k[''] && !k.c);
});

test('同日×同金額の経費があれば重複の可能性・チェックOFF（売上・予定は対象外）', () => {
  const r1 = A.debitRowsFrom([nextItem], [{ date: '2026-11-02', type: '交際費', desc: '手入力', amount: 4323, status: 'actual' }]).rows[0];
  assert.strictEqual(r1.dup, true);
  assert.strictEqual(r1.checked, false);
  const r2 = A.debitRowsFrom([nextItem], [
    { date: '2026-11-02', type: '売上', desc: '入金', amount: 4323, status: 'actual' },
    { date: '2026-11-02', type: 'その他経費', desc: '予定', amount: 4323, status: 'planned_out' }
  ]).rows[0];
  assert.strictEqual(r2.dup, false);
});

test('メール取込済み → 銀行明細CSV取込で二重にならない', () => {
  const ledger = [{ date: '2026-11-02', type: 'その他経費', desc: 'NEXT（Visaデビット）', amount: 4323, status: 'actual', calId: 'mail:m-next', memo: 'メール取込' }];
  // CSVの摘要は「VISA NEXT」のように文言が違うので、従来の同日・同金額・同摘要では漏れる
  const f = A.bankDupFlags(ledger, '2026-11-02', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false);
  assert.strictEqual(f.dup, false);
  assert.strictEqual(f.mailDup, true);
  // 金額か日付が違えば別の取引
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-02', 4324, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailDup, false);
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-03', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailDup, false);
  // 入金の行は対象外
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-02', 4323, 'ﾌﾘｺﾐ', true).mailDup, false);
  // メール取込ではない経費は従来の判定のまま
  assert.strictEqual(A.bankDupFlags([{ date: '2026-11-02', type: 'その他経費', desc: 'X', amount: 4323, status: 'actual' }],
    '2026-11-02', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailDup, false);
});

test('メール取込済みと同額で日付が±1日 → 重複の可能性（mailNear）', () => {
  const ledger = [{ date: '2026-11-02', type: 'その他経費', desc: 'NEXT（Visaデビット）', amount: 4323, status: 'actual', calId: 'mail:m-next' }];
  // CSVの取引日が1日後
  const after = A.bankDupFlags(ledger, '2026-11-03', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false);
  assert.strictEqual(after.mailDup, false);
  assert.strictEqual(after.mailNear, true);
  assert.strictEqual(after.mailNearDate, '2026-11-02');
  // CSVの取引日が1日前
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-01', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailNear, true);
  // 月・年をまたいでも1日差として扱う
  const eom = [{ date: '2026-12-31', type: 'システム利用料', desc: 'VERCEL INC（Visaデビット）', amount: 3000, status: 'actual', calId: 'mail:m-eoy' }];
  assert.strictEqual(A.bankDupFlags(eom, '2027-01-01', 3000, 'VERCEL', false).mailNear, true);
  // 同日同額は mailDup のほうだけ（mailNear は立てない）
  const same = A.bankDupFlags(ledger, '2026-11-02', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false);
  assert.strictEqual(same.mailDup, true);
  assert.strictEqual(same.mailNear, false);
  // 2日ずれ・金額違い・入金・メール取込でない経費は対象外
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-04', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailNear, false);
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-03', 4320, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailNear, false);
  assert.strictEqual(A.bankDupFlags(ledger, '2026-11-03', 4323, 'ﾌﾘｺﾐ', true).mailNear, false);
  assert.strictEqual(A.bankDupFlags([{ date: '2026-11-02', type: 'その他経費', desc: 'X', amount: 4323, status: 'actual' }],
    '2026-11-03', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailNear, false);
  // 出金予定（planned_out）は実績ではないので対象外
  assert.strictEqual(A.bankDupFlags([Object.assign({}, ledger[0], { status: 'planned_out' })],
    '2026-11-03', 4323, 'ﾃﾞﾋﾞｯﾄ NEXT', false).mailNear, false);
});

test('10円以下は認証の可能性（銀行明細側も同じ判定）', () => {
  assert.strictEqual(A.isAuthLike(1), true);
  assert.strictEqual(A.isAuthLike(10), true);
  assert.strictEqual(A.isAuthLike(11), false);
  assert.strictEqual(A.isAuthLike(0), false);
});

console.log(process.exitCode ? '\n失敗があります' : `\nすべて成功（${passed}件）`);
