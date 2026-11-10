/* 交通費の訪問先の候補（到着駅から過去の訪問先を選ぶ）・用件の選択式・同じ区間の過去の運賃・電車／バスの手段のテスト
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
// TRAVEL_MODES は範囲の外にあるので、アプリの定義をそのまま取り出して渡す
const modesSrc = /const TRAVEL_MODES=(\[[^\]]*\]);/.exec(html)[1];
vm.runInContext(html.slice(html.indexOf('\n', begin) + 1, html.lastIndexOf('\n', end)) + `
const TRAVEL_MODES_FOR_TEST=${modesSrc};
globalThis.exported = { HOME_STATIONS, TRAVEL_BLANK_DESC, normStation, isHomeStation, normVisit, visitSideStation,
  buildVisitIndex, visitSuggestions, clientSuggestions, lastPurposeFor, stationForVisit, stationInLocation,
  TRAVEL_PURPOSES, purposeFromState, purposeToState, travelPurposeHintFor, isReturnTrip, applyReturnAutofill,
  pastFares, fareAutofill, isCalendarTravel, isFareConfirmed, normFareCache, shouldConfirmFare, confirmFareInCache, calcFareSources,
  fareModeOf, rowFareModeOf, buildTravelDesc, travelModeChoices, fareCacheKey, legacyModeRows, relabelTravelMode,
  TRAVEL_MODES_FOR_TEST };`, app);
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
  const desc = String(l.desc || '');
  const m = /（([^（）]+)）(?:\s|　)*(?:往復)?\s*$/.exec(desc);
  const round = /往復\s*$/.test(desc);
  const d = desc.replace(/（[^（）]+）(?:\s|　)*(?:往復)?\s*$/, '');
  const i = d.indexOf('→');
  const ft = i < 0 ? { from: '', to: d.trim() } : { from: d.slice(0, i).trim(), to: d.slice(i + 1).trim() };
  return Object.assign(ft, { mode: m ? m[1] : '', round });
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

test('カレンダー取込の最寄駅 A：予定の名前が過去の訪問先に一致 → その駅（多い駅・同数は最近）／一致しない・自宅は空', () => {
  seq = 0;
  const idx = A.buildVisitIndex([tr('2026-09-01', '青野ヶ原駅', '鷹取', 'くらし工房'),
    tr('2026-09-10', '青野ヶ原駅', '鷹取', 'くらし工房'), tr('2026-10-01', '青野ヶ原駅', '三宮', 'くらし工房')], partsOf);
  assert.strictEqual(A.stationForVisit(idx, 'くらし工房'), '鷹取駅');
  assert.strictEqual(A.stationForVisit(idx, 'まだ行ったことのない会社'), '');
  assert.strictEqual(A.stationForVisit(idx, ''), '');
  // 入力した駅は登録した行に残る → 次回の候補になる
  const idx2 = A.buildVisitIndex([tr('2026-11-01', '青野ヶ原駅', '新開地駅', '新しい取引先')], partsOf);
  assert.strictEqual(A.stationForVisit(idx2, '新しい取引先'), '新開地駅');
});

test('カレンダー取込の最寄駅 B：場所欄の「〇〇駅」（住所の数字の部分は駅にしない）', () => {
  assert.strictEqual(A.stationInLocation('梅田駅'), '梅田駅');
  assert.strictEqual(A.stationInLocation('大阪府大阪市北区梅田3-1-1 大阪駅前第3ビル'), '大阪駅');
  assert.strictEqual(A.stationInLocation('株式会社テスト（JR三ノ宮駅 徒歩5分）'), 'JR三ノ宮駅');
  assert.strictEqual(A.stationInLocation('兵庫県神戸市中央区2-2'), '');
  assert.strictEqual(A.stationInLocation(''), '');
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

console.log('同じ区間の過去の運賃');

// 手段と往復つきの行
const fr = (date, from, to, amount, extra, mode, round) => Object.assign({ id: ++seq, date, type: '交通費', status: 'actual',
  desc: `${from}→${to}（${mode || '電車・バス'}）` + (round ? '　往復' : ''), amount, visit: '', purpose: '' }, extra || {});
const PF = (ledger, from, to, mode, cache) => plain(A.pastFares(ledger, partsOf, cache || {}, from, to, mode || '電車・バス'));

test('同じ区間・同じ手段で、最新の金額が採用される（駅名は正規化して比べる。往復の行は片道に）', () => {
  seq = 0;
  const ledger = [fr('2026-09-01', '青野ヶ原駅', '鷹取', 210), fr('2026-10-28', '青野ヶ原', '鷹取駅', 230),
    fr('2026-10-10', '青野ヶ原駅', '鷹取', 460, {}, '電車・バス', true)];
  const r = PF(ledger, ' 青野ヶ原駅', '鷹取');
  assert.strictEqual(r.source, 'same');
  assert.deepStrictEqual(r.options, [{ amount: 230, last: '2026-10-28' }, { amount: 210, last: '2026-09-01' }]);  // 460円の往復は片道230円
  assert.deepStrictEqual(plain(A.fareAutofill({}, '', r, 1)), { amount: '230', auto: true, value: '230' });
  assert.deepStrictEqual(plain(A.fareAutofill({}, '0', r, 2)), { amount: '460', auto: true, value: '460' });     // 往復の行
});

test('複数の金額は最大3つ（新しい順）。選んだ金額に差し替えられる', () => {
  seq = 0;
  const ledger = [210, 220, 230, 240].map((a, i) => fr('2026-10-0' + (i + 1), '青野ヶ原駅', '鷹取', a));
  ledger.push(fr('2026-10-09', '青野ヶ原駅', '鷹取', 240));
  const r = PF(ledger, '青野ヶ原駅', '鷹取');
  assert.deepStrictEqual(r.options.map(x => x.amount), [240, 230, 220]);
  assert.strictEqual(r.options[0].last, '2026-10-09');
  // 差し替え（画面では pickPastFare）。自動反映の値が変わっても、自動反映のまま扱う
  const st = { auto: true, value: '220' };
  assert.deepStrictEqual(plain(A.fareAutofill(st, '220', r, 1)), { amount: '240', auto: true, value: '240' });
});

test('すでに入っている運賃（手入力・修正済み）は上書きしない', () => {
  seq = 0;
  const r = PF([fr('2026-10-28', '青野ヶ原駅', '鷹取', 230)], '青野ヶ原駅', '鷹取');
  assert.deepStrictEqual(plain(A.fareAutofill({}, '250', r, 1)), { amount: '250', auto: false, value: '' });
  // 自動で入れた値を手で書き換えた（値が違う）ものも上書きしない
  assert.deepStrictEqual(plain(A.fareAutofill({ auto: true, value: '230' }, '260', r, 1)), { amount: '260', auto: false, value: '' });
});

test('手段がタクシー・車・その他のときは自動反映しない（参照元にも使わない）', () => {
  seq = 0;
  const ledger = [fr('2026-10-28', '青野ヶ原駅', '鷹取', 2300, {}, 'タクシー'), fr('2026-10-28', '青野ヶ原駅', '鷹取', 800, {}, '車')];
  ['タクシー', '車', 'その他'].forEach(m => assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', m), { source: '', options: [] }, m));
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取'), { source: '', options: [] });   // 電車・バスの行が無い
});

test('電車は逆区間から参照できる（同じ区間の行が無いときだけ）。バスは逆区間を参照しない', () => {
  seq = 0;
  const ledger = [fr('2026-10-28', '鷹取', '青野ヶ原駅', 230)];
  const r = PF(ledger, '青野ヶ原駅', '鷹取');
  assert.deepStrictEqual(r, { source: 'reverse', options: [{ amount: 230, last: '2026-10-28' }] });
  ledger.push(fr('2026-09-01', '青野ヶ原駅', '鷹取', 210));
  assert.strictEqual(PF(ledger, '青野ヶ原駅', '鷹取').source, 'same');                // 同じ区間があればそちら
  const bus = [fr('2026-10-28', '市役所前バス停', '青野ヶ原駅', 220), fr('2026-10-28', '鷹取', '中央停留所', 220)];
  assert.deepStrictEqual(PF(bus, '青野ヶ原駅', '市役所前バス停'), { source: '', options: [] });
  assert.deepStrictEqual(PF(bus, '中央停留所', '鷹取'), { source: '', options: [] });
  assert.strictEqual(PF(bus, '市役所前バス停', '青野ヶ原駅').source, 'same');          // バスでも同じ区間は使う
});

test('0円・空の行、予定の行、AI推定のまま未確認の行は参照元に入らない', () => {
  seq = 0;
  const ledger = [fr('2026-10-01', '青野ヶ原駅', '鷹取', 0), fr('2026-10-02', '青野ヶ原駅', '鷹取', ''),
    fr('2026-10-03', '青野ヶ原駅', '鷹取', 230, { status: 'planned_out' }),
    fr('2026-10-04', '青野ヶ原駅', '鷹取', 999, { calId: 'evt1@2026-10-04' })];                // カレンダーの行・キャッシュは推定
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', '電車・バス', { '青野ヶ原駅|鷹取': { amount: 999, confidence: 'mid' } }), { source: '', options: [] });
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取'), { source: '', options: [] });     // キャッシュも無い
  // デビット通知・領収書の印は「カレンダーの行」ではない（確認済みとして扱う）
  assert(!A.isCalendarTravel({ calId: 'mail:x' }) && !A.isCalendarTravel({ calId: 'rcpt:x' }) && !A.isCalendarTravel({ calId: '' }));
  assert(A.isCalendarTravel({ calId: 'evt1@2026-10-04' }));
});

test('manual のキャッシュと金額が一致するカレンダーの行は、参照元として使われる（往復は片道で比べる）', () => {
  seq = 0;
  const ledger = [fr('2026-10-04', '青野ヶ原駅', '鷹取', 460, { calId: 'evt1@2026-10-04' }, '電車・バス', true)];
  const manual = { '青野ヶ原|鷹取駅': { amount: 230, confidence: 'manual' } };            // キーの表記が違っても同じ区間
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', '電車・バス', manual).options, [{ amount: 230, last: '2026-10-04' }]);
  // 金額が一致しなければ未確認のまま
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', '電車・バス', { '青野ヶ原駅|鷹取': { amount: 240, confidence: 'manual' } }).options, []);
  const l = ledger[0], p = partsOf(l);
  assert.strictEqual(A.isFareConfirmed(l, p, A.normFareCache(manual)), true);
});

test('出発・到着を変えたとき、自動反映のままの運賃だけが戻る（手で入れた運賃は残る）', () => {
  seq = 0;
  const ledger = [fr('2026-10-28', '青野ヶ原駅', '鷹取', 230), fr('2026-10-20', '青野ヶ原駅', '三宮', 420)];
  let st = A.fareAutofill({}, '', PF(ledger, '青野ヶ原駅', '鷹取'), 1);
  assert.strictEqual(st.amount, '230');
  // 到着を三宮に → 三宮の運賃に入れ替わる
  st = A.fareAutofill(st, st.amount, PF(ledger, '青野ヶ原駅', '三宮'), 1);
  assert.deepStrictEqual(plain(st), { amount: '420', auto: true, value: '420' });
  // 参照元の無い駅に → 空に戻る
  st = A.fareAutofill(st, st.amount, PF(ledger, '青野ヶ原駅', '初めての駅'), 1);
  assert.deepStrictEqual(plain(st), { amount: '', auto: false, value: '' });
  // 手で入れた運賃は、参照元の無い駅に変えても残る
  assert.strictEqual(A.fareAutofill({ auto: false }, '500', PF(ledger, '青野ヶ原駅', '初めての駅'), 1).amount, '500');
});

test('キャッシュを manual にするのは、カレンダーの行で運賃を書き換えた／「運賃を確認した」を押して保存したときだけ', () => {
  const cal = { calId: 'evt1@2026-10-04', amount: 230 };
  // 到着地や訪問先だけを直して保存 → manual にしない
  assert.strictEqual(A.shouldConfirmFare(cal, { touched: false, confirmed: false }), false);
  assert.strictEqual(A.shouldConfirmFare(cal, { touched: true, confirmed: false }), true);     // 運賃を書き換えた
  assert.strictEqual(A.shouldConfirmFare(cal, { touched: false, confirmed: true }), true);     // 確認ボタン
  assert.strictEqual(A.shouldConfirmFare({ calId: '', amount: 230 }, { touched: true }), false); // 手入力の行は対象外（もともと確認済み）
  // 既存の同じ区間のキー（表記違い）を書き換える
  const cache = { '青野ヶ原|鷹取駅': { amount: 999, confidence: 'mid', at: '2026-10-01' } };
  assert.strictEqual(A.confirmFareInCache(cache, '青野ヶ原駅', '鷹取', 230, '2026-11-02'), '青野ヶ原|鷹取駅');
  assert.deepStrictEqual(plain(cache), { '青野ヶ原|鷹取駅': { amount: 230, confidence: 'manual', at: '2026-11-02' } });
  const c2 = {};
  A.confirmFareInCache(c2, '青野ヶ原駅', '三宮', 420, '2026-11-02');
  assert.deepStrictEqual(Object.keys(c2), ['青野ヶ原駅|三宮']);
  assert.strictEqual(A.confirmFareInCache(c2, '青野ヶ原駅', '三宮', 0, '2026-11-02'), null);
});

test('カレンダーの運賃計算：過去実績が先に使われ、AI検索の対象から外れる（次にキャッシュ）', () => {
  seq = 0;
  const ledger = [fr('2026-10-28', '青野ヶ原駅', '鷹取', 230)];
  const cache = { '青野ヶ原駅|三宮': { amount: 420, confidence: 'mid' }, '青野ヶ原駅|鷹取': { amount: 999, confidence: 'mid' } };
  const rows = [{ from: '青野ヶ原駅', to: '鷹取', mode: '電車・バス' }, { from: '青野ヶ原駅', to: '三宮', mode: '電車・バス' },
    { from: '青野ヶ原駅', to: '大阪', mode: '電車・バス' }, { from: '青野ヶ原駅', to: '大阪', mode: '電車・バス' }];
  const plan = A.calcFareSources(rows, ledger, partsOf, cache);
  assert.deepStrictEqual(plain(plan.past.map(x => [x.row.to, x.amount])), [['鷹取', 230]]);          // キャッシュの999円より実績
  assert.deepStrictEqual(plain(plan.cached.map(x => [x.row.to, parseInt(x.entry.amount)])), [['三宮', 420]]);
  assert.deepStrictEqual(plain(plan.missing), [{ from: '青野ヶ原駅', to: '大阪', mode: '電車', key: '青野ヶ原駅|大阪' }]);  // AI検索は1区間だけ
});

console.log('移動手段：電車／バス');

test('新しい行は「電車」「バス」で保存・復元される（摘要の手段）', () => {
  assert.deepStrictEqual(plain(A.TRAVEL_MODES_FOR_TEST), ['電車', 'バス', 'タクシー', '車', 'その他']);
  seq = 0;
  ['電車', 'バス'].forEach(m => {
    const l = { id: ++seq, type: '交通費', desc: A.buildTravelDesc('青野ヶ原駅', '鷹取', m, false) };
    assert.strictEqual(l.desc, `青野ヶ原駅→鷹取（${m}）`);
    assert.strictEqual(partsOf(l).mode, m);
  });
  assert.strictEqual(A.buildTravelDesc('青野ヶ原駅', '鷹取', 'バス', true), '青野ヶ原駅→鷹取（バス）　往復');
  assert.strictEqual(A.buildTravelDesc('', '', '電車', false), '（未入力）');
  assert.strictEqual(A.buildTravelDesc('', '鷹取', '', false), '鷹取');
});

test('旧「電車・バス」の行は、開くと「電車・バス（旧）」を出し、保存し直しても値は変わらない', () => {
  const desc = '青野ヶ原駅→鷹取（電車・バス）　往復';
  const p = partsOf({ desc });
  const choices = plain(A.travelModeChoices(A.TRAVEL_MODES_FOR_TEST, p.mode));
  assert.deepStrictEqual(choices[0], { value: '電車・バス', label: '電車・バス（旧）' });
  // 手段欄の値（電車・バス）のまま保存 → 摘要は同じ
  assert.strictEqual(A.buildTravelDesc(p.from, p.to, choices[0].value, p.round), desc);
  // 新しい行・電車の行には「（旧）」を出さない
  assert(!A.travelModeChoices(A.TRAVEL_MODES_FOR_TEST, '電車').some(o => o.value === '電車・バス'));
  assert(!A.travelModeChoices(A.TRAVEL_MODES_FOR_TEST, '').some(o => o.value === '電車・バス'));
});

test('バスの入力は逆区間を参照しない／電車は参照する。電車とバスの実績は混ざらない', () => {
  seq = 0;
  const ledger = [fr('2026-10-28', '鷹取', '青野ヶ原駅', 230, {}, '電車'), fr('2026-10-20', '鷹取', '青野ヶ原駅', 210, {}, 'バス')];
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', '電車'), { source: 'reverse', options: [{ amount: 230, last: '2026-10-28' }] });
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '鷹取', 'バス'), { source: '', options: [] });
  assert.deepStrictEqual(PF(ledger, '鷹取', '青野ヶ原駅', 'バス'), { source: 'same', options: [{ amount: 210, last: '2026-10-20' }] });
  assert.deepStrictEqual(PF(ledger, '鷹取', '青野ヶ原駅', '電車'), { source: 'same', options: [{ amount: 230, last: '2026-10-28' }] });
});

test('旧データの判定：旧「電車・バス」と「（電車）」の行は、駅名に「バス」「停留所」があればバス、それ以外は電車', () => {
  assert.strictEqual(A.rowFareModeOf({ mode: '電車・バス', from: '青野ヶ原駅', to: '鷹取' }), '電車');
  assert.strictEqual(A.rowFareModeOf({ mode: '電車・バス', from: '市役所前バス停', to: '青野ヶ原駅' }), 'バス');
  assert.strictEqual(A.rowFareModeOf({ mode: '電車', from: '中央停留所', to: '鷹取' }), 'バス');
  assert.strictEqual(A.rowFareModeOf({ mode: 'バス', from: '青野ヶ原駅', to: '鷹取' }), 'バス');
  assert.strictEqual(A.rowFareModeOf({ mode: '車', from: 'A', to: 'B' }), '');
  assert.strictEqual(A.rowFareModeOf({ mode: '', from: 'A', to: 'B' }), '');            // 手段が空は対象外
  // 入力中の手段：選んだ電車・バスはそのまま、旧「電車・バス」は駅名で決める
  assert.strictEqual(A.fareModeOf('電車', '市役所前バス停', '鷹取'), '電車');
  assert.strictEqual(A.fareModeOf('電車・バス', '市役所前バス停', '鷹取'), 'バス');
  assert.strictEqual(A.fareModeOf('タクシー', 'A', 'B'), '');
  // 旧「電車・バス」の過去の行は、電車の入力の参照元になる（バス停の行はバスの参照元）
  seq = 0;
  const ledger = [fr('2026-10-01', '青野ヶ原駅', '鷹取', 230), fr('2026-10-02', '青野ヶ原駅', '市役所前バス停', 220),
    fr('2026-10-03', '青野ヶ原駅', '三宮', 420, {}, '電車')];                               // 収支入力モーダルの（電車）
  assert.strictEqual(PF(ledger, '青野ヶ原駅', '鷹取', '電車').options[0].amount, 230);
  assert.strictEqual(PF(ledger, '青野ヶ原駅', '市役所前バス停', 'バス').options[0].amount, 220);
  assert.deepStrictEqual(PF(ledger, '青野ヶ原駅', '市役所前バス停', '電車').options, []);
  assert.strictEqual(PF(ledger, '青野ヶ原駅', '三宮', '電車').options[0].amount, 420);
  assert.deepStrictEqual(PF([fr('2026-10-01', '青野ヶ原駅', '鷹取', 230, {}, 'タクシー')], '青野ヶ原駅', '鷹取', '電車').options, []);
});

test('運賃キャッシュ：電車とバスのキーが分かれ、既存のキー（手段なし）は電車として読める', () => {
  assert.strictEqual(A.fareCacheKey('青野ヶ原駅', '鷹取', '電車'), '青野ヶ原駅|鷹取');
  assert.strictEqual(A.fareCacheKey('青野ヶ原駅', '鷹取', 'バス'), '青野ヶ原駅|鷹取|バス');
  const cache = { '青野ヶ原駅|鷹取': { amount: 230, confidence: 'mid' }, '青野ヶ原|鷹取駅|バス': { amount: 210, confidence: 'mid' } };
  const n = A.normFareCache(cache);
  assert.strictEqual(n['青野ヶ原|鷹取|電車'].amount, 230);
  assert.strictEqual(n['青野ヶ原|鷹取|バス'].amount, 210);
  const rows = [{ from: '青野ヶ原駅', to: '鷹取', mode: '電車' }, { from: '青野ヶ原駅', to: '鷹取', mode: 'バス' },
    { from: '青野ヶ原駅', to: '三宮', mode: 'バス' }, { from: '青野ヶ原駅', to: '鷹取', mode: 'タクシー' }];
  const plan = A.calcFareSources(rows, [], partsOf, cache);
  assert.deepStrictEqual(plain(plan.cached.map(x => [x.row.mode, parseInt(x.entry.amount)])), [['電車', 230], ['バス', 210]]);
  assert.deepStrictEqual(plain(plan.missing), [{ from: '青野ヶ原駅', to: '三宮', mode: 'バス', key: '青野ヶ原駅|三宮|バス' }]);
  // 確認（manual）もバスはバスのキーへ。電車の既存キーは触らない
  const c2 = Object.assign({}, cache);
  A.confirmFareInCache(c2, '青野ヶ原駅', '鷹取', 220, '2026-11-03', 'バス');
  assert.deepStrictEqual(plain(c2['青野ヶ原|鷹取駅|バス']), { amount: 220, confidence: 'manual', at: '2026-11-03' });
  assert.deepStrictEqual(plain(c2['青野ヶ原駅|鷹取']), { amount: 230, confidence: 'mid' });
  // カレンダーのバスの行は、バスのキーが manual のときだけ確認済み
  seq = 0;
  const bus = fr('2026-10-04', '青野ヶ原駅', '鷹取', 220, { calId: 'evt@2026-10-04' }, 'バス');
  assert.strictEqual(A.isFareConfirmed(bus, partsOf(bus), A.normFareCache(c2)), true);
  assert.strictEqual(A.isFareConfirmed(bus, partsOf(bus), A.normFareCache({ '青野ヶ原駅|鷹取': { amount: 220, confidence: 'manual' } })), false);
});

test('旧データの整理：精算済みの月・手段が空・ほかの手段は対象外、提案は駅名で、適用前はデータが変わらない', () => {
  seq = 0;
  const ledger = [
    fr('2026-09-10', '青野ヶ原駅', '鷹取', 230),                                    // 9月は精算済み
    { id: ++seq, type: '交通費', desc: '交通費精算 2026年9月分', amount: 230, status: 'planned_out', date: '2026-10-25', settlementMonth: '2026-09' },
    fr('2026-10-01', '青野ヶ原駅', '鷹取', 460, {}, '電車・バス', true),
    fr('2026-10-02', '市役所前バス停', '青野ヶ原駅', 220),
    fr('2026-10-03', '青野ヶ原駅', '鷹取', 230, {}, '電車'),
    fr('2026-10-04', '青野ヶ原駅', '鷹取', 2300, {}, 'タクシー'),
    Object.assign(fr('2026-10-05', '', '', 0), { desc: '（未入力）' }),
    Object.assign(fr('不明', '青野ヶ原駅', '鷹取', 230), { date: '' })                 // 日付が読めない → 安全側で外す
  ];
  const before = JSON.stringify(ledger);
  const rows = A.legacyModeRows(ledger, partsOf);
  assert.deepStrictEqual(plain(rows), [{ id: 3, suggestion: '電車' }, { id: 4, suggestion: 'バス' }]);
  assert.strictEqual(JSON.stringify(ledger), before);                                 // 一覧を作っただけでは変わらない
  // 適用：摘要の（手段）だけを書き換える（往復の印・区間はそのまま）
  assert.strictEqual(A.relabelTravelMode(ledger[2].desc, '電車'), '青野ヶ原駅→鷹取（電車）　往復');
  assert.strictEqual(A.relabelTravelMode(ledger[3].desc, 'バス'), '市役所前バス停→青野ヶ原駅（バス）');
  ledger[3].desc = A.relabelTravelMode(ledger[3].desc, 'バス');
  assert.strictEqual(partsOf(ledger[3]).mode, 'バス');
  assert.deepStrictEqual(plain(A.legacyModeRows(ledger, partsOf).map(x => x.id)), [3]);
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
