/* 交通費の訪問先の候補（到着駅から過去の訪問先を選ぶ）と、用件の選択式のテスト
   実行: node tests/travel-suggest.test.js

   - keiei-kanri.html は「@travel-rules-begin」〜「@travel-rules-end」の範囲だけを切り出して読む
   - 摘要の分解（travelPartsOf）は範囲の外にあるので、同じ形（出発→到着（手段）　往復）を読む簡易版を渡す */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'keiei-kanri.html'), 'utf8');
const begin = html.indexOf('@travel-rules-begin');
const end = html.indexOf('@travel-rules-end');
assert(begin > 0 && end > begin, 'keiei-kanri.html に @travel-rules の範囲が見つかりません');
const app = {};
vm.createContext(app);
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
globalThis.exported = { HOME_STATIONS, TRAVEL_BLANK_DESC, normStation, isHomeStation, normVisit, visitSideStation,
  buildVisitIndex, visitSuggestions, clientSuggestions, lastPurposeFor,
  TRAVEL_PURPOSES, purposeFromState, purposeToState, travelPurposeHintFor, isReturnTrip, applyReturnAutofill };`, app);
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

// 摘要「出発→到着（手段）　往復」を分ける（アプリの travelPartsOf と同じ形）
const partsOf = l => {
  const d = String(l.desc || '').replace(/（[^（）]+）(?:\s|　)*(?:往復)?\s*$/, '');
  const i = d.indexOf('→');
  return i < 0 ? { from: '', to: d.trim() } : { from: d.slice(0, i).trim(), to: d.slice(i + 1).trim() };
};
let seq = 0;
const tr = (date, from, to, visit, purpose, extra) => Object.assign({ id: ++seq, date, type: '交通費', status: 'actual',
  desc: `${from}→${to}（電車・バス）`, amount: 420, visit, purpose: purpose || '' }, extra || {});
const labels = list => plain(list.map(x => x.label));

console.log('駅名・訪問先の正規化');

test('駅名：「鷹取」「鷹取駅」「鷹取 」・全角は同じ駅', () => {
  ['鷹取', '鷹取駅', '鷹取 ', ' 鷹取駅　', '鷹取　'].forEach(s => assert.strictEqual(A.normStation(s), '鷹取', JSON.stringify(s)));
  assert.strictEqual(A.normStation('ＪＲ三ノ宮駅'), 'JR三ノ宮');
  assert.strictEqual(A.normStation('天神橋筋六丁目'), A.normStation('天神橋筋六丁目駅'));
  assert.strictEqual(A.normStation(''), '');
});

test('自宅駅は HOME_STATIONS の2つ（駅の有無・空白に関係なく判定）', () => {
  assert.deepStrictEqual(plain(A.HOME_STATIONS), ['青野ヶ原駅', '天神橋筋六丁目駅']);
  ['青野ヶ原', '青野ヶ原駅', '天神橋筋六丁目', '天神橋筋六丁目駅', ' 天神橋筋六丁目 '].forEach(s => assert(A.isHomeStation(s), s));
  assert(!A.isHomeStation('三宮'));
  assert(!A.isHomeStation(''));
});

test('訪問先：「くらし工房様」「くらし工房」「（株）くらし工房」「株式会社くらし工房 御中」は1つにまとまる', () => {
  const k = A.normVisit('くらし工房');
  ['くらし工房様', '（株）くらし工房', '(株)くらし工房', '株式会社くらし工房 御中', 'くらし工房株式会社', 'くらし工房（株）', '㈱くらし工房'].forEach(s =>
    assert.strictEqual(A.normVisit(s), k, s));
  assert.notStrictEqual(A.normVisit('くらし工房 西店'), k);
});

console.log('訪問先側の駅');

test('出発・到着のうち自宅駅でない方。両方とも自宅駅でなければ到着、両方とも自宅駅なら集計しない', () => {
  assert.strictEqual(A.visitSideStation('青野ヶ原駅', '鷹取'), '鷹取');
  assert.strictEqual(A.visitSideStation('鷹取駅', '青野ヶ原'), '鷹取');            // 帰りの行は出発駅から
  assert.strictEqual(A.visitSideStation('天神橋筋六丁目', '梅田'), '梅田');
  assert.strictEqual(A.visitSideStation('梅田', '天神橋筋六丁目駅'), '梅田');
  assert.strictEqual(A.visitSideStation('三宮', '鷹取'), '鷹取');                   // どちらも自宅駅でない → 到着
  assert.strictEqual(A.visitSideStation('青野ヶ原駅', '天神橋筋六丁目駅'), '');     // 自宅駅どうし
  assert.strictEqual(A.visitSideStation('天神橋筋六丁目', '青野ヶ原'), '');
  assert.strictEqual(A.visitSideStation('', ''), '');
  assert.strictEqual(A.visitSideStation('', '鷹取'), '鷹取');
});

console.log('集計と並び順');

function sampleLedger() {
  seq = 0;
  return [
    tr('2026-09-01', '青野ヶ原駅', '鷹取', 'くらし工房様', '打ち合わせ'),
    tr('2026-09-01', '鷹取', '青野ヶ原駅', 'くらし工房様', '打ち合わせ'),      // 帰りの行（出発駅から引く）
    tr('2026-10-02', '青野ヶ原', '鷹取駅', '（株）くらし工房', '現場確認'),
    tr('2026-10-20', '天神橋筋六丁目駅', '鷹取', '鷹取病院', '営業'),
    tr('2026-10-28', '天神橋筋六丁目', '鷹取', '鷹取病院', '営業同行'),
    tr('2026-08-15', '青野ヶ原駅', '鷹取', '須磨商店', ''),
    tr('2026-10-10', '鷹取', '天神橋筋六丁目駅', '須磨商店', ''),            // 天六への帰り
    tr('2026-10-05', '青野ヶ原駅', '天神橋筋六丁目駅', '自宅間の移動', ''),   // 自宅駅どうし
    tr('2026-10-06', '天神橋筋六丁目駅', '青野ヶ原駅', '自宅間の移動', ''),
    tr('2026-10-07', '青野ヶ原駅', '鷹取', ''),                                // 訪問先が空
    tr('2026-10-08', '青野ヶ原駅', '鷹取', '（未入力）'),                      // 「（未入力）」
    Object.assign(tr('2026-10-09', '', '', '空の区間'), { desc: '（未入力）' }), // 区間なし
    Object.assign(tr('2026-10-11', '青野ヶ原駅', '鷹取', '予定の行'), { status: 'planned_out' }),
    tr('2026-10-12', '三宮', '大阪', '大阪の会社')
  ];
}

test('回数の多い順、同数は最近の順。表記は「いちばん使われている表記（同数は最近）」', () => {
  const idx = A.buildVisitIndex(sampleLedger(), partsOf);
  const s = A.visitSuggestions(idx, '鷹取駅', 8);
  // くらし工房3回（最終10/2）、鷹取病院2回（最終10/28）、須磨商店2回（最終10/10）
  assert.deepStrictEqual(labels(s), ['くらし工房様', '鷹取病院', '須磨商店']);
  assert.deepStrictEqual(plain(s[0]), { label: 'くらし工房様', count: 3, last: '2026-10-02' });
  assert.strictEqual(s[1].last, '2026-10-28');
  assert.strictEqual(A.visitSuggestions(idx, '鷹取', 2).length, 2);   // 件数の上限
});

test('自宅駅（どちらでも）が候補を汚さない。自宅駅どうしの移動は集計しない', () => {
  const idx = A.buildVisitIndex(sampleLedger(), partsOf);
  ['青野ヶ原駅', '青野ヶ原', '天神橋筋六丁目', '天神橋筋六丁目駅'].forEach(st =>
    assert.deepStrictEqual(labels(A.visitSuggestions(idx, st, 8)), [], st));
  const all = [].concat(...Object.keys(idx.stations).map(k => Object.keys(idx.stations[k])));
  assert(all.indexOf(A.normVisit('自宅間の移動')) < 0);
  assert.deepStrictEqual(plain(Object.keys(idx.stations).sort()), ['大阪', '鷹取']);
});

test('空・「（未入力）」の訪問先、区間が「（未入力）」の行、予定の行は集計に入らない', () => {
  const idx = A.buildVisitIndex(sampleLedger(), partsOf);
  const s = labels(A.visitSuggestions(idx, '鷹取', 8));
  ['（未入力）', '予定の行', '空の区間', ''].forEach(v => assert(s.indexOf(v) < 0, v));
  assert.strictEqual(A.lastPurposeFor(idx, '空の区間'), '');
});

test('同じ数の表記は最近の方を出す', () => {
  seq = 0;
  const idx = A.buildVisitIndex([tr('2026-09-01', '青野ヶ原駅', '鷹取', 'くらし工房'),
    tr('2026-10-01', '青野ヶ原駅', '鷹取', '株式会社くらし工房')], partsOf);
  assert.deepStrictEqual(labels(A.visitSuggestions(idx, '鷹取', 8)), ['株式会社くらし工房']);
});

test('最後の用件：訪問先ごとに、いちばん新しい用件（表記ゆれもまとめる）', () => {
  const idx = A.buildVisitIndex(sampleLedger(), partsOf);
  assert.strictEqual(A.lastPurposeFor(idx, 'くらし工房'), '現場確認');
  assert.strictEqual(A.lastPurposeFor(idx, '鷹取病院 様'), '営業同行');
  assert.strictEqual(A.lastPurposeFor(idx, '須磨商店'), '');   // 用件が無い
  assert.strictEqual(A.lastPurposeFor(idx, 'はじめての会社'), '');
});

test('取引先から：案件の取引先名（駅の候補・同じ取引先と重複しないもの）を最大5件', () => {
  const projects = [{ id: 1, client: '株式会社くらし工房' }, { id: 2, client: '鷹取病院' }, { id: 3, client: 'A社' }, { id: 4, client: 'A社' },
    { id: 5, client: 'B社' }, { id: 6, client: 'C社' }, { id: 7, client: 'D社' }, { id: 8, client: 'E社' }, { id: 9, client: '' }];
  const c = A.clientSuggestions(projects, ['くらし工房様', '鷹取病院'], 5);
  assert.deepStrictEqual(plain(c), ['E社', 'D社', 'C社', 'B社', 'A社']);
  assert.deepStrictEqual(plain(A.clientSuggestions(projects, [], 10)).slice(-2), ['鷹取病院', '株式会社くらし工房']);
});

test('候補が無いとき：駅が空・初めての駅・台帳が空でも空の配列（普通の入力欄として動く）', () => {
  const idx = A.buildVisitIndex(sampleLedger(), partsOf);
  assert.deepStrictEqual(plain(A.visitSuggestions(idx, '', 8)), []);
  assert.deepStrictEqual(plain(A.visitSuggestions(idx, '初めての駅', 8)), []);
  const empty = A.buildVisitIndex([], partsOf);
  assert.deepStrictEqual(plain(A.visitSuggestions(empty, '鷹取', 8)), []);
  assert.deepStrictEqual(plain(A.clientSuggestions([], [], 5)), []);
  assert.deepStrictEqual(plain(A.visitSuggestions(null, '鷹取', 8)), []);
});

console.log('交通費の用件（選択式）');

test('3つの選択肢：保存はその文字列、復元はそのボタン', () => {
  A.TRAVEL_PURPOSES.forEach(c => {
    const r = A.purposeFromState(c, 'テキストは無視');
    assert.deepStrictEqual(plain(r), { ok: true, value: c });
    assert.deepStrictEqual(plain(A.purposeToState(r.value)), { choice: c, text: '' });
  });
  assert.deepStrictEqual(plain(A.TRAVEL_PURPOSES), ['打ち合わせ', '商談', '現地作業', '帰宅']);
});

test('「その他：○○」の保存と復元（テキストに「：」があっても崩れない）', () => {
  const r = A.purposeFromState('その他', '  研修  ');
  assert.deepStrictEqual(plain(r), { ok: true, value: 'その他：研修' });
  assert.deepStrictEqual(plain(A.purposeToState(r.value)), { choice: 'その他', text: '研修' });
  const r2 = A.purposeFromState('その他', '見積：A社の件');
  assert.strictEqual(r2.value, 'その他：見積：A社の件');
  assert.deepStrictEqual(plain(A.purposeToState(r2.value)), { choice: 'その他', text: '見積：A社の件' });
  // 保存し直しても増えていかない
  assert.strictEqual(A.purposeFromState('その他', A.purposeToState(r2.value).text).value, r2.value);
});

test('これまでの自由入力は「その他」＋元の文字列で復元し、保存しない限り書き換わらない', () => {
  assert.deepStrictEqual(plain(A.purposeToState('見積の件')), { choice: 'その他', text: '見積の件' });
  assert.deepStrictEqual(plain(A.purposeToState('営業同行')), { choice: 'その他', text: '営業同行' });
  seq = 0;
  const ledger = [tr('2026-10-01', '青野ヶ原駅', '鷹取', 'くらし工房', '見積の件')];
  const before = JSON.stringify(ledger);
  A.purposeToState(ledger[0].purpose);
  A.buildVisitIndex(ledger, partsOf);
  A.travelPurposeHintFor(A.buildVisitIndex(ledger, partsOf), 'くらし工房');
  assert.strictEqual(JSON.stringify(ledger), before);
  // 編集して保存し直したときだけ「その他：見積の件」になる
  const st = A.purposeToState(ledger[0].purpose);
  assert.strictEqual(A.purposeFromState(st.choice, st.text).value, 'その他：見積の件');
});

test('「その他」でテキストが空なら保存できない（理由つき）', () => {
  ['', '   ', null, undefined].forEach(t => {
    const r = A.purposeFromState('その他', t);
    assert.strictEqual(r.ok, false);
    assert(/内容を入力/.test(r.error), r.error);
  });
});

test('未選択なら空で保存できる', () => {
  assert.deepStrictEqual(plain(A.purposeFromState('', '')), { ok: true, value: '' });
  assert.deepStrictEqual(plain(A.purposeFromState('', '残っていた文字')), { ok: true, value: '' });
  assert.deepStrictEqual(plain(A.purposeToState('')), { choice: '', text: '' });
  assert.deepStrictEqual(plain(A.purposeToState(undefined)), { choice: '', text: '' });
});

test('前回の用件の提案は、選択肢（打ち合わせ・商談・現地作業。帰宅は除く）と一致するときだけ', () => {
  seq = 0;
  const idx = A.buildVisitIndex([
    tr('2026-09-01', '青野ヶ原駅', '鷹取', 'くらし工房', '打ち合わせ'),
    tr('2026-10-01', '青野ヶ原駅', '鷹取', 'くらし工房様', '商談'),          // 最後の用件（表記ゆれもまとめる）
    tr('2026-10-01', '青野ヶ原駅', '鷹取', '鷹取病院', 'その他：見学'),
    tr('2026-09-01', '青野ヶ原駅', '鷹取', '須磨商店', '現地作業'),
    tr('2026-10-05', '青野ヶ原駅', '鷹取', '須磨商店', '見積の件'),          // 最後が自由入力なら提案しない
    tr('2026-10-05', '青野ヶ原駅', '鷹取', '用件なし', '')
  ], partsOf);
  assert.strictEqual(A.travelPurposeHintFor(idx, 'くらし工房'), '商談');
  assert.strictEqual(A.travelPurposeHintFor(idx, '鷹取病院'), '');
  assert.strictEqual(A.travelPurposeHintFor(idx, '須磨商店'), '');
  assert.strictEqual(A.travelPurposeHintFor(idx, '用件なし'), '');
  assert.strictEqual(A.travelPurposeHintFor(idx, 'はじめての会社'), '');
});

console.log('帰りの行の自動入力（訪問先＝自宅、用件＝帰宅）');

const empty = { visit: '', choice: '', autoVisit: false, autoPurpose: false };

test('用件の選択肢は 打ち合わせ／商談／現地作業／帰宅（＋その他）。「帰宅」はそのまま保存・復元', () => {
  assert.deepStrictEqual(plain(A.TRAVEL_PURPOSES), ['打ち合わせ', '商談', '現地作業', '帰宅']);
  assert.deepStrictEqual(plain(A.purposeFromState('帰宅', '')), { ok: true, value: '帰宅' });
  assert.deepStrictEqual(plain(A.purposeToState('帰宅')), { choice: '帰宅', text: '' });
  // 既存の「その他：…」の復元は壊れない
  assert.deepStrictEqual(plain(A.purposeToState('その他：帰宅前に買い出し')), { choice: 'その他', text: '帰宅前に買い出し' });
  assert.deepStrictEqual(plain(A.purposeToState('その他：研修')), { choice: 'その他', text: '研修' });
});

test('帰りの行（到着が自宅駅・出発が自宅駅でない）で「自宅」「帰宅」が自動で入る（両方の自宅駅）', () => {
  [['鷹取', '青野ヶ原駅'], ['鷹取駅', '青野ヶ原'], ['梅田', '天神橋筋六丁目'], ['梅田駅', '天神橋筋六丁目駅']].forEach(([f, t]) => {
    const r = A.applyReturnAutofill(empty, f, t);
    assert.deepStrictEqual(plain(r), { visit: '自宅', choice: '帰宅', autoVisit: true, autoPurpose: true }, f + '→' + t);
  });
  assert(A.isReturnTrip('鷹取', '天神橋筋六丁目駅'));
});

test('片方だけ入っている行では、入っている欄を上書きしない（2つの欄は別々）', () => {
  const r1 = A.applyReturnAutofill({ visit: 'くらし工房', choice: '' }, '鷹取', '青野ヶ原駅');
  assert.deepStrictEqual(plain(r1), { visit: 'くらし工房', choice: '帰宅', autoVisit: false, autoPurpose: true });
  const r2 = A.applyReturnAutofill({ visit: '', choice: '商談' }, '鷹取', '青野ヶ原駅');
  assert.deepStrictEqual(plain(r2), { visit: '自宅', choice: '商談', autoVisit: true, autoPurpose: false });
});

test('自宅駅どうし・行きの行・出発が空では入らない', () => {
  [['青野ヶ原駅', '天神橋筋六丁目駅'], ['天神橋筋六丁目', '青野ヶ原'], ['青野ヶ原駅', '鷹取'], ['三宮', '鷹取'], ['', '青野ヶ原駅']].forEach(([f, t]) => {
    assert.deepStrictEqual(plain(A.applyReturnAutofill(empty, f, t)), empty, f + '→' + t);
  });
});

test('到着を自宅駅から別の駅に変えると、自動入力のままの値だけが消え、手入力の値は消えない', () => {
  // 両方とも自動入力のまま → 両方消える
  let st = A.applyReturnAutofill(empty, '鷹取', '青野ヶ原駅');
  assert.deepStrictEqual(plain(A.applyReturnAutofill(st, '鷹取', '三宮')), empty);
  // 用件だけ手で選び直した（autoPurpose=false）→ 用件は残り、訪問先（自動のまま）だけ消える
  st = A.applyReturnAutofill(empty, '鷹取', '青野ヶ原駅');
  st = Object.assign({}, st, { choice: '商談', autoPurpose: false });
  assert.deepStrictEqual(plain(A.applyReturnAutofill(st, '鷹取', '三宮')), { visit: '', choice: '商談', autoVisit: false, autoPurpose: false });
  // 訪問先を手で書き換えた → 訪問先は残る
  st = A.applyReturnAutofill(empty, '鷹取', '青野ヶ原駅');
  st = Object.assign({}, st, { visit: '自宅（実家）', autoVisit: false });
  assert.strictEqual(A.applyReturnAutofill(st, '鷹取', '三宮').visit, '自宅（実家）');
  // 「自宅」を手で入れた（自動入力ではない）ものも消さない
  assert.strictEqual(A.applyReturnAutofill({ visit: '自宅', choice: '帰宅' }, '鷹取', '三宮').visit, '自宅');
  assert.strictEqual(A.applyReturnAutofill({ visit: '自宅', choice: '帰宅' }, '鷹取', '三宮').choice, '帰宅');
  // 自宅駅どうしに変えたときも、自動入力は外れる
  st = A.applyReturnAutofill(empty, '鷹取', '青野ヶ原駅');
  assert.deepStrictEqual(plain(A.applyReturnAutofill(st, '天神橋筋六丁目', '青野ヶ原駅')), empty);
});

test('「自宅」は候補の集計にも取引先候補にも入らない。過去の帰りの行（訪問先が出発地の訪問先）は集計に入る', () => {
  seq = 0;
  const idx = A.buildVisitIndex([
    tr('2026-10-01', '青野ヶ原駅', '鷹取', 'くらし工房', '商談'),
    tr('2026-10-01', '鷹取', '青野ヶ原駅', 'くらし工房', '商談'),       // 過去の帰りの行
    tr('2026-10-02', '鷹取', '青野ヶ原駅', '自宅', '帰宅'),
    tr('2026-10-03', '梅田', '天神橋筋六丁目駅', ' 自宅 ', '帰宅')
  ], partsOf);
  assert.deepStrictEqual(plain(A.visitSuggestions(idx, '鷹取', 8)), [{ label: 'くらし工房', count: 2, last: '2026-10-01' }]);
  assert.deepStrictEqual(plain(A.visitSuggestions(idx, '梅田', 8)), []);
  assert.strictEqual(A.lastPurposeFor(idx, '自宅'), '');
  assert.deepStrictEqual(plain(A.clientSuggestions([{ id: 1, client: '自宅' }, { id: 2, client: 'A社' }], [], 5)), ['A社']);
});

test('「帰宅」は前回の用件として提案しない', () => {
  seq = 0;
  const idx = A.buildVisitIndex([
    tr('2026-10-01', '青野ヶ原駅', '鷹取', 'くらし工房', '商談'),
    tr('2026-10-02', '鷹取', '青野ヶ原駅', 'くらし工房', '帰宅')        // 最後の用件が帰宅
  ], partsOf);
  assert.strictEqual(A.lastPurposeFor(idx, 'くらし工房'), '帰宅');
  assert.strictEqual(A.travelPurposeHintFor(idx, 'くらし工房'), '');
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
