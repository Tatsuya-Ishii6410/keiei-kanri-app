// 画面の実行テスト（ヘッドレスの Chrome）
// GASの代わりに偽の応答を返して（fetch を差し替える。シート・Drive・Gmail には触らない）アプリを開き、主な操作を順に行う。
// ページの例外（ReferenceError・TypeError など）と console.error を集め、1件でもあれば失敗にする。
// 追加の依存なし：Chrome を --remote-debugging-port で起動し、Node の WebSocket で DevTools Protocol を直接使う。
// 実行：node tests/app-smoke.test.js（npm test に含まれる）
//   Chrome の場所は CHROME_PATH で指定できる。どうしても Chrome が無い環境では SKIP_BROWSER_TEST=1 で飛ばせる（飛ばしたことを表示する）
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const APP = process.env.APP_FILE || path.join(ROOT, 'keiei-kanri.html');
const TIMEOUT_MS = 90000;

function findChrome() {
  const c = [process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return c.find(p => p && fs.existsSync(p));
}

// ---- 静的なファイルの配信（アプリ本体は APP_FILE。images/ などはリポジトリから） ----
function startServer() {
  const types = { '.html': 'text/html; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.js': 'text/javascript', '.css': 'text/css' };
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const file = u === '/' || u === '/index.html' ? APP : path.join(ROOT, path.normalize(u).replace(/^([/\\])+/, ''));
    if (!file.startsWith(ROOT) && file !== APP) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---- DevTools Protocol の最小のクライアント ----
function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const pending = new Map(); const handlers = [];
  ws.onmessage = ev => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id); pending.delete(msg.id);
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
    } else if (msg.method) handlers.forEach(h => h(msg));
  };
  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error('DevTools に接続できませんでした'));
    ws.onopen = () => resolve({
      send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { resolve: res, reject: rej }); ws.send(JSON.stringify({ id: i, method, params })); }),
      on: h => handlers.push(h),
      close: () => ws.close(),
    });
  });
}

