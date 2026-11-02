/**
 * 経営管理アプリ － Google Apps Script（GAS）バックエンド
 * =========================================================
 * このファイルの中身を丸ごとコピーして、GASエディタに貼り付けてください。
 *
 * 【セットアップ手順】
 *  1. https://script.google.com/ で新しいプロジェクトを作成
 *  2. コード.gs の中身を全部消して、このファイルの中身を貼り付け
 *  3. 保存 → 上部の関数リストから setup を選んで「実行」
 *     （初回はGoogleの承認ダイアログが出るので許可する）
 *     → スプレッドシートに projects / quotes / ledger / settings シートが作られます
 *  4. 右上「デプロイ」→「新しいデプロイ」→ 種類の選択で「ウェブアプリ」
 *       - 説明          : 任意（例: v1）
 *       - 次のユーザーとして実行 : 自分
 *       - アクセスできるユーザー : 全員
 *     →「デプロイ」を押してウェブアプリURLをコピー
 *  5. keiei-kanri.html の先頭にある GAS_URL にそのURLを貼り付け
 *
 * 【ドライブ経費取込を使う場合】
 *  「プロジェクトの設定」→「スクリプト プロパティ」で
 *  ANTHROPIC_API_KEY に Anthropic の APIキー（sk-ant-...）を登録する。
 *  キーはこのファイルにも公開HTMLにも書かないこと。
 *
 * 【コードを直したあと】
 *  必ず「デプロイ」→「デプロイを管理」→ 鉛筆アイコン →
 *  バージョン「新バージョン」→「デプロイ」でURLを更新すること
 *  （URLは変わりません。これをやらないと変更が反映されません）
 */

// ===== 設定 =====================================================
// 保存先スプレッドシートのID（URLの /d/ と /edit の間の文字列）
var SPREADSHEET_ID = '1gdtg7q3NwG3FQmWGc7lMpNEKROyvyRwuoIRKNSPsi4k';

// 各シートの列定義（この順番でシートに書き込まれます）
var SHEET_DEFS = {
  projects: ['id', 'name', 'client', 'amount', 'status', 'start', 'end', 'contract', 'memo',
    'invoiceStatus', 'paidMonth', 'paidAmount'],
  quotes:   ['id', 'subject', 'client', 'amount', 'type', 'date', 'expire', 'due',
    'contractStart', 'contractEnd', 'paymentMethod', 'isMonthly',
    'source', 'driveFileId', 'items', 'note',
    'status', 'revision', 'history', 'billingMonth', 'billingKey', 'cancelReason', 'issuedAt'],
  ledger:   ['id', 'date', 'type', 'desc', 'amount', 'memo', 'status', 'expectedDate', 'projectId', 'settlementMonth', 'billingMonth', 'fixedCostId',
    'visit', 'purpose', 'calId', 'withWhom', 'persons', 'receiptId', 'payee', 'docNo', 'reviewed'],
  fixedCosts: ['id', 'type', 'desc', 'amount', 'startMonth', 'endMonth', 'enabled'],
  fiscalYears: ['id', 'name', 'startMonth', 'endMonth', 'salesTarget', 'profitTarget', 'active',
    'newCustomerTarget', 'retentionTarget', 'winRateTarget'],
  monthlyBillings: ['id', 'projectId', 'billingMonth', 'amount', 'invoiceStatus',
    'invoiceId', 'paidDate', 'paidAmount', 'expectedPayDate', 'note'],
  settings: ['key', 'value']
};

// 日付として自動変換されると困る列（テキスト書式を強制する）
var TEXT_COLUMNS = ['id', 'start', 'end', 'date', 'expire', 'due', 'items', 'value',
  'startMonth', 'endMonth', 'contractStart', 'contractEnd', 'paidMonth', 'expectedDate', 'settlementMonth',
  'billingMonth', 'paidDate', 'expectedPayDate', 'invoiceId', 'driveFileId',
  'history', 'billingKey', 'issuedAt', 'receiptId', 'docNo', 'reviewed'];

// settings シートに保存する会社情報の項目
var COMPANY_FIELDS = ['name', 'rep', 'zip', 'addr', 'tel', 'email',
  'bankName', 'bankBranch', 'accountType', 'accountNumber', 'accountHolder',
  'invoice', 'capital', 'payment', 'shareWith', 'note'];
/* settings シートに保存する税金・社会保険の計算設定。
   キーは taxSettings.<グループ>.<項目>（例: taxSettings.consumptionTax.rate）。
   数値以外の項目（method）だけ TAX_TEXT_KEYS に入れて文字列で読み書きする。 */
var TAX_SETTING_FIELDS = {
  consumptionTax: ['rate', 'taxableRatio', 'method', 'businessType', 'deemedRate', 'filingsPerYear'],
  socialInsurance: ['monthlyPay', 'autoStandard', 'standardPay', 'healthRate', 'pensionRate', 'careRate', 'over40'],
  corporateTax: ['lowRate', 'highRate', 'threshold', 'residentRate', 'perCapita', 'bizLow', 'bizMid', 'bizHigh']
};
var TAX_TEXT_KEYS = ['consumptionTax.method'];
var TAX_BOOL_KEYS = ['socialInsurance.autoStandard', 'socialInsurance.over40'];

// settings シートに保存する計画の項目
// 月次計画は plan.<月>.<項目> というキーで保存する（例: plan.4.sales）
var PLAN_FIELDS = ['sales', 'expense', 'labor', 'tax'];


// ===== Webアプリのエントリポイント ==============================

/**
 * データ読み込み。アプリ起動時に呼ばれる。
 *   GET {URL}?action=load
 *   GET {URL}?action=load&callback=fn   … JSONP（CORSで失敗したときの保険）
 */
function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback || '';
  try {
    var action = params.action || 'load';
    if (action === 'ping') return respond_({ ok: true, message: 'pong' }, callback);
    if (action === 'calendarEvents') return respond_(calendarEvents_(params.from, params.to, params.calendarId), callback);
    if (action === 'debitMails') return respond_(debitMails_(params.since, params.until), callback);
    if (action !== 'load') throw new Error('不明なaction: ' + action);
    return respond_({ ok: true, data: readAll_() }, callback);
  } catch (err) {
    return respond_({ ok: false, error: String(err && err.message || err) }, callback);
  }
}

/**
 * データ書き込み。アプリ側で追加・更新・削除したときに呼ばれる。
 *   POST {URL}  body: {"action":"save","data":{...アプリの全データ...}}
 *
 * ※ ブラウザからのプリフライト(OPTIONS)を避けるため、
 *   アプリ側は Content-Type: text/plain で送っています。
 */
function doPost(e) {
  var body;
  try {
    var raw = (e && e.postData && e.postData.contents) || (e && e.parameter && e.parameter.payload) || '';
    if (!raw) throw new Error('リクエストが空です');
    body = JSON.parse(raw);
  } catch (err) {
    return respond_({ ok: false, error: String(err && err.message || err) }, '');
  }
  var action = body.action || 'save';

  // ドライブ連携はスプレッドシートに書かないのでロックを取らない
  try {
    if (action === 'driveList') return respond_({ ok: true, files: driveList_(body.folderId) }, '');
    if (action === 'invoiceList') return respond_(invoiceFolderList_(body.year, body.month), '');
    if (action === 'driveRead') return respond_(driveRead_(body.fileId), '');
    if (action === 'driveExtract') return respond_(driveExtract_(body.fileId), '');
    if (action === 'receiptRead') return respond_(receiptRead_(body.image, body.categories), '');
    if (action === 'receiptSave') return respond_(receiptSave_(body), '');
    if (action === 'inboxScan') return respond_(weeklyInboxScan(), '');
    if (action === 'backupNow') return respond_(weeklyBackup(), '');
    if (action === 'inboxList') return respond_({ ok: true, items: inboxOpenItems_() }, '');
    if (action === 'inboxRetry') return respond_(inboxRetry_(body.fileId), '');
    if (action === 'inboxDone') return respond_(inboxDone_(body), '');
    if (action === 'driveProcessed') return respond_({ ok: true, renamed: driveMarkProcessed_(body.fileIds) }, '');
    if (action === 'advise') return respond_(loanAdvice_(body.data), '');
    if (action === 'fare') return respond_(fareLookup_(body.from, body.to, body.mode), '');
    if (action === 'fareBatch') return respond_(fareBatch_(body.pairs), '');
    if (action === 'distance') return respond_(distanceLookup_(body.origin, body.destination, body.apiKey), '');
  } catch (err) {
    return respond_({ ok: false, error: String(err && err.message || err) }, '');
  }

  if (action !== 'save') return respond_({ ok: false, error: '不明なaction: ' + action }, '');

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return respond_({ ok: false, error: '他の書き込み処理と競合しました。少し待って再試行してください。' }, '');
  }
  try {
    if (!body.data) throw new Error('dataがありません');
    writeAll_(body.data);
    return respond_({ ok: true, savedAt: new Date().toISOString() }, '');
  } catch (err) {
    return respond_({ ok: false, error: String(err && err.message || err) }, '');
  } finally {
    lock.releaseLock();
  }
}

/** GASエディタから手動で1回実行する。シートを作成し、無ければ初期値を入れる。 */
function setup() {
  var ss = openSpreadsheet_();
  ensureSheets_(ss);
  Logger.log('シートを準備しました: ' + Object.keys(SHEET_DEFS).join(', '));
  Logger.log('スプレッドシート: ' + ss.getUrl());
}


// ===== 読み込み =================================================

function readAll_() {
  var ss = openSpreadsheet_();
  ensureSheets_(ss);
  var settings = readSettings_(ss.getSheetByName('settings'));
  return {
    projects: readProjects_(ss.getSheetByName('projects')),
    quotes:   readQuotes_(ss.getSheetByName('quotes')),
    ledger:   readLedger_(ss.getSheetByName('ledger')),
    fixedCosts: readFixedCosts_(ss.getSheetByName('fixedCosts')),
    fiscalYears: readFiscalYears_(ss.getSheetByName('fiscalYears')),
    monthlyBillings: readMonthlyBillings_(ss.getSheetByName('monthlyBillings')),
    inboxItems: inboxOpenItems_(ss),
    inboxFolders: settings.inboxFolders,
    company:  settings.company,
    plan:     settings.plan,
    nextProjectId: settings.nextProjectId,
    nextQuoteNum:  settings.nextQuoteNum,
    nextLedgerId:  settings.nextLedgerId,
    nextFixedCostId: settings.nextFixedCostId,
    nextBillingId: settings.nextBillingId,
    finance: settings.finance,
    travel: settings.travel,
    mail: settings.mail,
    bank: settings.bank,
    backup: settings.backup,
    reminder: settings.reminder,
    monthClose: settings.monthClose,
    taxSettings: settings.taxSettings,
    bankBalance: settings.bankBalance,
    currentFiscalYearId: settings.currentFiscalYearId,
    nextFiscalYearId: settings.nextFiscalYearId
  };
}

function readProjects_(sh) {
  return rowObjects_(sh, SHEET_DEFS.projects).map(function (o) {
    return {
      id: num_(o.id),
      name: str_(o.name),
      client: str_(o.client),
      amount: num_(o.amount),
      status: str_(o.status) || '商談中',
      start: str_(o.start),
      end: str_(o.end),
      contract: str_(o.contract) || 'single',
      memo: str_(o.memo),
      invoiceStatus: str_(o.invoiceStatus) || 'uninvoiced',
      paidMonth: ym_(o.paidMonth),
      paidAmount: num_(o.paidAmount)
    };
  }).filter(function (p) { return p.name !== ''; });
}

function readQuotes_(sh) {
  return rowObjects_(sh, SHEET_DEFS.quotes).map(quoteFromRow_).filter(function (q) { return q.id !== ''; });
}

