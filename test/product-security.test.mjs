import assert from 'node:assert/strict';
import {once} from 'node:events';
import {request} from 'node:http';
import test from 'node:test';
import {mkdtempSync, readdirSync, unlinkSync, rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeAbiParameters} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {CheckoutService} from '../dist/src/core/checkout.js';
import {PostgresCheckoutService} from '../dist/src/core/postgres.js';
import pg from 'pg';

test('Postgres certificate and hostname checks cannot be disabled by connection URL flags',async()=>{
  for(const options of ['ssl=0','sslmode=no-verify','sslmode=require&uselibpqcompat=true']){
    const store=new PostgresCheckoutService('postgresql://test:test@db.example.test/db?'+options);
    const client=new pg.Client(store.pool.options);
    assert.equal(client.ssl.rejectUnauthorized,true);
    assert.equal(client.ssl.checkServerIdentity,undefined);
    await store.close();
  }
});

test('abuse counters enforce a window and retain state independently of a request handler',()=>{
  const store=new CheckoutService(':memory:');
  try{
    assert.equal(store.consumeRequestLimit('wallet:a',2,60000,1000).allowed,true);
    assert.equal(store.consumeRequestLimit('wallet:a',2,60000,2000).allowed,true);
    assert.deepEqual(store.consumeRequestLimit('wallet:a',2,60000,3000),{allowed:false,retryAfterSeconds:57});
    assert.equal(store.consumeRequestLimit('wallet:b',2,60000,3000).allowed,true);
    assert.equal(store.consumeRequestLimit('wallet:a',2,60000,60000).allowed,true);
  }finally{store.close();}
});

test('request limits are shared by independent store connections',()=>{
  const directory=mkdtempSync(join(tmpdir(),'relayguard-limits-'));
  const a=new CheckoutService(join(directory,'checkout.sqlite'));
  const b=new CheckoutService(join(directory,'checkout.sqlite'));
  try{
    assert.equal(a.consumeRequestLimit('wallet:shared',1,60000,1000).allowed,true);
    assert.equal(b.consumeRequestLimit('wallet:shared',1,60000,2000).allowed,false);
  }finally{
    a.close();b.close();
    for(const file of readdirSync(directory))unlinkSync(join(directory,file));
    rmdirSync(directory);
  }
});

test('the same EVM transaction cannot pay two invoices through different hex casing',()=>{
  const store=new CheckoutService(':memory:');
  try {
    const input={merchantUserId:'seller',merchantName:'Seller',merchantAddress:'0x'+'1'.repeat(40),amountAtomic:'1',description:'Order',now:1000,expiresAt:5000};
    const a=store.create(input),b=store.create(input);
    store.authorize(a.id,'a',1100);store.authorize(b.id,'b',1100);
    store.submit(a.id,'a','0x'+'ab'.repeat(32),1200);
    assert.throws(()=>store.submit(b.id,'b','0x'+'AB'.repeat(32),1200));
    assert.equal(store.get(b.id,1200).status,'authorized');
  }finally{store.close();}
});

test('merchant invoice lists expire unpaid orders without requiring a customer visit',()=>{
  const store=new CheckoutService(':memory:');
  try{
    const invoice=store.create({merchantUserId:'seller',merchantName:'Seller',merchantAddress:'0x'+'1'.repeat(40),amountAtomic:'1',description:'Order',now:1000,expiresAt:2000});
    assert.equal(store.list('seller')[0].status,'expired');
    assert.equal(store.get(invoice.id).status,'expired');
  }finally{store.close();}
});

