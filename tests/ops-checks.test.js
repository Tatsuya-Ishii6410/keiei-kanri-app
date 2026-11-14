/* 運用チェックのテスト（①週次バックアップ ②入金遅延アラート ③月次締めチェック。GASの運賃検索の電車／バス）
   実行: node tests/ops-checks.test.js

   - gas-code.js はまるごと読む。DriveApp・ScriptApp・SpreadsheetApp・LockService・Utilities はモックに差し替える
     バックアップの本体（runBackup_）は Drive を io で受け取るので、io もモックで渡す
   - keiei-kanri.html は「@invoice-rules」「@import-rules」「@ops-rules」の範囲だけを切り出して読む */

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
vm.runInContext(region('invoice-rules') + '\n' + region('import-rules') + '\n' + region('ops-rules') + `
globalThis.exported = { backupStatusOf, overdueReceivables, overdueLevel, reschedulePlannedIn, fillReminder, REMINDER_TEMPLATE_DEFAULT, ymdJp,
  closeChecks, reviewCandidates, setReviewed, ledgerSourceOf, bankExtId };`, app);
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

test('GASとの往復：削除済みの取込の外部ID（ledger.deletedExtIds）が残る・古いアプリでは消えない・キーが無ければ undefined', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  gas.writeAll_({});
  assert.strictEqual(gas.readAll_().deletedExtIds, undefined);   // 古いシート：アプリは手元の値を残す
  gas.writeAll_({ deletedExtIds: ['ev1@2026-07-03', 'mail:m1', 'mail:m1', ''] });
  assert.deepStrictEqual(Array.from(gas.readAll_().deletedExtIds), ['ev1@2026-07-03', 'mail:m1']);
  gas.writeAll_({ company: { name: 'X' } });                     // deletedExtIds を送らない古いアプリ
  assert.deepStrictEqual(Array.from(gas.readAll_().deletedExtIds), ['ev1@2026-07-03', 'mail:m1']);
  gas.writeAll_({ deletedExtIds: [] });
  assert.deepStrictEqual(Array.from(gas.readAll_().deletedExtIds), []);
});

test('GASとの往復：古い端末の保存を断る（版 updatedAt・画面のID）。版なしの古いアプリ・版の無いシートは通る', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  gas.ContentService = { MimeType: { JSON: 'json', JAVASCRIPT: 'js' }, createTextOutput: s => ({ setMimeType() { return this; }, text: s }) };
  const post = body => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(Object.assign({ action: 'save' }, body)) } }).text);
  // 版の無い古いシート：版を送っても通る
  assert.strictEqual(gas.readAll_().syncVersion, '');
  const r0 = post({ data: { company: { name: 'A' } }, baseVersion: 'x', writer: 'tabA' });
  assert.ok(r0.ok && /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/.test(r0.version), JSON.stringify(r0));
  assert.strictEqual(gas.readAll_().syncVersion, r0.version);
  // 最新の版は通る。連続の保存（前の応答の版を送る）も通る
  const r1 = post({ data: { company: { name: 'A1' } }, baseVersion: r0.version, writer: 'tabA' });
  assert.ok(r1.ok);
  const r2 = post({ data: { company: { name: 'A2' } }, baseVersion: r1.version, writer: 'tabA' });
  assert.ok(r2.ok);
  // 応答が届かなかった保存の再試行（古い版・同じ画面）は通る
  const r3 = post({ data: { company: { name: 'A3' } }, baseVersion: r0.version, writer: 'tabA' });
  assert.ok(r3.ok);
  // 別の画面が古い版で保存 → 断る。シートは変わらない
  const r4 = post({ data: { company: { name: 'B-old' } }, baseVersion: r0.version, writer: 'tabB' });
  assert.ok(!r4.ok && r4.conflict && r4.version === r3.version && /別の端末で更新されています/.test(r4.error));
  assert.strictEqual(gas.readAll_().company.name, 'A3');
  // 版を送らない古いアプリは通る（今までどおり）
  const r5 = post({ data: { company: { name: 'old-app' } } });
  assert.ok(r5.ok);
  assert.strictEqual(gas.readAll_().company.name, 'old-app');
  // 古いアプリの保存のあと、前の版を持つ画面は断られる（同じ画面のIDではない）
  assert.ok(!post({ data: {}, baseVersion: r3.version, writer: 'tabA' }).ok);
  assert.strictEqual(gas.isStaleSave_(undefined, 'w', { updatedAt: 'v1' }), false);
  assert.strictEqual(gas.isStaleSave_('v0', 'w', { updatedAt: '' }), false);
});