/** JSON の列（items / history）を配列に。壊れていたら空配列。 */
function jsonArray_(v) {
  var raw = str_(v);
  if (!raw) return [];
  try { var a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch (err) { return []; }
}

/**
 * quotes シートの1行（列名→値）を書類に。
 * status が空の既存行は発行済み（issued）。history は訂正・取消の履歴（JSON）。
 */
function quoteFromRow_(o) {
    var items = jsonArray_(o.items);
    var status = str_(o.status);
    return {
      id: str_(o.id),
      subject: str_(o.subject),
      client: str_(o.client),
      amount: num_(o.amount),
      type: str_(o.type) || '見積書',
      date: str_(o.date),
      expire: str_(o.expire),
      due: str_(o.due),
      contractStart: ym_(o.contractStart),
      contractEnd: ym_(o.contractEnd),
      paymentMethod: str_(o.paymentMethod),
      isMonthly: bool_(o.isMonthly),
      source: str_(o.source) || 'manual',
      driveFileId: str_(o.driveFileId),
      items: items,
      note: str_(o.note),
      status: (status === 'draft' || status === 'cancelled') ? status : 'issued',
      revision: num_(o.revision) || 1,
      history: jsonArray_(o.history),
      billingMonth: ym_(o.billingMonth),
      billingKey: str_(o.billingKey),
      cancelReason: str_(o.cancelReason),
      issuedAt: str_(o.issuedAt)
    };
}

/** 書類を quotes シートの1行に（SHEET_DEFS.quotes の列順）。 */
function quoteRow_(q) {
  var status = str_(q.status);
  return [
    str_(q.id), str_(q.subject), str_(q.client), num_(q.amount), str_(q.type) || '見積書',
    str_(q.date), str_(q.expire), str_(q.due),
    ym_(q.contractStart), ym_(q.contractEnd), str_(q.paymentMethod), !!q.isMonthly,
    str_(q.source) || 'manual', str_(q.driveFileId),
    JSON.stringify(q.items || []), str_(q.note),
    (status === 'draft' || status === 'cancelled') ? status : 'issued',
    num_(q.revision) || 1,
    JSON.stringify(Array.isArray(q.history) ? q.history : []),
    ym_(q.billingMonth), str_(q.billingKey), str_(q.cancelReason), str_(q.issuedAt)
  ];
}

function readLedger_(sh) {
  return rowObjects_(sh, SHEET_DEFS.ledger).map(ledgerFromRow_)
    .filter(function (l) { return l.date !== '' && l.desc !== ''; });
}

/** ledger シートの1行（列名→値）を収支に。 */
function ledgerFromRow_(o) {
    return {
      id: num_(o.id),
      date: str_(o.date),
      type: str_(o.type),
      desc: str_(o.desc),
      amount: num_(o.amount),
      memo: str_(o.memo),
      status: str_(o.status) || 'actual',
      expectedDate: str_(o.expectedDate),
      projectId: str_(o.projectId) === '' ? null : num_(o.projectId),
      settlementMonth: ym_(o.settlementMonth),
      billingMonth: ym_(o.billingMonth),
      fixedCostId: str_(o.fixedCostId) === '' ? null : num_(o.fixedCostId),
      visit: str_(o.visit),
      purpose: str_(o.purpose),
      calId: str_(o.calId),
      withWhom: str_(o.withWhom),
      persons: str_(o.persons) === '' ? '' : num_(o.persons),
      receiptId: str_(o.receiptId),
      payee: str_(o.payee),
      docNo: str_(o.docNo),
      reviewed: str_(o.reviewed)   // 月次締めの「認証・重複の可能性」を確認した日（空＝未確認）
    };
}

/** 収支を ledger シートの1行に（SHEET_DEFS.ledger の列順）。 */
function ledgerRow_(l) {
  return [num_(l.id), str_(l.date), str_(l.type), str_(l.desc), num_(l.amount), str_(l.memo),
    str_(l.status) || 'actual', str_(l.expectedDate),
    (l.projectId === null || l.projectId === undefined || l.projectId === '') ? '' : num_(l.projectId),
    ym_(l.settlementMonth), ym_(l.billingMonth),
    (l.fixedCostId === null || l.fixedCostId === undefined || l.fixedCostId === '') ? '' : num_(l.fixedCostId),
    str_(l.visit), str_(l.purpose), str_(l.calId),
    str_(l.withWhom), (l.persons === null || l.persons === undefined || l.persons === '') ? '' : num_(l.persons),
    str_(l.receiptId), str_(l.payee), str_(l.docNo), str_(l.reviewed)];
}

function readMonthlyBillings_(sh) {
  return rowObjects_(sh, SHEET_DEFS.monthlyBillings).map(function (o) {
    var paidAmount = str_(o.paidAmount);
    return {
      id: num_(o.id),
      projectId: num_(o.projectId),
      billingMonth: ym_(o.billingMonth),
      amount: num_(o.amount),
      invoiceStatus: str_(o.invoiceStatus) || 'uninvoiced',
      invoiceId: str_(o.invoiceId) || null,
      paidDate: str_(o.paidDate) || null,
      paidAmount: paidAmount === '' ? null : num_(paidAmount),
      expectedPayDate: str_(o.expectedPayDate) || null,
      note: str_(o.note)
    };
  }).filter(function (b) { return b.id && b.projectId && b.billingMonth !== ''; });
}

function readFiscalYears_(sh) {
  return rowObjects_(sh, SHEET_DEFS.fiscalYears).map(function (o) {
    return {
      id: num_(o.id),
      name: str_(o.name),
      startMonth: ym_(o.startMonth),
      endMonth: ym_(o.endMonth),
      salesTarget: num_(o.salesTarget),
      profitTarget: num_(o.profitTarget),
      active: bool_(o.active),
      // 新ダッシュボードの重要KPIの目標（任意。空なら ''）
      newCustomerTarget: optNum_(o.newCustomerTarget),
      retentionTarget: optNum_(o.retentionTarget),
      winRateTarget: optNum_(o.winRateTarget)
    };
  }).filter(function (f) { return f.id && f.name !== ''; });
}

function readFixedCosts_(sh) {
  return rowObjects_(sh, SHEET_DEFS.fixedCosts).map(function (o) {
    return {
      id: num_(o.id),
      type: str_(o.type),
      desc: str_(o.desc),
      amount: num_(o.amount),
      startMonth: ym_(o.startMonth),
      endMonth: ym_(o.endMonth),
      enabled: bool_(o.enabled)
    };
  }).filter(function (f) { return f.desc !== '' && f.startMonth !== ''; });
}

function readSettings_(sh) {
  var company = {};
  var plan = [];
  for (var i = 0; i < 12; i++) plan.push({ sales: 0, expense: 0, labor: 0, tax: 0 });
  var legacyPlan = null; // 月の区別が無かった頃の形式
  var nextProjectId = 1, nextQuoteNum = 1, nextLedgerId = 1, nextFixedCostId = 1, nextBillingId = 1;
  var finance = { loan: 0 };
  var mail = { lastDebitSync: '' };
  var bank = { lastCsvImportDate: '' };
  var inboxFolders = { receipt: '', invoice: '' };
  var backup = { lastAt: '', lastFile: '', lastError: '', lastErrorAt: '' };
  var reminder = { template: '' };   // 入金の催促文のひな形（空ならアプリの初期の文面）
  var monthClose = {};               // 月次締めの確認日時 { 'YYYY-MM': 'YYYY-MM-DD HH:mm' }
  var travel = { googleMapsApiKey: '', gasolinePrice: 175, fuelEfficiency: 15,
    calendarId: DEFAULT_CALENDAR_ID, fareCache: {} };
  // 税金設定は、シートに無い項目はキーごと返さない（アプリ側の初期値を潰さないため）
  var taxSettings = {};
  var bankBalance = 0;
  var currentFiscalYearId = 0, nextFiscalYearId = 1;

  rowObjects_(sh, SHEET_DEFS.settings).forEach(function (o) {
    var key = str_(o.key);
    if (!key) return;
    var value = o.value;
    if (key.indexOf('company.') === 0) {
      company[key.substring(8)] = str_(value);
    } else if (key.indexOf('plan.') === 0) {
      var rest = key.substring(5);        // "4.sales" または旧形式の "sales"
      var dot = rest.indexOf('.');
      if (dot > 0) {
        var pm = parseInt(rest.substring(0, dot), 10) - 1;
        var field = rest.substring(dot + 1);
        if (pm >= 0 && pm < 12 && PLAN_FIELDS.indexOf(field) >= 0) plan[pm][field] = num_(value);
      } else if (PLAN_FIELDS.indexOf(rest) >= 0) {
        if (!legacyPlan) legacyPlan = { sales: 0, expense: 0, labor: 0 };
        legacyPlan[rest] = num_(value);
      }
    } else if (key === 'nextProjectId') {
      nextProjectId = num_(value) || 1;
    } else if (key === 'nextQuoteNum') {
      nextQuoteNum = num_(value) || 1;
    } else if (key === 'nextLedgerId') {
      nextLedgerId = num_(value) || 1;
    } else if (key === 'nextFixedCostId') {
      nextFixedCostId = num_(value) || 1;
    } else if (key === 'nextBillingId') {
      nextBillingId = num_(value) || 1;
    } else if (key === 'finance.loan') {
      finance.loan = num_(value);
    } else if (key === 'mail.lastDebitSync') {
      mail.lastDebitSync = ymd_(value);
    } else if (key === 'bank.lastCsvImportDate') {
      bank.lastCsvImportDate = ymd_(value);
    } else if (key === 'inboxFolders.receipt' || key === 'inboxFolders.invoice') {
      inboxFolders[key.substring(13)] = str_(value);
    } else if (key.indexOf('backup.') === 0 && BACKUP_SETTING_FIELDS.indexOf(key.substring(7)) >= 0) {
      backup[key.substring(7)] = str_(value);
    } else if (key === 'reminder.template') {
      reminder.template = str_(value);
    } else if (/^monthClose\.\d{4}-\d{2}$/.test(key)) {
      if (str_(value)) monthClose[key.substring(11)] = str_(value);
    } else if (key === 'travel.googleMapsApiKey') {
      travel.googleMapsApiKey = str_(value);
    } else if (key === 'travel.gasolinePrice') {
      travel.gasolinePrice = num_(value) || 175;
    } else if (key === 'travel.fuelEfficiency') {
      travel.fuelEfficiency = parseFloat(str_(value)) || 15;
    } else if (key === 'travel.calendarId') {
      travel.calendarId = str_(value) || DEFAULT_CALENDAR_ID;
    } else if (key === 'travel.fareCache') {
      travel.fareCache = parseFareCache_(value);
    } else if (key.indexOf('taxSettings.') === 0) {
      var tkey = key.substring(12);          // "consumptionTax.rate" など
      var tdot = tkey.indexOf('.');
      if (tdot > 0) {
        var grp = tkey.substring(0, tdot), fld = tkey.substring(tdot + 1);
        if (TAX_SETTING_FIELDS[grp] && TAX_SETTING_FIELDS[grp].indexOf(fld) >= 0) {
          if (!taxSettings[grp]) taxSettings[grp] = {};
          if (TAX_TEXT_KEYS.indexOf(tkey) >= 0) {
            taxSettings[grp][fld] = str_(value);
          } else if (TAX_BOOL_KEYS.indexOf(tkey) >= 0) {
            taxSettings[grp][fld] = (value === true || str_(value) === 'true' || num_(value) === 1);
          } else {
            taxSettings[grp][fld] = parseFloat(str_(value)) || 0;
          }
        }
      }
    } else if (key === 'bankBalance') {
      bankBalance = num_(value);
    } else if (key === 'currentFiscalYearId') {
      currentFiscalYearId = num_(value);
    } else if (key === 'nextFiscalYearId') {
      nextFiscalYearId = num_(value) || 1;
    }
  });

  // 未設定の項目はキーごと返さない（アプリ側の初期値を潰さないため）
  // 旧形式しか無い月には、その値を引き継ぐ
  if (legacyPlan) {
    for (var j = 0; j < 12; j++) {
      if (!plan[j].sales && !plan[j].expense && !plan[j].labor && !plan[j].tax) {
        plan[j] = { sales: legacyPlan.sales, expense: legacyPlan.expense, labor: legacyPlan.labor, tax: legacyPlan.tax || 0 };
      }
    }
  }

  return {
    company: company,
    plan: plan,
    nextProjectId: nextProjectId,
    nextQuoteNum: nextQuoteNum,
    nextLedgerId: nextLedgerId,
    nextFixedCostId: nextFixedCostId,
    nextBillingId: nextBillingId,
    finance: finance,
    travel: travel,
    mail: mail,
    bank: bank,
    inboxFolders: inboxFolders,
    backup: backup,
    reminder: reminder,
    monthClose: monthClose,
    taxSettings: taxSettings,
    bankBalance: bankBalance,
    currentFiscalYearId: currentFiscalYearId,
    nextFiscalYearId: nextFiscalYearId
  };
}


// ===== 書き込み =================================================

/** アプリの全データを4シートに書き戻す（全置換）。 */
function writeAll_(data) {
  var ss = openSpreadsheet_();
  ensureSheets_(ss);

  var projects = (data.projects || []).map(function (p) {
    return [
      num_(p.id), str_(p.name), str_(p.client), num_(p.amount), str_(p.status),
      str_(p.start), str_(p.end), str_(p.contract), str_(p.memo),
      str_(p.invoiceStatus) || 'uninvoiced', ym_(p.paidMonth), num_(p.paidAmount)
    ];
  });

  var quotes = (data.quotes || []).map(quoteRow_);

  var ledger = (data.ledger || []).map(ledgerRow_);

  var fixedCosts = (data.fixedCosts || []).map(function (f) {
    return [num_(f.id), str_(f.type), str_(f.desc), num_(f.amount),
      ym_(f.startMonth), ym_(f.endMonth), !!f.enabled];
  });

  var monthlyBillings = (data.monthlyBillings || []).map(function (b) {
    return [num_(b.id), num_(b.projectId), ym_(b.billingMonth), num_(b.amount),
      str_(b.invoiceStatus) || 'uninvoiced', str_(b.invoiceId),
      str_(b.paidDate), (b.paidAmount === null || b.paidAmount === undefined || b.paidAmount === '') ? '' : num_(b.paidAmount),
      str_(b.expectedPayDate), str_(b.note)];
  });

  var fiscalYears = (data.fiscalYears || []).map(function (f) {
    return [num_(f.id), str_(f.name), ym_(f.startMonth), ym_(f.endMonth),
      num_(f.salesTarget), num_(f.profitTarget), !!f.active,
      optNum_(f.newCustomerTarget), optNum_(f.retentionTarget), optNum_(f.winRateTarget)];
  });

  var settings = [];
  var company = data.company || {};
  COMPANY_FIELDS.forEach(function (k) { settings.push(['company.' + k, str_(company[k])]); });
  var plan = normalizePlan_(data.plan);
  for (var pm = 0; pm < 12; pm++) {
    var month = pm + 1;
    var pv = plan[pm];
    PLAN_FIELDS.forEach(function (k) { settings.push(['plan.' + month + '.' + k, pv[k]]); });
  }
  settings.push(['nextProjectId', num_(data.nextProjectId) || 1]);
  settings.push(['nextQuoteNum', num_(data.nextQuoteNum) || 1]);
  settings.push(['nextLedgerId', num_(data.nextLedgerId) || 1]);
  settings.push(['nextFixedCostId', num_(data.nextFixedCostId) || 1]);
  settings.push(['nextBillingId', num_(data.nextBillingId) || 1]);
  var fin = data.finance || {};
  settings.push(['finance.loan', num_(fin.loan)]);
  settings.push(['mail.lastDebitSync', ymd_((data.mail || {}).lastDebitSync)]);
  settings.push(['bank.lastCsvImportDate', ymd_((data.bank || {}).lastCsvImportDate)]);
  var ibf = data.inboxFolders || {};
  settings.push(['inboxFolders.receipt', str_(ibf.receipt)]);
  settings.push(['inboxFolders.invoice', str_(ibf.invoice)]);
  // バックアップの記録は weeklyBackup がシートに直接書く。アプリの値ではなくシート側の値を残す
  var sheetBackup = readSettings_(ss.getSheetByName('settings')).backup;
  BACKUP_SETTING_FIELDS.forEach(function (k) { settings.push(['backup.' + k, str_(sheetBackup[k])]); });
  settings.push(['reminder.template', str_((data.reminder || {}).template)]);
  var mc = data.monthClose || {};
  Object.keys(mc).sort().forEach(function (ym) {
    if (/^\d{4}-\d{2}$/.test(ym) && str_(mc[ym])) settings.push(['monthClose.' + ym, str_(mc[ym])]);
  });
  var tv = data.travel || {};
  settings.push(['travel.googleMapsApiKey', str_(tv.googleMapsApiKey)]);
  settings.push(['travel.gasolinePrice', num_(tv.gasolinePrice) || 175]);
  settings.push(['travel.fuelEfficiency', parseFloat(tv.fuelEfficiency) || 15]);
  settings.push(['travel.calendarId', str_(tv.calendarId) || DEFAULT_CALENDAR_ID]);
  // 運賃キャッシュは fareBatch がシートに直接書き足すので、シート側の値にアプリ側の値を重ねる
  // （アプリで手修正した運賃が優先。アプリが知らない検索結果も消さない）
  var fareCache = readFareCache_(ss);
  var appCache = (tv.fareCache && typeof tv.fareCache === 'object') ? tv.fareCache : {};
  Object.keys(appCache).forEach(function (k) { fareCache[k] = appCache[k]; });
  settings.push(['travel.fareCache', JSON.stringify(fareCache)]);
  var tx = data.taxSettings || {};
  Object.keys(TAX_SETTING_FIELDS).forEach(function (grp) {
    var g = tx[grp] || {};
    TAX_SETTING_FIELDS[grp].forEach(function (fld) {
      var key = grp + '.' + fld;
      var v = g[fld];
      if (TAX_TEXT_KEYS.indexOf(key) >= 0) {
        v = str_(v);
      } else if (TAX_BOOL_KEYS.indexOf(key) >= 0) {
        v = !!v;
      } else {
        v = parseFloat(v) || 0;
      }
      settings.push(['taxSettings.' + key, v]);
    });
  });
  settings.push(['bankBalance', num_(data.bankBalance)]);
  settings.push(['currentFiscalYearId', num_(data.currentFiscalYearId)]);
  settings.push(['nextFiscalYearId', num_(data.nextFiscalYearId) || 1]);
  settings.push(['updatedAt', Utilities.formatDate(new Date(), timezone_(ss), 'yyyy-MM-dd HH:mm:ss')]);

  writeSheet_(ss.getSheetByName('projects'), SHEET_DEFS.projects, projects);
  writeSheet_(ss.getSheetByName('quotes'),   SHEET_DEFS.quotes,   quotes);
  writeSheet_(ss.getSheetByName('ledger'),   SHEET_DEFS.ledger,   ledger);
  writeSheet_(ss.getSheetByName('fixedCosts'), SHEET_DEFS.fixedCosts, fixedCosts);
  writeSheet_(ss.getSheetByName('fiscalYears'), SHEET_DEFS.fiscalYears, fiscalYears);
  writeSheet_(ss.getSheetByName('monthlyBillings'), SHEET_DEFS.monthlyBillings, monthlyBillings);
  writeSheet_(ss.getSheetByName('settings'), SHEET_DEFS.settings, settings);
  SpreadsheetApp.flush();
}

/** 計画データを、どの形式で来ても12ヶ月分の配列に整える。 */
function normalizePlan_(plan) {
  var out = [];
  for (var i = 0; i < 12; i++) out.push({ sales: 0, expense: 0, labor: 0, tax: 0 });
  if (!plan) return out;
  if (Object.prototype.toString.call(plan) === '[object Array]') {
    for (var j = 0; j < 12; j++) {
      var v = plan[j] || {};
      out[j] = { sales: num_(v.sales), expense: num_(v.expense), labor: num_(v.labor), tax: num_(v.tax) };
    }
    return out;
  }
  // 旧形式（月の区別なし）は全ての月に同じ値を入れる
  var legacy = { sales: num_(plan.sales), expense: num_(plan.expense), labor: num_(plan.labor), tax: num_(plan.tax) };
  for (var k = 0; k < 12; k++) out[k] = { sales: legacy.sales, expense: legacy.expense, labor: legacy.labor, tax: legacy.tax };
  return out;
}

function writeSheet_(sh, headers, rows) {
  var lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, headers.length).clearContent();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
}


