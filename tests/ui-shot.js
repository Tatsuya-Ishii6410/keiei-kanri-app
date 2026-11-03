// UI改修の前後の比較（開発用の道具。npm test には含まれない。docs/ui-revamp.md）
// 見本のデータで、ヘッドレスの Chrome（使い捨てのプロフィール）でアプリを開く。本番サイト・ログイン済みの Chrome・GAS には触らない。
//   撮影：node tests/ui-shot.js shot <名前> <出力先フォルダ> [アプリのHTML]
//     → <名前>-375.png・<名前>-1440.png・<名前>.json（部分の縦の長さ・横スクロール・表示された金額の一覧）
//   比較：node tests/ui-shot.js combine <出力.png> <前の名前> <後の名前> <出力先フォルダ>
//     → 前後×375/1440 を1枚（幅800px）にまとめ、金額の一覧の食い違いを出す
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');
const ROOT = path.join(__dirname, '..');

function findChrome() {
  return [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium']
    .find(p => p && fs.existsSync(p));
}
function startServer(app) {
  const srv = http.createServer((req, res) => {
    const u = decodeURIComponent(req.url.split('?')[0]);
    const file = u === '/' ? app : path.join(ROOT, path.normalize(u).replace(/^([/\\])+/, ''));
    fs.readFile(file, (err, buf) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200); res.end(buf); });
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv)));
}
function cdpClient(wsUrl) {
  const ws = new WebSocket(wsUrl); let id = 0; const pending = new Map();
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  return new Promise((resolve, reject) => {
    ws.onerror = () => reject(new Error('DevTools に接続できません'));
    ws.onopen = () => resolve({ send: (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); }), close: () => ws.close() });
  });
}
async function withChrome(fn) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-shot-'));
  const proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', '--user-data-dir=' + profile, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const ws = await new Promise((res, rej) => { let b = ''; proc.stderr.on('data', d => { b += d; const m = b.match(/DevTools listening on (ws:\/\/\S+)/); if (m) res(m[1]); }); proc.on('exit', c => rej(new Error('Chrome が終了（' + c + '）'))); });
    const list = await (await fetch(`http://127.0.0.1:${new URL(ws).port}/json/list`)).json();
    const cdp = await cdpClient(list.find(t => t.type === 'page').webSocketDebuggerUrl);
    await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
    try { return await fn(cdp); } finally { cdp.close(); }
  } finally { proc.kill(); setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} }, 500); }
}
const evalJs = async (cdp, expression) => { const r = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception ? r.exceptionDetails.exception.description : r.exceptionDetails.text); return r.result.value; };
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---- 見本のデータ（日付は今月を基準。毎回同じ形） ----
const PRELUDE = String.raw`(() => {
  const pad = n => String(n).padStart(2, '0');
  const now = new Date(), y = now.getFullYear(), m = now.getMonth();
  const ym = (k) => { const d = new Date(y, m + k, 1); return d.getFullYear() + '-' + pad(d.getMonth() + 1); };
  const d = (k, day) => ym(k) + '-' + pad(day);
  try { localStorage.clear(); localStorage.setItem('bizapp_session_v1', JSON.stringify({ expires: Date.now() + 86400000 })); } catch (e) {}
  window.alert = () => {}; window.confirm = () => true; window.prompt = () => ''; window.open = () => null;
  let id = 100; const L = (o) => Object.assign({ id: ++id, status: 'actual' }, o);
  const ledger = [
    L({ date: d(0, 1), type: '売上', desc: '株式会社テスト商事 10月分', amount: 330000 }),
    L({ date: d(0, 2), type: '役員報酬', desc: '役員報酬', amount: 250000 }),
    L({ date: d(0, 3), type: '消耗品費', desc: '文具・コピー用紙', amount: 3300, memo: '事務用品' }),
    L({ date: d(0, 5), type: '交際費', desc: '会食', amount: 18800, withWhom: 'A社 山田様', purpose: '打ち合わせ', persons: 3 }),
    L({ date: d(0, 6), type: '通信費', desc: '携帯電話', amount: 7480, fixedCostId: 1 }),
    L({ date: d(0, 8), type: '外注費', desc: 'デザイン制作（株式会社サンプル）', amount: 88000 }),
    L({ date: d(0, 10), type: '租税公課', desc: '源泉所得税', amount: 32000 }),
    L({ date: d(0, 12), type: '交通費', desc: '青野ヶ原駅→三宮駅（電車）', amount: 560, visit: 'A社', purpose: '商談' }),
    L({ date: d(0, 15), type: '支払手数料', desc: '振込手数料', amount: 440 }),
    L({ date: d(0, 18), type: '地代家賃', desc: '事務所家賃', amount: 66000, fixedCostId: 2 }),
    L({ date: d(0, 20), expectedDate: d(0, 20), type: '売上', desc: '株式会社サンプル 入金予定', amount: 132000, status: 'planned_in' }),
    L({ date: d(0, 25), expectedDate: d(0, 25), type: '外注費', desc: '外注費 支払予定', amount: 55000, status: 'planned_out' }),
    L({ date: d(0, 27), expectedDate: d(0, 27), type: '売上', desc: '株式会社テスト商事 11月分', amount: 330000, status: 'planned_in' }),
    L({ date: d(0, 28), expectedDate: d(0, 28), type: '地代家賃', desc: '駐車場代 支払予定', amount: 15000, status: 'planned_out' }),
    L({ date: d(-1, 10), type: '消耗品費', desc: '前月の文具', amount: 1100 }),
    L({ date: d(-1, 25), type: '売上', desc: '前月の入金', amount: 220000 }),
  ];
  // 交通費（実績・CFの実績からは除外。翌月25日に精算）：同じ日に複数・要編集（到着なし／0円）・往復・前月分を含む
  const T = (day, desc, amount, visit, purpose, k = 0, memo) => L({ date: d(k, day), type: '交通費', desc, amount, visit, purpose, memo });
  ledger.push(
    T(4, '青野ヶ原駅→三宮駅（電車）', 560, 'A社', '商談'),
    T(4, '三宮駅→青野ヶ原駅（電車）', 560, 'A社', '商談'),
    T(9, '青野ヶ原駅→大阪駅（電車）往復', 2420, '株式会社テスト商事', '定例会議', 0, '乗換1回'),
    T(13, '小野市役所前→社町駅（バス）', 380, '合同会社みほん', '提案'),
    T(19, 'カレンダー：打ち合わせ', 0, 'B社', '打ち合わせ'),
    T(21, '青野ヶ原駅→（電車）', 0, '株式会社サンプル', '納品'),
    T(26, '自宅→加古川（車）往復', 1480, '株式会社サンプル', '現地調査', 0, 'ガソリン代'),
    T(28, '青野ヶ原駅→三宮駅（電車）往復', 1120, 'A社', '契約'),
    T(15, '青野ヶ原駅→三宮駅（電車）往復', 1120, 'A社', '商談', -1));
  const plan = Array.from({ length: 12 }, () => ({ sales: 0, expense: 0, labor: 0, tax: 0 }));
  plan[m] = { sales: 600000, expense: 200000, labor: 250000, tax: 0 };   // 税金・公課は計画ゼロ（ゼロ除算の確認）
  const SEED = {
    projects: [
      { id: 1, name: '営業支援', client: '株式会社テスト商事', status: '進行中', contract: 'monthly', amount: 300000, start: ym(-3), end: ym(6), invoiceStatus: 'uninvoiced' },
      { id: 2, name: '単発の制作', client: '株式会社サンプル', status: '完了', contract: 'single', amount: 120000, start: ym(-1), end: ym(-1), invoiceStatus: 'paid' },
      { id: 3, name: '新規の提案', client: '合同会社みほん', status: '商談中', contract: 'single', amount: 500000, start: ym(0), end: ym(0), invoiceStatus: 'uninvoiced' },
      { id: 4, name: '保守契約', client: '株式会社サンプル', status: '契約済', contract: 'monthly', amount: 50000, start: ym(0), end: '', invoiceStatus: 'uninvoiced' },
      { id: 5, name: '現地調査', client: '有限会社ためし', status: '進行中', contract: 'single', amount: 200000, start: ym(0), end: ym(0), invoiceStatus: 'uninvoiced' },
      { id: 6, name: '研修の企画', client: 'みほん工業株式会社', status: '契約済', contract: 'annual', amount: 1200000, start: ym(0), end: ym(11), invoiceStatus: 'uninvoiced' },
      { id: 7, name: '見送りの提案', client: '合同会社みほん', status: '失注', contract: 'single', amount: 80000, start: ym(0), end: ym(0), invoiceStatus: 'uninvoiced' },
      { id: 8, name: '旧サポート', client: '株式会社テスト商事', status: '完了', contract: 'monthly', amount: 40000, start: ym(-4), end: ym(-1), invoiceStatus: 'uninvoiced' },
    ],
    // 先月分は請求済・未入金（繰越の印）。現地調査は今月分を請求済（入金確認のボタン）
    monthlyBillings: [
      { id: 3, projectId: 8, billingMonth: ym(-1), amount: 40000, invoiceStatus: 'invoiced', invoiceId: null, paidDate: null, paidAmount: null, expectedPayDate: d(0, 10), note: '' },
      { id: 1, projectId: 1, billingMonth: ym(-1), amount: 300000, invoiceStatus: 'invoiced', invoiceId: null, paidDate: null, paidAmount: null, expectedPayDate: d(0, 25), note: '' },
      { id: 2, projectId: 5, billingMonth: ym(0), amount: 200000, invoiceStatus: 'invoiced', invoiceId: null, paidDate: null, paidAmount: null, expectedPayDate: d(1, 10), note: '' },
    ],
    nextBillingId: 50,
    // 見積・請求：見積2件、請求は 発行済（期限超過）・発行済（訂正版）・下書き・取消・ドライブ同期 の5件（日付は今月）
    quotes: [
      { id: 'EST-1', type: '見積書', client: '株式会社テスト商事', subject: '営業支援 見積', date: d(0, 3), expire: d(1, 3), amount: 330000, items: [{ name: '営業支援', qty: 1, unit: 300000 }] },
      { id: 'EST-2', type: '見積書', client: '合同会社みほん', subject: '新規の提案', date: d(0, 8), expire: d(1, 8), amount: 550000, items: [{ name: '提案', qty: 1, unit: 500000 }] },
      { id: 'INV-1', type: '請求書', status: 'issued', client: '株式会社テスト商事', subject: '営業支援 10月分', date: d(0, 1), due: d(0, 2), amount: 330000, items: [{ name: '営業支援', qty: 1, unit: 300000 }] },
      { id: 'INV-2', type: '請求書', status: 'issued', revision: 2, history: [{ at: d(0, 5), reason: '金額の訂正', changes: [] }], client: '有限会社ためし', subject: '現地調査', date: d(0, 4), due: d(1, 28), amount: 220000, items: [{ name: '現地調査', qty: 1, unit: 200000 }] },
      { id: 'DRAFT-1', type: '請求書', status: 'draft', client: '株式会社サンプル', subject: '保守契約 11月分', date: d(0, 6), due: d(1, 30), amount: 55000, items: [{ name: '保守', qty: 1, unit: 50000 }] },
      { id: 'INV-3', type: '請求書', status: 'cancelled', cancelReason: '宛名の誤り', client: '株式会社サンプル', subject: '保守契約（取消）', date: d(0, 2), due: d(1, 30), amount: 55000, items: [{ name: '保守', qty: 1, unit: 50000 }] },
      { id: 'INV-4', type: '請求書', status: 'issued', source: 'drive_sync', client: 'みほん工業株式会社', subject: '研修の企画', date: d(0, 7), due: d(1, 31), amount: 110000, items: [] },
    ],
    ledger, plan, bankBalance: 1234567,
  };
  const reply = o => new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } });
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = String(input && input.url || input);
    if (/script\.google\.com/.test(url)) {
      let action = (url.match(/[?&]action=([^&]+)/) || [])[1];
      if (!action && init && init.body) { try { action = JSON.parse(init.body).action; } catch (e) {} }
      return reply(action === 'load' ? { ok: true, data: JSON.parse(JSON.stringify(SEED)) } : { ok: true });
    }
    if (/api\.anthropic\.com/.test(url)) throw new Error('API は呼ばない');
    return realFetch(input, init);
  };
})();`;

