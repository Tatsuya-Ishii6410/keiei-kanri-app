/* 運用チェックのテスト（①週次バックアップ）
   実行: node tests/ops-checks.test.js

   - gas-code.js はまるごと読む。DriveApp・ScriptApp・SpreadsheetApp・LockService・Utilities はモックに差し替える
     バックアップの本体（runBackup_）は Drive を io で受け取るので、io もモックで渡す
   - keiei-kanri.html は「@import-rules」と「@ops-rules」の範囲だけを切り出して読む */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

// ---- スプレッドシートのモック（2次元配列） ----
function mockSheet(rows) {
  const data = (rows || []).map(r => r.slice());
  const sh = {
    data,
    getLastRow: () => { let n = data.length; while (n > 0 && data[n - 1].join('') === '') n--; return n; },
    getLastColumn: () => data.reduce((m, r) => Math.max(m, r.length), 0),
    getMaxRows: () => 1000,
    setFrozenRows: () => sh,
    getRange: (r, c, nr, nc) => {
      nr = nr || 1; nc = nc || 1;
      const rg = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(((data[r - 1 + i] || [])[c - 1 + j]) ?? ''); out.push(row); } return out; },
        setValues: v => { for (let i = 0; i < nr; i++) { while (data.length < r + i) data.push([]); for (let j = 0; j < nc; j++) data[r - 1 + i][c - 1 + j] = v[i][j]; } return rg; },
        clearContent: () => { for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) if (data[r - 1 + i]) data[r - 1 + i][c - 1 + j] = ''; return rg; },
        setNumberFormat: () => rg,
        setFontWeight: () => rg
      };
      return rg;
    }
  };
  return sh;
}
function mockSpreadsheet() {
  const sheets = {};
  return {
    sheets,
    getSheetByName: n => sheets[n] || null,
    insertSheet: n => (sheets[n] = mockSheet([])),
    getSpreadsheetTimeZone: () => 'Asia/Tokyo'
  };
}

// ---- GAS（モック付き） ----
const gas = {};
vm.createContext(gas);
vm.runInContext(fs.readFileSync(path.join(root, 'gas-code.js'), 'utf8'), gas);
const pad = n => String(n).padStart(2, '0');
gas.Utilities = {
  // テストでは Date の UTC の値をそのまま使う（タイムゾーンは見ない）
  formatDate: (d, tz, f) => f.replace('yyyy', d.getUTCFullYear()).replace('MM', pad(d.getUTCMonth() + 1)).replace('dd', pad(d.getUTCDate()))
    .replace('HH', pad(d.getUTCHours())).replace('mm', pad(d.getUTCMinutes())).replace('ss', pad(d.getUTCSeconds()))
};
gas.LockService = { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) };
gas.Logger = { log: () => {} };
let ss = mockSpreadsheet();
gas.SpreadsheetApp = { openById: () => ss, flush: () => {} };

// ---- アプリの判定 ----
const html = fs.readFileSync(path.join(root, 'keiei-kanri.html'), 'utf8');
function region(name) {
  const b = html.indexOf('@' + name + '-begin'), e = html.indexOf('@' + name + '-end');
  assert(b > 0 && e > b, 'keiei-kanri.html に @' + name + ' の範囲が見つかりません');
  return html.slice(html.indexOf('\n', b) + 1, html.lastIndexOf('\n', e));
}
const app = {};
vm.createContext(app);
vm.runInContext(region('import-rules') + '\n' + region('ops-rules') + `
globalThis.exported = { backupStatusOf };`, app);
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
const SHEET = 'application/vnd.google-apps.spreadsheet';

console.log('① 週次バックアップ');

// フォルダの中身を持つ Drive の io モック
function backupIo(files, now) {
  const trashed = [];
  let seq = 0;
  return {
    files, trashed,
    now: () => now, tz: 'Asia/Tokyo',
    copy: name => { const f = { id: 'NEW' + (++seq), name, mimeType: SHEET }; files.push(f); return f; },
    listFiles: () => files.filter(f => trashed.indexOf(f.id) < 0).map(f => Object.assign({}, f)),
    trash: id => trashed.push(id)
  };
}
const eightBackups = () => [1, 2, 3, 4, 5, 6, 7, 8].map(i => ({ id: 'B' + i, name: 'appデータ_202609' + pad(i) + '_2100', mimeType: SHEET }));

test('ファイル名は appデータ_YYYYMMDD_HHmm', () => {
  assert.strictEqual(gas.backupFileName_(new Date(Date.UTC(2026, 10, 1, 21, 5)), 'Asia/Tokyo'), 'appデータ_20261101_2105');
});

test('9件目を作ると、いちばん古い1件だけゴミ箱へ（直近8件を残す）', () => {
  const io = backupIo(eightBackups(), new Date(Date.UTC(2026, 10, 1, 21, 0)));
  const r = gas.runBackup_(io);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name, 'appデータ_20261101_2100');
  assert.deepStrictEqual(io.trashed, ['B1']);
  assert.strictEqual(r.trashed, 1);
});

