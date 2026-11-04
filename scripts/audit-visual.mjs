import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

const output = process.env.VISUAL_OUTPUT || 'output/visual-audit';
await mkdir(output, { recursive: true });
const server = spawn(process.execPath, ['scripts/review-server.mjs'], { env: { ...process.env, PORT: '4176' }, stdio: 'ignore' });
const origin = 'http://127.0.0.1:4176';
let browser;
try {
  for (let i=0;i<80;i++) {
    try { if ((await fetch(origin+'/review')).ok) break; } catch {}
    await new Promise(resolve=>setTimeout(resolve,250));
  }
  browser = await chromium.launch({ channel:'chrome', headless:true });
  const page = await browser.newPage();
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  const results=[];
  // Explicitly labelled browser fixtures expose forms and checkout states without
  // creating accounts, signing messages or broadcasting payments.
  let fixture = false;
  let signedIn = false;
  let invoiceStatus = 'open';
  await page.route('**/api/config', async route => {
    const response = await route.fetch(); const config = await response.json();
    if(fixture) config.supabase = { url:'https://visual-fixture.invalid', publishableKey:'visual-fixture' };
    await route.fulfill({json:config});
  });
  const merchantAddress = '0x840E5bBF20D725f581752f8A4021ADd730550d47';
  await page.route('**/api/merchant', route => fixture ? route.fulfill({json:{name:'Visual audit fixture',address:merchantAddress,tokenAddress:'0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503',walletVerified:signedIn}}) : route.continue());
  await page.route('**/api/invoices', route => fixture ? route.fulfill({json:{invoices:[]}}) : route.continue());
  await page.route('**/api/merchant/x402/resources', route => fixture ? route.fulfill({json:{resources:[]}}) : route.continue());
  await page.route('**/api/invoices/visual-fixture', route => route.fulfill({json:{invoice:{id:'visual-fixture',merchantName:'Visual audit fixture',merchantAddress,amountAtomic:'1000000000000000000',description:'Digital access pass · visual fixture',status:invoiceStatus,expiresAt:Date.now()+3600000}}}));
  for (const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:900});
    for (const [name,path] of [['merchant','/#merchant'],['faq','/#faq'],['treasury','/#console'],['review','/review'],['checkout-error','/pay/visual-missing']]) {
      await page.goto('about:blank');
      await page.goto(origin+path); await page.waitForTimeout(500);
      const state=await page.evaluate(()=>({
        fits:document.documentElement.scrollWidth<=innerWidth,
        overflow:[...document.querySelectorAll('body *')].filter(el=>el.getBoundingClientRect().width && el.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(el=>el.id||el.className),
        heading:[...document.querySelectorAll('h1,h2')].find(el=>el.getBoundingClientRect().height)?.textContent,
      }));
      results.push({name,width,...state});
      await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});
    }
    fixture = true;
    for (const [name,path] of [['account-form','/#merchant'],['checkout-open','/pay/visual-fixture'],['checkout-paid','/pay/visual-fixture'],['account-connected','/#merchant']]) {
      signedIn = name==='account-connected';
      await page.evaluate(signedIn => signedIn ? localStorage.setItem('relayguard.authSession',JSON.stringify({access_token:'visual-fixture',expires_at:Math.floor(Date.now()/1000)+3600})) : localStorage.removeItem('relayguard.authSession'), signedIn);
      invoiceStatus = name==='checkout-paid' ? 'paid' : 'open';
      await page.goto('about:blank'); await page.goto(origin+path); await page.waitForTimeout(500);
      const fits = await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
      results.push({name,width,fits,fixture:true});
      await page.screenshot({path:`${output}/${name}-${width}.png`,fullPage:true});
      if(signedIn) {
        const button = page.locator('#auth-signout'); await button.waitFor({state:'visible'});
        const box = await button.boundingBox(), settings = await page.locator('.merchant-wallet-settings').boundingBox();
        if(box.y+box.height>settings.y) throw new Error('Sign out overlaps receiving wallet settings');
      }
    }
    await page.evaluate(()=>localStorage.removeItem('relayguard.authSession'));
    signedIn = false;
    fixture = false;
  }
  await page.goto(origin+'/#merchant');
  await page.locator('.rail-link[data-view=faq]').click();
  await page.goBack(); await page.locator('#merchant-view').waitFor({state:'visible'});
  await page.goForward(); await page.locator('#faq-view').waitFor({state:'visible'});
  await page.goto(origin+'/review');
  await page.locator('#decision-title').filter({hasText:'Within spending policy'}).waitFor();
  await page.locator('#preview-amount').fill('invalid'); await page.locator('#run-policy').click();
  await page.locator('#decision-title').filter({hasText:'Check the input'}).waitFor();
  if(await page.locator('#policy-result').getAttribute('data-outcome')!=='error') throw new Error('Invalid policy input retained a successful decision');
  await page.goto('about:blank'); await page.goto(origin+'/review');
  await page.keyboard.press('Tab');
  await page.locator('.skip-link:focus').waitFor();
  await page.keyboard.press('Enter');
  if(await page.evaluate(()=>document.activeElement?.id)!=='main-content') throw new Error('Skip link did not focus main content');
  const font = await page.request.get(origin+'/fonts/manrope.ttf');
  if(!font.ok() || !font.headers()['content-type'].includes('font/ttf')) throw new Error('Local font is not served');
  await writeFile(`${output}/results.json`,JSON.stringify({results,errors},null,2));
  console.log(JSON.stringify({failures:results.filter(r=>!r.fits),errors},null,2));
  if(results.some(r=>!r.fits)||errors.length) process.exitCode=1;
} finally { await browser?.close(); server.kill(); }