// ---- 画面ごとの開き方と、測る部分（無い部品は 0 として出す） ----
const PAGES = {
  ledger: {
    open: `showPage('ledger',[...document.querySelectorAll('.nav-btn')].find(b=>(b.getAttribute('onclick')||'').includes("'ledger'")));
      document.getElementById('ledger-month').value=String(new Date().getMonth());renderLedger();`,
    root: '#page-ledger',
    parts: { '明細': '#ledger-list-title', '計画対実績': '#plan-month-label', '資金状況': '#cf-balance', 'KPI': '#cf-actual-in', 'ヘッダー': '#ledger-month' },
    valueRoot: '#cf-pane-main',
  },
  travel: {
    open: `showPage('ledger',[...document.querySelectorAll('.nav-btn')].find(b=>(b.getAttribute('onclick')||'').includes("'ledger'")));
      switchCfTab('travel',document.querySelector('[onclick*="switchCfTab(\\'travel\\'"]'));
      document.getElementById('tl-month').value=String(new Date().getMonth());renderTravelLedger();`,
    root: '#page-ledger',
    parts: { '一覧': '#tl-list', '要約': '#tl-summary', 'ヘッダー': '#tl-month' },
    valueRoot: '#cf-pane-travel',
  },
  projects: {
    open: `showPage('projects',[...document.querySelectorAll('.nav-btn')].find(b=>(b.getAttribute('onclick')||'').includes("'projects'")));
      document.getElementById('project-month').value=String(new Date().getMonth());renderProjects();`,
    root: '#page-projects',
    parts: { '一覧': '#project-empty', '営業サマリー': '#project-total', 'ヘッダー': '#project-month' },
    valueRoot: '#pj-tab-list',
  },
};
// 見積・請求（請求書タブ。見積書タブは quotesEst）
PAGES.quotes = {
  open: `showPage('quotes',[...document.querySelectorAll('.nav-btn')].find(b=>(b.getAttribute('onclick')||'').includes("'quotes'")));
    document.getElementById('quote-month').value=String(new Date().getMonth());renderQuotes();
    switchQuoteTab('invoice',document.querySelectorAll('#page-quotes .tab-group .tab')[1]);`,
  root: '#page-quotes',
  parts: { '一覧': '#invoice-empty', '要約': '#invoice-hero', 'ヘッダー': '#quote-month' },
  valueRoot: '#q-invoice',
};
PAGES.quotesEst = Object.assign({}, PAGES.quotes, {
  open: PAGES.quotes.open.replace("switchQuoteTab('invoice',document.querySelectorAll('#page-quotes .tab-group .tab')[1]);", ''),
  parts: { '一覧': '#estimate-empty', '要約': '#estimate-hero', 'ヘッダー': '#quote-month' },
  valueRoot: '#q-estimate',
});
// 案件の行を1つ開いた状態（ステップ表示の確認用）
PAGES.projectsOpen = Object.assign({}, PAGES.projects, {
  open: PAGES.projects.open + `const r=document.querySelector('#project-cards .uc-row[data-project-id="1"]');if(r)r.open=true;`,
});
// 測る：その要素を含む一番近い .card（または .uc-hero / .metric-grid / .uc-kpis）の高さ
const MEASURE = (p) => `(() => {
  const P=${JSON.stringify(p)};
  const box=sel=>{const el=document.querySelector(sel);if(!el)return null;const c=el.closest('.card,.uc-hero,.metric-grid,.uc-kpis,.list-toolbar')||el;return c};
  const h={};for(const [k,sel] of Object.entries(P.parts)){const c=box(sel);h[k]=c&&c.offsetParent!==null?Math.round(c.getBoundingClientRect().height):0;}
  const root=document.querySelector(P.root);
  h['画面全体']=Math.round(root.getBoundingClientRect().height);
  const vr=document.querySelector(P.valueRoot);
  const amounts=(vr.textContent.match(/¥-?[0-9,]+/g)||[]).sort();
  const bal=document.getElementById('cf-balance');
  return {heights:h,hScroll:document.documentElement.scrollWidth>window.innerWidth,scrollWidth:document.documentElement.scrollWidth,
    amounts:[...new Set(amounts)],balanceInput:bal?bal.value:null,
    // 状態・件数の突き合わせ用：PCの表（tbody）の行の数と、行の中のバッジの文字の数え上げ
    rows:vr.querySelectorAll('tbody>tr').length,
    badges:[...vr.querySelectorAll('tbody .badge')].map(b=>b.textContent.trim()).reduce((a,t)=>(a[t]=(a[t]||0)+1,a),{})};
})()`;

