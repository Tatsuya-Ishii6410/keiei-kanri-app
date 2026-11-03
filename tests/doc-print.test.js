// 請求書・見積書の印刷（PDF）：ヘッドレスの Chrome で A4・倍率100%（@page の大きさ＝preferCSSPageSize）の PDF にして、ページ数を確かめる
//   ・明細3行の請求書（通常・月次の特記事項つき・月次＋契約期間と支払方法）と見積書は1ページ
//   ・明細25行の請求書は2ページ以上。行は途中で切らない・表の見出しはページごとに繰り返す・合計欄は最後だけ（CSS と構成で確かめる）
//   ・印刷では書類だけを出す（全画面のバー・アプリの画面は出さない）
// ネットのフォントは読み込まない（結果をネットに左右させない）。Chrome が無い環境では SKIP_BROWSER_TEST=1 で飛ばせる
const path = require('path');
const T = require('./ui-shot.js');

if (process.env.SKIP_BROWSER_TEST) { console.log('（SKIP_BROWSER_TEST のため、書類の印刷のテストを飛ばしました）'); process.exit(0); }

const SAMPLES = `(()=>{
  const it=n=>Array.from({length:n},(_,i)=>({name:'営業支援業務 '+(i+1)+'（10月分・訪問営業と資料作成）',qty:1,unit:100000+i*1000}));
  const base={client:'株式会社テスト商事',subject:'営業支援',date:'2026-11-01',due:'2026-11-30',expire:'2026-11-30',note:'お振込手数料は貴社にてご負担ください。'};
  const mk=(o)=>{const q=Object.assign({},base,o);q.amount=Math.round(q.items.reduce((a,x)=>a+x.qty*x.unit,0)*1.1);return q};
  return {
    '請求書（明細3行）':mk({id:'INV-202611-001',type:'請求書',status:'issued',items:it(3)}),
    '請求書（月次・特記事項）':mk({id:'INV-202611-005',type:'請求書',status:'issued',items:it(3),isMonthly:true}),
    '請求書（月次・契約期間・支払方法）':mk({id:'INV-202611-002',type:'請求書',status:'issued',items:it(3),isMonthly:true,contractStart:'2026-10',contractEnd:'2027-03',paymentMethod:'銀行振込（月末締め翌月末払い）'}),
    '請求書（訂正版）':mk({id:'INV-202611-006',type:'請求書',status:'issued',revision:2,items:it(3),isMonthly:true}),
    '見積書（明細3行）':mk({id:'EST-202611-001',type:'見積書',items:it(3)}),
    '請求書（明細25行）':mk({id:'INV-202611-004',type:'請求書',status:'issued',items:it(25)}),
  };
})()`;

let passed = 0;
const fail = [];
const ok = (c, label) => { if (c) passed++; else fail.push(label); };