test('8件以下なら何も消さない', () => {
  const io = backupIo(eightBackups().slice(0, 7), new Date(Date.UTC(2026, 10, 1, 21, 0)));
  gas.runBackup_(io);
  assert.deepStrictEqual(io.trashed, []);
});

test('ほかのファイル（名前の形式が違う・スプレッドシートでない）には触らない', () => {
  const others = [
    { id: 'X1', name: 'appデータ_20200101_0000のコピー', mimeType: SHEET },
    { id: 'X2', name: 'メモ', mimeType: 'text/plain' },
    { id: 'X3', name: 'appデータ_20200101_0000', mimeType: 'application/pdf' },   // 形式は同じでもスプレッドシートでない
    { id: 'X4', name: 'appデータ_2020010_0000', mimeType: SHEET },                // 桁が違う
    { id: 'X5', name: '経営管理_20200101_0000', mimeType: SHEET }
  ];
  const io = backupIo(others.concat(eightBackups()), new Date(Date.UTC(2026, 10, 1, 21, 0)));
  gas.runBackup_(io);
  assert.deepStrictEqual(io.trashed, ['B1']);
  // 何度回しても、ほかのファイルは消えない
  const io2 = backupIo(others.slice(), new Date(Date.UTC(2026, 10, 8, 21, 0)));
  for (let i = 0; i < 12; i++) { io2.now = () => new Date(Date.UTC(2026, 10, 8 + i, 21, 0)); gas.runBackup_(io2); }
  assert(io2.trashed.every(id => /^NEW/.test(id)), '消したのはバックアップだけ: ' + io2.trashed.join(','));
  assert.strictEqual(io2.trashed.length, 4);   // 12件作って8件残す
});

test('ゴミ箱へ移す対象は名前（日時）の古い順。並び順に依存しない', () => {
  const files = eightBackups().reverse().concat([{ id: 'N', name: 'appデータ_20261101_2100', mimeType: SHEET }]);
  assert.deepStrictEqual(plain(gas.backupTrashTargets_(files, 8)), ['B1']);
  assert.deepStrictEqual(plain(gas.backupTrashTargets_(files, 3)), ['B6', 'B5', 'B4', 'B3', 'B2', 'B1']);
});

// トリガーのモック
function mockScriptApp() {
  const triggers = [];
  const created = [];
  const builder = handler => {
    const t = { handler };
    const chain = { timeBased: () => chain, onWeekDay: d => { t.day = d; return chain; }, atHour: h => { t.hour = h; return chain; },
      create: () => { const tr = { getHandlerFunction: () => handler, info: t }; triggers.push(tr); created.push(t); return tr; } };
    return chain;
  };
  return {
    triggers, created,
    WeekDay: { SUNDAY: 'SUNDAY', MONDAY: 'MONDAY' },
    getProjectTriggers: () => triggers.slice(),
    newTrigger: builder,
    deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); }
  };
}

test('setupBackupTrigger は重複して作らない（2回実行しても1つ）。日曜の夜', () => {
  gas.ScriptApp = mockScriptApp();
  assert.strictEqual(gas.setupBackupTrigger(), true);
  assert.strictEqual(gas.setupBackupTrigger(), false);
  assert.strictEqual(gas.ScriptApp.triggers.length, 1);
  assert.deepStrictEqual(gas.ScriptApp.created[0], { handler: 'weeklyBackup', day: 'SUNDAY', hour: 21 });
});

test('受信箱のトリガーがあってもバックアップのトリガーは作られ、削除はバックアップだけ', () => {
  gas.ScriptApp = mockScriptApp();
  gas.setupWeeklyTrigger();
  gas.setupBackupTrigger();
  gas.setupWeeklyTrigger();
  assert.strictEqual(gas.ScriptApp.triggers.length, 2);
  assert.strictEqual(gas.removeBackupTrigger(), 1);
  assert.deepStrictEqual(gas.ScriptApp.triggers.map(t => t.getHandlerFunction()), ['weeklyInboxScan']);
  assert.strictEqual(gas.removeBackupTrigger(), 0);
});

