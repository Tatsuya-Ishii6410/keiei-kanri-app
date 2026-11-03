// npm test：tests/*.test.js をすべて順に実行する。1つでも失敗したら全体を失敗にする（終了コード1）
// 静的チェック（no-undef.test.js）が使う ESLint は tests/ の開発用の依存。無ければ最初に入れる（tests/package-lock.json の版）
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const dir = __dirname;
if (!fs.existsSync(path.join(dir, 'node_modules', 'eslint'))) {
  console.log('テスト用の依存（ESLint）を tests/node_modules に入れます...');
  const r = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error('✗ テスト用の依存を入れられませんでした（cd tests && npm ci）'); process.exit(1); }
}

// 速いものから。画面の実行テスト（Chrome を起動する）は最後
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort((a, b) => (a === 'app-smoke.test.js') - (b === 'app-smoke.test.js') || a.localeCompare(b));
const failed = [];
for (const f of files) {
  console.log(`\n=== ${f}`);
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed.push(f);
}
console.log('\n' + (failed.length ? `✗ 失敗：${failed.join('、')}（${files.length}本中 ${failed.length}本）` : `✓ すべて成功（${files.length}本）`));
process.exit(failed.length ? 1 : 0);
