import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {mkdir,writeFile,copyFile} from 'node:fs/promises';
import QRCode from 'qrcode';
const out='output/hackathon/captures';
await mkdir(out,{recursive:true});
const server=spawn(process.execPath,['scripts/review-server.mjs'],{env:{...process.env,PORT:'4180'},stdio:'ignore'});
const origin='http://127.0.0.1:4180';
const deployed='https://relayguard.vercel.app';
const merchant='0x840E5bBF20D725f581752f8A4021ADd730550d47';
const token='0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
const hash='0x875fcecd46badf138205c83d048e7163b9fed5d7c810ef46c5e14ba52d655868';
let browser;
const manifest=[];
try {
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/review')).ok)break;}catch{} await new Promise(r=>setTimeout(r,250));}
  browser=await chromium.launch({channel:'chrome',headless:true});
  const evidenceResponse=await fetch(deployed+'/api/mezo/evidence',{signal:AbortSignal.timeout(55000)}).catch(()=>null);
  const evidence=evidenceResponse?.ok?await evidenceResponse.json():null;
  if(evidence)await writeFile(out+'/live-evidence.json',JSON.stringify(evidence,null,2));
  const publicHealth=await fetch(deployed+'/api/health/console',{signal:AbortSignal.timeout(45000)}).then(r=>r.ok?r.json():null).catch(()=>null);
  if(publicHealth)await writeFile(out+'/live-health.json',JSON.stringify(publicHealth,null,2));
  const challenge=await fetch(deployed+'/api/paid-resource',{signal:AbortSignal.timeout(30000)}).then(async r=>({status:r.status,paymentRequired:r.headers.get('payment-required')})).catch(()=>null);
  if(challenge)await writeFile(out+'/live-x402.json',JSON.stringify(challenge,null,2));
  const contexts=[];
  async function pageFor(name,{mobile=false,fixtures=false,live=false}={}){
    const c=await browser.newContext({viewport:mobile?{width:430,height:920}:{width:1440,height:1000},deviceScaleFactor:2,recordVideo:{dir:out+'/recordings',size:mobile?{width:430,height:920}:{width:1440,height:1000}}});contexts.push(c);
    const p=await c.newPage();
    if(fixtures){
      await p.addInitScript(()=>localStorage.setItem('relayguard.authSession',JSON.stringify({access_token:'demo-account',expires_at:Math.floor(Date.now()/1000)+3600})));
      await p.route('**/api/**',async route=>{
        const path=new URL(route.request().url()).pathname;
        const invoice={id:'demo-invoice',merchantName:'RelayGuard Demo',merchantAddress:merchant,amountAtomic:'1000000000000000000',description:'Digital access pass',status:'open',createdAt:Date.now(),expiresAt:Date.now()+86400000};
        let json;
        if(path==='/api/config')json={supabase:{url:'https://demo.invalid',publishableKey:'demo'},x402:{enabled:true,price:'$0.001',endpoint:'/api/paid-resource'}};
        else if(path==='/api/merchant')json={name:'RelayGuard Demo',address:merchant,walletVerified:true,tokenAddress:token};
        else if(path==='/api/invoices'&&route.request().method()==='POST')json={invoice,checkoutUrl:deployed+'/pay/demo-invoice',qrUrl:origin+'/api/invoices/demo-invoice/qr'};
        else if(path==='/api/invoices')json={invoices:[{...invoice,status:'paid',transactionReference:hash},{...invoice,id:'demo-open',description:'API access subscription',amountAtomic:'12000000000000000000',status:'open'}]};
        else if(path==='/api/invoices/demo-invoice')json={invoice};
        else if(path.endsWith('/qr')){await route.fulfill({contentType:'image/png',body:await QRCode.toBuffer(deployed+'/pay/demo-invoice')});return;}
        else if(path==='/api/merchant/x402/resources')json={resources:[{id:'demo-resource',name:'Market data API',method:'GET',routePath:'/api/market-data',price:'$0.01',keyPrefix:'demo',keyRevokedAt:null}]};
        else if(path==='/api/session')json={authenticated:true,operator:false};
        else {await route.fulfill({status:403,json:{error:'Demo account'}});return;}
        await route.fulfill({json});
      });
    }
    p.on('pageerror',err=>{throw err;});
    async function snap(id,selector){await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(400);if(selector)await p.locator(selector).screenshot({path:`${out}/${id}.png`});else await p.screenshot({path:`${out}/${id}.png`});manifest.push({id,path:`${out}/${id}.png`,source:live?deployed:origin,state:fixtures?'Demo account': 'Mezo Testnet',commit:'f74c1a4'});}
    return {p,c,snap,async finish(){const video=p.video();await c.close();await video.saveAs(`${out}/${name}.webm`);}};
  }
  // Deployed product: full hero, exact current design.
  let shot=await pageFor('overview-motion',{live:true});
  await shot.p.goto(deployed+'/review',{waitUntil:'domcontentloaded'});await shot.p.locator('#decision-title').filter({hasText:'Within spending policy'}).waitFor();
  await shot.snap('overview');await shot.p.waitForTimeout(2500);await shot.finish();
  // Merchant interaction. Browser route fixtures keep this capture read-only.
  shot=await pageFor('invoice-motion',{fixtures:true});await shot.p.goto(origin+'/#merchant');await shot.p.locator('#merchant-name').filter({hasText:'RelayGuard Demo'}).waitFor();
  await shot.snap('merchant');await shot.p.locator('.merchant-grid').scrollIntoViewIfNeeded();await shot.p.waitForTimeout(1000);
  await shot.p.locator('#invoice-description').fill('Digital access pass');await shot.p.locator('#invoice-amount').fill('1.00');await shot.p.waitForTimeout(800);await shot.snap('invoice','.merchant-grid');
  await shot.p.locator('#invoice-button').click();await shot.p.locator('#created-invoice img').waitFor();await shot.p.waitForTimeout(1400);await shot.snap('invoice-created','.create-invoice-panel');await shot.p.waitForTimeout(1200);await shot.finish();
  shot=await pageFor('checkout-motion',{fixtures:true,mobile:true});await shot.p.goto(origin+'/pay/demo-invoice');await shot.p.locator('#checkout-content').waitFor();await shot.p.locator('#checkout-qr').waitFor();await shot.snap('checkout');await shot.p.waitForTimeout(3500);await shot.finish();
  shot=await pageFor('api-motion',{fixtures:true});await shot.p.goto(origin+'/#merchant');await shot.p.locator('.merchant-x402>summary').click();await shot.p.locator('.merchant-x402').scrollIntoViewIfNeeded();await shot.p.locator('#x402-resource-name').fill('Market data API');await shot.p.locator('#x402-resource-path').fill('/api/market-data');await shot.p.locator('#x402-resource-price').fill('0.01');await shot.p.waitForTimeout(1200);await shot.snap('api','.merchant-x402');await shot.p.waitForTimeout(1800);await shot.finish();
  // Real public treasury snapshot. No simulated balances or protocol health.
  shot=await pageFor('treasury-motion',{live:true});await shot.p.goto(deployed+'/#console');
  await shot.p.waitForFunction(()=>!['READING','CHECKING'].includes(document.getElementById('network-status').textContent),null,{timeout:55000});
  await shot.p.locator('.stats').scrollIntoViewIfNeeded();await shot.snap('treasury');await shot.p.waitForTimeout(1500);await shot.finish();
  shot=await pageFor('policy-motion',{live:true});await shot.p.goto(deployed+'/review');await shot.p.locator('#decision-title').filter({hasText:'Within spending policy'}).waitFor();await shot.p.locator('#policy').scrollIntoViewIfNeeded();await shot.p.waitForTimeout(800);
  for(const [scenario,title]of [['review','Human approval required'],['blocked','Payment blocked'],['unavailable','MUSD spending paused'],['healthy','Within spending policy']]){await shot.p.locator(`[data-scenario=${scenario}]`).click();await shot.p.getByText(title,{exact:true}).waitFor();await shot.snap('policy-'+scenario,'#policy');await shot.p.waitForTimeout(1600);}
  await shot.finish();
  shot=await pageFor('evidence-motion',{live:true});await shot.p.goto(deployed+'/review');await shot.p.locator('#proof').scrollIntoViewIfNeeded();await shot.p.waitForFunction(()=>!document.getElementById('refresh-evidence').disabled,null,{timeout:55000});await shot.snap('evidence','#proof');
  await shot.p.locator('#inspect-x402').click();await shot.p.locator('#x402-challenge').filter({hasText:'HTTP 402'}).waitFor({timeout:30000});await shot.snap('x402-challenge','#x402-challenge');await shot.p.waitForTimeout(2000);await shot.finish();
  await writeFile(out+'/manifest.json',JSON.stringify({capturedAt:new Date().toISOString(),assets:manifest,evidence},null,2));
  console.log('Captured deployed product and demo account interactions.');
}finally{await browser?.close();server.kill();}