// ===== シート準備 ===============================================

function openSpreadsheet_() {
  if (!SPREADSHEET_ID) throw new Error('SPREADSHEET_ID が設定されていません');
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

/** 無いシートを作り、ヘッダー行と書式を整える。既存データには触らない。 */
function ensureSheets_(ss) {
  Object.keys(SHEET_DEFS).forEach(function (name) {
    var headers = SHEET_DEFS[name];
    var sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);

    // 日付に勝手に変換されないよう、該当列をテキスト書式に固定
    headers.forEach(function (h, i) {
      if (TEXT_COLUMNS.indexOf(h) >= 0) {
        sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
      }
    });

    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  });
}


// ===== Google ドライブ経費取込 ==================================
// 専用フォルダ内のPDF・画像をAIで読み取り、経費データとして返す。
// Anthropic APIキーはスクリプト プロパティに保存する（コードには書かない）:
//   GASエディタ左の「プロジェクトの設定」→「スクリプト プロパティ」→
//   プロパティ名 ANTHROPIC_API_KEY、値に sk-ant-... を設定
var EXPENSE_FOLDER_ID = '1YLUeZuWj6QAVWaXAOLaKE5sZXz4NQhxA'; // アスリンク_経費取込フォルダ
var PROCESSED_PREFIX = '処理済み_';
var ANTHROPIC_MODEL = 'claude-sonnet-4-6';
var ANTHROPIC_VERSION = '2023-06-01';
var MAX_FILE_BYTES = 4 * 1024 * 1024; // 1ファイル4MBまで

// AIに選ばせる区分と、アプリ側の区分名の対応
var CATEGORY_MAP = {
  '家賃': '家賃（レンタルオフィス利用料）',
  '家賃（レンタルオフィス利用料）': '家賃（レンタルオフィス利用料）',
  '通信料': '通信料',
  'システム利用料': 'システム利用料',
  '交通費': '交通費',
  '交際費': '交際費',
  'その他経費': 'その他経費'
};

var EXTRACT_PROMPT =
  'このレシート/領収書/請求書から日付・金額・店名・支払内容を抽出してJSON形式で返してください。\n' +
  '{"date":"YYYY-MM-DD","amount":数値,"desc":"摘要","category":"区分"}\n' +
  '区分は家賃/通信料/システム利用料/交通費/交際費/その他経費から最適なものを選んでください。\n' +
  'JSONのみ返してください。';

/** APIキーが設定されているか確認する（GASエディタから手動実行）。 */
function checkApiKey() {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  Logger.log(key ? 'ANTHROPIC_API_KEY は設定済みです（先頭: ' + key.slice(0, 8) + '...）'
                 : 'ANTHROPIC_API_KEY が未設定です。プロジェクトの設定から追加してください。');
}

function isSupportedMime_(mime) {
  return mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png'
    || mime === 'image/gif' || mime === 'image/webp';
}

/** フォルダ内の対象ファイル一覧を返す（既定は経費取込フォルダ）。 */
function driveList_(folderId) {
  var folder = DriveApp.getFolderById(folderId || EXPENSE_FOLDER_ID);
  var it = folder.getFiles();
  var out = [];
  while (it.hasNext()) {
    var f = it.next();
    if (!isSupportedMime_(f.getMimeType())) continue;
    var name = f.getName();
    out.push({
      id: f.getId(),
      name: name,
      mimeType: f.getMimeType(),
      size: f.getSize(),
      url: f.getUrl(),
      processed: name.indexOf(PROCESSED_PREFIX) === 0
    });
  }
  out.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
  return out;
}

/** Anthropic API を呼んで回答の本文を返す（ドライブ経費取込・領収書・受信箱で共通）。
    content はメッセージの中身（画像・PDF・テキストのブロックの配列）。 */
function callClaude_(content, maxTokens) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY がスクリプト プロパティに設定されていません' };
  var res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      payload: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens || 1500, messages: [{ role: 'user', content: content }] }),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'APIに接続できませんでした: ' + (err && err.message || err) };
  }
  var code = res.getResponseCode();
  var raw = res.getContentText();
  var body;
  try { body = JSON.parse(raw); } catch (err) { body = null; }
  if (code !== 200) return { ok: false, error: apiErrorMessage_(code, body, raw), code: code };
  var text = '';
  ((body && body.content) || []).forEach(function (c) { if (c.type === 'text') text += c.text; });
  return { ok: true, text: text };
}

/** Driveのファイル（画像・PDF）を AI に渡すブロックにする。 */
function fileBlock_(mime, bytes) {
  var source = { type: 'base64', media_type: mime, data: Utilities.base64Encode(bytes) };
  return mime === 'application/pdf' ? { type: 'document', source: source } : { type: 'image', source: source };
}

/** 1ファイルをAIで読み取って経費データにする。 */
function driveExtract_(fileId) {
  if (!fileId) return { ok: false, error: 'fileId がありません' };

  var file = DriveApp.getFileById(fileId);
  var mime = file.getMimeType();
  if (!isSupportedMime_(mime)) return { ok: false, error: '対応していない形式です: ' + mime };

  var bytes = file.getBlob().getBytes();
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'ファイルが大きすぎます（' + Math.round(bytes.length / 1024 / 1024) + 'MB / 上限4MB）' };
  }

  var r = callClaude_([fileBlock_(mime, bytes), { type: 'text', text: EXTRACT_PROMPT }], 1024);
  if (!r.ok) return r;
  var parsed = parseJsonLoose_(r.text);
  if (!parsed) return { ok: false, error: 'AIの応答をJSONとして読み取れませんでした' };

  return {
    ok: true,
    data: {
      date: normalizeDate_(parsed.date),
      amount: num_(parsed.amount),
      desc: str_(parsed.desc),
      type: normalizeCategory_(parsed.category)
    }
  };
}


