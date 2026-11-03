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