console.log('③ 月次締めチェック');

const YM = '2026-10';
const groupOf = t => t === '売上' ? 'sales' : t === '役員報酬' ? 'labor' : t === '法人税・住民税・事業税（納付）' ? 'tax' : 'expense';
const opt = extra => Object.assign({ groupOf, needsTravelEdit: l => !(l.amount > 0) || !/→/.test(l.desc), features: { inbox: true } }, extra || {});
const act = (id, date, type, amount, extra) => Object.assign({ id, date, type, desc: type + id, amount, status: 'actual', memo: '', calId: '', reviewed: '' }, extra || {});
const byKey = items => { const o = {}; items.forEach(x => { o[x.key] = x; }); return o; };
const ng = items => items.filter(x => x.status === 'ng').length;

function fixture() {
  return {
    projects: [{ id: 1, name: '保守', client: '株式会社A', status: '進行中' }, { id: 2, name: '開発', client: '株式会社B', status: '進行中' }],
    monthlyBillings: [{ id: 1, projectId: 1, billingMonth: YM, amount: 100000, invoiceStatus: 'uninvoiced' },
      { id: 2, projectId: 2, billingMonth: YM, amount: 50000, invoiceStatus: 'uninvoiced', invoiceId: 'DRAFT-1' }],
    quotes: [{ id: 'DRAFT-1', type: '請求書', status: 'draft', billingMonth: YM, client: '株式会社B 御中', items: [{ projectId: 2 }] }],
    bank: { lastCsvImportDate: '2026-10-25' },
    inboxItems: [{ fileId: 'F1', status: 'ready' }, { fileId: 'F2', status: 'failed' }],
    ledger: [
      { id: 1, type: '売上', desc: '株式会社A 2026年9月分 入金予定', amount: 110000, status: 'planned_in', date: '2026-10-31', expectedDate: '2026-10-31', projectId: 1, billingMonth: '2026-09' },
      { id: 2, type: '通信料', desc: '回線', amount: 5500, status: 'planned_out', date: '2026-10-30', expectedDate: '2026-10-30' },
      { id: 3, type: '通信料', desc: '回線（来月）', amount: 5500, status: 'planned_out', date: '2026-11-05', expectedDate: '2026-11-05' },
      act(4, '2026-10-05', '交通費', 0, { desc: '青野ヶ原→三宮（電車・バス）' }),
      act(5, '2026-10-06', '交通費', 860, { desc: '青野ヶ原→三宮（電車・バス）' }),
      act(6, '2026-10-10', '交際費', 8800, { withWhom: '', purpose: '打合せ' }),
      act(7, '2026-10-11', '交際費', 6600, { withWhom: '株式会社A 様', purpose: '打合せ', receiptId: 'R7', calId: 'rcpt:R7' }),
      act(8, '2026-10-12', 'その他経費', 1, { calId: 'mail:m8', memo: 'メール取込' }),
      act(9, '2026-10-15', 'システム利用料', 3300, { calId: 'mail:m9', memo: 'メール取込' }),
      act(10, '2026-10-16', 'システム利用料', 3300, { calId: 'bank:2026-10-16|3300' })
    ]
  };
}

test('各項目の件数（請求書・入金遅延・出金予定の超過・交通費・交際費・認証/重複・銀行明細・取込待ち・参考）', () => {
  const items = A.closeChecks(fixture(), YM, '2026-11-02', opt());
  const k = byKey(items);
  assert.deepStrictEqual(plain(items.map(x => x.key)),
    ['invoice', 'overdue', 'payable', 'travelEdit', 'travelSettle', 'entertain', 'review', 'bank', 'inbox', 'receipt']);
  assert.strictEqual(k.invoice.count, 2);      // 未作成1（案件1）＋下書き1（案件2）
  assert.strictEqual(k.invoice.detail, '未作成 1件／下書き 1件');
  assert.strictEqual(k.overdue.count, 1);
  assert.strictEqual(k.payable.count, 1);      // 11/5 はまだ
  assert.strictEqual(k.travelEdit.count, 1);   // 0円の行
  assert.strictEqual(k.travelSettle.status, 'ng');
  assert.strictEqual(k.entertain.count, 1);
  assert.strictEqual(k.review.count, 2);       // 認証1件＋重複1組
  assert.strictEqual(k.review.detail, '認証の可能性 1件／重複の可能性 1組');
  assert.strictEqual(k.bank.status, 'ng');     // 10/25 は 10/31 より前
  assert.strictEqual(k.inbox.count, 2);
  assert.strictEqual(k.receipt.status, 'info'); // 参考は赤にしない
  assert.strictEqual(k.receipt.count, 4);      // 交際費6・その他経費8・システム利用料9,10（交通費と写真ありの7は除く）
  assert.strictEqual(ng(items), 9);
});