// ===== 領収書の写真から経費登録 ===================================
// アプリが縮小した写真（JPEG・base64）を受け取り、AIで読み取った項目だけを返す（receiptRead）。
// 写真の保存は、アプリで「登録」を押したときに別に呼ぶ（receiptSave）。スキップした写真は残さない。
// 保存先：マイドライブの「領収書」フォルダ（スクリプト プロパティ RECEIPT_FOLDER_ID があればそれ）
//        の下に「2026年11月」のような年月フォルダを作る。ファイルは消さない。
// normalizeReceipt_ / parseReceiptReply_ / receiptFileName_ / apiErrorMessage_ は
// GAS の API を使わない純粋な関数（tests/receipt-import.test.js が Node で読み込んでテストする）。

var RECEIPT_ROOT_NAME = '領収書';
var RECEIPT_MAX_BYTES = 4 * 1024 * 1024;
var RECEIPT_CONFIDENCE = { '高': '高', '中': '中', '低': '低', high: '高', medium: '中', mid: '中', low: '低' };
var RECEIPT_FIELDS = ['date', 'total', 'payee', 'item', 'taxType', 'taxes', 'invoiceNo', 'paymentMethod', 'category'];

function receiptPrompt_(categories) {
  return 'この領収書・レシートの写真から、次の項目を読み取ってJSONだけを返してください。\n'
    + '{"date":"YYYY-MM-DD","total":合計金額(数値),"payee":"支払先（店名・会社名）","item":"但し書き・品目",'
    + '"taxType":"税込 または 税抜","taxes":[{"rate":10,"base":対象額(数値),"tax":消費税額(数値)}],'
    + '"invoiceNo":"T+13桁の登録番号","paymentMethod":"現金/クレジットカード/電子マネー/QR決済など",'
    + '"category":"区分","confidence":{"date":"高|中|低","total":"高|中|低","payee":"高|中|低","item":"高|中|低",'
    + '"taxType":"高|中|低","taxes":"高|中|低","invoiceNo":"高|中|低","paymentMethod":"高|中|低","category":"高|中|低"}}\n'
    + '・区分は次から1つ選ぶ: ' + (categories || []).join(' / ') + '\n'
    + '・税率別の内訳は、レシートに「10%対象」「8%対象」などの記載がある分だけ入れる。base は記載どおりの対象額\n'
    + '・★ 読めない・記載がない項目は null にする。推測で埋めない（日付や金額を推測しない）\n'
    + '・confidence はそれぞれの項目をどれだけ確実に読めたか。\n'
    + 'JSONのみ返してください。';
}

/** 金額らしい値を整数に（"¥1,234" "1,234円" "１２３４" も可）。読めなければ null。 */
function receiptAmount_(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return isFinite(v) ? Math.round(v) : null;
  var s = nfkc_(v).replace(/[¥￥,\s円]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Math.round(parseFloat(s));
}

/** AIの返したオブジェクトを、アプリに返す形にそろえる。読めない項目は空（null / ''）のまま。 */
/** 項目ごとの確信度を 高/中/低 にそろえる（わからなければ空） */
function confidenceOf_(conf, fields) {
  conf = conf || {};
  var c = {};
  fields.forEach(function (f) { c[f] = RECEIPT_CONFIDENCE[String(conf[f] || '').toLowerCase()] || RECEIPT_CONFIDENCE[String(conf[f] || '')] || ''; });
  return c;
}

function normalizeReceipt_(p, categories) {
  p = p || {};
  var c = confidenceOf_(p.confidence, RECEIPT_FIELDS);
  var taxType = nfkc_(p.taxType || '');
  var m = registrationNo_(p.invoiceNo);
  var cat = str_(p.category);
  var taxes = (Array.isArray(p.taxes) ? p.taxes : []).map(function (t) {
    var rate = receiptAmount_(t && t.rate !== null && t.rate !== undefined ? nfkc_(t.rate).replace(/[%％]/g, '') : null);
    return { rate: rate, base: receiptAmount_(t && t.base), tax: receiptAmount_(t && t.tax) };
  }).filter(function (t) { return t.rate === 8 || t.rate === 10; });
  return {
    date: p.date ? normalizeDate_(nfkc_(p.date)) : '',
    total: receiptAmount_(p.total),
    payee: str_(p.payee === null ? '' : p.payee),
    item: str_(p.item === null ? '' : p.item),
    taxType: /税抜|外税/.test(taxType) ? '税抜' : /税込|内税/.test(taxType) ? '税込' : '',
    taxes: taxes,
    invoiceNo: m,
    paymentMethod: str_(p.paymentMethod === null ? '' : p.paymentMethod),
    category: (categories || []).indexOf(cat) >= 0 ? cat : '',
    confidence: c
  };
}

/** AIの回答文から JSON を取り出して normalizeReceipt_ にかける。壊れていれば ok:false。 */
function parseReceiptReply_(text, categories) {
  var parsed = parseJsonLoose_(text);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'AIの応答をJSONとして読み取れませんでした。手入力で登録してください' };
  return { ok: true, data: normalizeReceipt_(parsed, categories) };
}

/** Anthropic API のエラーを、画面に出す理由にする。 */
function apiErrorMessage_(code, body, raw) {
  var msg = (body && body.error && body.error.message) || String(raw || '').slice(0, 200);
  if (/credit balance/i.test(msg)) return 'Anthropic APIのクレジット残高が不足しています（Console の Billing で追加してください）';
  if (code === 401) return 'APIキーが無効です（スクリプト プロパティ ANTHROPIC_API_KEY を確認してください）';
  if (code === 429) return 'APIの利用上限に達しました。しばらく待ってからやり直してください';
  if (code === 529 || code >= 500) return 'AIが混雑しているか一時的に使えません（' + code + '）。しばらく待ってからやり直してください';
  return 'API エラー ' + code + ': ' + msg;
}

/** インボイスの登録番号（T+13桁）を取り出す。無ければ空 */
function registrationNo_(v) {
  var m = /T\d{13}/.exec(nfkc_(v || '').replace(/[\s\-ー－]/g, '').toUpperCase());
  return m ? m[0] : '';
}

/** 写真を読み取る。image は base64（data: の前置きがあっても可）。 */
function receiptRead_(image, categories) {
  var data = String(image || '').replace(/^data:[^,]*,/, '');
  if (!data) return { ok: false, error: '写真がありません' };
  if (data.length * 3 / 4 > RECEIPT_MAX_BYTES) return { ok: false, error: '写真が大きすぎます（上限4MB）' };
  var r = callClaude_([
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: data } },
    { type: 'text', text: receiptPrompt_(categories) }
  ], 1500);
  if (!r.ok) return r;
  return parseReceiptReply_(r.text, categories);
}