test('HTTP security and product boundaries',async t=>{
  const payer=privateKeyToAccount('0x'+'1'.repeat(64));
  const token='0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503';
  Object.assign(process.env,{NODE_ENV:'test',RELAYGUARD_NO_LISTEN:'true',RELAYGUARD_DATABASE_PATH:':memory:',
    MEZO_PRIVATE_KEY:'0x'+'1'.repeat(64),MEZO_NETWORK:'testnet',MEZO_TOKEN_ADDRESS:token,MEZO_SIGNER_ADDRESS:payer.address,
    MEZO_ALLOWED_RECIPIENTS:payer.address,MEZO_MERCHANT_ADDRESS:payer.address,
    SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'fixture',
    X402_ENABLED:'true',X402_PAY_TO:payer.address,X402_FACILITATOR_URL:'https://facilitator.invalid',
    MEZO_RPC_URL:'https://rpc.invalid/private-credential',VERCEL_URL:'configured-preview.vercel.app'});
  delete process.env.DATABASE_URL;delete process.env.VERCEL;delete process.env.RELAYGUARD_REVIEW_ONLY;
  const originalFetch=globalThis.fetch;
  let transactionAmount=10n**18n,transactionOverride={},transactionUnavailable=false;
  let receipt=null,failHealth=false,blockTime=Math.floor(Date.now()/1000);
  globalThis.fetch=async(input,init)=>{
    const url=String(input);
    if(url.startsWith('https://facilitator.invalid'))return Response.json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:31611'}]});
    if(url.startsWith('https://auth.invalid'))return Response.json({id:'seller',aud:'authenticated',role:'authenticated'});
    if(url.startsWith('https://rpc.invalid')){
      if(failHealth)throw new Error('RPC failed: https://rpc.invalid/private-credential');
      const handle=r=>{
        let result;
        if(r.method==='eth_call')result=r.params[0].data.startsWith('0x95d89b41')?encodeAbiParameters([{type:'string'}],['MUSD']):encodeAbiParameters([{type:'uint256'}],[r.params[0].data.startsWith('0x313ce567')?18n:10000n*10n**18n]);
        else if(r.method==='eth_getTransactionByHash')result=transactionUnavailable?null:{
          hash:r.params[0],from:payer.address,to:token,
          input:'0xa9059cbb'+payer.address.slice(2).toLowerCase().padStart(64,'0')+transactionAmount.toString(16).padStart(64,'0'),
          value:'0x0',gas:'0x10000',nonce:'0x0',type:'0x2',blockHash:null,blockNumber:null,transactionIndex:null,...transactionOverride};
        else if(r.method==='eth_getTransactionReceipt')result=receipt;
        else if(r.method==='eth_getBlockByHash')result={hash:'0x'+'b'.repeat(64),number:'0x1',timestamp:'0x'+blockTime.toString(16),transactions:[]};
        else if(r.method==='eth_chainId')result='0x7b7b';
        else if(r.method==='eth_blockNumber')result='0x1';
        else throw new Error('Unexpected RPC '+r.method);
        return {jsonrpc:'2.0',id:r.id,result};
      };
      const body=JSON.parse(init.body);return Response.json(Array.isArray(body)?body.map(handle):handle(body));
    }
    return originalFetch(input,init);
  };
  const {default:app}=await import('../dist/src/server.js');
  process.env.VERCEL='1';
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(async()=>{globalThis.fetch=originalFetch;delete process.env.VERCEL;await new Promise(r=>server.close(r));});
  const base=`http://127.0.0.1:${server.address().port}`;
  async function call(path,body,headers={}){
    const res=await originalFetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'content-type':'application/json'}),...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
    return {status:res.status,headers:res.headers,body:await res.json()};
  }
  await t.test('the paid endpoint remains protected through canonical and rewritten routes',async()=>{
    for(const path of ['/api/paid-resource','/api/config?__relayguard_path=/api/paid-resource']){
      const res=await call(path);assert.equal(res.status,402);assert.ok(res.headers.get('payment-required'));
    }
  });
  await t.test('nested routed paths cannot bypass payment middleware',async()=>{
    const path='/api/config?__relayguard_path='+encodeURIComponent('/api/config?__relayguard_path=/api/paid-resource');
    assert.equal((await call(path)).status,400);
  });
  await t.test('unconfigured Vercel hosts and cross-origin paid requests are rejected before payment',async()=>{
    const withHost=host=>new Promise((resolve,reject)=>{
      const req=request(base+'/api/config',{headers:{host}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
      req.on('error',reject);req.end();
    });
    assert.equal(await withHost('attacker.vercel.app'),403);
    assert.equal(await withHost('configured-preview.vercel.app'),200);
    assert.equal((await call('/api/paid-resource',undefined,{origin:'https://attacker.invalid'})).status,403);
  });
  await t.test('oversized JSON is rejected with an actionable status',async()=>{
    assert.equal((await call('/api/mezo/policy-preview',{scenario:'healthy',padding:'x'.repeat(17000)})).status,413);
  });
  await t.test('internal RPC errors do not expose private endpoint credentials',async()=>{
    failHealth=true;
    const res=await call('/api/health');failHealth=false;
    assert.ok(res.status>=500);assert.ok(!JSON.stringify(res.body).includes('private-credential'));
  });
  const auth={authorization:'Bearer seller'};
  const proof=(await call('/api/merchant/wallet/challenge',{address:payer.address},auth)).body;
  assert.equal((await call('/api/merchant/wallet/verify',{challengeId:proof.challengeId,signature:await payer.signMessage({message:proof.message})},auth)).status,200);
  async function order(amount='1'){
    const created=await call('/api/invoices',{amount,description:'Digital order'},auth);assert.equal(created.status,201);
    const invoice=created.body.invoice;
    const c=(await call(`/api/invoices/${invoice.id}/challenge`,{payerAddress:payer.address})).body;
    const authorization=await call(`/api/invoices/${invoice.id}/authorize`,{payerAddress:payer.address,challenge:c.challenge,signature:await payer.signMessage({message:c.message})});
    return {invoice,...authorization};
  }
  await t.test('a merchant order above the treasury cap can be paid from the buyer wallet',async()=>{
    const result=await order('50');assert.equal(result.status,200);assert.equal(result.body.authorization.status,'authorized');
  });
  await t.test('values outside the ERC-20 uint256 range cannot become unpayable invoices',async()=>{
    assert.equal((await call('/api/invoices',{amount:(2n**256n).toString(),description:'Overflow'},auth)).status,400);
  });
  async function submit(result,letter){
    const hash='0x'+letter.repeat(64);
    transactionAmount=BigInt(result.invoice.amountAtomic);
    const res=await call(`/api/invoices/${result.invoice.id}/submit`,{authorizationId:result.body.authorization.id,checkoutToken:result.body.checkoutToken,transactionHash:hash});
    assert.equal(res.status,200);
    const topic=a=>'0x'+a.slice(2).toLowerCase().padStart(64,'0');
    receipt={transactionHash:hash,transactionIndex:'0x0',blockHash:'0x'+'b'.repeat(64),blockNumber:'0x1',from:payer.address,to:token,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',contractAddress:null,logsBloom:'0x'+'00'.repeat(256),status:'0x1',effectiveGasPrice:'0x1',type:'0x2',logs:[{address:token,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',topic(payer.address),topic(payer.address)],data:'0x'+BigInt(result.invoice.amountAtomic).toString(16).padStart(64,'0'),blockHash:'0x'+'b'.repeat(64),blockNumber:'0x1',transactionHash:hash,transactionIndex:'0x0',logIndex:'0x0',removed:false}]};
  }
  await t.test('unrelated transaction hashes cannot be claimed and network visibility can recover',async()=>{
    const result=await order();
    const path=`/api/invoices/${result.invoice.id}/submit`;
    const body={authorizationId:result.body.authorization.id,checkoutToken:result.body.checkoutToken,transactionHash:'0x'+'d'.repeat(64)};
    transactionAmount=BigInt(result.invoice.amountAtomic);
    for(const override of [{from:'0x'+'2'.repeat(40)},{to:payer.address},{value:'0x1'},{input:'0xa9059cbb'+'0'.repeat(128)}]){
      transactionOverride=override;
      assert.equal((await call(path,body)).status,409);
    }
    transactionOverride={};transactionUnavailable=true;
    const delayed=await call(path,body);
    assert.equal(delayed.status,503);assert.equal(delayed.headers.get('retry-after'),'2');
    transactionUnavailable=false;
    assert.equal((await call(path,body)).status,200);
  });
  await t.test('an old transfer cannot fulfil a newly authorized order',async()=>{
    const result=await order();assert.equal(result.status,200);await submit(result,'a');
    blockTime=Math.floor(Date.now()/1000)-3600;
    const res=await call(`/api/invoices/${result.invoice.id}/verify`,{});
    assert.equal(res.body.invoice.status,'failed');
  });
  await t.test('a matching new transfer can fulfil its order',async()=>{
    const result=await order();assert.equal(result.status,200);await submit(result,'c');
    blockTime=Math.floor(Date.now()/1000)+1;
    const res=await call(`/api/invoices/${result.invoice.id}/verify`,{});
    assert.equal(res.body.invoice.status,'paid');
  });
  await t.test('expired reservations refuse new signatures while retaining broadcast recovery',async()=>{
    const result=await order();
    const originalNow=Date.now;
    try{
      Date.now=()=>result.invoice.expiresAt+1000;
      assert.equal((await call(`/api/invoices/${result.invoice.id}/challenge`,{payerAddress:payer.address})).status,409);
      assert.equal((await call(`/api/invoices/${result.invoice.id}/authorize`,{payerAddress:payer.address})).status,409);
      await submit(result,'e');
    }finally{Date.now=originalNow;}
  });
  await t.test('RPC throttling returns retry guidance before exhausting upstream services',async()=>{
    let limited;
    for(let i=0;i<125;i++){
      const res=await call('/api/health');
      if(res.status===429){limited=res;break;}
    }
    assert.ok(limited);assert.ok(Number(limited.headers.get('retry-after'))>0);
  });
});