test('すべて片付いていれば OK（参考は数えない）', () => {
  const D = fixture();
  D.monthlyBillings.forEach(b => { b.invoiceStatus = 'invoiced'; b.invoiceId = 'INV-202610-00' + b.id; });
  D.quotes = [{ id: 'INV-202610-001', type: '請求書', status: 'issued', billingMonth: YM, items: [{ projectId: 1 }] },
    { id: 'INV-202610-002', type: '請求書', status: 'issued', billingMonth: YM, items: [{ projectId: 2 }] }];
  D.ledger = [act(5, '2026-10-06', '交通費', 860, { desc: '青野ヶ原→三宮（電車・バス）' }),
    { id: 20, type: '交通費', desc: '交通費精算 2026年10月分', amount: 860, status: 'planned_out', date: '2026-11-25', expectedDate: '2026-11-25', settlementMonth: YM },
    act(21, '2026-10-20', '通信料', 5500)];
  D.bank.lastCsvImportDate = '2026-10-31';
  D.inboxItems = [];
  const items = A.closeChecks(D, YM, '2026-11-02', opt());
  assert.strictEqual(ng(items), 0, items.filter(x => x.status === 'ng').map(x => x.key).join(','));
  assert.strictEqual(byKey(items).receipt.count, 1);
});

test('機能が無い項目は出さない（取込待ち）', () => {
  const noFeat = A.closeChecks(fixture(), YM, '2026-11-02', opt({ features: {} }));
  assert(!noFeat.some(x => x.key === 'inbox'));
  const D = fixture(); delete D.inboxItems;
  assert(!A.closeChecks(D, YM, '2026-11-02', opt()).some(x => x.key === 'inbox'));
});

test('交通費の精算：月が終わっていなければ要対応にしない／精算済み・交通費なしは OK', () => {
  const D = fixture();
  assert.strictEqual(byKey(A.closeChecks(D, YM, '2026-10-20', opt())).travelSettle.status, 'ok');
  D.ledger.push({ id: 30, type: '交通費', desc: '精算', amount: 860, status: 'planned_out', date: '2026-11-25', expectedDate: '2026-11-25', settlementMonth: YM });
  assert.strictEqual(byKey(A.closeChecks(D, YM, '2026-11-02', opt())).travelSettle.status, 'ok');
  assert.strictEqual(byKey(A.closeChecks(D, '2026-09', '2026-11-02', opt())).travelSettle.status, 'ok');
});

test('取込元の判定：calId の接頭辞と備考の印', () => {
  assert.strictEqual(A.ledgerSourceOf({ calId: 'mail:x' }), 'mail');
  assert.strictEqual(A.ledgerSourceOf({ calId: 'rcpt:x' }), 'rcpt');
  assert.strictEqual(A.ledgerSourceOf({ calId: A.bankExtId('2026-10-16', 3300) }), 'bank');
  assert.strictEqual(A.ledgerSourceOf({ memo: '領収書取込／打合せ' }), 'rcpt');   // 写真を保存しなかった領収書
  assert.strictEqual(A.ledgerSourceOf({ memo: 'メール取込' }), 'mail');
  assert.strictEqual(A.ledgerSourceOf({ calId: 'abc123@2026-10-01' }), 'cal');
  assert.strictEqual(A.ledgerSourceOf({ fixedCostId: 3 }), 'fixed');
  assert.strictEqual(A.ledgerSourceOf({}), 'manual');                         // 印を付ける前の銀行明細CSVもここ
});