(async () => {
  const srv = await T.startServer(path.join(T.ROOT, 'keiei-kanri.html'));
  try {
    await T.withChrome(async cdp => {
      await cdp.send('Network.enable');
      await cdp.send('Network.setBlockedURLs', { urls: ['*fonts.googleapis.com*', '*fonts.gstatic.com*', '*script.google.com*'] });
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: T.PRELUDE });
      await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${srv.address().port}/` });
      await T.wait(2500);
      // 会社の情報（宛名・住所・登録番号・振込先）をすべて埋めて、いちばん長い形にする
      await T.evalJs(cdp, `(async()=>{for(let i=0;i<40&&!(S.ledger||[]).length;i++)await new Promise(r=>setTimeout(r,100));
        S.company=Object.assign({},S.company,{name:'アスリンク株式会社',rep:'石井 啓介',zip:'675-0000',addr:'兵庫県加古川市○○町1-2-3 ○○ビル4階',tel:'079-000-0000',email:'info@example.co.jp',invoice:'T1234567890123',
          bankName:'○○銀行',bankBranch:'加古川支店',accountType:'普通',accountNumber:'1234567',accountName:'アスリンク（カ'});
        document.querySelectorAll('.modal-overlay.open').forEach(m=>m.classList.remove('open'));})()`);
      const names = await T.evalJs(cdp, `Object.keys(${SAMPLES})`);
      for (const n of names) {
        const info = await T.evalJs(cdp, `(async()=>{currentQuoteData=(${SAMPLES})[${JSON.stringify(n)}];showPreviewModal();
          await document.fonts.ready;await new Promise(r=>setTimeout(r,300));
          const root=document.getElementById('dvw-sheet').shadowRoot,sheet=root.querySelector('.doc-sheet');
          const page=(document.getElementById('dvw-page')||{}).textContent||'';
          return{page,tfoot:!!sheet.querySelector('tfoot'),rowsAvoid:getComputedStyle(sheet.querySelector('tbody tr')).breakInside,
            headRepeat:getComputedStyle(sheet.querySelector('thead')).display,totals:(sheet.textContent.match(/合計金額（税込）|月額合計（税込）/g)||[]).length,
            keep:[...sheet.querySelectorAll('.doc-keep')].every(e=>getComputedStyle(e).breakInside==='avoid'),
            text:sheet.textContent}})()`);
        await cdp.send('Emulation.setEmulatedMedia', { media: 'print' });
        const shown = await T.evalJs(cdp, `(()=>{const vis=e=>e&&getComputedStyle(e).display!=='none';
          return{bar:vis(document.querySelector('.dvw-bar')),others:[...document.body.children].filter(e=>e.id!=='doc-viewer'&&vis(e)&&e.getBoundingClientRect().height>0).map(e=>e.id||e.className).slice(0,5),
            pad:getComputedStyle(document.getElementById('dvw-sheet').shadowRoot.querySelector('.doc-sheet')).paddingTop}})()`);
        await cdp.send('Emulation.setEmulatedMedia', { media: '' });
        const pdf = Buffer.from((await cdp.send('Page.printToPDF', { preferCSSPageSize: true, printBackground: true, scale: 1 })).data, 'base64');
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
        const many = /25行/.test(n);
        ok(many ? pages >= 2 : pages === 1, `${n}：ページ数 ${pages}（${many ? '2ページ以上' : '1ページ'}のはず）`);
        ok(/size:A4 portrait;margin:12mm/.test(info.page), `${n}：@page が A4・余白12mm でない（${info.page}）`);
        ok(!info.tfoot && info.totals === 1, `${n}：合計欄がページごとに繰り返される形（tfoot）か、合計が1つでない`);
        ok(info.rowsAvoid === 'avoid' && info.headRepeat === 'table-header-group' && info.keep, `${n}：行・枠の改ページ止め、表の見出しの繰り返しがない`);
        ok(/登録番号: T1234567890123/.test(info.text) && /【お振込先】/.test(info.text) && /備考:/.test(info.text), `${n}：登録番号・振込先・備考のどれかが無い`);
        ok(!shown.bar && !shown.others.length && shown.pad === '0px', `${n}：印刷に書類以外が出る、または本文の内側の余白が残る（${JSON.stringify(shown)}）`);
        console.log(`  ${n}：${pages}ページ`);
        await T.evalJs(cdp, 'closeDocViewer()');
      }
      // 交通費台帳のPDFなど、余白を指定しない書類は従来どおり用紙の余白0（書類の側で余白を持つ）
      const pg = await T.evalJs(cdp, `(()=>{openDocViewer({title:'台帳',html:'<div>x</div>'});const t=document.getElementById('dvw-page').textContent;closeDocViewer();return t})()`);
      ok(/margin:0\}/.test(pg), '余白を指定しない書類の @page が余白0でない：' + pg);
    });
  } finally { srv.close(); }
  if (fail.length) { fail.forEach(f => console.error('  ✗ ' + f)); console.error(`✗ 書類の印刷：${fail.length}件の失敗`); process.exit(1); }
  console.log(`${passed}件 成功（書類の印刷：A4・倍率100%）`);
})().catch(e => { console.error('✗ ' + (e && e.stack || e)); process.exit(1); });