// ---- ページより先に入れる：ログイン済みの状態・GASの偽の応答・エラーの収集・ダイアログの自動応答 ----
const PRELUDE = String.raw`(() => {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date();
  const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
  const ymdOf = d => ymOf(d) + '-' + pad(d.getDate());
  const addM = k => new Date(now.getFullYear(), now.getMonth() + k, 1);
  try {
    localStorage.clear();
    localStorage.setItem('bizapp_session_v1', JSON.stringify({ expires: Date.now() + 86400000 }));
  } catch (e) {}
  window.__step = '読み込み';
  window.__alerts = [];
  window.__gas = [];
  // エラーはページの中で、その時の段の名前を付けて集める（DevTools のイベントは名前が遅れて付くことがあるので予備）
  window.__errs = [];
  const errText = e => String(e && (e.stack || e.message) || e).split(String.fromCharCode(10)).slice(0, 3).join(' / ');
  window.addEventListener('error', e => { window.__errs.push('[' + window.__step + '] 例外：' + (e.error ? errText(e.error) : e.message)); });
  window.addEventListener('unhandledrejection', e => { window.__errs.push('[' + window.__step + '] Promise の例外：' + errText(e.reason)); });
  const origError = console.error.bind(console);
  console.error = (...a) => { window.__errs.push('[' + window.__step + '] console.error：' + a.map(x => x instanceof Error ? errText(x) : String(x)).join(' ')); origError(...a); };
  window.alert = m => { window.__alerts.push(window.__step + '：' + m); };
  window.confirm = () => true;
  window.prompt = () => '';
  window.open = () => { window.__alerts.push(window.__step + '：window.open'); return null; };
  // 経費・売上・交通費・予定の行と、進行中の案件（今月に請求レコードができる）
  const ym = ymOf(now), prevYm = ymOf(addM(-1));
  const SEED = {
    projects: [
      { id: 1, name: '営業支援', client: '株式会社テスト商事', status: '進行中', contract: 'monthly', amount: 300000, start: ymOf(addM(-3)), end: ymOf(addM(6)), invoiceStatus: 'uninvoiced' },
      { id: 2, name: '単発の制作', client: '株式会社サンプル', status: '完了', contract: 'single', amount: 120000, start: prevYm, end: prevYm, invoiceStatus: 'paid' },
    ],
    quotes: [
      { id: 'EST-' + ym.replace('-', '') + '-001', type: '見積書', client: '株式会社テスト商事', subject: '営業支援', date: ymdOf(now), expire: ymdOf(now), amount: 330000, items: [{ name: '営業支援', qty: 1, unit: 300000 }] },
    ],
    ledger: [
      { id: 101, date: ymdOf(new Date(now.getFullYear(), now.getMonth(), 1)), type: '売上', desc: '入金', amount: 330000, status: 'actual' },
      { id: 102, date: prevYm + '-10', type: '消耗品費', desc: '文具', amount: 1100, status: 'actual' },
      { id: 103, date: prevYm + '-12', type: '交際費', desc: '会食', amount: 8800, status: 'actual', withWhom: 'A社', purpose: '打ち合わせ' },
      { id: 104, date: prevYm + '-15', type: '交通費', desc: '青野ヶ原駅→三宮駅（電車）', amount: 560, status: 'actual', visit: 'A社', purpose: '商談' },
      { id: 105, date: ymOf(addM(1)) + '-25', expectedDate: ymOf(addM(1)) + '-25', type: '外注費', desc: '出金予定', amount: 50000, status: 'planned_out' },
      { id: 106, date: prevYm + '-20', expectedDate: prevYm + '-20', type: '売上', desc: '入金予定', amount: 110000, status: 'planned_in' },
    ],
    bankBalance: 1000000,
    inboxFolders: { receipt: '1TestReceiptFolder', invoice: '1TestInvoiceFolder' },
  };
  window.__seed = SEED;
  const reply = obj => new Response(JSON.stringify(obj), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const gasReply = action => {
    switch (action) {
      case 'load': return { ok: true, data: JSON.parse(JSON.stringify(SEED)) };
      case 'inboxScan': return { ok: true, read: 1, ready: 1, failed: 0, unsupported: 0, remaining: 0 };
      case 'inboxList': return { ok: true, items: [{ fileId: 'f1', kind: '領収書', status: 'ready', fileName: 'r.jpg', data: { date: ymdOf(now), amount: 1100, payee: '文具店' }, confidence: '高' }] };
      case 'driveList': return { ok: true, files: [{ id: 'o1', name: 'old.pdf', processed: false }] };
      case 'debitMails': return { ok: true, items: [{ messageId: 'm1', datetime: ymdOf(now) + ' 10:00', amount: 1200, merchant: 'NEXT', account: '****' }], unreadable: [] };
      default: return { ok: true };
    }
  };
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input && input.url || input);
    if (/script\.google\.com/.test(url)) {
      let action = (url.match(/[?&]action=([^&]+)/) || [])[1];
      if (!action && init && init.body) { try { action = JSON.parse(init.body).action; } catch (e) {} }
      window.__gas.push(window.__step + '：' + action);
      return reply(gasReply(action));
    }
    if (/api\.anthropic\.com/.test(url)) throw new Error('テスト中に Anthropic API を呼ぼうとしました');
    return realFetch(input, init);
  };
})();`;