// weeklyBackup の全体（Drive とシートはモック）
function mockDrive(opts) {
  const folderFiles = (opts.files || []).map(f => ({ getId: () => f.id, getName: () => f.name, getMimeType: () => f.mimeType || SHEET, f }));
  const trashed = [];
  const folder = {
    getFiles: () => { let i = 0; const list = folderFiles.filter(x => trashed.indexOf(x.getId()) < 0); return { hasNext: () => i < list.length, next: () => list[i++] }; }
  };
  let createdFolder = 0;
  const drive = {
    trashed, folder, folderFiles,
    get createdFolder() { return createdFolder; },
    getRootFolder: () => ({
      getFoldersByName: () => { let done = !opts.folderExists; return { hasNext: () => !done, next: () => { done = true; return folder; } }; },
      createFolder: () => { createdFolder++; return folder; }
    }),
    getFileById: id => ({
      makeCopy: (name, f) => {
        if (opts.copyError) throw new Error(opts.copyError);
        assert.strictEqual(f, folder);
        const nf = { getId: () => 'COPY', getName: () => name, getMimeType: () => SHEET };
        folderFiles.push(nf);
        return nf;
      },
      setTrashed: v => { if (v) trashed.push(id); }
    })
  };
  return drive;
}
function settingsValue(key) {
  const row = ss.sheets.settings.data.find(r => r[0] === key);
  return row ? row[1] : undefined;
}

test('weeklyBackup：フォルダが無ければ作り、成功を settings の backup.* に書く', () => {
  ss = mockSpreadsheet();
  ss.sheets.settings = mockSheet([['key', 'value'], ['company.name', 'アスリンク株式会社'], ['backup.lastError', '前回の失敗']]);
  gas.DriveApp = mockDrive({ folderExists: false, files: eightBackups() });
  const r = gas.weeklyBackup();
  assert.strictEqual(r.ok, true, r.error);
  assert.strictEqual(gas.DriveApp.createdFolder, 1);
  assert.deepStrictEqual(gas.DriveApp.trashed, ['B1']);
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(settingsValue('backup.lastAt')));
  assert(/^appデータ_\d{8}_\d{4}$/.test(settingsValue('backup.lastFile')));
  assert.strictEqual(settingsValue('backup.lastError'), '');
  assert.strictEqual(settingsValue('company.name'), 'アスリンク株式会社');   // ほかの行には触らない
});

test('weeklyBackup：容量不足などの失敗は理由を settings に残し、ファイルは消さない', () => {
  ss = mockSpreadsheet();
  ss.sheets.settings = mockSheet([['key', 'value'], ['backup.lastAt', '2026-10-25 21:00']]);
  gas.DriveApp = mockDrive({ folderExists: true, files: eightBackups(), copyError: 'Exception: Insufficient storage quota' });
  const r = gas.weeklyBackup();
  assert.strictEqual(r.ok, false);
  assert(/容量が不足/.test(r.error), r.error);
  assert(/容量が不足/.test(settingsValue('backup.lastError')));
  assert.strictEqual(settingsValue('backup.lastAt'), '2026-10-25 21:00');   // 前回の成功は残す
  assert.deepStrictEqual(gas.DriveApp.trashed, []);
  assert(/権限/.test(gas.backupErrorMessage_(new Error('You do not have permission to call DriveApp'))));
});

test('GASとの往復：アプリの保存（writeAll_）でバックアップの記録が消えない・上書きされない', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  ss.sheets.settings = mockSheet([['key', 'value'], ['backup.lastAt', '2026-11-01 21:00'], ['backup.lastFile', 'appデータ_20261101_2100'],
    ['backup.lastError', ''], ['backup.lastErrorAt', '']]);
  // アプリ側の古い値（または空）を送っても、シート側の記録が残る
  gas.writeAll_({ backup: { lastAt: '', lastFile: '', lastError: 'アプリの古い値', lastErrorAt: '2020-01-01 00:00' }, company: { name: 'X' } });
  const back = gas.readAll_();
  assert.deepStrictEqual(plain(back.backup), { lastAt: '2026-11-01 21:00', lastFile: 'appデータ_20261101_2100', lastError: '', lastErrorAt: '' });
  assert.strictEqual(back.company.name, 'X');
});

test('アプリの表示：10日超＝アンバー／20日超・未実行＝赤／失敗は理由つき', () => {
  const T = '2026-11-21';
  assert.strictEqual(A.backupStatusOf({}, T).cls, 'badge-red');
  assert.strictEqual(A.backupStatusOf({}, T).label, '未実行');
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-11-11 21:00' }, T).cls, 'badge-green');   // 10日
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-11-10 21:00' }, T).cls, 'badge-amber');   // 11日
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-11-01 21:00' }, T).cls, 'badge-amber');   // 20日
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-10-31 21:00' }, T).cls, 'badge-red');     // 21日
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-11-01 21:00' }, T).label, '11月1日 21:00');
  const f = A.backupStatusOf({ lastAt: '2026-11-01 21:00', lastError: '容量不足', lastErrorAt: '2026-11-08 21:00' }, T);
  assert.strictEqual(f.error, '容量不足');
  // 失敗のあとで成功していれば、失敗は出さない
  assert.strictEqual(A.backupStatusOf({ lastAt: '2026-11-15 21:00', lastError: '容量不足', lastErrorAt: '2026-11-08 21:00' }, T).error, '');
  assert.strictEqual(A.backupStatusOf({ lastError: '権限がありません', lastErrorAt: '2026-11-08 21:00' }, T).error, '権限がありません');
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