test('重複の可能性：条件（交通費でない・取込元が違い片方が取込・100円以上・前後1日）をすべて満たすペアだけ', () => {
  const R = ledger => A.reviewCandidates(ledger, YM, groupOf);
  const mail = (id, date, amount, type) => act(id, date, type || 'その他経費', amount, { calId: 'mail:' + id });
  const bank = (id, date, amount, type) => act(id, date, type || 'その他経費', amount, { calId: A.bankExtId(date, amount) });
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), bank(2, '2026-10-16', 3300)]).pairs.length, 1);
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), act(2, '2026-10-15', 'その他経費', 3300, { memo: '領収書取込' })]).pairs.length, 1);
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), act(2, '2026-10-15', 'その他経費', 3300)]).pairs.length, 1);   // 取込と手入力
  assert.strictEqual(R([mail(1, '2026-10-15', 860, '交通費'), bank(2, '2026-10-15', 860, '交通費')]).pairs.length, 0);  // 交通費
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), mail(2, '2026-10-15', 3300)]).pairs.length, 0);    // 同じ取込元
  assert.strictEqual(R([act(1, '2026-10-15', 'その他経費', 3300), act(2, '2026-10-15', 'その他経費', 3300, { fixedCostId: 1 })]).pairs.length, 0); // どちらも取込でない
  assert.strictEqual(R([mail(1, '2026-10-15', 99), bank(2, '2026-10-15', 99)]).pairs.length, 0);        // 100円未満
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), bank(2, '2026-10-17', 3300)]).pairs.length, 0);    // 2日差
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), bank(2, '2026-10-15', 3400)]).pairs.length, 0);    // 金額違い
  assert.strictEqual(R([mail(1, '2026-10-15', 3300), bank(2, '2026-10-15', 3300, '売上')]).pairs.length, 0); // 売上は対象外
  // 月またぎ（10/31 と 11/1）はどちらの月にも出る
  const cross = [mail(1, '2026-10-31', 3300), bank(2, '2026-11-01', 3300)];
  assert.strictEqual(R(cross).pairs.length, 1);
  assert.strictEqual(A.reviewCandidates(cross, '2026-11', groupOf).pairs.length, 1);
  assert.strictEqual(A.reviewCandidates(cross, '2026-09', groupOf).pairs.length, 0);
});

test('認証の可能性：10円以下の経費（実績）。確認済みは除く', () => {
  const l = [act(1, '2026-10-12', 'その他経費', 1), act(2, '2026-10-12', 'その他経費', 10), act(3, '2026-10-12', 'その他経費', 11),
    act(4, '2026-10-12', 'その他経費', 1, { reviewed: '2026-11-01' }), act(5, '2026-10-12', '売上', 1),
    Object.assign(act(6, '2026-10-12', 'その他経費', 1), { status: 'planned_out' })];
  const r = A.reviewCandidates(l, YM, groupOf);
  assert.deepStrictEqual(plain(r.auth.map(x => x.id)), [1, 2]);
  assert.deepStrictEqual(plain(r.authDone.map(x => x.id)), [4]);
});

test('確認済み：ペアは両方に印を付ける。片方だけなら未解決のまま。解除すると戻る', () => {
  const ledger = [act(1, '2026-10-15', 'その他経費', 3300, { calId: 'mail:1' }), act(2, '2026-10-16', 'その他経費', 3300, { calId: 'bank:x' })];
  assert.strictEqual(A.setReviewed(ledger, [1, 2], '2026-11-02'), 2);
  assert.strictEqual(ledger[0].reviewed, '2026-11-02');
  assert.strictEqual(ledger[1].reviewed, '2026-11-02');
  let r = A.reviewCandidates(ledger, YM, groupOf);
  assert.strictEqual(r.pairs.length, 0);
  assert.strictEqual(r.pairsDone.length, 1);
  // 3件目（同額・前日・別の取込元）が増えたら、確認済みの行とのペアでも未解決に出る
  ledger.push(act(3, '2026-10-14', 'その他経費', 3300, { memo: '領収書取込' }));
  r = A.reviewCandidates(ledger, YM, groupOf);
  assert.strictEqual(r.pairs.length, 1);
  assert.deepStrictEqual(plain(r.pairs[0].map(x => x.id)).sort(), [1, 3]);
  A.setReviewed(ledger, [1, 2], '');
  r = A.reviewCandidates(ledger, YM, groupOf);
  assert.strictEqual(r.pairs.length, 2);
  assert.strictEqual(r.pairsDone.length, 0);
});

