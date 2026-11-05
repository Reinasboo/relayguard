// Preview the current reviewer script against the real deployed 402 endpoint.
import {chromium} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000},deviceScaleFactor:2});
  await page.route('**/review.js',async route=>route.fulfill({contentType:'application/javascript',body:await readFile('public/review.js','utf8')}));
  await page.goto('https://relayguard.vercel.app/review',{waitUntil:'domcontentloaded'});
  await page.locator('#inspect-x402').click();
  await page.waitForFunction(()=>document.querySelector('#x402-challenge').textContent.startsWith('HTTP 402 PAYMENT REQUIRED'));
  const text=await page.locator('#x402-challenge').innerText();
  if(!text.includes('— pay')||text.includes('â'))throw new Error('UTF-8 challenge display regression');
  await page.evaluate(()=>document.fonts.ready);
  await page.locator('#x402-challenge').screenshot({path:'output/hackathon/captures/x402-challenge.png'});
  await writeFile('output/hackathon/captures/challenge-preview.json',JSON.stringify({source:'https://relayguard.vercel.app/api/paid-resource',reviewerScript:'public/review.js',capture:'Current reviewer UI preview with deployed HTTP 402 response',capturedAt:new Date().toISOString(),text},null,2));
  const manifest=JSON.parse(await readFile('output/hackathon/captures/manifest.json','utf8'));
  const asset=manifest.assets.find(a=>a.id==='x402-challenge');
  Object.assign(asset,{uiSource:'public/review.js (UTF-8 fix)',state:'Mezo Testnet / current UI preview',dataSource:'https://relayguard.vercel.app/api/paid-resource',capturedAt:new Date().toISOString()});
  await writeFile('output/hackathon/captures/manifest.json',JSON.stringify(manifest,null,2));
  console.log('Real 402 response displays UTF-8 correctly.');
}finally{await browser.close();}
