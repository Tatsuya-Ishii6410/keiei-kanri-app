/* 運用チェックのテスト（①週次バックアップ ②入金遅延アラート）
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
globalThis.exported = { backupStatusOf, overdueReceivables, overdueLevel, reschedulePlannedIn, fillReminder, REMINDER_TEMPLATE_DEFAULT, ymdJp };`, app);
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

console.log('② 入金遅延アラート');

const TODAY = '2026-11-02';
const projects = [{ id: 1, name: '保守', client: '株式会社A' }, { id: 2, name: '開発', client: '株式会社B' }, { id: 3, name: '運用', client: '株式会社C' }];
const pin = (id, pid, ym, date, amount, extra) => Object.assign({ id, type: '売上', desc: 'X ' + ym + '分 入金予定', amount, status: 'planned_in',
  date, expectedDate: date, projectId: pid, billingMonth: ym, memo: '' }, extra || {});
const ids = list => plain(list.map(x => x.id));

test('遅延の判定：前日は遅延（1日）、当日・翌日は遅延ではない', () => {
  const ledger = [pin(1, 1, '2026-09', '2026-11-01', 110000), pin(2, 2, '2026-09', '2026-11-02', 220000), pin(3, 3, '2026-09', '2026-11-03', 330000)];
  const r = A.overdueReceivables(ledger, [], [], projects, TODAY);
  assert.deepStrictEqual(ids(r), [1]);
  assert.strictEqual(r[0].days, 1);
  assert.strictEqual(r[0].client, '株式会社A');
});

test('入金済み（実績）・出金予定は対象外', () => {
  const ledger = [pin(1, 1, '2026-09', '2026-10-01', 110000, { status: 'actual' }), pin(2, 2, '2026-09', '2026-10-01', 5000, { status: 'planned_out', type: '通信料' })];
  assert.deepStrictEqual(plain(A.overdueReceivables(ledger, [], [], projects, TODAY)), []);
});

test('取消した請求書の入金予定は対象外（請求レコードの invoiceId・請求月と明細の案件、どちらの紐づけでも）', () => {
  const ledger = [pin(1, 1, '2026-09', '2026-10-31', 110000), pin(2, 2, '2026-09', '2026-10-31', 220000), pin(3, 3, '2026-09', '2026-10-31', 330000)];
  const quotes = [
    { id: 'INV-202609-001', type: '請求書', status: 'cancelled', client: '株式会社A 御中', items: [] },
    { id: 'INV-202609-002', type: '請求書', status: 'cancelled', billingMonth: '2026-09', items: [{ projectId: 2 }] },
    { id: 'INV-202609-003', type: '請求書', status: 'issued', billingMonth: '2026-09', revision: 2, items: [{ projectId: 3 }] }
  ];
  const billings = [{ projectId: 1, billingMonth: '2026-09', invoiceId: 'INV-202609-001' }];
  const r = A.overdueReceivables(ledger, quotes, billings, projects, TODAY);
  assert.deepStrictEqual(ids(r), [3]);
  assert.strictEqual(r[0].invoiceNo, 'INV-202609-003-2');   // 訂正版は枝番つき
  // 取り消して発行し直した請求書があれば、生きている方で出す
  quotes.push({ id: 'INV-202610-001', type: '請求書', status: 'issued', billingMonth: '2026-09', items: [{ projectId: 2 }] });
  const r2 = A.overdueReceivables(ledger, quotes, billings, projects, TODAY);
  assert.deepStrictEqual(ids(r2).sort(), [2, 3]);
  assert.strictEqual(r2.find(x => x.id === 2).invoiceNo, 'INV-202610-001');
});

test('案件に紐づかない入金予定も出す（取引先は摘要から）。請求書番号は空', () => {
  const l = { id: 9, type: '売上', desc: '株式会社Z 2026年9月分 入金予定', amount: 50000, status: 'planned_in', date: '2026-10-15', expectedDate: '2026-10-15', projectId: null };
  const r = A.overdueReceivables([l], [], [], projects, TODAY);
  assert.strictEqual(r[0].client, '株式会社Z');
  assert.strictEqual(r[0].invoiceNo, '');
  assert.strictEqual(r[0].days, 18);
});

test('並び順は遅延日数の長い順', () => {
  const ledger = [pin(1, 1, '2026-09', '2026-10-30', 1), pin(2, 2, '2026-08', '2026-08-31', 1), pin(3, 3, '2026-09', '2026-10-10', 1)];
  assert.deepStrictEqual(ids(A.overdueReceivables(ledger, [], [], projects, TODAY)), [2, 3, 1]);
});

test('色分けの境界：1〜7日／8〜30日／31日以上', () => {
  assert.strictEqual(A.overdueLevel(1), 'low');
  assert.strictEqual(A.overdueLevel(7), 'low');
  assert.strictEqual(A.overdueLevel(8), 'mid');
  assert.strictEqual(A.overdueLevel(30), 'mid');
  assert.strictEqual(A.overdueLevel(31), 'high');
  const r = A.overdueReceivables([pin(1, 1, '2026-09', '2026-10-26', 1), pin(2, 2, '2026-09', '2026-10-25', 1),
    pin(3, 3, '2026-09', '2026-10-03', 1), pin(4, 1, '2026-08', '2026-10-02', 1)], [], [], projects, TODAY);
  assert.deepStrictEqual(plain(r.map(x => x.days + ':' + x.level)), ['31:high', '30:mid', '8:mid', '7:low']);
});

test('予定日を変更すると遅延から外れ、変更履歴が備考に残る', () => {
  const l = pin(1, 1, '2026-09', '2026-10-31', 110000, { memo: '振込予定' });
  const ledger = [l];
  assert.strictEqual(A.overdueReceivables(ledger, [], [], projects, TODAY).length, 1);
  assert.strictEqual(A.reschedulePlannedIn(l, '2026-11-30', '月末払いに変更の連絡', TODAY).ok, true);
  assert.strictEqual(A.overdueReceivables(ledger, [], [], projects, TODAY).length, 0);
  assert.strictEqual(l.expectedDate, '2026-11-30');
  assert.strictEqual(l.memo, '振込予定／【予定日変更 2026-11-02】2026-10-31→2026-11-30：月末払いに変更の連絡');
  A.reschedulePlannedIn(l, '2026-12-10', '再度延期', TODAY);
  assert(/2026-10-31→2026-11-30/.test(l.memo) && /2026-11-30→2026-12-10：再度延期/.test(l.memo));   // 履歴は足していく
});

test('予定日の変更：過去の日付・理由なしは受け付けない（当日はOK＝遅延から外れる）', () => {
  const l = pin(1, 1, '2026-09', '2026-10-31', 1);
  assert.strictEqual(A.reschedulePlannedIn(l, '2026-11-01', '理由', TODAY).ok, false);
  assert.strictEqual(A.reschedulePlannedIn(l, '2026-11-10', ' ', TODAY).ok, false);
  assert.strictEqual(A.reschedulePlannedIn(l, '', '理由', TODAY).ok, false);
  assert.strictEqual(l.expectedDate, '2026-10-31');
  assert.strictEqual(A.reschedulePlannedIn(l, TODAY, '本日入金と連絡', TODAY).ok, true);
  assert.strictEqual(A.overdueReceivables([l], [], [], projects, TODAY).length, 0);
});

test('催促文：宛名・請求書番号・金額・期日を差し込む（知らない差し込みはそのまま）', () => {
  const t = A.fillReminder(A.REMINDER_TEMPLATE_DEFAULT, { '宛名': '株式会社A', '請求書番号': 'INV-202609-001', '金額': '¥110,000', '期日': A.ymdJp('2026-10-31'), '会社名': 'アスリンク株式会社' });
  assert(t.startsWith('株式会社A 御中'));
  ['INV-202609-001', '¥110,000', '2026年10月31日', 'アスリンク株式会社'].forEach(w => assert(t.indexOf(w) >= 0, w));
  assert(!/\{宛名\}|\{金額\}/.test(t));
  assert.strictEqual(A.fillReminder('{宛名}様 {不明}', { '宛名': 'B' }), 'B様 {不明}');
});

test('GASとの往復：催促文のひな形（複数行）が消えない', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  const tpl = '{宛名} 御中\n\nお世話になっております。\n{金額}';
  gas.writeAll_({ reminder: { template: tpl } });
  assert.strictEqual(gas.readAll_().reminder.template, tpl);
  gas.writeAll_({});
  assert.strictEqual(gas.readAll_().reminder.template, '');
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