test('GASとの往復：ledger の reviewed 列・settings の月次締めの確認日時が消えない', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  const l = { id: 7, date: '2026-10-15', type: 'その他経費', desc: 'X', amount: 3300, status: 'actual', calId: 'mail:7', reviewed: '2026-11-02' };
  const row = gas.ledgerRow_(l);
  assert.strictEqual(row.length, gas.SHEET_DEFS.ledger.length);
  assert(gas.TEXT_COLUMNS.indexOf('reviewed') >= 0);   // 日付に変換されない
  gas.writeAll_({ ledger: [l, { id: 8, date: '2026-10-16', type: '通信料', desc: 'Y', amount: 1, status: 'actual' }],
    monthClose: { '2026-10': '2026-11-02 10:30', '2026-09': '2026-10-05 09:00', 'bad': 'x', '2026-08': '' } });
  const back = gas.readAll_();
  assert.strictEqual(back.ledger.find(x => x.id === 7).reviewed, '2026-11-02');
  assert.strictEqual(back.ledger.find(x => x.id === 8).reviewed, '');
  assert.deepStrictEqual(plain(back.monthClose), { '2026-09': '2026-10-05 09:00', '2026-10': '2026-11-02 10:30' });
  // 列が無い古いシート（reviewed より前の列だけ）でも読める
  const old = gas.SHEET_DEFS.ledger.filter(h => h !== 'reviewed');
  ss.sheets.ledger = mockSheet([old, old.map(h => ({ id: 9, date: '2026-10-01', type: '通信料', desc: 'Z', amount: 100, status: 'actual' })[h] ?? '')]);
  assert.strictEqual(gas.readAll_().ledger[0].reviewed, '');
});

console.log('交通費の運賃検索（GAS）：電車／バス');

test('GASの運賃検索：バスはバスの運賃を調べ、キャッシュのキーが「出発|到着|バス」で分かれる（既存の電車のキーはそのまま）', () => {
  ss = mockSpreadsheet();
  gas.ensureSheets_(ss);
  ss.sheets.settings = mockSheet([['key', 'value'], ['travel.fareCache', JSON.stringify({ '青野ヶ原駅|鷹取': { amount: 230, confidence: 'mid' } })]]);
  ss.sheets.settings.getRange = (orig => (r, c, nr, nc) => Object.assign(orig(r, c, nr, nc), {
    setValue: v => { ss.sheets.settings.data[r - 1][c - 1] = v; }
  }))(ss.sheets.settings.getRange);
  const prompts = [];
  gas.PropertiesService = { getScriptProperties: () => ({ getProperty: k => (k === 'ANTHROPIC_API_KEY' ? 'sk-ant-test' : null) }) };
  gas.UrlFetchApp = { fetch: (url, opts) => {
    prompts.push(JSON.parse(opts.payload).messages[0].content[0].text);
    return { getResponseCode: () => 200, getContentText: () => JSON.stringify({ content: [{ type: 'text', text: '210円です' }] }) };
  } };
  const r = gas.fareBatch_([{ from: '青野ヶ原駅', to: '鷹取' }, { from: '青野ヶ原駅', to: '鷹取', mode: 'バス' }]);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(plain(r.results.map(x => [x.mode, x.amount, x.cached])), [['電車', 230, true], ['バス', 210, false]]);
  assert.strictEqual(prompts.length, 1);                       // 電車はキャッシュ、バスだけ検索
  assert(/路線バス/.test(prompts[0]) && !/電車のICカード運賃を調べて/.test(prompts[0]), prompts[0]);
  const saved = JSON.parse(ss.sheets.settings.data.find(row => row[0] === 'travel.fareCache')[1]);
  assert.deepStrictEqual(Object.keys(saved).sort(), ['青野ヶ原駅|鷹取', '青野ヶ原駅|鷹取|バス']);
  assert.strictEqual(saved['青野ヶ原駅|鷹取'].amount, 230);
  // 手段を渡さない呼び出し（古いアプリ・単発の fare）は電車
  prompts.length = 0;
  gas.fareLookup_('三宮', '大阪');
  assert(/電車のICカード運賃/.test(prompts[0]));
  gas.fareLookup_('三宮', '大阪', 'バス');
  assert(/路線バス/.test(prompts[1]));
});

console.log(`\n${passed}件 成功` + (process.exitCode ? '（失敗あり）' : ''));
