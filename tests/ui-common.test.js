// UI改修の共通部品（uc-）のテスト：表示だけの関数を切り出して Node で読む（docs/ui-revamp.md）
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'keiei-kanri.html'), 'utf8');
function fnSource(name) {
  const i = html.indexOf('function ' + name + '(');
  assert(i > 0, name + ' が見つかりません');
  let d = 0, j = html.indexOf('{', i);
  for (; j < html.length; j++) { if (html[j] === '{') d++; else if (html[j] === '}') { d--; if (!d) break; } }
  return html.slice(i, j + 1);
}
const iconsAt = html.indexOf('const UC_ICONS=');
assert(iconsAt > 0, 'UC_ICONS が見つかりません');
const iconsSrc = html.slice(iconsAt, html.indexOf('\n};', iconsAt) + 3);
const names = ['fmt', 'escAttr', 'ucIcon', 'ucBadge', 'ucDiff', 'ucKpis', 'ucBar', 'ucMore', 'ucHero', 'ucRow', 'ucProgress'];
const app = {};
vm.createContext(app);
vm.runInContext(iconsSrc + '\n' + names.map(fnSource).join('\n') + `
globalThis.exported = { ${names.join(',')} };`, app);
const A = app.exported;

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  ✓ ' + name); }
  catch (e) { console.error('  ✗ ' + name + '\n    ' + e.message); process.exitCode = 1; }
}

test('差額：計画ゼロで率を出さない（ゼロ除算なし）・中立の色に▲▼', () => {
  const z = A.ucDiff(5000, 0);
  assert(z.includes('▲') && z.includes('¥5,000') && !z.includes('%') && !/Infinity|NaN/.test(z));
  assert(A.ucDiff(800, 1000).includes('▼¥200（-20%）'));
  assert(A.ucDiff(0, 0).includes('±¥0'));
  assert(!/green|red|#1D9E75|#E24B4A/.test(A.ucDiff(1, 2)));
});
test('進捗行：max が 0 でもバーは 0%・NaN を出さない', () => {
  const p = A.ucProgress('売上', 100, 0);
  assert(p.includes('width:0%') && !/NaN|Infinity/.test(p));
  assert(A.ucProgress('売上', 150, 100).includes('width:100%'));
});
test('横棒：負の値でも幅は 0〜100%、凡例は元の数字', () => {
  const b = A.ucBar(100000, -20000, '現在残高', '月末予測');
  assert(!/NaN|width:-/.test(b) && b.includes('¥-20,000'));
  assert(A.ucBar(0, 0, 'a', 'b').includes('width:0%'));
});
test('文字は escape される（行・KPI・ヒーロー・バッジ）', () => {
  const x = '<img src=x>';
  for (const h of [A.ucRow({ main: x, sub: x, amount: 1 }), A.ucKpis([{ label: x, value: x }]), A.ucHero({ label: x, value: 1, sub: x }), A.ucBadge(x)])
    assert(!h.includes('<img'), h);
});
test('ヒーロー：負の値は is-neg（#DC2626）、アイコンは線画SVG', () => {
  assert(A.ucHero({ label: 'a', value: -1 }).includes('is-neg'));
  assert(!A.ucHero({ label: 'a', value: 0 }).includes('is-neg'));
  assert(A.ucIcon('wallet').startsWith('<svg') && A.ucIcon('none') === '');
});

console.log(`\n${passed}件 成功`);
