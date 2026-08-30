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
  projects: ['id', 'name', 'client', 'amount', 'status', 'start', 'end', 'contract', 'memo'],
  quotes:   ['id', 'subject', 'client', 'amount', 'type', 'date', 'expire', 'due', 'items', 'note'],
  ledger:   ['id', 'date', 'type', 'desc', 'amount'],
  settings: ['key', 'value']
};

// 日付として自動変換されると困る列（テキスト書式を強制する）
var TEXT_COLUMNS = ['id', 'start', 'end', 'date', 'expire', 'due', 'items', 'value'];

// settings シートに保存する会社情報の項目
var COMPANY_FIELDS = ['name', 'rep', 'zip', 'addr', 'tel', 'email',
  'bankName', 'bankBranch', 'accountType', 'accountNumber', 'accountHolder',
  'invoice', 'payment', 'note'];
// settings シートに保存する計画の項目
// 月次計画は plan.<月>.<項目> というキーで保存する（例: plan.4.sales）
var PLAN_FIELDS = ['sales', 'expense', 'labor'];


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
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return respond_({ ok: false, error: '他の書き込み処理と競合しました。少し待って再試行してください。' }, '');
  }
  try {
    var raw = (e && e.postData && e.postData.contents) || (e && e.parameter && e.parameter.payload) || '';
    if (!raw) throw new Error('リクエストが空です');
    var body = JSON.parse(raw);
    var action = body.action || 'save';
    if (action !== 'save') throw new Error('不明なaction: ' + action);
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
    company:  settings.company,
    plan:     settings.plan,
    nextProjectId: settings.nextProjectId,
    nextQuoteNum:  settings.nextQuoteNum,
    nextLedgerId:  settings.nextLedgerId
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
      memo: str_(o.memo)
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
      amount: num_(o.amount)
    };
  }).filter(function (l) { return l.date !== '' && l.desc !== ''; });
}

function readSettings_(sh) {
  var company = {};
  var plan = [];
  for (var i = 0; i < 12; i++) plan.push({ sales: 0, expense: 0, labor: 0 });
  var legacyPlan = null; // 月の区別が無かった頃の形式
  var nextProjectId = 1, nextQuoteNum = 1, nextLedgerId = 1;

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
    }
  });

  // 未設定の項目はキーごと返さない（アプリ側の初期値を潰さないため）
  // 旧形式しか無い月には、その値を引き継ぐ
  if (legacyPlan) {
    for (var j = 0; j < 12; j++) {
      if (!plan[j].sales && !plan[j].expense && !plan[j].labor) {
        plan[j] = { sales: legacyPlan.sales, expense: legacyPlan.expense, labor: legacyPlan.labor };
      }
    }
  }

  return {
    company: company,
    plan: plan,
    nextProjectId: nextProjectId,
    nextQuoteNum: nextQuoteNum,
    nextLedgerId: nextLedgerId
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
      str_(p.start), str_(p.end), str_(p.contract), str_(p.memo)
    ];
  });

  var quotes = (data.quotes || []).map(function (q) {
    return [
      str_(q.id), str_(q.subject), str_(q.client), num_(q.amount), str_(q.type) || '見積書',
      str_(q.date), str_(q.expire), str_(q.due), JSON.stringify(q.items || []), str_(q.note)
    ];
  });

  var ledger = (data.ledger || []).map(function (l) {
    return [num_(l.id), str_(l.date), str_(l.type), str_(l.desc), num_(l.amount)];
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
  settings.push(['updatedAt', Utilities.formatDate(new Date(), timezone_(ss), 'yyyy-MM-dd HH:mm:ss')]);

  writeSheet_(ss.getSheetByName('projects'), SHEET_DEFS.projects, projects);
  writeSheet_(ss.getSheetByName('quotes'),   SHEET_DEFS.quotes,   quotes);
  writeSheet_(ss.getSheetByName('ledger'),   SHEET_DEFS.ledger,   ledger);
  writeSheet_(ss.getSheetByName('settings'), SHEET_DEFS.settings, settings);
  SpreadsheetApp.flush();
}

/** 計画データを、どの形式で来ても12ヶ月分の配列に整える。 */
function normalizePlan_(plan) {
  var out = [];
  for (var i = 0; i < 12; i++) out.push({ sales: 0, expense: 0, labor: 0 });
  if (!plan) return out;
  if (Object.prototype.toString.call(plan) === '[object Array]') {
    for (var j = 0; j < 12; j++) {
      var v = plan[j] || {};
      out[j] = { sales: num_(v.sales), expense: num_(v.expense), labor: num_(v.labor) };
    }
    return out;
  }
  // 旧形式（月の区別なし）は全ての月に同じ値を入れる
  var legacy = { sales: num_(plan.sales), expense: num_(plan.expense), labor: num_(plan.labor) };
  for (var k = 0; k < 12; k++) out[k] = { sales: legacy.sales, expense: legacy.expense, labor: legacy.labor };
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