// ---- アプリの中で行う操作（各段の名前は window.__step に入れ、エラーにどの段かを付ける） ----
const SCENARIO = String.raw`(async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const checks = [];
  const ok = (cond, label) => { if (!cond) checks.push(window.__step + '：' + label); };
  const nav = p => showPage(p, [...document.querySelectorAll('.nav-btn')].find(b => (b.getAttribute('onclick') || '').includes("showPage('" + p + "'")));
  // 1つの段で例外が出ても、残りの段は続ける（すべての段のエラーをまとめて出す）
  const step = async (name, fn) => {
    window.__step = name;
    try { await fn(); } catch (e) { checks.push(name + '：例外 ' + String(e && e.stack || e).split(String.fromCharCode(10)).slice(0, 2).join(' / ')); }
    await wait(250);
  };
  const change = (id, value) => { const el = document.getElementById(id); if (!el) { checks.push(window.__step + '：#' + id + ' がありません'); return; } if (value !== undefined) el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); };
  for (let i = 0; i < 40 && !(S.projects || []).some(p => p.id === 1); i++) await wait(100);   // GASの読み込みを待つ

  await step('ダッシュボード（新）', async () => {
    nav('dashboard'); setDashVersion(2);
    const ms = document.getElementById('month-select');
    for (const o of [...ms.options].slice(0, 3)) change('month-select', o.value);
    const fs = document.getElementById('fiscal-select');
    if (fs.options.length) change('fiscal-select', fs.options[0].value);
    ok(document.body.classList.contains('dv2-on'), '新ダッシュボードが表示されていない');
  });
  await step('ダッシュボード（旧）', async () => { setDashVersion(1); change('month-select'); setDashVersion(2); });
  await step('案件管理', async () => { nav('projects'); ok(document.querySelector('#page-projects.active'), '案件管理が開かない'); });
  await step('請求書の下書き作成', async () => {
    syncMonthlyBillings();
    const ym = localToday().slice(0, 7);
    pendingDraftYm = ym;
    createInvoiceDraftsNow();
    ok(S.quotes.some(q => docStatusOf(q) === 'draft'), '下書きができない（' + ym + '）');
  });
  await step('請求書の発行', async () => {
    const d = S.quotes.find(q => isInvoiceDoc(q) && docStatusOf(q) === 'draft');
    if (!d) return;
    const before = window.__gas.length;
    previewQuoteById(d.id);
    [...document.querySelectorAll('#dvw-actions button')].find(b => b.textContent.trim() === '発行する').click();
    await wait(900);   // 保存（GASへのPOST）は少し遅れて送る
    const q = S.quotes.find(x => x.client === d.client && isInvoiceDoc(x));
    ok(q && docStatusOf(q) === 'issued', '発行済みにならない');
    ok(window.__gas.slice(before).some(x => /：save$/.test(x)), 'GASへの保存が呼ばれない');
    closeDocViewer();
  });
  await step('見積・請求の一覧', async () => {
    nav('quotes');
    for (const t of ['estimate', 'invoice', 'upload', 'invoice']) switchQuoteTab(t, document.querySelector('[onclick*="switchQuoteTab(\'' + t + '\'"]'));
    change('quote-month', '');
    previewQuoteById(S.quotes.find(q => !isInvoiceDoc(q)).id); closeDocViewer();
  });
  await step('CF管理', async () => { nav('ledger'); switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]')); });
  await step('ドライブから取込', async () => {
    openDriveImportModal(); await wait(200);
    document.getElementById('drive-load-btn').click(); await wait(400);
    ok(/取込待ち/.test(document.getElementById('drive-msg').textContent), '読み取りの結果が出ない');
    closeModal('modal-drive-import');
  });
  await step('デビット通知から取込', async () => {
    openDebitImportModal(); await wait(100);
    await fetchDebitMails();
    ok(debitRows.length > 0, 'プレビューの行が出ない');
    closeModal('modal-debit-import');
  });
  await step('銀行明細CSVのプレビュー', async () => {
    nav('csv');
    const csv = '取引日,摘要,お支払金額,お預り金額,残高,メモ\n' + localToday().replace(/-/g, '/') + ',テスト文具,1100,,100000,\n' + localToday().replace(/-/g, '/') + ',振込 テスト商事,,330000,430000,\n';
    await bankHandleFile(new File([csv], 'bank.csv', { type: 'text/csv' }));
    ok(bankRows.length === 2, '明細の行が2件にならない（' + bankRows.length + '）');
  });
  await step('交通費台帳', async () => {
    nav('ledger'); switchCfTab('travel', document.querySelector('[onclick*="switchCfTab(\'travel\'"]'));
    change('tl-month', '');
    printTravelLedger(); closeDocViewer();
    switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]'));
  });
  await step('月次締め', async () => {
    openClosePage(); await wait(100);
    const btn = [...document.querySelectorAll('#page-close button')].find(b => /この月の確認を完了/.test(b.textContent));
    ok(btn, '「確認を完了」のボタンがない');
    if (btn) btn.click();
    const ym = document.getElementById('close-month').value;
    ok(S.monthClose && S.monthClose[ym], '確認の日時が保存されない（' + ym + '）');
  });
  await step('月次レポート', async () => {
    nav('report');
    switchReportTab('monthly', document.querySelector('[onclick*="switchReportTab(\'monthly\'"]'));
    generateReport();
    ok(document.getElementById('report-body').innerHTML.trim(), 'レポートが空');
    change('report-month', 'all'); generateReport();
    switchReportTab('forecast', document.querySelector('[onclick*="switchReportTab(\'forecast\'"]'));
    switchReportTab('loan', document.querySelector('[onclick*="switchReportTab(\'loan\'"]'));
  });
  await step('設定', async () => { nav('settings'); ok(document.querySelector('#page-settings.active'), '設定が開かない'); });
  window.__step = '終了';
  await wait(800);
  return { checks, gas: window.__gas, alerts: window.__alerts, errs: window.__errs };
})()`;