/** 保存するファイル名：YYYYMMDD_支払先_金額.jpg（使えない文字は _） */
function receiptFileName_(date, payee, amount) {
  var d = String(date || '').replace(/-/g, '').slice(0, 8) || '日付不明';
  var who = nfkc_(payee || '').replace(/[\\\/:*?"<>|\r\n\t]/g, '_').replace(/^\s+|\s+$/g, '').slice(0, 40) || '支払先不明';
  return d + '_' + who + '_' + (receiptAmount_(amount) || 0) + '.jpg';
}

/** YYYY-MM-DD → 「2026年11月」（年月フォルダ名） */
function receiptMonthFolderName_(date) {
  var m = /^(\d{4})-(\d{2})/.exec(String(date || ''));
  return m ? m[1] + '年' + parseInt(m[2], 10) + '月' : '日付不明';
}

function receiptRootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty('RECEIPT_FOLDER_ID');
  if (id) return DriveApp.getFolderById(id);
  // 受信箱に「領収書」という名前のフォルダを使っていても、そこには保存しない（受信箱と保存先を混ぜない）
  var inbox = inboxFolderIdList_();
  var it = DriveApp.getRootFolder().getFoldersByName(RECEIPT_ROOT_NAME);
  while (it.hasNext()) {
    var f = it.next();
    if (inbox.indexOf(f.getId()) < 0) return f;
  }
  return DriveApp.getRootFolder().createFolder(RECEIPT_ROOT_NAME);
}

/** 写真を「領収書/年月」に保存して fileId を返す。body: {image, date, payee, amount} */
function receiptSave_(body) {
  var data = String((body && body.image) || '').replace(/^data:[^,]*,/, '');
  if (!data) return { ok: false, error: '写真がありません' };
  var root = receiptRootFolder_();
  var name = receiptMonthFolderName_(body.date);
  var it = root.getFoldersByName(name);
  var folder = it.hasNext() ? it.next() : root.createFolder(name);
  var blob = Utilities.newBlob(Utilities.base64Decode(data), 'image/jpeg', receiptFileName_(body.date, body.payee, body.amount));
  var file = folder.createFile(blob);
  return { ok: true, fileId: file.getId(), url: file.getUrl(), name: file.getName() };
}

/** GASエディタから手動で実行し、Driveの書き込み（フォルダ作成）を確認する関数。 */
function testReceiptFolder() {
  var root = receiptRootFolder_();
  Logger.log('OK: 保存先フォルダ「' + root.getName() + '」 ' + root.getUrl());
}

// ===== 受信箱フォルダの週次読み取り（取込待ち） =====================
// 設定ページで指定した「領収書」「受取請求書」の受信箱フォルダ（settings の inboxFolders.*）を読み、
// AIの読み取り結果を inbox シート（取込待ち）に書く。経費の登録はアプリで確認してから行う。
// ★ GASがするのは「受信箱の読み取り」「処理済みサブフォルダへの移動と名前の変更」「inbox シートへの書き込み」だけ。
//    ファイルは削除しない。inbox シートは writeAll_（アプリの保存）の対象外なので、保存で消えない。
// 毎週月曜の朝に weeklyInboxScan を動かすトリガーは、GASエディタで setupWeeklyTrigger() を1回実行して作る。
// planInboxScan_ / runInboxScan_ / normalizePayable_ / parsePayableReply_ / inboxConfidence_ は
// GAS の API を使わない（runInboxScan_ は Drive・シート・AI を io で受け取る）。tests/inbox-scan.test.js がモックでテストする。

var INBOX_SHEET = 'inbox';
var INBOX_HEADERS = ['fileId', 'kind', 'fileName', 'mimeType', 'data', 'confidence', 'status', 'error',
  'readAt', 'retries', 'folderId', 'doneName', 'updatedAt'];
var INBOX_KIND_RECEIPT = '領収書';
var INBOX_KIND_INVOICE = '受取請求書';
var INBOX_MAX_PER_RUN = 8;        // 6分制限のため1回の実行で読むのは8ファイルまで（残りは次の実行へ）
var INBOX_MAX_RETRIES = 3;        // 失敗したファイルの読み直しは3回まで
var INBOX_DONE_FOLDER = '処理済み';
var INBOX_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
var INBOX_OPEN_STATES = ['ready', 'failed', 'unsupported'];   // 取込待ちに出す状態（registered / skipped は済み）
// AIに選ばせる区分（アプリの経費区分。LEDGER_TYPES のうち ledgerGroup が expense のもの）
var INBOX_CATEGORIES = ['家賃（レンタルオフィス利用料）', '通信料', 'システム利用料', '交通費', '交際費', 'その他経費'];
// 一括登録の判定に使う、種別ごとの大事な項目（いちばん低い確信度を全体の確信度にする）
var INBOX_KEY_FIELDS = {
  '領収書': ['date', 'total', 'payee'],
  '受取請求書': ['issuer', 'date', 'dueDate', 'total']
};
var PAYABLE_FIELDS = ['issuer', 'docNo', 'date', 'dueDate', 'total', 'tax', 'invoiceNo', 'item', 'category'];

function payablePrompt_(categories) {
  return 'この請求書（当社が受け取った請求書）から、次の項目を読み取ってJSONだけを返してください。\n'
    + '{"issuer":"請求元（請求書を発行した会社名）","docNo":"請求書番号","date":"請求日 YYYY-MM-DD",'
    + '"dueDate":"支払期限 YYYY-MM-DD","total":請求金額・税込(数値),"tax":消費税額(数値),'
    + '"invoiceNo":"請求元のインボイス登録番号（T+13桁）","item":"請求の内容（何の費用か）","category":"区分",'
    + '"confidence":{"issuer":"高|中|低","docNo":"高|中|低","date":"高|中|低","dueDate":"高|中|低","total":"高|中|低",'
    + '"tax":"高|中|低","invoiceNo":"高|中|低","item":"高|中|低","category":"高|中|低"}}\n'
    + '・区分は次から1つ選ぶ: ' + (categories || []).join(' / ') + '\n'
    + '・請求元は宛先（当社）ではなく、請求書を出した側の名前\n'
    + '・★ 読めない・記載がない項目は null にする。推測で埋めない（支払期限・日付・金額を推測しない）\n'
    + '・confidence はそれぞれの項目をどれだけ確実に読めたか。\n'
    + 'JSONのみ返してください。';
}

/** 受取請求書：AIの返したオブジェクトをそろえる。読めない項目は空（null / ''）のまま。 */
function normalizePayable_(p, categories) {
  p = p || {};
  var cat = str_(p.category);
  var text = function (v) { return v === null || v === undefined ? '' : str_(v); };
  return {
    issuer: text(p.issuer),
    docNo: text(p.docNo),
    date: p.date ? normalizeDate_(nfkc_(p.date)) : '',
    dueDate: p.dueDate ? normalizeDate_(nfkc_(p.dueDate)) : '',
    total: receiptAmount_(p.total),
    tax: receiptAmount_(p.tax),
    invoiceNo: registrationNo_(p.invoiceNo),
    item: text(p.item),
    category: (categories || []).indexOf(cat) >= 0 ? cat : '',
    confidence: confidenceOf_(p.confidence, PAYABLE_FIELDS)
  };
}

/** 受取請求書：AIの回答文から JSON を取り出して normalizePayable_ にかける。壊れていれば ok:false。 */
function parsePayableReply_(text, categories) {
  var parsed = parseJsonLoose_(text);
  if (!parsed || typeof parsed !== 'object') return { ok: false, error: 'AIの応答をJSONとして読み取れませんでした。手入力で登録してください' };
  return { ok: true, data: normalizePayable_(parsed, categories) };
}

/** 全体の確信度：大事な項目のうちいちばん低いもの（確信度が無い・項目が空なら「低」） */
function inboxConfidence_(kind, data) {
  var rank = { '低': 0, '中': 1, '高': 2 };
  var worst = '高';
  var conf = (data && data.confidence) || {};
  (INBOX_KEY_FIELDS[kind] || []).forEach(function (f) {
    var v = data ? data[f] : null;
    var c = (v === null || v === undefined || v === '') ? '低' : (conf[f] || '低');
    if (rank[c] < rank[worst]) worst = c;
  });
  return worst;
}

function inboxUnsupportedReason_(f) {
  if (INBOX_MIMES.indexOf(f.mimeType) < 0) return '非対応の形式です（' + (f.mimeType || '不明') + '）。JPEG・PNG・PDFにして入れ直してください';
  if (f.size > MAX_FILE_BYTES) return 'ファイルが大きすぎます（' + Math.round(f.size / 1024 / 1024) + 'MB / 上限4MB）';
  return '';
}

/** 今回読むファイルを決める。
    files: 受信箱の直下のファイル [{id,name,mimeType,size,kind,folderId}]（古い順）
    rows: inbox シートの行 / doneIds: 「処理済み」サブフォルダにあるファイルID
    ・取込待ちにも処理済みにもあるファイルは読まない（同じファイルを2回読まない）
    ・失敗した行は読み直しが3回未満なら読み直す（新しいファイルが先）
    ・非対応の形式は読まずに「非対応」として取込待ちに出す（AIを呼ばないので件数に数えない）
    ・読むのは limit 件まで。残りは remaining として次の実行に回す */
function planInboxScan_(files, rows, doneIds, limit) {
  var byId = {};
  (rows || []).forEach(function (r) { byId[r.fileId] = r; });
  doneIds = doneIds || {};
  var fresh = [], retry = [], unsupported = [];
  (files || []).forEach(function (f) {
    if (doneIds[f.id]) return;
    var r = byId[f.id];
    if (r) {
      if (r.status === 'failed' && num_(r.retries) < INBOX_MAX_RETRIES) retry.push({ file: f, row: r });
      return;
    }
    var why = inboxUnsupportedReason_(f);
    if (why) unsupported.push({ file: f, reason: why });
    else fresh.push({ file: f, row: null });
  });
  var all = fresh.concat(retry);
  var n = limit || INBOX_MAX_PER_RUN;
  return { read: all.slice(0, n), unsupported: unsupported, remaining: Math.max(0, all.length - n) };
}

function inboxRowFor_(file, o) {
  return {
    fileId: file.id, kind: file.kind, fileName: file.name, mimeType: file.mimeType, folderId: file.folderId || '',
    data: o.data || null, confidence: o.confidence || '', status: o.status, error: o.error || '',
    readAt: o.readAt || '', retries: o.retries || 0, doneName: '', updatedAt: o.readAt || ''
  };
}

/** 1ファイル読んで inbox の行にする。row があれば読み直し（retries を1つ増やす） */
function readInboxEntry_(io, file, row, now) {
  var res;
  try { res = io.read(file); } catch (err) { res = { ok: false, error: String(err && err.message || err) }; }
  var retries = row ? num_(row.retries) + 1 : 0;
  if (res && res.ok) {
    return inboxRowFor_(file, { status: 'ready', data: res.data, confidence: inboxConfidence_(file.kind, res.data), readAt: now, retries: retries });
  }
  return inboxRowFor_(file, { status: 'failed', error: (res && res.error) || '読み取りに失敗しました', readAt: now, retries: retries });
}

/** 受信箱を読んで取込待ちに入れる本体。io: {listFiles, doneIds, readRows, saveRow, read, now} */
function runInboxScan_(io, limit) {
  var plan = planInboxScan_(io.listFiles(), io.readRows(), io.doneIds(), limit);
  var now = io.now();
  var out = { ok: true, read: 0, ready: 0, failed: 0, unsupported: 0, remaining: plan.remaining };
  plan.unsupported.forEach(function (u) {
    io.saveRow(inboxRowFor_(u.file, { status: 'unsupported', error: u.reason, readAt: now }));
    out.unsupported++;
  });
  plan.read.forEach(function (x) {
    var row = readInboxEntry_(io, x.file, x.row, now);
    io.saveRow(row);
    out.read++;
    if (row.status === 'ready') out.ready++; else out.failed++;
  });
  return out;
}

/** settings シートの受信箱フォルダID {receipt, invoice} */
function inboxConfig_(ss) {
  return readSettings_((ss || openSpreadsheet_()).getSheetByName('settings')).inboxFolders || { receipt: '', invoice: '' };
}

/** 受信箱のフォルダIDの一覧（読めなければ空。領収書の保存先探しで使う） */
function inboxFolderIdList_() {
  try {
    var c = inboxConfig_();
    return [c.receipt, c.invoice].filter(function (v) { return !!v; });
  } catch (err) {
    return [];
  }
}

function inboxKinds_(cfg) {
  var out = [];
  if (cfg.receipt) out.push({ kind: INBOX_KIND_RECEIPT, folderId: cfg.receipt });
  if (cfg.invoice) out.push({ kind: INBOX_KIND_INVOICE, folderId: cfg.invoice });
  return out;
}

/** 受信箱の設定の確認。問題があれば理由（無ければ空） */
function inboxConfigError_(cfg) {
  if (!cfg.receipt && !cfg.invoice) return '受信箱フォルダが設定されていません（アプリの設定ページで「領収書」「受取請求書」のフォルダを指定してください）';
  if (cfg.receipt && cfg.receipt === cfg.invoice) return '「領収書」と「受取請求書」に同じフォルダが指定されています';
  var saveId = PropertiesService.getScriptProperties().getProperty('RECEIPT_FOLDER_ID');
  if (saveId && (saveId === cfg.receipt || saveId === cfg.invoice)) return '受信箱に、領収書の保存先（RECEIPT_FOLDER_ID）と同じフォルダが指定されています。別のフォルダにしてください';
  return '';
}

/** 受信箱の直下のファイル（サブフォルダの中は見ない）。古い順 */
function listInboxFiles_(cfg) {
  var out = [];
  inboxKinds_(cfg).forEach(function (k) {
    var it = DriveApp.getFolderById(k.folderId).getFiles();
    while (it.hasNext()) {
      var f = it.next();
      out.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(),
        created: f.getDateCreated().getTime(), kind: k.kind, folderId: k.folderId });
    }
  });
  out.sort(function (a, b) { return a.created - b.created; });
  return out;
}

/** 受信箱の「処理済み」サブフォルダにあるファイルID */
function inboxDoneIds_(cfg) {
  var ids = {};
  inboxKinds_(cfg).forEach(function (k) {
    var fit = DriveApp.getFolderById(k.folderId).getFoldersByName(INBOX_DONE_FOLDER);
    while (fit.hasNext()) {
      var it = fit.next().getFiles();
      while (it.hasNext()) ids[it.next().getId()] = true;
    }
  });
  return ids;
}

function readInboxFile_(f) {
  var file = DriveApp.getFileById(f.id);
  var bytes = file.getBlob().getBytes();
  if (bytes.length > MAX_FILE_BYTES) return { ok: false, error: 'ファイルが大きすぎます（上限4MB）' };
  var invoice = f.kind === INBOX_KIND_INVOICE;
  var r = callClaude_([fileBlock_(f.mimeType, bytes),
    { type: 'text', text: invoice ? payablePrompt_(INBOX_CATEGORIES) : receiptPrompt_(INBOX_CATEGORIES) }], 1500);
  if (!r.ok) return r;
  return invoice ? parsePayableReply_(r.text, INBOX_CATEGORIES) : parseReceiptReply_(r.text, INBOX_CATEGORIES);
}

/** inbox シート。無ければ作る。足りない列は右端に足す（既存の列・データは動かさない） */
function inboxSheet_(ss) {
  var sh = ss.getSheetByName(INBOX_SHEET);
  if (!sh) sh = ss.insertSheet(INBOX_SHEET);
  var lastCol = sh.getLastColumn();
  var headers = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); }) : [];
  if (!headers.join('')) headers = [];
  INBOX_HEADERS.forEach(function (h) { if (headers.indexOf(h) < 0) headers.push(h); });
  sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
  ['fileId', 'data', 'readAt', 'updatedAt', 'retries'].forEach(function (h) {
    sh.getRange(1, headers.indexOf(h) + 1, sh.getMaxRows(), 1).setNumberFormat('@');
  });
  sh.setFrozenRows(1);
  return sh;
}

function inboxFromRow_(o) {
  var data = null;
  try { data = o.data ? JSON.parse(String(o.data)) : null; } catch (err) { data = null; }
  return {
    fileId: str_(o.fileId), kind: str_(o.kind), fileName: str_(o.fileName), mimeType: str_(o.mimeType),
    data: data, confidence: str_(o.confidence), status: str_(o.status), error: str_(o.error),
    readAt: str_(o.readAt), retries: num_(o.retries), folderId: str_(o.folderId),
    doneName: str_(o.doneName), updatedAt: str_(o.updatedAt)
  };
}

function readInboxRows_(sh) {
  return rowObjects_(sh, INBOX_HEADERS).map(inboxFromRow_).filter(function (r) { return r.fileId !== ''; });
}

/** inbox シートに1行書く（同じファイルIDの行があれば上書き、無ければ追加） */
function saveInboxRow_(sh, row) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var lastCol = sh.getLastColumn();
    var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim(); });
    var idCol = headers.indexOf('fileId') + 1;
    var lastRow = sh.getLastRow();
    var at = 0;
    if (lastRow > 1) {
      var ids = sh.getRange(2, idCol, lastRow - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === row.fileId) { at = i + 2; break; }
    }
    var values = headers.map(function (h) {
      if (h === 'data') return row.data ? JSON.stringify(row.data) : '';
      var v = row[h];
      return v === null || v === undefined ? '' : String(v);
    });
    sh.getRange(at || lastRow + 1, 1, 1, headers.length).setValues([values]);
  } finally {
    lock.releaseLock();
  }
}

/** 取込待ち（読み取り済み・失敗・非対応）の行。シートが無ければ空 */
function inboxOpenItems_(ss) {
  try {
    var sh = (ss || openSpreadsheet_()).getSheetByName(INBOX_SHEET);
    if (!sh) return [];
    return readInboxRows_(sh).filter(function (r) { return INBOX_OPEN_STATES.indexOf(r.status) >= 0; });
  } catch (err) {
    return [];
  }
}

function inboxNow_(ss) {
  return Utilities.formatDate(new Date(), timezone_(ss), 'yyyy-MM-dd HH:mm:ss');
}