async function shot(name, outDir, appFile, pageKey = 'ledger') {
  const P = PAGES[pageKey];
  const srv = await startServer(path.resolve(appFile || path.join(ROOT, 'keiei-kanri.html')));
  const result = {};
  try {
    await withChrome(async cdp => {
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*script.google.com*'] });
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: PRELUDE });
      for (const w of [375, 1440]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width: w, height: 900, deviceScaleFactor: 1, mobile: w < 800 });
        await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/` });
        await wait(2500);
        await evalJs(cdp, `(async()=>{for(let i=0;i<40&&!(S.ledger||[]).length;i++)await new Promise(r=>setTimeout(r,100));${P.open}})()`);
        await evalJs(cdp, "document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'))");
        await wait(600);
        result[w] = await evalJs(cdp, MEASURE(P));
        const r = await evalJs(cdp, `(()=>{const b=document.querySelector('${P.root}').getBoundingClientRect();return{x:0,y:Math.max(0,b.top+scrollY-60),w:innerWidth,h:Math.ceil(b.height+60)}})()`);
        const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } });
        fs.writeFileSync(path.join(outDir, `${name}-${w}.png`), Buffer.from(img.data, 'base64'));
      }
    });
  } finally { srv.close(); }
  fs.writeFileSync(path.join(outDir, name + '.json'), JSON.stringify(result, null, 1));
  return result;
}

// 前後×375/1440 を1枚に（幅800px：上段375の前後、下段1440の前後）
async function combine(outPng, before, after, dir) {
  const src = n => 'data:image/png;base64,' + fs.readFileSync(path.join(dir, n)).toString('base64');
  const cell = (label, n, w) => `<figure style="margin:0;width:${w}px"><figcaption style="font:12px sans-serif;padding:2px 0">${label}</figcaption><img src="${src(n)}" style="width:${w}px;display:block;border:1px solid #ccc"></figure>`;
  const html = `<body style="margin:0;padding:4px;background:#fff;width:792px">
    <div style="display:flex;gap:8px;align-items:flex-start">${cell('前 375px', before + '-375.png', 190)}${cell('後 375px', after + '-375.png', 190)}
    <div style="display:flex;flex-direction:column;gap:8px">${cell('前 1440px', before + '-1440.png', 390)}${cell('後 1440px', after + '-1440.png', 390)}</div></div></body>`;
  await withChrome(async cdp => {
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false });
    const { frameTree } = await cdp.send('Page.getFrameTree');
    await cdp.send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
    await wait(800);
    const h = await evalJs(cdp, 'Math.ceil(document.body.getBoundingClientRect().height)+8');
    const img = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 800, height: h, scale: 1 } });
    fs.writeFileSync(outPng, Buffer.from(img.data, 'base64'));
  });
  const a = JSON.parse(fs.readFileSync(path.join(dir, before + '.json'))), b = JSON.parse(fs.readFileSync(path.join(dir, after + '.json')));
  for (const w of ['375', '1440']) {
    const miss = a[w].amounts.filter(x => !b[w].amounts.includes(x)), add = b[w].amounts.filter(x => !a[w].amounts.includes(x));
    console.log(`${w}px 縦の長さ 前→後：` + Object.keys({ ...a[w].heights, ...b[w].heights }).map(k => `${k} ${a[w].heights[k] || 0}→${b[w].heights[k] || 0}`).join('・'));
    console.log(`  横スクロール 前 ${a[w].hScroll}・後 ${b[w].hScroll}／金額 ${a[w].amounts.length}種→${b[w].amounts.length}種、消えた ${miss.join(' ') || 'なし'}、増えた ${add.join(' ') || 'なし'}／残高の入力 ${a[w].balanceInput}→${b[w].balanceInput}`);
  }
}

if (require.main === module) {
  const [cmd, ...a] = process.argv.slice(2);
  (cmd === 'combine' ? combine(a[0], a[1], a[2], a[3]) : shot(a[0], a[1], a[2], a[3]))
    .then(r => { if (cmd !== 'combine') console.log(JSON.stringify(Object.fromEntries(Object.entries(r).map(([w, v]) => [w, v.heights])))); process.exit(0); })
    .catch(e => { console.error(e.message); process.exit(1); });
}
module.exports = { findChrome, startServer, withChrome, evalJs, wait, ROOT, PRELUDE, shot, combine };