(async () => {
  if (process.env.SKIP_BROWSER_TEST === '1') { console.log('画面の実行テスト：SKIP_BROWSER_TEST=1 のため飛ばしました'); return; }
  const chrome = findChrome();
  if (!chrome) { console.error('Chrome が見つかりません。CHROME_PATH で場所を指定してください（飛ばすときは SKIP_BROWSER_TEST=1）'); process.exit(1); }
  const srv = await startServer();
  const port = srv.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-smoke-'));
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1280,900', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let finished = false;
  const cleanup = code => {
    if (finished) return; finished = true;
    try { proc.kill(); } catch (e) {}
    srv.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} process.exit(code); }, 300);
  };
  const timer = setTimeout(() => { console.error('✗ 画面の実行テストが時間内に終わりませんでした'); cleanup(1); }, TIMEOUT_MS);

  try {
    const wsBrowser = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stderr.on('data', d => { buf += d; const m = buf.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
      proc.on('exit', c => reject(new Error('Chrome が終了しました（' + c + '）')));
    });
    const devPort = new URL(wsBrowser).port;
    const list = await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    const cdp = await cdpClient(page.webSocketDebuggerUrl);

    const errors = [];
    let currentStep = '読み込み';
    cdp.on(msg => {
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        errors.push(`[${currentStep}] 例外：${(d.exception && d.exception.description || d.text).split('\n').slice(0, 3).join(' / ')}`);
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push(`[${currentStep}] console.error：${msg.params.args.map(a => a.value !== undefined ? a.value : a.description).join(' ')}`);
      } else if (msg.method === 'Page.javascriptDialogOpening') {
        cdp.send('Page.handleJavaScriptDialog', { accept: true });
      }
    });
    await cdp.send('Runtime.enable');
    await cdp.send('Page.enable');
    await cdp.send('Network.enable');
    // 外部のフォント・ライブラリは読まない（テストをネットにつながずに動かすため）
    await cdp.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*cdn.jsdelivr.net*', '*cdnjs.cloudflare.com*', '*script.google.com*'] });
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 375, height: 760, deviceScaleFactor: 1, mobile: true });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });
    await new Promise(r => setTimeout(r, 2500));

    // 段の名前をエラーに付けるため、実行中は __step を見に行く
    const poll = setInterval(async () => {
      try { const r = await cdp.send('Runtime.evaluate', { expression: 'window.__step', returnByValue: true }); if (r.result.value) currentStep = r.result.value; } catch (e) {}
    }, 100);
    const r = await cdp.send('Runtime.evaluate', { expression: SCENARIO, awaitPromise: true, returnByValue: true });
    clearInterval(poll);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      errors.push(`[${currentStep}] 操作の途中で例外：${(d.exception && d.exception.description || d.text).split('\n').slice(0, 3).join(' / ')}`);
    }
    const v = (r.result && r.result.value) || {};
    const res = { checks: v.checks || [], gas: v.gas || [], alerts: v.alerts || [] };
    // ページの中で集めたものを正とし、DevTools だけが拾ったもの（ページの仕組みが動く前など）を足す
    const pageErrs = v.errs || [];
    const extra = errors.filter(e => !pageErrs.some(p => p.split('：').slice(1).join('：').slice(0, 40) && e.includes(p.split('：').slice(1).join('：').split(' / ')[0].slice(0, 40))));
    errors.length = 0; errors.push(...pageErrs, ...extra);
    cdp.close();
    clearTimeout(timer);

    const fail = errors.length + res.checks.length;
    if (fail) {
      errors.forEach(e => console.error('  ' + e));
      res.checks.forEach(c => console.error('  確認：' + c));
      console.error(`✗ 画面の実行テスト：エラー ${errors.length}件・確認の失敗 ${res.checks.length}件`);
      if (process.env.SMOKE_VERBOSE) console.error('GASの呼び出し：', res.gas, '\nalert：', res.alerts);
      return cleanup(1);
    }
    console.log(`画面の実行テスト：エラーなし（12の画面・操作。GASの偽の呼び出し ${res.gas.length}回・alert ${res.alerts.length}回）`);
    if (process.env.SMOKE_VERBOSE) console.log(res.gas, res.alerts);
    cleanup(0);
  } catch (e) {
    console.error('✗ 画面の実行テストを動かせませんでした：' + e.message);
    cleanup(1);
  }
})();