/** 毎週月曜の朝にトリガーから動く（アプリの「📥 今すぐ読み取る」も同じ関数）。1回で8ファイルまで。 */
function weeklyInboxScan() {
  var props = PropertiesService.getScriptProperties();
  var running = Number(props.getProperty('INBOX_SCAN_RUNNING') || 0);
  if (running && Date.now() - running < 7 * 60 * 1000) {
    return { ok: false, error: '別の読み取りを実行中です。数分たってからやり直してください' };
  }
  var ss = openSpreadsheet_();
  var cfg = inboxConfig_(ss);
  var err = inboxConfigError_(cfg);
  if (err) { Logger.log(err); return { ok: false, error: err }; }
  props.setProperty('INBOX_SCAN_RUNNING', String(Date.now()));
  try {
    var sh = inboxSheet_(ss);
    var result = runInboxScan_({
      listFiles: function () { return listInboxFiles_(cfg); },
      doneIds: function () { return inboxDoneIds_(cfg); },
      readRows: function () { return readInboxRows_(sh); },
      saveRow: function (row) { saveInboxRow_(sh, row); },
      read: readInboxFile_,
      now: function () { return inboxNow_(ss); }
    });
    Logger.log(JSON.stringify(result));
    return result;
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    props.deleteProperty('INBOX_SCAN_RUNNING');
  }
}

/** 失敗したファイルを1つ読み直す（読み直しは3回まで） */
function inboxRetry_(fileId) {
  var ss = openSpreadsheet_();
  var sh = inboxSheet_(ss);
  var row = readInboxRows_(sh).filter(function (r) { return r.fileId === fileId; })[0];
  if (!row) return { ok: false, error: '取込待ちに見つかりません' };
  if (num_(row.retries) >= INBOX_MAX_RETRIES) return { ok: false, error: '読み直しは' + INBOX_MAX_RETRIES + '回までです。手入力で登録してください' };
  var f = DriveApp.getFileById(fileId);
  var file = { id: fileId, name: f.getName(), mimeType: f.getMimeType(), size: f.getSize(), kind: row.kind, folderId: row.folderId };
  var why = inboxUnsupportedReason_(file);
  if (why) return { ok: false, error: why };
  var next = readInboxEntry_({ read: readInboxFile_ }, file, row, inboxNow_(ss));
  saveInboxRow_(sh, next);
  return { ok: true, item: next };
}

/** 処理済みのファイル名：YYYYMMDD_支払先_金額.拡張子（日付も金額も無ければ元の名前のまま） */
function inboxDoneName_(name, mime, date, payee, amount) {
  if (!date && !receiptAmount_(amount)) return name;
  var ext = mime === 'application/pdf' ? '.pdf' : mime === 'image/png' ? '.png' : '.jpg';
  return receiptFileName_(date, payee, amount).replace(/\.jpg$/, ext);
}

/** 登録・スキップしたファイルを受信箱の「処理済み」へ移動して名前を変える。
    body: {fileId, status:'registered'|'skipped', date, payee, amount}。ファイルは消さない */
function inboxDone_(body) {
  var fileId = body && body.fileId;
  if (!fileId) return { ok: false, error: 'fileId がありません' };
  var status = body.status === 'registered' ? 'registered' : 'skipped';
  var ss = openSpreadsheet_();
  var sh = inboxSheet_(ss);
  var row = readInboxRows_(sh).filter(function (r) { return r.fileId === fileId; })[0];
  var f = DriveApp.getFileById(fileId);
  var folderId = (row && row.folderId) || '';
  if (!folderId) {
    var cfg = inboxConfig_(ss);
    var parents = f.getParents();
    while (parents.hasNext()) {
      var pid = parents.next().getId();
      if (pid === cfg.receipt || pid === cfg.invoice) { folderId = pid; break; }
    }
  }
  if (!folderId) return { ok: false, error: '受信箱のフォルダが分かりません' };
  var inbox = DriveApp.getFolderById(folderId);
  var it = inbox.getFoldersByName(INBOX_DONE_FOLDER);
  var done = it.hasNext() ? it.next() : inbox.createFolder(INBOX_DONE_FOLDER);
  var name = inboxDoneName_(f.getName(), f.getMimeType(), body.date, body.payee, body.amount);
  if (name !== f.getName()) f.setName(name);
  f.moveTo(done);
  var now = inboxNow_(ss);
  var next = row || inboxRowFor_({ id: fileId, kind: '', name: name, mimeType: f.getMimeType(), folderId: folderId }, { status: status, readAt: now });
  next.status = status;
  next.doneName = name;
  next.updatedAt = now;
  saveInboxRow_(sh, next);
  return { ok: true, name: name };
}

/** 毎週月曜の朝（7〜8時）に weeklyInboxScan を動かすトリガーを作る。GASエディタで1回だけ手動実行する。
    すでにあれば作らない（重複させない） */
function setupWeeklyTrigger() {
  return ensureWeeklyTrigger_('weeklyInboxScan', ScriptApp.WeekDay.MONDAY, 7, '毎週月曜 7〜8時');
}

/** weeklyInboxScan のトリガーを削除する（自動読み取りを止めたいとき） */
function deleteWeeklyTrigger() {
  return removeTriggers_('weeklyInboxScan');
}

/** handler の時間トリガー（毎週 weekDay の hour 時台）を作る。同じ関数のトリガーがあれば作らない。
    作ったら true。ほかの関数のトリガーには触らない */
function ensureWeeklyTrigger_(handler, weekDay, hour, label) {
  var exists = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === handler; });
  if (exists) { Logger.log(handler + ' のトリガーはすでにあります（重複して作りません）'); return false; }
  ScriptApp.newTrigger(handler).timeBased().onWeekDay(weekDay).atHour(hour).create();
  Logger.log(label + 'に ' + handler + ' を実行するトリガーを作りました');
  return true;
}

/** handler のトリガーだけを削除する。削除した件数を返す */
function removeTriggers_(handler) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === handler) { ScriptApp.deleteTrigger(t); n++; }
  });
  Logger.log(handler + ' のトリガーを ' + n + '件 削除しました');
  return n;
}


// ===== スプレッドシートの週次バックアップ ==========================
/* weeklyBackup()：データのスプレッドシート全体を、マイドライブの「経営管理アプリ_バックアップ」に
   「appデータ_YYYYMMDD_HHmm」としてコピーする。直近 BACKUP_KEEP 件を残し、古いものはゴミ箱へ。
   ★ ゴミ箱へ移すのは「このフォルダの直下にある、この名前の形式のスプレッドシート」だけ。ほかのファイルには触らない
   結果（最終バックアップ日時・失敗理由）は settings シートの backup.* に書く（バックアップ対象のシートとは別の行）。
   writeAll_ はこの行をシート側の値のまま残す */
var BACKUP_FOLDER_NAME = '経営管理アプリ_バックアップ';
var BACKUP_KEEP = 8;
var BACKUP_NAME_RE = /^appデータ_\d{8}_\d{4}$/;
var BACKUP_SETTING_FIELDS = ['lastAt', 'lastFile', 'lastError', 'lastErrorAt'];

/** バックアップのファイル名（appデータ_YYYYMMDD_HHmm） */
function backupFileName_(date, tz) {
  return 'appデータ_' + Utilities.formatDate(date, tz, 'yyyyMMdd_HHmm');
}

/** ゴミ箱へ移すファイルのID。files は [{id, name, mimeType}]。
    名前の形式が合うスプレッドシートだけを新しい順（名前＝日時）に並べ、keep 件より古いものを返す */
function backupTrashTargets_(files, keep) {
  var mine = (files || []).filter(function (f) {
    return BACKUP_NAME_RE.test(String(f.name || '')) && (!f.mimeType || f.mimeType === 'application/vnd.google-apps.spreadsheet');
  });
  mine.sort(function (a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0; });
  return mine.slice(keep).map(function (f) { return f.id; });
}

/** バックアップの本体。Drive は io で受け取る（テストでモックにするため）
    io: { copy(name) → {id, name}, listFiles() → [{id,name,mimeType}], trash(id), now() → Date, tz }
    返り値 { ok, fileId, name, trashed } */
function runBackup_(io) {
  var name = backupFileName_(io.now(), io.tz);
  var copied = io.copy(name);
  var targets = backupTrashTargets_(io.listFiles(), BACKUP_KEEP);
  targets.forEach(function (id) { if (id !== copied.id) io.trash(id); });
  return { ok: true, fileId: copied.id, name: copied.name || name, trashed: targets.length };
}

/** 失敗の理由を、画面に出せる日本語にする（容量不足・権限など） */
function backupErrorMessage_(err) {
  var m = String(err && err.message || err || '');
  if (/storage|quota|容量|space/i.test(m)) return 'Googleドライブの容量が不足しています（' + m + '）';
  if (/permission|権限|authoriz|access denied|許可/i.test(m)) return '権限がありません。GASエディタで weeklyBackup を一度実行して承認してください（' + m + '）';
  if (/limit|上限|too many/i.test(m)) return 'Googleの利用上限に達しました。時間をおいて再実行してください（' + m + '）';
  return m || '不明なエラー';
}

