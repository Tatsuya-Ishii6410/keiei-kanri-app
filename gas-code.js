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
    'contractStart', 'contractEnd', 'paymentMethod', 'isMonthly', 'items', 'note'],
  ledger:   ['id', 'date', 'type', 'desc', 'amount', 'memo', 'status', 'expectedDate', 'projectId', 'settlementMonth', 'fixedCostId'],
  fixedCosts: ['id', 'type', 'desc', 'amount', 'startMonth', 'endMonth', 'enabled'],
  fiscalYears: ['id', 'name', 'startMonth', 'endMonth', 'salesTarget', 'profitTarget', 'active'],
  monthlyBillings: ['id', 'projectId', 'billingMonth', 'amount', 'invoiceStatus',
    'invoiceId', 'paidDate', 'paidAmount', 'expectedPayDate', 'note'],
  settings: ['key', 'value']
};

// 日付として自動変換されると困る列（テキスト書式を強制する）
var TEXT_COLUMNS = ['id', 'start', 'end', 'date', 'expire', 'due', 'items', 'value',
  'startMonth', 'endMonth', 'contractStart', 'contractEnd', 'paidMonth', 'expectedDate', 'settlementMonth',
  'billingMonth', 'paidDate', 'expectedPayDate', 'invoiceId'];

// settings シートに保存する会社情報の項目
var COMPANY_FIELDS = ['name', 'rep', 'zip', 'addr', 'tel', 'email',
  'bankName', 'bankBranch', 'accountType', 'accountNumber', 'accountHolder',
  'invoice', 'payment', 'shareWith', 'note'];
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
    if (action === 'driveList') return respond_({ ok: true, files: driveList_() }, '');
    if (action === 'driveExtract') return respond_(driveExtract_(body.fileId), '');
    if (action === 'driveProcessed') return respond_({ ok: true, renamed: driveMarkProcessed_(body.fileIds) }, '');
    if (action === 'advise') return respond_(loanAdvice_(body.data), '');
    if (action === 'fare') return respond_(fareLookup_(body.from, body.to), '');
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
    company:  settings.company,
    plan:     settings.plan,
    nextProjectId: settings.nextProjectId,
    nextQuoteNum:  settings.nextQuoteNum,
    nextLedgerId:  settings.nextLedgerId,
    nextFixedCostId: settings.nextFixedCostId,
    nextBillingId: settings.nextBillingId,
    finance: settings.finance,
    travel: settings.travel,
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
  return rowObjects_(sh, SHEET_DEFS.quotes).map(function (o) {
    var items = [];
    var rawItems = str_(o.items);
    if (rawItems) {
      try { items = JSON.parse(rawItems) || []; } catch (err) { items = []; }
    }
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
      items: items,
      note: str_(o.note)
    };
  }).filter(function (q) { return q.id !== ''; });
}

function readLedger_(sh) {
  return rowObjects_(sh, SHEET_DEFS.ledger).map(function (o) {
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
      fixedCostId: str_(o.fixedCostId) === '' ? null : num_(o.fixedCostId)
    };
  }).filter(function (l) { return l.date !== '' && l.desc !== ''; });
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
      active: bool_(o.active)
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
  var travel = { googleMapsApiKey: '', gasolinePrice: 175, fuelEfficiency: 15 };
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
    } else if (key === 'travel.googleMapsApiKey') {
      travel.googleMapsApiKey = str_(value);
    } else if (key === 'travel.gasolinePrice') {
      travel.gasolinePrice = num_(value) || 175;
    } else if (key === 'travel.fuelEfficiency') {
      travel.fuelEfficiency = parseFloat(str_(value)) || 15;
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

  var quotes = (data.quotes || []).map(function (q) {
    return [
      str_(q.id), str_(q.subject), str_(q.client), num_(q.amount), str_(q.type) || '見積書',
      str_(q.date), str_(q.expire), str_(q.due),
      ym_(q.contractStart), ym_(q.contractEnd), str_(q.paymentMethod), !!q.isMonthly,
      JSON.stringify(q.items || []), str_(q.note)
    ];
  });

  var ledger = (data.ledger || []).map(function (l) {
    return [num_(l.id), str_(l.date), str_(l.type), str_(l.desc), num_(l.amount), str_(l.memo),
      str_(l.status) || 'actual', str_(l.expectedDate),
      (l.projectId === null || l.projectId === undefined || l.projectId === '') ? '' : num_(l.projectId),
      ym_(l.settlementMonth),
      (l.fixedCostId === null || l.fixedCostId === undefined || l.fixedCostId === '') ? '' : num_(l.fixedCostId)];
  });

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
      num_(f.salesTarget), num_(f.profitTarget), !!f.active];
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
  var tv = data.travel || {};
  settings.push(['travel.googleMapsApiKey', str_(tv.googleMapsApiKey)]);
  settings.push(['travel.gasolinePrice', num_(tv.gasolinePrice) || 175]);
  settings.push(['travel.fuelEfficiency', parseFloat(tv.fuelEfficiency) || 15]);
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

/** 取込フォルダ内の対象ファイル一覧を返す。 */
function driveList_() {
  var folder = DriveApp.getFolderById(EXPENSE_FOLDER_ID);
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

/** 1ファイルをAIで読み取って経費データにする。 */
function driveExtract_(fileId) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY がスクリプト プロパティに設定されていません' };
  if (!fileId) return { ok: false, error: 'fileId がありません' };

  var file = DriveApp.getFileById(fileId);
  var mime = file.getMimeType();
  if (!isSupportedMime_(mime)) return { ok: false, error: '対応していない形式です: ' + mime };

  var bytes = file.getBlob().getBytes();
  if (bytes.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'ファイルが大きすぎます（' + Math.round(bytes.length / 1024 / 1024) + 'MB / 上限4MB）' };
  }

  var source = { type: 'base64', media_type: mime, data: Utilities.base64Encode(bytes) };
  var block = (mime === 'application/pdf')
    ? { type: 'document', source: source }
    : { type: 'image', source: source };

  var payload = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: [block, { type: 'text', text: EXTRACT_PROMPT }] }]
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
  var parsed = parseJsonLoose_(text);
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


// ===== 交通費の計算 =============================================
// 運賃はAnthropic APIのウェブ検索で調べ、走行距離は Google Maps の
// Distance Matrix API で取得する。どちらもブラウザからは呼べないので
// （APIキーの露出とCORS）GAS側で実行する。

/** 電車・バスのICカード運賃を調べる。 */
function fareLookup_(from, to) {
  var key = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!key) return { ok: false, error: 'ANTHROPIC_API_KEY がスクリプト プロパティに設定されていません' };
  from = str_(from); to = str_(to);
  if (!from || !to) return { ok: false, error: '出発駅と到着駅を入力してください' };

  var prompt = from + 'から' + to + 'までの電車のICカード運賃を調べて、'
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
function num_(v) {
  if (typeof v === 'number') return Math.round(v);
  var s = String(v === null || v === undefined ? '' : v).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isNaN(n) ? 0 : Math.round(n);
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
