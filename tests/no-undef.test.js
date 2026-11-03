// 未定義の名前の静的チェック（ESLint の no-undef）
// keiei-kanri.html のインラインのスクリプトと、HTMLの on○○="…" 属性（JSのテンプレート文字列の中で作るものも含む）を調べる。
// 関数を消したのに呼び出しが残っている、といった事故（2026-11-03 の localYmd など）を、ブラウザで開く前に見つける。
// 実行：node tests/no-undef.test.js（npm test に含まれる）。ESLint は tests/node_modules の開発用の依存
const fs = require('fs');
const path = require('path');
const { Linter } = require('eslint');
const globals = require('globals');

const FILE = process.env.APP_FILE || path.join(__dirname, '..', 'keiei-kanri.html');
const html = fs.readFileSync(FILE, 'utf8');

// ブラウザの標準以外で、意図して使っているグローバル（読み込み時に作られるもの・外部ライブラリ）
const ALLOWED_GLOBALS = {
  XLSX: 'readonly',      // 月次PL（Excel）。ボタンを押したときに xlsx-js-style を読み込む
  Chart: 'readonly',     // グラフのライブラリ（読み込んでいれば）
};

// インラインのスクリプト（<script> … </script>。src のあるものは除く）
const scripts = [];
const reScript = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
let m;
while ((m = reScript.exec(html))) {
  if (m[1] && /\ssrc=/.test(m[1])) continue;
  const startLine = html.slice(0, m.index + m[0].indexOf('>') + 1).split('\n').length;
  scripts.push({ code: m[2], startLine });
}
if (!scripts.length) { console.error('インラインのスクリプトが見つかりません'); process.exit(1); }

const linter = new Linter({ configType: 'flat' });
const baseConfig = extra => [{
  languageOptions: {
    ecmaVersion: 'latest',
    sourceType: 'script',
    globals: { ...globals.browser, ...ALLOWED_GLOBALS, ...extra },
  },
  rules: { 'no-undef': 'error' },
}];

const problems = [];
// 1. スクリプト本体
const topNames = {};
scripts.forEach(s => {
  const msgs = linter.verify(s.code, baseConfig({}));
  msgs.forEach(x => problems.push(`keiei-kanri.html:${s.startLine + x.line - 1}:${x.column}  ${x.fatal ? '構文エラー: ' : ''}${x.message}`));
  // 属性のチェック用に、トップレベルで宣言した名前を集める（クラシックスクリプトなのでグローバルになる）
  const sc = linter.getSourceCode();
  if (sc && sc.scopeManager) sc.scopeManager.globalScope.variables.forEach(v => { if (v.defs.length) topNames[v.name] = 'writable'; });
});

// 2. on○○="…" の属性。${…} は値に置き換え、JSの文字列の中のエスケープを戻してから調べる
const decode = t => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const dropTemplates = t => {
  let out = '', i = 0;
  while (i < t.length) {
    if (t[i] === '$' && t[i + 1] === '{') {
      let depth = 1, j = i + 2;
      while (j < t.length && depth) { if (t[j] === '{') depth++; else if (t[j] === '}') depth--; j++; }
      out += '0'; i = j;
    } else out += t[i++];
  }
  return out;
};
const reAttr = /\son([a-z]+)="([^"]*)"/g;
let attrs = 0, skipped = 0;
while ((m = reAttr.exec(html))) {
  const line = html.slice(0, m.index).split('\n').length;
  const code = decode(dropTemplates(m[2]).replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  if (!code.trim()) continue;
  attrs++;
  const msgs = linter.verify(`(function(event){${code}\n})`, baseConfig(topNames));
  if (msgs.some(x => x.fatal)) { skipped++; continue; }   // テンプレートの組み立て方によっては、そのままでは読めないものがある
  msgs.forEach(x => problems.push(`keiei-kanri.html:${line}  on${m[1]}="${m[2].slice(0, 60)}"  ${x.message}`));
}

if (problems.length) {
  console.error('未定義の名前があります（関数・変数を消していないか、名前の打ち間違いがないか確認すること）');
  problems.forEach(p => console.error('  ' + p));
  console.error(`✗ ${problems.length}件`);
  process.exit(1);
}
console.log(`未定義の名前なし（スクリプト ${scripts.length}本・トップレベルの名前 ${Object.keys(topNames).length}個・on属性 ${attrs}件、うち読めずに飛ばした ${skipped}件）`);