/** マイドライブ直下の「経営管理アプリ_バックアップ」フォルダ（無ければ作る） */
function backupFolder_() {
  var it = DriveApp.getRootFolder().getFoldersByName(BACKUP_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.getRootFolder().createFolder(BACKUP_FOLDER_NAME);
}

/** settings シートの key 行を書き換える（無ければ足す）。ほかの行には触らない */
function setSettingValues_(ss, values) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ss.getSheetByName('settings');
    var last = sh.getLastRow();
    var keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return str_(r[0]); }) : [];
    Object.keys(values).forEach(function (k) {
      var i = keys.indexOf(k);
      var row = i >= 0 ? i + 2 : sh.getLastRow() + 1;
      if (i < 0) keys.push(k);
      sh.getRange(row, 1, 1, 2).setNumberFormat('@').setValues([[k, str_(values[k])]]);
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
}

/** 時間トリガー（毎週日曜の夜）とアプリの「💾 今すぐバックアップ」（action backupNow）から呼ぶ */
function weeklyBackup() {
  var ss = openSpreadsheet_();
  var tz = timezone_(ss);
  var stamp = function () { return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm'); };
  var result;
  try {
    var folder = backupFolder_();
    result = runBackup_({
      now: function () { return new Date(); },
      tz: tz,
      copy: function (name) {
        var f = DriveApp.getFileById(SPREADSHEET_ID).makeCopy(name, folder);
        return { id: f.getId(), name: f.getName() };
      },
      listFiles: function () {
        var out = [], it = folder.getFiles();     // フォルダ直下だけ
        while (it.hasNext()) { var f = it.next(); out.push({ id: f.getId(), name: f.getName(), mimeType: f.getMimeType() }); }
        return out;
      },
      trash: function (id) { DriveApp.getFileById(id).setTrashed(true); }
    });
    result.at = stamp();
    setSettingValues_(ss, { 'backup.lastAt': result.at, 'backup.lastFile': result.name, 'backup.lastError': '', 'backup.lastErrorAt': '' });
  } catch (err) {
    result = { ok: false, error: backupErrorMessage_(err), at: stamp() };
    try { setSettingValues_(ss, { 'backup.lastError': result.error, 'backup.lastErrorAt': result.at }); } catch (e2) { }
  }
  Logger.log(JSON.stringify(result));
  return result;
}

/** 毎週日曜の夜（21〜22時）に weeklyBackup を動かすトリガーを作る。GASエディタで1回だけ手動実行する（重複して作らない） */
function setupBackupTrigger() {
  return ensureWeeklyTrigger_('weeklyBackup', ScriptApp.WeekDay.SUNDAY, 21, '毎週日曜 21〜22時');
}

/** weeklyBackup のトリガーを削除する（自動バックアップを止めたいとき） */
function removeBackupTrigger() {
  return removeTriggers_('weeklyBackup');
}

/** 登録済みファイルに「処理済み_」を付けてリネームする。 */
function driveMarkProcessed_(fileIds) {
  var renamed = 0;
  (fileIds || []).forEach(function (id) {
    try {
      var f = DriveApp.getFileById(id);
      var name = f.getName();
      if (name.indexOf(PROCESSED_PREFIX) === 0) return;
      f.setName(PROCESSED_PREFIX + name);
      renamed++;
    } catch (err) {
      // 1件失敗しても他のリネームは続ける
    }
  });
  return renamed;
}

/** ```json ... ``` などで囲まれていても中身のJSONを取り出す。 */
function parseJsonLoose_(text) {
  if (!text) return null;
  var s = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
  var i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  try { return JSON.parse(s.substring(i, j + 1)); } catch (err) { return null; }
}

/** いろいろな表記の日付を YYYY-MM-DD に寄せる。読めなければ空文字。 */
function normalizeDate_(v) {
  var s = str_(v);
  var m = /(\d{4})[-\/年.](\d{1,2})[-\/月.](\d{1,2})/.exec(s);
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

/** AIが返した区分をアプリの区分名に寄せる。該当なしは「その他経費」。 */
function normalizeCategory_(v) {
  var s = str_(v);
  if (CATEGORY_MAP[s]) return CATEGORY_MAP[s];
  var keys = Object.keys(CATEGORY_MAP);
  for (var i = 0; i < keys.length; i++) {
    if (s && s.indexOf(keys[i]) >= 0) return CATEGORY_MAP[keys[i]];
  }
  return 'その他経費';
}


// ===== 請求書フォルダの参照 =====================================
// 請求書関係フォルダの下に「2026年9月」のような月別フォルダがある想定。
// PDFのテキストはDrive APIでGoogleドキュメントに変換して取り出す
// （GASにはPDFからテキストを取る機能が無いため）。
var INVOICE_FOLDER_ID = '14QU-Gwgpj-wM6an0i7I8tzF0DoPMoFOP';

/** 指定した名前のフォルダを depth 階層まで探す。 */
function findFolderByName_(root, name, depth) {
  var it = root.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  if (depth <= 0) return null;
  var subs = root.getFolders();
  while (subs.hasNext()) {
    var found = findFolderByName_(subs.next(), name, depth - 1);
    if (found) return found;
  }
  return null;
}

/** {year}年{month}月 のフォルダを探してPDF一覧を返す。 */
function invoiceFolderList_(year, month) {
  var ym = num_(year) + '年' + num_(month) + '月';
  // 実際のフォルダ名にはスラッシュが入っているので、両方の綴りで探す
  var names = ['請求書/' + ym, ym];
  var root;
  try {
    root = DriveApp.getFolderById(INVOICE_FOLDER_ID);
  } catch (err) {
    return { ok: false, error: '請求書フォルダを開けませんでした（ID: ' + INVOICE_FOLDER_ID + '）' };
  }
  var folder = null, matched = '';
  for (var i = 0; i < names.length && !folder; i++) {
    folder = findFolderByName_(root, names[i], 2);
    if (folder) matched = names[i];
  }
  if (!folder) {
    return { ok: false, error: '「' + ym + '」のフォルダが見つかりませんでした。\n'
      + 'ドライブの「請求書関係」フォルダ内に「請求書/' + ym + '」または「' + ym + '」'
      + 'という名前のフォルダがあるか確認してください。' };
  }
  return { ok: true, folderId: folder.getId(), folderName: matched, url: folder.getUrl(), files: driveList_(folder.getId()) };
}

/** PDFをテキストにして返す。 */
function driveRead_(fileId) {
  if (!fileId) return { ok: false, error: 'fileId がありません' };
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (err) {
    return { ok: false, error: 'ファイルが見つかりません' };
  }
  var docId = null;
  try {
    var res = UrlFetchApp.fetch(
      'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?ocrLanguage=ja&supportsAllDrives=true',
      {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        payload: JSON.stringify({ name: '__tmp_ocr__', mimeType: 'application/vnd.google-apps.document' }),
        muteHttpExceptions: true
      });
    var body;
    try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
    if (res.getResponseCode() !== 200) {
      return { ok: false, error: 'PDFをテキストにできませんでした（' + res.getResponseCode() + '）: '
        + (body && body.error && body.error.message || '') };
    }
    docId = body.id;
    var text = DocumentApp.openById(docId).getBody().getText();
    return { ok: true, name: file.getName(), contentSnippet: text };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  } finally {
    if (docId) { try { DriveApp.getFileById(docId).setTrashed(true); } catch (e2) { } }
  }
}


// ===== 交通費の計算 =============================================
// 運賃はAnthropic APIのウェブ検索で調べ、走行距離は Google Maps の
// Distance Matrix API で取得する。どちらもブラウザからは呼べないので
// （APIキーの露出とCORS）GAS側で実行する。

/** 運賃を調べる。mode は '電車'（既定）か 'バス'。バスのときは路線バスの運賃を調べさせる */
var FARE_MODE_BUS = 'バス';
function fareLookup_(from, to, mode) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY がスクリプト プロパティに設定されていません' };
  from = str_(from); to = str_(to);
  if (!from || !to) return { ok: false, error: '出発駅と到着駅を入力してください' };

  var prompt = mode === FARE_MODE_BUS
    ? from + 'から' + to + 'までの路線バスの運賃（ICカード利用時。ICの運賃が無ければ現金の運賃）を調べて、'
      + '金額だけを数値で返してください。電車の運賃は答えないでください。例：230'
    : from + 'から' + to + 'までの電車のICカード運賃を調べて、'
      + '金額だけを数値で返してください。例：320';

  var payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 5 }],
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  };

  var res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'APIに接続できませんでした: ' + (err && err.message || err) };
  }

  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (code !== 200) {
    return { ok: false, error: 'API エラー ' + code + ': ' + (body && body.error && body.error.message || res.getContentText().slice(0, 200)) };
  }

  var text = '';
  (body.content || []).forEach(function (c) { if (c.type === 'text') text += c.text; });
  var m = /(\d[\d,]*)/.exec(text.replace(/[０-９]/g, function (s) {
    return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
  }));
  if (!m) return { ok: false, error: '運賃を読み取れませんでした（回答: ' + text.slice(0, 80) + '）' };
  return { ok: true, amount: num_(m[1]), note: text.slice(0, 200) };
}

// ===== 運賃のまとめて取得（カレンダーから交通費を作成） ==========
// 運賃の検索は fareLookup_ をそのまま使う。同じ「出発|到着」は1回だけ検索し、
// settings シートの travel.fareCache（JSON）に保存して次回から再利用する。

var FARE_BATCH_MAX = 10; // 1リクエストの最大区間数（アプリ側で分割して呼ぶ）

function parseFareCache_(v) {
  var s = str_(v);
  if (!s) return {};
  try {
    var o = JSON.parse(s);
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}

function readFareCache_(ss) {
  var sh = ss.getSheetByName('settings');
  var cache = {};
  rowObjects_(sh, SHEET_DEFS.settings).forEach(function (o) {
    if (str_(o.key) === 'travel.fareCache') cache = parseFareCache_(o.value);
  });
  return cache;
}

function writeFareCache_(ss, cache) {
  var sh = ss.getSheetByName('settings');
  var json = JSON.stringify(cache);
  var last = sh.getLastRow();
  if (last >= 2) {
    var keys = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < keys.length; i++) {
      if (str_(keys[i][0]) === 'travel.fareCache') {
        sh.getRange(i + 2, 2).setNumberFormat('@').setValue(json);
        return;
      }
    }
  }
  sh.appendRow(['travel.fareCache', json]);
}

/** 回答文から信頼度を決める（low=要確認 / mid=推定）。 */
function fareConfidence_(text) {
  var t = str_(text);
  if (/約|程度|前後|おそらく|推定|不明|確認でき|見つかりませ|わかりませ|分かりませ/.test(t)) return 'low';
  var nums = {};
  (t.match(/\d[\d,]{2,}/g) || []).forEach(function (n) { nums[n.replace(/,/g, '')] = 1; });
  return Object.keys(nums).length > 1 ? 'low' : 'mid';
}

/** pairs: [{from,to}]（片道）。結果は pairs と同じ順で返す。 */
function fareBatch_(pairs) {
  pairs = (pairs || []).slice(0, FARE_BATCH_MAX);
  var ss = openSpreadsheet_();
  var cache = readFareCache_(ss);
  var fresh = {};
  var results = pairs.map(function (p) {
    var from = str_(p && p.from), to = str_(p && p.to);
    var mode = str_(p && p.mode) === FARE_MODE_BUS ? FARE_MODE_BUS : '電車';
    // 運賃キャッシュのキー：電車「出発|到着」（これまでのキー）／バス「出発|到着|バス」
    var key = from + '|' + to + (mode === FARE_MODE_BUS ? '|' + FARE_MODE_BUS : '');
    if (!from || !to) return { from: from, to: to, mode: mode, ok: false, error: '出発と到着が必要です' };
    var hit = cache[key];
    if (hit && num_(hit.amount) > 0) {
      return { from: from, to: to, mode: mode, ok: true, amount: num_(hit.amount), confidence: hit.confidence || 'mid', cached: true };
    }
    var r = fareLookup_(from, to, mode);
    if (!r.ok) return { from: from, to: to, mode: mode, ok: false, error: r.error, confidence: 'low' };
    var conf = fareConfidence_(r.note);
    cache[key] = fresh[key] = { amount: r.amount, confidence: conf, at: Utilities.formatDate(new Date(), timezone_(ss), 'yyyy-MM-dd') };
    return { from: from, to: to, mode: mode, ok: true, amount: r.amount, confidence: conf, cached: false };
  });
  if (Object.keys(fresh).length) {
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // 検索中に保存が入っているかもしれないので、読み直してから足す
      var latest = readFareCache_(ss);
      Object.keys(fresh).forEach(function (k) { latest[k] = fresh[k]; });
      writeFareCache_(ss, latest);
    } finally {
      lock.releaseLock();
    }
  }
  return { ok: true, results: results };
}


// ===== Googleカレンダー（読み取り専用） ===========================
// 予定の作成・変更・削除は一切しない。getEvents で読むだけ。

var DEFAULT_CALENDAR_ID = 'tatsuya-ishii@us-links.com';
var MEETING_URL_RE = /https?:\/\/(meet\.google\.com|[\w.-]*zoom\.us|teams\.microsoft\.com|teams\.live\.com|[\w.-]*webex\.com)\//i;

function settingsCalendarId_() {
  var sh = openSpreadsheet_().getSheetByName('settings');
  var id = '';
  rowObjects_(sh, SHEET_DEFS.settings).forEach(function (o) {
    if (str_(o.key) === 'travel.calendarId') id = str_(o.value);
  });
  return id || DEFAULT_CALENDAR_ID;
}

/** from / to は YYYY-MM-DD（to の日も含む）。 */
function calendarEvents_(from, to, calendarId) {
  var re = /^(\d{4})-(\d{2})-(\d{2})$/;
  var f = re.exec(str_(from)), t = re.exec(str_(to));
  if (!f || !t) return { ok: false, error: '期間は YYYY-MM-DD で指定してください' };
  var start = new Date(+f[1], +f[2] - 1, +f[3]);
  var end = new Date(+t[1], +t[2] - 1, +t[3] + 1); // to の翌日0時まで
  if (end <= start) return { ok: false, error: '期間の終わりが始まりより前です' };

  var id = str_(calendarId) || settingsCalendarId_();
  var cal = CalendarApp.getCalendarById(id);
  if (!cal) return { ok: false, error: 'カレンダーが見つかりません: ' + id + '（GASエディタで testCalendarAccess を実行して権限を承認してください）' };

  var tz = Session.getScriptTimeZone();
  var events = cal.getEvents(start, end).map(function (ev) {
    var allDay = ev.isAllDayEvent();
    var st = allDay ? ev.getAllDayStartDate() : ev.getStartTime();
    var date = Utilities.formatDate(st, tz, 'yyyy-MM-dd');
    var title = str_(ev.getTitle());
    var location = str_(ev.getLocation());
    var desc = '';
    try { desc = str_(ev.getDescription()); } catch (e) { desc = ''; }
    // 場所欄に会議URLだけが入っている予定は「場所なし」とみなす
    var locIsUrl = /^https?:\/\//i.test(location);
    var online = title.indexOf('オンライン') >= 0
      || ((!location || locIsUrl) && (MEETING_URL_RE.test(desc) || MEETING_URL_RE.test(location)));
    return {
      // 繰り返し予定は同じIDを共有するので、日付を付けて1回ごとに区別する
      eventId: ev.getId() + '@' + date,
      date: date,
      startTime: allDay ? '' : Utilities.formatDate(st, tz, 'HH:mm'),
      title: title,
      location: locIsUrl ? '' : location,
      isAllDay: allDay,
      online: online
    };
  });
  events.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0;
  });
  return { ok: true, calendarId: id, events: events };
}

/** GASエディタから手動で実行し、カレンダーの読み取り権限を承認するための関数。 */
function testCalendarAccess() {
  var id = settingsCalendarId_();
  var cal = CalendarApp.getCalendarById(id);
  if (!cal) throw new Error('カレンダーが見つかりません: ' + id);
  var now = new Date();
  var week = new Date(now.getTime() + 7 * 24 * 3600 * 1000);
  var n = cal.getEvents(now, week).length;
  Logger.log('OK: ' + cal.getName() + '（' + id + '）今後7日間の予定 ' + n + '件');
}

// ===== Visaデビット利用通知メール（読み取り専用） ===================
// GmailApp は search と getter だけを使う。ラベル変更・既読化・削除はしない。
// メール本文はアプリに返さず、抽出した項目（日時・金額・店名・口座）だけを返す。
// parseDebitMail_ / buildDebitResult_ は GAS の API を使わない純粋な関数
// （tests/debit-import.test.js が Node で読み込んでテストする）。

