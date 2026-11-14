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
      case 'calendarEvents': return { ok: true, events: JSON.parse(JSON.stringify(window.__calEvents || [])) };
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
      const fail = window.__gasFail && window.__gasFail(action);   // 同期エラーの段：失敗の応答を返す
      if (fail) return fail;
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
  await step('案件管理', async () => {
    nav('projects'); ok(document.querySelector('#page-projects.active'), '案件管理が開かない');
    // 営業サマリー：今月の確定売上＝進行中の営業支援の今月分（300,000）。見込み（商談中）は別枠で 0
    change('project-month', String(new Date().getMonth()));
    const tot = document.getElementById('project-total'), hero = document.getElementById('pj-hero');
    ok(hero && hero.classList.contains('ui-scope'), '営業サマリーのヒーローが無い');
    ok(Number(tot.dataset.ucV) === 300000, '確定の売上合計が従来の集計と違う：' + tot.dataset.ucV);
    ok(document.getElementById('project-forecast').textContent === '¥0', '売上見込みが違う');
    ok(/確定/.test(hero.textContent) && /未確定/.test(hero.textContent), '確定と見込みの区別が無い');
    ok(!/NaN|Infinity/.test(hero.textContent), '営業サマリーに NaN');
    // スマホの案件の行：表の行と同じ数。展開で操作（主な1つ＋その他）。月次請求を開いても行は開いたまま。削除は確認つき
    const rows = () => [...document.querySelectorAll('#project-cards .uc-row')];
    ok(rows().length > 0 && rows().length === document.querySelectorAll('#project-list > tr').length, '案件の行の数が表と違う');   // 月次請求はまだ開いていない
    const r = document.querySelector('#project-cards .uc-row[data-project-id="1"]');
    ok(r, '営業支援の行がない'); if (!r) return;
    ok(/営業支援/.test(r.querySelector('summary').textContent) && /株式会社テスト商事/.test(r.querySelector('summary').textContent) && /進行中/.test(r.querySelector('summary').textContent), '閉じた行に 案件名・顧客・状態 がない');
    r.querySelector('summary').click(); ok(r.open, 'タップで展開されない');
    const items = [...r.querySelectorAll('.uc-row-body button')].map(b => b.textContent.trim());
    ['編集', '月次請求を表示', '更新', '見積', '削除'].forEach(t => ok(items.includes(t), '展開に「' + t + '」がない'));
    ok(items.includes('その他 ▾'), '「その他 ▾」がない');
    // 状態のステップ（進行中が今の段）。請求・入金は別の行。状態が変わった時だけ動きの印
    const cur = r.querySelector('.uc-steps [aria-current="step"]');
    ok(cur && /進行中/.test(cur.textContent) && r.querySelectorAll('.uc-steps .is-done').length === 2, 'ステップの今の段が違う');
    ok(r.querySelector('.pj-inv .badge') && !r.querySelector('.uc-steps').textContent.includes('請求'), '請求・入金がステップと別になっていない');
    ok(!r.querySelector('.uc-steps.is-changed'), '状態が変わっていないのに動く');
    const p1 = S.projects.find(p => p.id === 1), st0 = p1.status;
    p1.status = '完了'; renderProjects();
    ok(document.querySelector('#project-cards .uc-row[data-project-id="1"] .uc-steps.is-changed'), '状態の変化に動きの印がない');
    p1.status = st0; renderProjects(); renderProjects();
    toggleBillingRows(1);
    const r2 = document.querySelector('#project-cards .uc-row[data-project-id="1"]');
    ok(r2 && r2.open && r2.querySelector('.mob-billing'), '月次請求を開くと行が閉じる・レコードが出ない');
    toggleBillingRows(1);
    const n0 = S.projects.length, conf = window.confirm; let asked = false;
    window.confirm = () => { asked = true; return false; };
    deleteProject(1); window.confirm = conf;
    ok(asked && S.projects.length === n0, '案件の削除に確認が出ない');
  });
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
    // 要約（ヒーロー）：合計は従来どおり（見積は全件、請求は発行済だけ）
    const sum = (type, f) => S.quotes.filter(q => (q.type || '見積書') === type && f(q)).reduce((a, q) => a + (q.amount || 0), 0);
    const hv = id => Number((document.querySelector('#' + id + ' .uc-hero-value') || { dataset: {} }).dataset.ucV);
    ok(hv('estimate-hero') === sum('見積書', () => true), '見積の合計が従来の計算と違う：' + hv('estimate-hero'));
    ok(hv('invoice-hero') === sum('請求書', q => docStatusOf(q) === 'issued'), '請求の合計が従来の計算と違う：' + hv('invoice-hero'));
    ok(!/NaN|Infinity/.test(document.getElementById('q-invoice').textContent), '見積・請求に NaN');
    // スマホの行：表の行と同じ数。展開で 表示・削除（確認つき）
    ok(document.querySelectorAll('#estimate-cards .uc-row').length === document.querySelectorAll('#estimate-list > tr').length, '見積の行の数が表と違う');
    const est = S.quotes.find(q => !isInvoiceDoc(q));
    const r = document.querySelector('#estimate-cards .uc-row[data-quote-id="' + est.id + '"]');
    ok(r && /株式会社テスト商事/.test(r.querySelector('summary').textContent), '見積の行に宛名がない'); if (!r) return;
    r.querySelector('summary').click(); ok(r.open, 'タップで展開されない');
    const bs = [...r.querySelectorAll('.uc-row-body button')].map(b => b.textContent.trim());
    ok(bs.some(t => /表示/.test(t)) && bs.some(t => /削除/.test(t)), '展開に 表示・削除 がない：' + bs);
    const n0 = S.quotes.length, conf = window.confirm; let asked = false;
    window.confirm = () => { asked = true; return false; };
    [...r.querySelectorAll('.uc-row-body button')].find(b => /削除/.test(b.textContent)).click(); window.confirm = conf;
    ok(asked && S.quotes.length === n0, '見積の削除に確認が出ない');
  });
  await step('見積・請求：行の「その他 ▾」から 訂正・取消、下書きは 発行（主のボタン）と 編集・削除。PCの操作エリアの「その他 ▾」に 同期・一括作成', async () => {
    const keepQ = S.quotes.slice(), d0 = localToday();
    S.quotes.push({ id: 'INV-SMK-1', type: '請求書', status: 'issued', client: 'A社', subject: '発行済', date: d0, due: d0, amount: 11000, items: [] },
      { id: 'DRAFT-SMK-1', type: '請求書', status: 'draft', client: 'B社', subject: '下書き', date: d0, due: d0, amount: 22000, items: [] });
    try {
      change('quote-month', ''); renderQuotes();
      const row = id => document.querySelector('#invoice-cards .uc-row[data-quote-id="' + id + '"]');
      const menuOf = r => [...r.querySelectorAll('.uc-row-body .lt-menu [role=menuitem]')];
      const iss = row('INV-SMK-1'), dr = row('DRAFT-SMK-1');
      ok(iss && dr, '請求書の行がない'); if (!iss || !dr) return;
      const im = menuOf(iss);
      ok(iss.querySelector('.uc-row-body .lt-menu-btn') && ['訂正', '取消'].every(t => im.some(b => b.textContent.trim() === t)), '発行済の「その他 ▾」に 訂正・取消 がない：' + im.map(b => b.textContent.trim()));
      im.find(b => b.textContent.trim() === '取消').click();
      ok(document.getElementById('modal-invoice-cancel').classList.contains('open'), '「その他 ▾」の取消で取消の画面が開かない');
      closeModal('modal-invoice-cancel');
      im.find(b => b.textContent.trim() === '訂正').click();
      ok(document.getElementById('modal-create-quote').classList.contains('open'), '「その他 ▾」の訂正で訂正の画面が開かない');
      closeModal('modal-create-quote');
      const main = dr.querySelector('.uc-row-body .mob-card-actions > .btn');
      ok(main && main.textContent.trim() === '発行' && /issueDraftInvoice/.test(main.getAttribute('onclick')), '下書きの主のボタンが「発行」でない');
      const dm = menuOf(dr).map(b => b.textContent.trim());
      ok(['表示', '編集', '削除'].every(t => dm.includes(t)), '下書きの「その他 ▾」に 表示・編集・削除 がない：' + dm);
      const tm = [...document.querySelectorAll('#inv-more-menu [role=menuitem]')].map(b => b.getAttribute('onclick'));
      ok(tm.some(o => /openInvoiceSyncModal/.test(o)) && tm.some(o => /openBulkInvoiceModal/.test(o)), '請求書の「その他 ▾」に 同期・一括請求書作成 がない');
    } finally { S.quotes = keepQ; renderQuotes(); }
  });
  // ドライブの請求書同期：候補1件は自動、0件・2件以上は保留（請求書・請求レコード・入金予定を作らない）、保留から選ぶと自動と同じ結果
  await step('ドライブの請求書同期（保留・確定）', async () => {
    const pad = n => String(n).padStart(2, '0'), now = new Date(), mi = now.getMonth(), ym = monthYear(mi) + '-' + pad(mi + 1);
    const y0 = now.getFullYear();
    const P = (id, client, start, end, status) => ({ id, name: '同期' + id, client, amount: 100000, status: status || '進行中', start, end, contract: 'monthly', invoiceStatus: 'uninvoiced' });
    S.projects.push(P(901, '株式会社旧新', (y0 - 3) + '-01-01', (y0 - 2) + '-12-31', '完了'), P(902, '株式会社旧新', (y0 - 1) + '-01-01', (y0 + 1) + '-12-31'),
      P(903, 'C社', (y0 - 1) + '-01-01', (y0 + 1) + '-12-31'), P(904, 'C社', (y0 - 1) + '-06-01', (y0 + 1) + '-12-31'),
      P(905, 'テスト商事', (y0 - 1) + '-01-01', (y0 + 1) + '-12-31'), P(906, 'E社', (y0 - 1) + '-01-01', (y0 + 1) + '-12-31', '商談中'));
    syncMonthlyBillings();
    const files = [['sf1', '株式会社旧新'], ['sf2', 'C社'], ['sf3', 'テスト'], ['sf4', 'E社']], map = {};
    files.forEach(x => { map[x[0]] = x[1]; });
    const keepCall = window.gasCall, keepParse = window.parseInvoiceText;
    window.gasCall = async b => ({ ok: true, contentSnippet: b.fileId });
    window.parseInvoiceText = t => ({ client: map[t], id: 'INV-SMOKE-' + t, total: 110000, sub: 100000, date: ym + '-28', due: ym + '-28' });
    try {
      invPending = [];
      openInvoiceSyncModal(); document.getElementById('inv-month').value = String(mi);
      invFiles = files.map(x => ({ id: x[0], name: x[0] + '.pdf', client: x[1] }));
      document.getElementById('inv-list').innerHTML = files.map((x, i) => '<input type="checkbox" class="inv-check" value="' + i + '" checked>').join('');
      const recs0 = S.monthlyBillings.length, plan0 = S.ledger.filter(l => l.status === 'planned_in').length;
      await syncInvoices();
      const rec = pid => S.monthlyBillings.find(b => b.projectId === pid && b.billingMonth === ym);
      ok(rec(902) && rec(902).invoiceStatus === 'invoiced' && rec(902).invoiceId === 'INV-SMOKE-sf1', '古い案件と今の案件 → 今の案件に付かない');
      ok(!rec(901) || rec(901).invoiceStatus === 'uninvoiced', '古い（終わった）案件に付いた');
      ok(invPending.map(x => x.f.id).join(',') === 'sf2,sf3,sf4', '保留が「候補2件・部分一致・商談中」の3件にならない（' + invPending.map(x => x.f.id) + '）');
      ok(!S.quotes.some(q => /INV-SMOKE-sf[234]/.test(q.id)), '保留なのに請求書ができた');
      ok(S.monthlyBillings.length === recs0 && S.ledger.filter(l => l.status === 'planned_in').length === plan0 + 1, '保留なのに請求レコード・入金予定ができた');
      ok(rec(906) === undefined || rec(906).invoiceStatus === 'uninvoiced', '商談中に付いた');
      ok(/案件を決められない請求書 3件/.test(document.getElementById('inv-pending').textContent), '保留の件数が画面に出ない');
      // 「あとで決める」：保留があっても閉じられ、何も作られない。閉じるときに件数を知らせる
      const snap = () => [S.quotes.length, S.monthlyBillings.length, S.ledger.filter(l => l.status === 'planned_in').length].join(',');
      const s0 = snap();
      document.getElementById('inv-pend-later').click(); await wait(300);   // 履歴を1つ戻すのを待つ
      ok(!document.getElementById('modal-invoice-sync').classList.contains('open'), '「あとで決める」で閉じられない');
      ok(snap() === s0, '「あとで決める」で何かが作られた');
      ok(/3件は保留のままです。次の同期で、もう一度出ます/.test((document.getElementById('app-toast') || {}).textContent || ''), '閉じるときの知らせが出ない');
      // スマホの戻る操作でも閉じる
      openInvoiceSyncModal(); await wait(50);
      history.back(); await wait(300);
      ok(!document.getElementById('modal-invoice-sync').classList.contains('open'), '戻る操作で閉じられない');
      // 次の同期（保留の記録が無くなった後でも）で、同じPDFがもう一度保留に出る。重ねては出ない
      invPending = [];
      openInvoiceSyncModal(); document.getElementById('inv-month').value = String(mi);
      invFiles = files.map(x => ({ id: x[0], name: x[0] + '.pdf', client: x[1] }));
      document.getElementById('inv-list').innerHTML = files.map((x, i) => '<input type="checkbox" class="inv-check" value="' + i + '" checked>').join('');
      await syncInvoices();
      ok(invPending.map(x => x.f.id).join(',') === 'sf2,sf3,sf4', '次の同期で、同じPDFがもう一度保留に出ない（' + invPending.map(x => x.f.id) + '）');
      ok(snap() === s0, '2回目の同期で、保留の分や同期済みの分が作られた');
      // 保留から C社 の案件（903）を選んで確定 → 自動と同じ（請求済み・請求書番号・支払期限・入金予定）
      const i = invPending.findIndex(x => x.f.id === 'sf2');
      document.getElementById('inv-pend-sel-' + i).value = '903';
      await confirmInvPending(i);
      const b = rec(903), a = rec(902), pl = id => S.ledger.find(l => l.status === 'planned_in' && l.projectId === id && l.billingMonth === ym);
      ok(b && b.invoiceStatus === 'invoiced' && b.invoiceId === 'INV-SMOKE-sf2' && b.expectedPayDate === a.expectedPayDate && b.amount === a.amount, '確定の結果が自動の同期と違う（請求レコード）');
      ok(pl(903) && pl(902) && pl(903).amount === pl(902).amount && (pl(903).expectedDate || pl(903).date) === (pl(902).expectedDate || pl(902).date), '確定の結果が自動の同期と違う（入金予定）');
      ok(invPending.length === 2, '確定した請求書が保留に残る');
    } finally {
      window.gasCall = keepCall; window.parseInvoiceText = keepParse;
      invPending = []; closeModal('modal-invoice-sync');
    }
  });
  await step('CF管理', async () => { nav('ledger'); switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]')); });
  await step('CF管理：スマホの明細の行（展開・操作・削除の確認）', async () => {
    change('ledger-month', '');
    const rowsEl = [...document.querySelectorAll('#ledger-cards .uc-row')];
    ok(rowsEl.length === cashflowRows(null).length, '明細の行の数が一覧と違う：' + rowsEl.length);
    const r = document.querySelector('#ledger-cards .uc-row[data-ledger-id="106"]');
    ok(r && r.querySelector('summary'), '入金予定の行がない');
    if (!r) return;
    r.querySelector('summary').click();
    ok(r.open, 'タップで展開されない');
    const btn = t => [...r.querySelectorAll('.uc-row-actions button')].find(b => b.textContent.trim() === t);
    ok(btn('実績に変換') && btn('編集') && btn('削除'), '展開に 実績に変換・編集・削除 がない');
    btn('編集').click();
    ok(document.getElementById('modal-add-ledger').classList.contains('open'), '編集が開かない');
    closeModal('modal-add-ledger');
    const n0 = S.ledger.length, conf = window.confirm; let asked = false;
    window.confirm = () => { asked = true; return false; };
    btn('削除').click();
    window.confirm = conf;
    ok(asked && S.ledger.length === n0, '削除の確認が出ない、または確認で取り消しても消えた');
  });
  /* 交通費精算の振込（実例：2026年9月分 48,630円を 2026-11-03 に口座振込）。今日を基準に「2か月前の分を、今月3日に振込」で作る（2026-11 では実例と同じ日付）
     精算の支払いは 経費の集計から外れ、CFの実績出金に1回だけ入る。CF管理・月次レポート・ダッシュボード・損益・税金の試算・交通費台帳で確認 */
  await step('交通費精算の振込：経費は変わらず、CFの出金は1回だけ（振込済み → 銀行CSV・既存の出金への紐付け）', async () => {
    const keep = JSON.parse(JSON.stringify(S.ledger)), keepTax = JSON.parse(JSON.stringify(S.taxSettings || {}));
    const pad = n => String(n).padStart(2, '0'), now = new Date();
    const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
    const tD = new Date(now.getFullYear(), now.getMonth() - 2, 1), tYm = ymOf(tD), pYm = ymOf(now), pay = pYm + '-03';
    const miT = tD.getMonth(), miP = now.getMonth(), absT = tD.getFullYear() * 12 + miT, absP = now.getFullYear() * 12 + miP;
    const sameYear = monthYear(miT) === tD.getFullYear() && monthYear(miP) === now.getFullYear();   // 月だけで選ぶ画面は、今の期に入る時だけ見る
    const plan = () => ({ id: 9001, type: '交通費', desc: '交通費精算 ' + tD.getFullYear() + '年' + (miT + 1) + '月分', amount: 48630, status: 'planned_out', date: pay, expectedDate: pay, settlementMonth: tYm, memo: '' });
    const base = () => keep.concat([
      { id: 9002, type: '交通費', desc: '青野ヶ原駅→三宮駅（電車）', amount: 30000, status: 'actual', date: tYm + '-10', visit: 'A社', purpose: '商談' },
      { id: 9003, type: '交通費', desc: '自宅→加古川（車）', amount: 18630, status: 'actual', date: tYm + '-20', visit: 'B社', purpose: '現地調査' },
      plan()]);
    taxSettings().consumptionTax.method = 'general';
    const fy = activeFiscalYear();
    const snap = () => {
      if (sameYear) { document.getElementById('report-month').value = String(miT); generateReport(); }
      const rep = sameYear ? (document.getElementById('page-report').textContent.match(/経費合計[^¥]*(¥[0-9,]+)/) || [])[1] : null;
      const cf = cashflowTotals(cashflowRows(miP));
      // 月次P/L（損益計算書）：表の行だけ見る（XLSX は読み込まないので、行をそのまま返す代わりを入れる）
      let pl = null;
      if (sameYear) {
        const keepX = window.XLSX; window.XLSX = { utils: { aoa_to_sheet: rows => ({ rows }) } };
        try { pl = JSON.stringify(buildMonthlyPL(miP).ws.rows); } finally { window.XLSX = keepX; }
      }
      return {
        exp: [sumLedgerAbs(absT).expense, sumLedgerAbs(absP).expense],                  // 月次レポート・期の集計の元
        report: rep,                                                                     // 月次レポートの画面の「経費合計」
        dash: [dashMonthNumbers(absT).expense, dashMonthNumbers(absP).expense],          // ダッシュボード
        profit: [profitOfAbs(absT), profitOfAbs(absP)],                                  // 損益（営業利益）
        plSettle: pl === null ? null : pl.includes('交通費精算'),                         // 月次P/L に精算の行が出ないこと
        corp: fy ? estimateCorporateTax(fy).income : null,                               // 税金の試算（法人税の課税所得）
        purchases: fy ? estimateConsumptionTax(fy).basis : null,                         // 税金の試算（消費税の課税仕入。精算の予定は入れない＝④）
        plannedExp: sumPlannedOutAbs(absP).expense,                                      // 経費の見込み（出金予定。精算の予定は入れない＝④）
        cfOut: cf.actualOut, cfPlanOut: cf.planOut,                                      // CF管理
        travel: sameYear ? travelActualTotal(miT) : null,                                // 交通費台帳
      };
    };
    const same = (a, b, keys, label) => keys.forEach(k => ok(JSON.stringify(a[k]) === JSON.stringify(b[k]), label + '：' + k + ' が変わった ' + JSON.stringify(a[k]) + '→' + JSON.stringify(b[k])));
    const EXP = ['exp', 'report', 'dash', 'profit', 'corp', 'travel', 'purchases', 'plannedExp'];
    try {
      // 0) 振込前（出金予定のまま）
      S.ledger = base(); refreshAll();
      const s0 = snap();
      ok(s0.travel === null || s0.travel === 48630, '交通費台帳の合計が違う：' + s0.travel);
      // 1) 案A：CF管理の行から「振込済みにする」（2026-11-03・48,630円）
      nav('ledger'); switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]')); change('ledger-month', String(miP));
      const r = document.querySelector('#ledger-cards .uc-row[data-ledger-id="9001"]');
      const b = r && [...r.querySelectorAll('.uc-row-actions button')].find(x => x.textContent.trim() === '振込済みにする');
      ok(b && ![...r.querySelectorAll('button')].some(x => x.textContent.trim() === '実績に変換'), '精算の行に「振込済みにする」がない（または実績に変換が出る）');
      if (!b) return;
      b.click();
      ok(document.getElementById('pc-title').textContent === '交通費精算を振込済みにする' && !document.querySelector('#pc-dups input'), '振込済みの画面が違う（候補が無いのに警告が出る）');
      document.getElementById('pc-date').value = pay; document.getElementById('pc-amount').value = '48630';
      confirmPlanned();
      const l = S.ledger.find(x => x.id === 9001);
      ok(l && isSettlePaid(l) && l.date === pay && l.amount === 48630 && l.settlementMonth === tYm && S.ledger.filter(x => x.id === 9001).length === 1, '振込済みの行が正しくない');
      const s1 = snap();
      same(s0, s1, EXP, '振込済みにした後の経費');
      ok(s1.plSettle !== true, '月次P/L に交通費精算が経費として出る');
      ok(s1.cfOut === s0.cfOut + 48630 && s1.cfPlanOut === s0.cfPlanOut - 48630, 'CFの出金が1回だけになっていない：' + [s0.cfOut, s1.cfOut, s0.cfPlanOut, s1.cfPlanOut]);
      if (sameYear) { change('tl-month', String(miT)); renderTravelLedger(); ok(/振込済み/.test(document.getElementById('tl-summary').textContent), '交通費台帳の精算状況が「振込済み」にならない'); }
      // 2) 案C：同じ振込を含む銀行CSV（翌日の日付）→ 登録済みとみなして未選択、理由を表示。そのまま登録しても二重にならない
      nav('csv');
      const csv = '取引日,摘要,お支払金額,お預り金額,残高,メモ\n' + (pYm + '-04').replace(/-/g, '/') + ',ﾌﾘｺﾐ ｺｳﾂｳﾋ,48630,,900000,\n';
      await bankHandleFile(new File([csv], 'bank.csv', { type: 'text/csv' }));
      ok(bankRows.length === 1 && bankRows[0].settlePaidId === 9001 && !bankRows[0].checked, '振込済みの精算と同じ振込が、未選択にならない');
      ok(/精算の振込として登録済み/.test(document.getElementById('bank-result').textContent) && /理由/.test(document.getElementById('bank-result').textContent), '取込の確認画面に理由が出ない');
      bankRegister();   // 何も選ばれていない → 登録しない
      const s2 = snap();
      same(s1, s2, EXP.concat(['cfOut', 'cfPlanOut']), '銀行CSVの取込の後');
      // ユーザーが取り消して選べば、通常の出金として登録できる（黙って除外しない）
      const n2 = S.ledger.length; bankRows[0].checked = true; bankRegister();
      ok(S.ledger.length === n2 + 1, '選んだのに通常の出金として登録されない');
      // 3) 案Aの二重の検知：先に銀行CSVで出金（その他経費）がある状態で振込済みにする → 既存の行に紐付け（予定は消す）
      S.ledger = base().concat([{ id: 9004, type: 'その他経費', desc: 'ﾌﾘｺﾐ ｺｳﾂｳﾋ', amount: 48630, status: 'actual', date: pYm + '-04', calId: 'bank:x' }]); refreshAll();
      openPlanConfirm(9001); document.getElementById('pc-date').value = pay; document.getElementById('pc-amount').value = '48630'; renderSettleDups();
      const radio = document.querySelector('#pc-dups input[name="pc-dup"]:checked');
      ok(radio && radio.value === '9004' && /二重/.test(document.getElementById('pc-dups').textContent), '既存の出金があるのに警告・紐付けの選択肢が出ない');
      // 金額に差がある候補だけの時は、初期値で紐付けが選ばれない。選ばずに保存すると止まる（新しい実績を作らない）
      document.getElementById('pc-amount').value = '48000'; renderSettleDups();
      ok(document.querySelector('#pc-dups input[name="pc-dup"]') && !document.querySelector('#pc-dups input[name="pc-dup"]:checked'), '金額に差がある時に、初期値で紐付けが選ばれている');
      const n3 = S.ledger.length; confirmPlanned();
      ok(S.ledger.length === n3 && S.ledger.find(x => x.id === 9001).status === 'planned_out', '選ばずに保存したのに、実績ができた');
      document.getElementById('pc-amount').value = '48630'; renderSettleDups();
      ok((document.querySelector('#pc-dups input[name="pc-dup"]:checked') || {}).value === '9004', '金額が一致する時に、初期値で紐付けが選ばれない');
      confirmPlanned();
      const s3 = snap(), linked = S.ledger.find(x => x.id === 9004);
      ok(!S.ledger.some(x => x.id === 9001) && linked && isSettlePaid(linked) && linked.settlementMonth === tYm, '紐付けで、予定が消えない・既存の行が精算の支払いにならない');
      same(s0, s3, EXP, '紐付けの後の経費');
      ok(s3.cfOut === s0.cfOut + 48630 && s3.cfPlanOut === s0.cfPlanOut - 48630, '紐付けの後、CFの出金が1回だけになっていない');
      window.__settleNumbers = { s0, s1, s3 };
    } finally {
      closeModal('modal-plan-confirm'); bankRows = [];
      S.ledger = keep; S.taxSettings = keepTax; change('ledger-month', ''); refreshAll();
    }
  });
  await step('編集・追加の画面：見出し／本文／固定フッター（保存・キャンセル・閉じ方は従来どおり）', async () => {
    // 見出し＋最後の子が actions-row のモーダルは、すべて3層（交通費は te-、ほかは mf-）
    const bad = [...document.querySelectorAll('.modal-overlay>.modal')].filter(m => {
      const k = [...m.children];
      return k.length && k[0].classList.contains('modal-header') && !m.classList.contains('te-modal')
        && !(m.classList.contains('mf-modal') && k[1] && k[1].classList.contains('mf-body'));
    }).map(m => m.parentElement.id);
    ok(!bad.length, '3層になっていない画面：' + bad.join(','));
    const m = document.querySelector('#modal-add-ledger>.modal'), foot = m.querySelector(':scope>.mf-foot');
    const fb = t => foot && [...foot.querySelectorAll('button')].find(b => b.textContent.includes(t));
    ok(foot && fb('キャンセル') && foot.querySelector('#modal-ledger-submit') && !foot.querySelector('.danger'), '実績入力のフッターに 保存・キャンセル がない（または危険な操作がある）');
    ok(m.querySelector('.mf-body #l-amount'), '入力欄が本文に入っていない');
    // 保存：フッターのボタンから従来の saveLedger
    openLedgerModal(null, 'actual');
    const n0 = S.ledger.length;
    document.getElementById('l-desc').value = 'フッターの保存'; document.getElementById('l-amount').value = '1234';
    document.getElementById('l-type').value = '消耗品費';
    document.getElementById('modal-ledger-submit').click();
    ok(S.ledger.length === n0 + 1 && !document.getElementById('modal-add-ledger').classList.contains('open'), 'フッターの保存で登録・閉じるができない');
    S.ledger = S.ledger.filter(l => l.desc !== 'フッターの保存'); refreshAll();
    // キャンセル・背景のタップで閉じる
    openLedgerModal(null, 'actual'); fb('キャンセル').click();
    ok(!document.getElementById('modal-add-ledger').classList.contains('open'), 'キャンセルで閉じない');
    openLedgerModal(null, 'actual');
    const ov = document.getElementById('modal-add-ledger'); ov.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    ok(!ov.classList.contains('open'), '背景のタップで閉じない');
    m.querySelector('.mf-body').dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await step('CF管理：予定を実績に変換（出金予定・入金予定。スマホの行から。二重にならない）', async () => {
    const keep = JSON.parse(JSON.stringify(S.ledger)), keepProj = JSON.parse(JSON.stringify(S.projects));
    const pad = n => String(n).padStart(2, '0'), now = new Date();
    const ymOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1);
    const addM = k => new Date(now.getFullYear(), now.getMonth() + k, 1), prevYm = ymOf(addM(-1));
    try {
      // 交通費精算の出金予定は変換の対象外（二重計上を防ぐ。銀行明細の突合と同じ）
      S.ledger.push({ id: 990, date: ymOf(addM(1)) + '-25', expectedDate: ymOf(addM(1)) + '-25', type: '交通費', desc: '交通費精算', amount: 3000, status: 'planned_out', settlementMonth: ymOf(now) });
      const conv = (id, mi, date, amount) => {
        change('ledger-month', String(mi));
        const fc0 = Number(document.querySelector('#cf-forecast .uc-hero-value').dataset.ucV), n0 = S.ledger.length;
        const r = document.querySelector('#ledger-cards .uc-row[data-ledger-id="' + id + '"]');
        const b = r && [...r.querySelectorAll('.uc-row-actions button')].find(x => x.textContent.trim() === '実績に変換');
        ok(b, id + '：スマホの行に「実績に変換」がない'); if (!b) return null;
        b.click();
        ok(document.getElementById('modal-plan-confirm').classList.contains('open'), id + '：変換の画面が開かない');
        document.getElementById('pc-date').value = date; document.getElementById('pc-amount').value = String(amount);
        confirmPlanned();
        const l = S.ledger.find(x => x.id === id);
        ok(l.status === 'actual' && l.date === date && l.amount === amount, id + '：状態・日付・金額が正しく変わらない');
        ok(S.ledger.length === n0 && S.ledger.filter(x => x.id === id).length === 1, id + '：予定と実績が二重に残る');
        const fc1 = Number(document.querySelector('#cf-forecast .uc-hero-value').dataset.ucV);
        ok(fc1 === fc0, id + '：同じ月・同じ金額の変換で月末予測が変わった（二重計上）：' + fc0 + '→' + fc1);
        return l;
      };
      const nx = addM(1), pv = addM(-1);
      const o = conv(105, nx.getMonth(), ymOf(nx) + '-26', 50000);
      ok(document.getElementById('pc-title').textContent === '出金を実績にする', '出金予定の画面の見出しが違う');
      ok(o && isActual(o) && !isInflow(o), '出金予定が出金の実績にならない');
      // 受取請求書（取込待ち）から作った出金予定（取込の識別子 calId・receiptId つき）も同じく変換でき、識別子は残る（再取込で重複しない）
      S.ledger.push({ id: 991, date: ymOf(nx) + '-05', expectedDate: ymOf(nx) + '-20', type: '外注費', desc: '受取請求書', amount: 22000, status: 'planned_out', projectId: null, calId: 'rcpt:f9', receiptId: 'f9' });
      const iv = conv(991, nx.getMonth(), ymOf(nx) + '-19', 22000);
      ok(iv && iv.calId === 'rcpt:f9' && iv.receiptId === 'f9', '取込の識別子が変換で消えた');
      conv(106, pv.getMonth(), prevYm + '-21', 110000);
      change('ledger-month', String(nx.getMonth()));
      const s = document.querySelector('#ledger-cards .uc-row[data-ledger-id="990"]');
      ok(s && ![...s.querySelectorAll('button')].some(x => x.textContent.trim() === '実績に変換'), '交通費精算に「実績に変換」が出る');
    } finally {
      closeModal('modal-plan-confirm');
      S.ledger = keep; S.projects = keepProj; change('ledger-month', ''); refreshAll();
    }
  });
  // 日付の初期値は今日（端末のローカル日付）。時刻を日本時間 2026-03-01 00:30（UTC では 2/28）に固定して確かめる
  await step('予定を実績にする日付の初期値は今日（入金予定・出金予定・振込済みにする。日本時間の0時台）', async () => {
    const keep = JSON.parse(JSON.stringify(S.ledger)), RealDate = Date;
    const fixed = RealDate.parse('2026-03-01T00:30:00+09:00');
    window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
    try {
      S.ledger.push(
        { id: 9101, date: '2026-03-20', expectedDate: '2026-03-20', type: '売上', desc: '入金予定', amount: 11000, status: 'planned_in' },
        { id: 9102, date: '2026-03-25', expectedDate: '2026-03-25', type: '外注費', desc: '出金予定', amount: 5500, status: 'planned_out' },
        { id: 9103, date: '2026-03-25', expectedDate: '2026-03-25', type: '交通費', desc: '交通費精算 2026年1月分', amount: 4321, status: 'planned_out', settlementMonth: '2026-01' });
      const dt = () => document.getElementById('pc-date').value;
      for (const id of [9101, 9102, 9103]) {
        openPlanConfirm(id);
        ok(dt() === '2026-03-01', id + '：日付の初期値が今日（2026-03-01）でない：' + dt());
        ok(!document.getElementById('pc-date').disabled && !document.getElementById('pc-date').readOnly, id + '：日付が変更できない');
        // 直した日付で保存される
        document.getElementById('pc-date').value = '2026-02-27'; renderSettleDups();
        confirmPlanned();
        const l = S.ledger.find(x => x.id === id);
        ok(l && isActual(l) && l.date === '2026-02-27', id + '：直した日付で保存されない：' + (l && l.date));
      }
    } finally {
      window.Date = RealDate; closeModal('modal-plan-confirm');
      S.ledger = keep; refreshAll();
    }
  });
  // today() は端末のローカル日付（日本時間）。0時台・9時台・23時台で、請求書の発行日・実績の日付の初期値も今日
  await step('今日の日付（日本時間の0時台・9時台・23時台）：today()・請求書の発行日・実績入力の日付', async () => {
    const RealDate = Date;
    try {
      for (const [iso, want] of [['2026-03-01T00:30:00+09:00', '2026-03-01'], ['2026-03-01T09:30:00+09:00', '2026-03-01'], ['2026-03-01T23:30:00+09:00', '2026-03-01'], ['2026-01-01T00:05:00+09:00', '2026-01-01']]) {
        const fixed = RealDate.parse(iso);
        window.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(fixed); } static now() { return fixed; } };
        ok(today() === want, iso + '：today() が ' + today());
        openCreateQuoteModal('請求書');
        ok(document.getElementById('q-date').value === want, iso + '：請求書の発行日の初期値が ' + document.getElementById('q-date').value);
        closeModal('modal-create-quote');
        openLedgerModal();
        ok(document.getElementById('l-date').value === want, iso + '：実績入力の日付の初期値が ' + document.getElementById('l-date').value);
        closeModal('modal-add-ledger');
        window.Date = RealDate;
      }
      // 契約更新の期間（月末の翌日・1年後の前日）も日付がずれない
      const p = S.projects[0], keepEnd = p.end, keepC = p.contract;
      p.end = '2026-03-31'; p.contract = 'annual'; openRenewModal(p.id);
      ok(document.getElementById('r-start').value === '2026-04-01' && document.getElementById('r-end').value === '2027-03-31', '契約更新の期間がずれる：' + document.getElementById('r-start').value + '〜' + document.getElementById('r-end').value);
      p.end = keepEnd; p.contract = keepC; closeModal('modal-renew-project');
    } finally { window.Date = RealDate; }
  });
  await step('CF管理：口座残高の桁区切り（保存する値は数字のまま）', async () => {
    const b0 = S.bankBalance, el = document.getElementById('cf-balance');
    ok(el.value === Number(b0).toLocaleString('ja-JP'), '残高が桁区切りで出ない：' + el.value);
    change('cf-balance', '1,500,000');
    ok(S.bankBalance === 1500000 && el.value === '1,500,000', '桁区切りの入力で保存値が違う：' + S.bankBalance);
    const v = document.querySelector('#cf-forecast .uc-hero-value');
    ok(v && document.querySelector('#cf-forecast .uc-more'), 'ヒーロー（月末予測・内訳）がない');
    change('cf-balance', String(b0));
    ok(S.bankBalance === b0, '残高を戻せない');
    ok([...document.querySelectorAll('#cf-more-menu [role=menuitem]')].some(b => /startReceiptImport/.test(b.getAttribute('onclick'))), '「その他」に 領収書から登録 がない');
    ok(['cf-actual-in', 'cf-actual-out', 'cf-plan-in', 'cf-plan-out'].every(id => /^¥/.test((document.getElementById(id) || {}).textContent || '')), 'KPIの4つの金額がない');
    const pr = document.querySelectorAll('#plan-cards .cf-plan-row');
    ok(pr.length === 4 && !/NaN|Infinity/.test(document.getElementById('plan-cards').textContent + document.getElementById('plan-table').textContent), '計画対実績の4項目がない、または NaN・Infinity が出た');
  });
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
    const tm = [...document.querySelectorAll('#tl-more-menu [role=menuitem]')].map(b => b.getAttribute('onclick'));
    ok(['exportTravelCsv', 'printTravelLedger', 'openLegacyModeModal'].every(f => tm.some(o => o.includes(f))), '交通費の「その他」に CSV・PDF・旧手段の整理 がない');
    // 要約カード：合計（カウントアップの最終値）は従来の集計と同じ
    const hv = document.querySelector('#tl-summary .uc-hero-value');
    ok(hv && hv.dataset.ucV === String(travelLedgerRows(null).reduce((a, l) => a + l.amount, 0)), '交通費の要約の合計が集計と違う');
    // スマホの行（ucRow）：件数・展開・編集・削除の確認（取り消すと消えない）
    const tRows = [...document.querySelectorAll('#tl-cards .uc-row')];
    ok(tRows.length === travelLedgerRows(null).length && tRows.length > 0, '交通費の行の数が一覧と違う：' + tRows.length);
    const tr = tRows[0];
    if (tr) {
      tr.querySelector('summary').click();
      const tb = t => [...tr.querySelectorAll('.uc-row-actions button')].find(b => b.textContent.trim() === t);
      ok(tr.open && tb('編集') && tb('削除'), '交通費の行が展開されない、または 編集・削除 がない');
      const n0 = S.ledger.length, conf = window.confirm; let asked = false;
      window.confirm = () => { asked = true; return false; };
      tb('削除').click();
      window.confirm = conf;
      ok(asked && S.ledger.length === n0, '交通費の削除の確認が出ない、または取り消しても消えた');
    }
    printTravelLedger(); closeDocViewer();
    switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]'));
  });
  // 取込の行を消したら、次のカレンダー取込で候補に出さない（消していない予定は出る）。精算済みの月は確認の文に警告
  await step('交通費の削除：削除済みの印・精算済みの月の警告', async () => {
    const d = '2026-07-03', ym = d.slice(0, 7);
    window.__calEvents = [
      { eventId: 'evA@' + d, date: d, startTime: '10:00', title: '削除テストA', location: '大阪府大阪市北区1-1', online: false },
      { eventId: 'evB@' + d, date: d, startTime: '14:00', title: '削除テストB', location: '兵庫県神戸市中央区2-2', online: false },
    ];
    const fetchCal = async () => { openCalendarImport(); document.getElementById('ci-from').value = d; document.getElementById('ci-to').value = d; await fetchCalendarEvents(); return calRows.concat(calOnline).map(r => r.calId); };
    const ids0 = await fetchCal();
    ok(ids0.includes('evA@' + d) && ids0.includes('evB@' + d), 'カレンダーの予定が候補に出ない：' + ids0.join(','));
    const n0 = S.ledger.length;
    const row = { id: S.nextLedgerId++, date: d, type: '交通費', desc: '青野ヶ原駅 → 梅田駅（電車・バス）　往復', amount: 1000, status: 'actual', calId: 'evA@' + d };
    const st = { id: S.nextLedgerId++, date: '2026-08-25', type: '交通費精算', desc: '交通費精算 2026年7月', amount: 4321, status: 'planned_out', settlementMonth: ym };
    S.ledger.push(row, st);
    const conf = window.confirm; let asked = '';
    window.confirm = m => { asked = String(m); return true; };
    deleteLedger(row.id);
    window.confirm = conf;
    ok(/精算の金額 ¥4,321 は自動では変わりません/.test(asked), '精算済みの月の警告が確認の文にない：' + asked.slice(0, 60));
    ok(!S.ledger.some(l => l.id === row.id) && S.deletedExtIds.includes('evA@' + d), '削除されない、または削除済みの印が残らない');
    const ids1 = await fetchCal();
    ok(!ids1.includes('evA@' + d) && ids1.includes('evB@' + d), '消した予定が次の取込で出る、または消していない予定が出ない：' + ids1.join(','));
    S.ledger = S.ledger.filter(l => l.id !== st.id);
    S.deletedExtIds = S.deletedExtIds.filter(x => x !== 'evA@' + d);
    ok(S.ledger.length === n0, '後片付けで件数が戻らない');
    closeModal('modal-cal-import'); window.__calEvents = [];
  });
  // カレンダー取込の到着＝最寄駅（B 場所欄の駅／C 一致しない→入力を促す／入力した駅は次回 A で出る）。運賃の計算の関数は同じで、到着が住所→駅に変わる
  await step('カレンダー取込：最寄駅', async () => {
    const d1 = '2026-07-10', d2 = '2026-07-17', title = '【訪問】最寄駅テスト商会';
    const fetchCal = async (d) => { openCalendarImport(); document.getElementById('ci-from').value = d; document.getElementById('ci-to').value = d; await fetchCalendarEvents(); return calRows; };
    window.__calEvents = [
      { eventId: 'evS1@' + d1, date: d1, startTime: '10:00', title: '駅テスト', location: '大阪府大阪市北区梅田3-1-1 大阪駅前第3ビル', online: false },
      { eventId: 'evS2@' + d1, date: d1, startTime: '15:00', title, location: '兵庫県神戸市兵庫区9-9', online: false },
    ];
    const rows = await fetchCal(d1);
    const b = rows.find(r => r.calId === 'evS1@' + d1), c = rows.find(r => r.calId === 'evS2@' + d1);
    ok(b && b.to === '大阪駅' && b.toSrc === 'loc', '場所欄の駅が到着にならない：' + (b && b.to));
    ok(c && c.to === '' && c.toSrc === '', '一致しない行の到着が空にならない：' + (c && c.to));
    const body = document.getElementById('ci-body').innerHTML;
    ok(/最寄駅を入力/.test(body) && body.includes('兵庫県神戸市兵庫区9-9'), '一致しない行に「最寄駅を入力」と住所が出ない');
    ok(calFareKey(b).includes('大阪駅') && !calFareKey(b).includes('梅田3'), '運賃を調べる到着が駅になっていない：' + calFareKey(b));
    // C：駅を入れて登録 → 次回、同じ名前の予定は A でその駅
    const ci = calRows.indexOf(c);
    calEdit(ci, 'to', { value: '新開地駅' });
    calRows.forEach(r => { r.checked = r === c; });
    const conf = window.confirm; window.confirm = () => true;
    registerCalRows();
    window.confirm = conf;
    const added = S.ledger.find(l => l.calId === 'evS2@' + d1);
    ok(added && /新開地駅/.test(added.desc) && added.visit === '最寄駅テスト商会', '入力した駅で登録されない：' + (added && added.desc));
    window.__calEvents = [{ eventId: 'evS3@' + d2, date: d2, startTime: '10:00', title, location: '兵庫県神戸市兵庫区9-9', online: false }];
    const rows2 = await fetchCal(d2);
    const a = rows2.find(r => r.calId === 'evS3@' + d2);
    ok(a && a.to === '新開地駅' && a.toSrc === 'visit', '入力した駅が次回の候補にならない：' + (a && a.to));
    S.ledger = S.ledger.filter(l => l !== added);
    closeModal('modal-cal-import'); window.__calEvents = [];
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
  // スマホの幅（375px）：行の操作ボタン・モーダルの✕・入力欄・選択欄が 44px 以上（後からの指定で上書きされたら気づく）
  await step('スマホのタップ領域（44px以上）', async () => {
    const vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const lowOf = els => els.filter(vis).filter(e => e.getBoundingClientRect().height < 44).map(e => (e.textContent || e.tagName).trim().slice(0, 10) + '(' + Math.round(e.getBoundingClientRect().height) + ')');
    nav('ledger');
    for (const tab of ['cf', 'travel']) {
      switchCfTab(tab, document.querySelector('[onclick*="switchCfTab(\'' + tab + '\'"]')); await wait(200);
      const rows = [...document.querySelectorAll('#page-ledger .uc-row')].filter(vis);
      rows.forEach(r => { r.open = true; });
      const btns = rows.flatMap(r => [...r.querySelectorAll('.uc-row-actions button')]);
      ok(btns.length > 0, tab + '：行の操作ボタンがない');
      const low = lowOf(btns);
      ok(!low.length, tab + '：行の操作ボタンが44px未満：' + low.slice(0, 4).join(' '));
      rows.forEach(r => { r.open = false; });
    }
    switchCfTab('cf', document.querySelector('[onclick*="switchCfTab(\'cf\'"]'));
    const bad = [];
    for (const o of document.querySelectorAll('.modal-overlay')) {
      o.classList.add('open'); await wait(30);
      const m = o.querySelector('.modal');
      const low = lowOf([...m.querySelectorAll('.modal-header button, input:not([type=checkbox]):not([type=radio]):not([type=file]):not([type=hidden]), select')]);
      if (low.length) bad.push(o.id + '：' + low.slice(0, 3).join(' '));
      o.classList.remove('open');
    }
    ok(!bad.length, 'モーダルの✕・入力欄が44px未満：' + bad.slice(0, 4).join(' ／ '));
  });
  await step('同期エラー：押すと理由のモーダル・再試行で復帰', async () => {
    const vis = e => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden';
    const modal = document.getElementById('modal-sync-err');
    const n0 = S.ledger.length;
    try {
      // 保存の失敗（HTTP 403）：表示を押すとモーダル、理由・案内・時刻、再試行で保存し直す
      window.__gasFail = a => a === 'save' ? new Response('forbidden', { status: 403 }) : null;
      S.ledger.push({ id: 995, date: '2026-01-05', type: '雑費', desc: '同期エラーの確認', amount: 1, status: 'actual' });
      await pushToGAS();
      const taps = [...document.querySelectorAll('.sync-tap')];
      ok(taps.length >= 2, '同期エラーの表示が押せる形にならない：' + taps.length);
      const low = taps.filter(vis).filter(e => e.getBoundingClientRect().height < 44 || e.getBoundingClientRect().width < 44);
      ok(taps.some(vis) && !low.length, '同期エラーの表示が見えない、または44px未満');
      document.getElementById('tb-sync').click();
      ok(modal.classList.contains('open'), '押してもモーダルが開かない');
      const txt = id => document.getElementById(id).textContent;
      ok(txt('se-detail') === 'HTTP 403', '元の文面が出ない：' + txt('se-detail'));
      ok(/GASの設定.*HTTP 403/.test(txt('se-hint')), '案内の文が出ない：' + txt('se-hint'));
      ok(/保存/.test(txt('se-op')) && /:[0-9][0-9]:[0-9][0-9]/.test(txt('se-at')), '失敗した処理・発生時刻が出ない');
      saveLocal();   // saveState と同じく、手元の保存は GAS の前に済む
      ok(Object.keys(localStorage).some(k => (localStorage.getItem(k) || '').includes('同期エラーの確認')), '保存の失敗で、手元の入力が残らない');
      // まだ失敗（JSONでない応答＝ログイン画面など）：モーダルは開いたまま、案内が変わる
      window.__gasFail = a => a === 'save' ? new Response('<html>login</html>', { status: 200 }) : null;
      await retrySyncErr();
      ok(modal.classList.contains('open') && /まだ同期できません/.test(txt('se-msg')), '再試行の失敗が出ない');
      ok(/JSONではありません/.test(txt('se-hint')), 'JSONでない応答の案内が出ない：' + txt('se-hint') + ' / ' + txt('se-detail'));
      // 復帰：同じデータを送り直し、表示が戻り、モーダルが閉じる
      window.__gasFail = null;
      const g0 = window.__gas.length;
      await retrySyncErr();
      ok(window.__gas.slice(g0).some(x => /：save$/.test(x)) && !window.__gas.slice(g0).some(x => /：load$/.test(x)), '再試行が保存をやり直さない（または読み込みをした）');
      ok(!modal.classList.contains('open') && dv2SyncState === 'ok' && !document.querySelector('.sync-tap'), '再試行で復帰しない');
      ok(S.ledger.length === n0 + 1, '再試行で入力が消えた');
      // 読み込みの失敗（GASがエラーを返す）：元の文面と、再試行は読み込み
      window.__gasFail = a => a === 'load' ? new Response(JSON.stringify({ ok: false, error: 'シートがありません' }), { status: 200 }) : null;
      S.ledger = S.ledger.filter(x => x.id !== 995); saveLocal();
      await loadFromGAS();
      openSyncErr();
      ok(/読み込み/.test(txt('se-op')) && txt('se-detail') === 'シートがありません' && /GASがエラー/.test(txt('se-hint')), '読み込みの失敗の表示が違う：' + txt('se-hint'));
      ok(/[0-9][0-9]:[0-9][0-9]:[0-9][0-9]/.test(txt('se-ok')), '最後に同期できた時刻が出ない');
      window.__gasFail = null;
      const g1 = window.__gas.length;
      await retrySyncErr();
      ok(window.__gas.slice(g1).some(x => /：load$/.test(x)) && dv2SyncState === 'ok' && !modal.classList.contains('open'), '読み込みの再試行で復帰しない');
    } finally {
      window.__gasFail = null; closeModal('modal-sync-err');
      S.ledger = S.ledger.filter(x => x.id !== 995); saveLocal(); setSyncStatus('ok');
    }
  });
  await step('古い端末の保存を断る・未送信の入力の保護（版・連続保存・選ぶ画面・控え）', async () => {
    const keepS = JSON.parse(JSON.stringify(S)), sheet = JSON.parse(JSON.stringify(S));
    const sent = [];
    // GASの代わり：版 cur と最後に保存した画面 last を持ち、gas-code.js の isStaleSave_ と同じ判定で断る
    let cur = 'v1', last = '', n = 1;
    const json = o => new Response(JSON.stringify(o), { status: 200 });
    window.__gasFail = (a) => null;
    const server = (a, body) => {
      if (a === 'load') return json({ ok: true, data: Object.assign(JSON.parse(JSON.stringify(sheet)), cur ? { syncVersion: cur } : {}) });
      if (a !== 'save') return null;
      sent.push(body);
      if (cur && body.baseVersion && body.baseVersion !== cur && !(body.writer && body.writer === last)) return json({ ok: false, conflict: true, version: cur, error: '別の端末で更新されています。読み込み直してください' });
      cur = 'v' + (++n); last = body.writer || ''; return json({ ok: true, version: cur });
    };
    const realFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = String(input && input.url || input);
      if (/script[.]google[.]com/.test(url)) {
        let a = (url.match(/[?&]action=([^&]+)/) || [])[1], body = {};
        if (init && init.body) { body = JSON.parse(init.body); a = a || body.action; }
        const r = server(a, body); if (r) return r;
      }
      return realFetch(input, init);
    };
    const ls = t => Object.keys(localStorage).some(k => k !== 'bizapp_stash' && (localStorage.getItem(k) || '').includes(t));
    const settle = async () => { for (let i = 0; i < 30 && (gasSaving || dv2SyncState === 'sync'); i++) await wait(100); };
    try {
      // 読み込み：版を覚える（S には入れない）
      await loadFromGAS();
      ok(gasBaseVersion === 'v1' && S.syncVersion === undefined, '読み込みの版を覚えない：' + gasBaseVersion);
      // 最新の版は通る・連続保存（0.6秒以内に2回）も通る
      S.company.note = 'edit-1'; saveState(); await wait(200); S.company.note = 'edit-2'; saveState();
      await wait(900); await settle(); await wait(700); await settle();
      ok(sent.length >= 1 && sent.every(b => b.writer === gasWriterId) && sent[0].baseVersion === 'v1', '保存に版・画面のIDが付かない');
      ok(dv2SyncState === 'ok' && !gasUnsent && gasBaseVersion === cur, '連続の保存が断られた：' + dv2SyncState + ' ' + gasBaseVersion + '/' + cur);
      // 応答が届かなかった保存の再試行：同じ画面なら断られない
      const prev = gasBaseVersion; cur = 'v' + (++n); last = gasWriterId;  // 前の保存は書けたが応答が届かなかった
      S.company.note = 'edit-3'; saveState(); await wait(900); await settle();
      ok(dv2SyncState === 'ok' && sent[sent.length - 1].baseVersion === prev, '同じ画面の再試行が断られた');
      // 別の端末が保存した → この端末の保存は断られる。入力は画面と端末に残る
      cur = 'v' + (++n); last = 'other-device'; sheet.company.note = 'from-other';
      S.company.note = 'stale-edit'; saveState(); await wait(900); await settle();
      ok(dv2SyncState === 'err' && syncErrInfo.op === 'conflict' && gasUnsent, '古い端末の保存が断られない：' + dv2SyncState);
      ok(S.company.note === 'stale-edit' && ls('stale-edit'), '断られた入力が消えた');
      openSyncErr();
      ok(/別の端末で更新されています/.test(document.getElementById('se-hint').textContent) && document.getElementById('se-retry').textContent === '読み込み直す', '断られた時の案内が出ない');
      // 読み込み直す → 未送信の変更があるので、黙って置き換えない
      await retrySyncErr(); await wait(100);
      ok(document.getElementById('modal-unsent').classList.contains('open') && S.company.note === 'stale-edit', '未送信の変更が、読み込みで黙って置き換わった');
      // ① この端末の内容を送る：先にシートの内容を控えに残す
      localStorage.removeItem('bizapp_stash');
      await unsentSendLocal(); await settle();
      const st1 = stashList();
      ok(st1.length === 1 && st1[0].kind === 'sheet' && st1[0].json.includes('from-other'), '①：シートの控えが残らない');
      ok(dv2SyncState === 'ok' && !gasUnsent && S.company.note === 'stale-edit' && last === gasWriterId, '①：この端末の内容が送れない');
      // ② シートの内容で置き換える：先にこの端末の内容を控えに残す（未送信のまま開き直した場合）
      cur = 'v' + (++n); last = 'other-device'; sheet.company.note = 'sheet-latest';
      S.company.note = 'unsent-edit'; saveState(); await wait(900); await settle();
      gasUnsent = true; saveSyncMeta();
      await loadFromGAS();
      ok(document.getElementById('modal-unsent').classList.contains('open') && S.company.note === 'unsent-edit', '②：未送信の変更が黙って置き換わった');
      unsentUseSheet();
      const st2 = stashList();
      ok(st2.length === 2 && st2[0].kind === 'local' && st2[0].json.includes('unsent-edit'), '②：この端末の控えが残らない');
      ok(S.company.note === 'sheet-latest' && !gasUnsent && gasBaseVersion === cur && dv2SyncState === 'ok', '②：シートの内容で置き換わらない');
      nav('settings');
      ok(document.querySelectorAll('#stash-list .stash-row').length === 2, '設定に控えが出ない');
      nav('ledger');
      // 版の無い古いGAS：版を送らない（今までどおり保存）
      cur = ''; await loadFromGAS(); sent.length = 0;
      S.company.note = 'old-gas'; saveState(); await wait(900); await settle();
      ok(sent.length && sent[sent.length - 1].baseVersion === undefined && dv2SyncState === 'ok', '版の無いシートで保存できない');
    } finally {
      window.fetch = realFetch; window.__gasFail = null;
      closeModal('modal-unsent'); closeModal('modal-sync-err');
      localStorage.removeItem('bizapp_stash');
      S = keepS; saveLocal(); gasBaseVersion = ''; gasUnsent = false; gasConflict = false; saveSyncMeta(); setSyncStatus('ok'); refreshAll();
    }
  });
  // 段階6-a で外した絵文字が戻っていない（モーダルの見出し・サイドバー・CSV取込・月次締め・設定の見出し）
  await step('絵文字を使わない場所', async () => {
    const emo = new RegExp(String.fromCharCode(92) + 'p{Extended_Pictographic}', 'u');   // SCENARIO は文字列なのでバックスラッシュを避ける
    const els = [...document.querySelectorAll('.modal-title, #sidebar, #page-csv .section-title, #page-csv .csv-type-btn, #page-csv .card-title, #page-close .section-title, #page-settings .card-title')];
    const hit = els.filter(e => emo.test(e.textContent)).map(e => e.textContent.trim().split(String.fromCharCode(10))[0].slice(0, 16));
    ok(els.length > 30 && !hit.length, '絵文字が残っている：' + hit.slice(0, 5).join(' ／ '));
  });
  window.__step = '終了';
  await wait(800);
  return { checks, gas: window.__gas, alerts: window.__alerts, errs: window.__errs, settle: window.__settleNumbers };
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
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Asia/Tokyo' });   // the app runs on JST devices (local-date checks)
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
    const res = { checks: v.checks || [], gas: v.gas || [], alerts: v.alerts || [], settle: v.settle };
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
    if (process.env.SMOKE_VERBOSE) console.log(res.gas, res.alerts, JSON.stringify(res.settle));
    cleanup(0);
  } catch (e) {
    console.error('✗ 画面の実行テストを動かせませんでした：' + e.message);
    cleanup(1);
  }
})();