var DEBIT_SUBJECT = 'Visaデビットご利用のお知らせ';
var DEBIT_SENDER_RE = /gmo-aozora|あおぞら/i;
var DEBIT_MAX_THREADS = 500;

function nfkc_(v) {
  var s = String(v == null ? '' : v);
  return s.normalize ? s.normalize('NFKC') : s;
}

/** 店名：NFKC正規化し、前後の空白と末尾の記号（. , など）を外す。ＮＥＸＴ→NEXT、VERCEL INC.→VERCEL INC */
function normalizeMerchant_(v) {
  return nfkc_(v).replace(/^\s+|\s+$/g, '').replace(/[\s.,。、・:;]+$/, '');
}

/** 本文から【処理日時】【引落し金額】【ご利用店名】【ご利用口座】を取る。値はその行の改行まで。 */
function parseDebitMail_(body) {
  var out = { datetime: '', date: '', amount: null, merchant: '', account: '' };
  var seen = {};
  String(body == null ? '' : body).split(/\r\n|\r|\n/).forEach(function (line) {
    var m = /^\s*【([^】]+)】(.*)$/.exec(line);
    if (!m) return;
    var label = nfkc_(m[1]).replace(/\s/g, '');
    var value = nfkc_(m[2]).replace(/^\s+|\s+$/g, '');
    var key = /処理日時/.test(label) ? 'datetime'
      : (/引落/.test(label) && /金額/.test(label)) ? 'amount'
      : /店名/.test(label) ? 'merchant'
      : /口座/.test(label) ? 'account' : '';
    if (!key || seen[key]) return; // 同じラベルが2回出ても最初の行だけ使う
    seen[key] = true;
    if (key === 'datetime') {
      var d = /(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})日?\s*(\d{1,2})\s*[:時]\s*(\d{1,2})(?:\s*[:分]\s*(\d{1,2}))?/.exec(value);
      if (d) {
        var p2 = function (n) { return ('0' + n).slice(-2); };
        out.date = d[1] + '-' + p2(d[2]) + '-' + p2(d[3]);
        out.datetime = out.date + ' ' + p2(d[4]) + ':' + p2(d[5]) + ':' + p2(d[6] || 0);
      }
    } else if (key === 'amount') {
      var a = /^(\d[\d,]*)\s*円/.exec(value);
      if (a) out.amount = parseInt(a[1].replace(/,/g, ''), 10);
    } else if (key === 'merchant') {
      out.merchant = normalizeMerchant_(value);
    } else {
      out.account = value;
    }
  });
  out.ok = !!out.date && out.amount !== null && !isNaN(out.amount);
  return out;
}

/**
 * messages: [{id, subject, received('yyyy-MM-dd HH:mm:ss'), from, body}]
 * since / until: YYYY-MM-DD（until は省略可、どちらもその日を含む）
 * 金額・日時が取れないメールは unreadable（件名と受信日時だけ）に入れる。
 */
function buildDebitResult_(messages, since, until) {
  var items = [], unreadable = [];
  var inRange = function (d) { return d && (!since || d >= since) && (!until || d <= until); };
  (messages || []).forEach(function (m) {
    var subject = String(m.subject || '');
    if (subject.indexOf(DEBIT_SUBJECT) < 0) return;
    var received = String(m.received || '');
    var p = parseDebitMail_(m.body);
    var day = p.ok ? p.date : received.slice(0, 10);
    if (!inRange(day)) return;
    if (!DEBIT_SENDER_RE.test(String(m.from || ''))) {
      unreadable.push({ messageId: m.id, subject: subject, received: received, reason: '差出人がGMOあおぞらネット銀行ではありません' });
      return;
    }
    if (!p.ok) {
      unreadable.push({ messageId: m.id, subject: subject, received: received, reason: '金額・日時を読み取れませんでした' });
      return;
    }
    items.push({ messageId: m.id, datetime: p.datetime, amount: p.amount, merchant: p.merchant, account: p.account });
  });
  items.sort(function (a, b) { return a.datetime < b.datetime ? -1 : a.datetime > b.datetime ? 1 : 0; });
  return { items: items, unreadable: unreadable };
}

function debitMails_(since, until) {
  var re = /^\d{4}-\d{2}-\d{2}$/;
  since = str_(since); until = str_(until);
  if (!re.test(since)) return { ok: false, error: 'since は YYYY-MM-DD で指定してください' };
  if (until && !re.test(until)) return { ok: false, error: 'until は YYYY-MM-DD で指定してください' };
  var tz = Session.getScriptTimeZone();
  var shift = function (ymd, days) {
    var p = ymd.split('-');
    return Utilities.formatDate(new Date(+p[0], +p[1] - 1, +p[2] + days), tz, 'yyyy/MM/dd');
  };
  // Gmail の after/before は日付の境目があいまいなので1日広めに探し、日付は本文の処理日時で絞る
  var query = 'subject:"' + DEBIT_SUBJECT + '" after:' + shift(since, -1) + (until ? ' before:' + shift(until, 2) : '');
  var threads = GmailApp.search(query, 0, DEBIT_MAX_THREADS);
  var messages = [];
  threads.forEach(function (th) {
    th.getMessages().forEach(function (m) {
      messages.push({
        id: m.getId(),
        subject: m.getSubject(),
        received: Utilities.formatDate(m.getDate(), tz, 'yyyy-MM-dd HH:mm:ss'),
        from: m.getFrom(),
        body: m.getPlainBody()
      });
    });
  });
  var r = buildDebitResult_(messages, since, until);
  return { ok: true, items: r.items, unreadable: r.unreadable, truncated: threads.length >= DEBIT_MAX_THREADS };
}

/** GASエディタから手動で実行し、Gmailの読み取り権限を承認するための関数。 */
function testGmailAccess() {
  var threads = GmailApp.search('subject:"' + DEBIT_SUBJECT + '"', 0, 5);
  var n = 0;
  threads.forEach(function (th) { n += th.getMessageCount(); });
  Logger.log('OK: 「' + DEBIT_SUBJECT + '」のスレッド ' + threads.length + '件（メール ' + n + '通）を読み取れました');
}

/** 2地点間の走行距離（km）を Google Maps から取得する。 */
function distanceLookup_(origin, destination, apiKey) {
  origin = str_(origin); destination = str_(destination); apiKey = str_(apiKey);
  if (!apiKey) return { ok: false, error: 'Google Maps APIキーが設定されていません' };
  if (!origin || !destination) return { ok: false, error: '出発地と到着地を入力してください' };

  var url = 'https://maps.googleapis.com/maps/api/distancematrix/json'
    + '?origins=' + encodeURIComponent(origin)
    + '&destinations=' + encodeURIComponent(destination)
    + '&mode=driving&language=ja&region=jp&key=' + encodeURIComponent(apiKey);

  var res;
  try {
    res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  } catch (err) {
    return { ok: false, error: 'Google Mapsに接続できませんでした: ' + (err && err.message || err) };
  }
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (e) { body = null; }
  if (!body) return { ok: false, error: 'Google Mapsの応答を読み取れませんでした' };
  if (body.status !== 'OK') {
    return { ok: false, error: 'Google Maps エラー: ' + body.status + (body.error_message ? '（' + body.error_message + '）' : '') };
  }
  var el = body.rows && body.rows[0] && body.rows[0].elements && body.rows[0].elements[0];
  if (!el || el.status !== 'OK') {
    return { ok: false, error: '経路が見つかりませんでした（' + (el && el.status || 'NOT_FOUND') + '）' };
  }
  return {
    ok: true,
    meters: el.distance.value,
    km: Math.round(el.distance.value / 100) / 10,
    text: el.distance.text,
    duration: el.duration && el.duration.text || ''
  };
}


// ===== 融資力診断のAIアドバイス =================================

/** 診断結果の数値をもとに、融資に向けたアドバイスを生成する。 */
function loanAdvice_(d) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY がスクリプト プロパティに設定されていません' };
  if (!d) return { ok: false, error: 'データがありません' };

  var yen = function (v) { return Math.round(Number(v) || 0).toLocaleString(); };
  var prompt = 'あなたは中小企業の資金調達に詳しい財務アドバイザーです。\n'
    + '次の会社の直近の数字をもとに、金融機関からの融資を受けやすくするためのアドバイスを日本語で書いてください。\n\n'
    + '会社名: ' + (d.company || '（未設定）') + '\n'
    + '月商（直近3ヶ月平均）: ' + yen(d.monthSales) + '円\n'
    + '安定売上（継続契約の月額合計）: ' + yen(d.recurring) + '円（継続案件比率 ' + (d.recurringRate || 0) + '%）\n'
    + '営業利益（直近3ヶ月平均）: ' + yen(d.profit) + '円（利益率 ' + (d.marginRate || 0) + '%）\n'
    + '現預金残高: ' + yen(d.cash) + '円（月商の ' + (d.cashMonths || 0) + 'ヶ月分）\n'
    + '既存借入残高: ' + yen(d.loan) + '円\n'
    + '年商: ' + yen(d.yearSales) + '円\n'
    + '月次計画の入力状況: 12ヶ月中 ' + (d.plannedMonths || 0) + 'ヶ月\n'
    + '融資力の総合スコア: ' + (d.totalScore || 0) + '/100\n\n'
    + '次の3点だけに絞って、具体的な数字を挙げながら書いてください。前置きや一般論は不要です。\n'
    + '【今すぐできること】\n【3ヶ月以内にすべきこと】\n【融資申込のベストタイミング】\n\n'
    + '各項目3つ以内の箇条書きで、全体で800字以内にまとめてください。';

  var payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 2000,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }]
  };

  var res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: 'APIに接続できませんでした: ' + (err && err.message || err) };
  }

  var code = res.getResponseCode();
  var body;
  try { body = JSON.parse(res.getContentText()); } catch (err) { body = null; }
  if (code !== 200) {
    return { ok: false, error: 'API エラー ' + code + ': ' + (body && body.error && body.error.message || res.getContentText().slice(0, 200)) };
  }

  var text = '';
  (body.content || []).forEach(function (c) { if (c.type === 'text') text += c.text; });
  if (!text) return { ok: false, error: 'AIの応答が空でした' };
  return { ok: true, text: text };
}


// ===== ユーティリティ ===========================================

/** シートを {列名: 値} の配列にして返す。ヘッダー行の並び順は問わない。 */
function rowObjects_(sh, defaultHeaders) {
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h || '').trim(); });
  if (!headers.join('')) headers = defaultHeaders.slice();

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (row.join('') === '') continue; // 空行スキップ
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      if (headers[c]) obj[headers[c]] = row[c];
    }
    out.push(obj);
  }
  return out;
}

/** セルの値を文字列に。Dateなら yyyy-MM-dd に整形する。 */
function str_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, timezone_(), 'yyyy-MM-dd');
  }
  return String(v).trim();
}

/** セルの値を数値に。「¥1,000」のような表記にも耐える。 */
/** 任意の数値（空なら ''、それ以外は小数も残す）。KPIの目標（%は小数1桁まで使う） */
function optNum_(v) {
  if (v === null || v === undefined || String(v).trim() === '') return '';
  var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? '' : n;
}

function num_(v) {
  if (typeof v === 'number') return Math.round(v);
  var s = String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
}

/** セルの値を YYYY-MM-DD に（日付として解釈されていても str_ が整形する）。それ以外は空文字。 */
function ymd_(v) {
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str_(v));
  return m ? m[1] + '-' + m[2] + '-' + m[3] : '';
}

/** セルの値を YYYY-MM に。日付として解釈されていた場合も整形する。 */
function ym_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    return Utilities.formatDate(v, timezone_(), 'yyyy-MM');
  }
  var s = String(v).trim();
  var m = /^(\d{4})[-\/](\d{1,2})/.exec(s);
  return m ? m[1] + '-' + ('0' + m[2]).slice(-2) : s;
}

/** セルの値を真偽値に。TRUE / true / 1 / 有効 を true とみなす。 */
function bool_(v) {
  if (typeof v === 'boolean') return v;
  var s = String(v === null || v === undefined ? '' : v).trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'yes' || s === '有効';
}

function timezone_(ss) {
  try {
    return (ss || SpreadsheetApp.openById(SPREADSHEET_ID)).getSpreadsheetTimeZone() || 'Asia/Tokyo';
  } catch (err) {
    return 'Asia/Tokyo';
  }
}

/** JSON（callback指定時はJSONP）で応答を返す。 */
function respond_(obj, callback) {
  var json = JSON.stringify(obj);
  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
