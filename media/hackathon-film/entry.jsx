import React from 'react';
import {AbsoluteFill, Composition, Sequence, Img, OffthreadVideo, interpolate, Easing, useCurrentFrame, registerRoot, staticFile} from 'remotion';
import timings from '../../output/hackathon/audio/timings.json';

const C={bg:'#0c1117',panel:'#111820',text:'#e8edf3',muted:'#a8b4c1',lime:'#b7f566',line:'#293744'};
const font='Manrope';
const clamp={extrapolateLeft:'clamp',extrapolateRight:'clamp'};
const Label=({children,style})=><div style={{color:C.lime,fontSize:20,fontWeight:600,letterSpacing:2,textTransform:'uppercase',...style}}>{children}</div>;
const Head=({children,style})=><div style={{fontSize:58,fontWeight:600,lineHeight:1.12,letterSpacing:-2,...style}}>{children}</div>;
const Copy=({children,style})=><div style={{fontSize:26,color:C.muted,lineHeight:1.45,...style}}>{children}</div>;
function Shot({name,style,fit='contain'}) {return <Img src={staticFile(name)} style={{width:'100%',height:'100%',objectFit:fit,...style}}/>;}
function Footage({name,seconds=6,offset=0,style}) {
  const f=useCurrentFrame();
  // Hold the last recorded frame rather than looping a completed interaction.
  const end=Math.floor(seconds*30)-1;
  return <div style={{width:'100%',height:'100%',overflow:'hidden',...style}}>
    {f<end?<OffthreadVideo muted src={staticFile(name)} trimBefore={Math.floor(offset*30)} style={{width:'100%',height:'100%',objectFit:'contain'}}/>:<Shot name={name.replace('-motion.webm','.png')}/>}
  </div>;
}
function Frame({children,x=600,y=170,w=1248,h=755}){return <div style={{position:'absolute',left:x,top:y,width:w,height:h,overflow:'hidden',border:`1px solid ${C.line}`,borderRadius:9,background:C.panel}}>{children}</div>;}
function Steps({items,top=480,width=450}){return <div style={{position:'absolute',left:72,top,width}}>{items.map((s,i)=><div key={s} style={{display:'flex',gap:20,marginBottom:32,paddingTop:20,borderTop:`1px solid ${C.line}`}}><span style={{fontSize:20,color:C.lime}}>0{i+1}</span><Copy style={{fontSize:24}}>{s}</Copy></div>)}</div>;}
function Scene({index}){
  const f=useCurrentFrame(); const intro=interpolate(f,[0,20],[0,1],{...clamp,easing:Easing.out(Easing.cubic)});
  const tx=interpolate(f,[0,24],[20,0],clamp);
  const common={position:'absolute',left:72,top:210,width:450,opacity:intro,transform:`translateY(${tx}px)`};
  return <AbsoluteFill style={{background:C.bg,color:C.text,fontFamily:font}}>
    <div style={{position:'absolute',left:72,top:44,display:'flex',alignItems:'center',gap:14}}><div style={{width:7,height:34,background:C.lime}}/><span style={{fontWeight:600,fontSize:29}}>RelayGuard</span></div>
    <div style={{position:'absolute',right:72,top:53,color:C.muted,fontSize:17,letterSpacing:1}}>MEZO / WAVE 2</div>
    <div style={{position:'absolute',left:72,right:72,top:111,height:1,background:C.line}}/>
    {index===0&&<>
      <div style={{...common,top:210,width:1040}}><Label>MUSD payments / Mezo</Label><Head style={{fontSize:94,marginTop:30,lineHeight:1.06}}>Sell in MUSD.<br/>Know what<br/>was paid.</Head><Copy style={{marginTop:35,width:760,fontSize:30}}>Merchant checkout and paid APIs<br/>with verifiable settlement.</Copy></div>
      <Frame x={1325} y={155} w={390} h={765}><Shot name="checkout.png"/></Frame>
      <div style={{position:'absolute',left:72,top:800,display:'flex',gap:16}}>{['Create','Pay','Verify'].map((s,i)=><div key={s} style={{opacity:interpolate(f,[25+i*28,43+i*28],[0,1],clamp),padding:'16px 24px',border:`1px solid ${C.line}`,fontSize:24,color:i===2?C.lime:C.text}}>{s}</div>)}</div>
    </>}
    {index===1&&<>
      <div style={common}><Label>01 / Merchant</Label><Head style={{marginTop:25}}>Create an<br/>invoice.</Head><Copy style={{marginTop:28}}>Set the price.<br/>Choose an expiry.<br/>Share the payment link.</Copy></div>
      <Steps top={650} items={['Verified receiving wallet','Funds paid directly to the merchant']}/>
      {f<220?<Frame x={570} y={150} w={1270} h={790}><Footage name="invoice-motion.webm" seconds={7.3} offset={2.2}/></Frame>:<>
        <Frame x={740} y={150} w={690} h={780}><Shot name="invoice-created.png"/></Frame>
        <div style={{position:'absolute',left:1500,top:340,width:340}}><Label>Exact amount</Label><Head style={{color:C.lime,marginTop:20,fontSize:70}}>1 MUSD</Head><Label style={{marginTop:80}}>Link expiry</Label><Head style={{marginTop:20,fontSize:43}}>24 hours</Head></div>
      </>}
    </>}
    {index===2&&<>
      <div style={{...common,width:680}}><Label>02 / Customer</Label><Head style={{marginTop:25,fontSize:73}}>Review first.<br/>Then authorize.</Head><Copy style={{marginTop:30,width:650}}>The amount, destination and network<br/>are visible before connecting a wallet.</Copy></div>
      <Steps width={650} top={625} items={['Ownership signature starts checkout','Separate confirmation sends MUSD']}/>
      <Frame x={1250} y={145} w={390} h={790}><Shot name="checkout.png"/></Frame>
    </>}
    {index===3&&<>
      <div style={{position:'absolute',left:72,top:155,opacity:intro}}><Label>03 / Settlement verification</Label><Head style={{marginTop:20,fontSize:62}}>A hash starts the check.</Head></div>
      <Frame x={72} y={335} w={1776} h={435}><Shot name="receipt-cards.png"/></Frame>
      <div style={{position:'absolute',top:810,left:72,display:'flex',gap:30}}>{['Receipt success','Canonical MUSD','Payer + recipient','Exact amount'].map((s,i)=><div key={s} style={{width:420,borderTop:`2px solid ${i<Math.floor(f/55)?C.lime:C.line}`,paddingTop:20,fontSize:25,color:i<Math.floor(f/55)?C.lime:C.muted}}>{s}</div>)}</div>
    </>}
    {index===4&&<>
      <div style={common}><Label>04 / Paid APIs</Label><Head style={{marginTop:25}}>Price an<br/>API route.</Head><Copy style={{marginTop:28}}>An HTTP 402 challenge begins the payment flow.</Copy></div>
      <Steps top={600} items={['Return payment requirements','Settle signed authorization','Release the API response']}/>
      {f<190?<Frame x={570} y={150} w={1270} h={790}><Footage name="api-motion.webm" seconds={5.2} offset={1.4}/></Frame>:<>
        <Label style={{position:'absolute',left:600,top:145,fontSize:17}}>Live reference endpoint / 0.001 MUSD</Label>
        <Frame x={600} y={185} w={1248} h={700}><Shot name="x402-challenge.png"/></Frame>
      </>}
    </>}
    {index===5&&<>
      <div style={{position:'absolute',left:72,top:150,opacity:intro}}><Label>05 / Mezo treasury policy</Label><Head style={{marginTop:20,fontSize:57}}>{f<90?'Mezo context informs permission.':f<330?'125%: human approval required.':f<425?'109%: spending blocked.':'Unavailable reads: authorization pauses.'}</Head></div>
      {f<90?<Frame x={72} y={340} w={1776} h={565}><Shot name="treasury-crop.png"/></Frame>:<Frame x={260} y={300} w={1400} h={620}><Shot name={f<330?'policy-review.png':f<425?'policy-blocked.png':'policy-unavailable.png'}/></Frame>}
    </>}
    {index===6&&<>
      <div style={common}><Label>06 / Public reviewer</Label><Head style={{marginTop:25}}>Inspect the<br/>integration.</Head><Copy style={{marginTop:28}}>Policy boundaries and historical payment evidence, without connecting a wallet.</Copy><Label style={{marginTop:50,fontSize:18}}>relayguard.vercel.app/review</Label></div>
      <Frame x={650} y={180} w={1120} h={740}><Shot name="policy-review.png"/></Frame>
    </>}
    {index===7&&<>
      <div style={{...common,top:175,width:1050}}><Label>RelayGuard / MUSD commerce</Label><Head style={{fontSize:84,marginTop:30}}>From payment request<br/>to verifiable result.</Head><Copy style={{marginTop:40,fontSize:31}}>For MUSD API sellers and digital merchants.</Copy></div>
      <div style={{position:'absolute',left:72,top:560,width:1040,borderTop:`1px solid ${C.line}`,paddingTop:30}}><Label>Next milestone / 3 design partners</Label><Copy style={{marginTop:20}}>Time to first payment · Completion · Repeat use</Copy></div>
      <Frame x={1375} y={160} w={350} h={715}><Shot name="checkout.png"/></Frame>
      <div style={{position:'absolute',left:72,top:805,fontSize:35,color:C.lime}}>relayguard.vercel.app</div>
      <div style={{position:'absolute',left:72,top:870,fontSize:21,color:C.muted}}>Built by Praise · github.com/Reinasboo/relayguard</div>
    </>}
    <div style={{position:'absolute',left:72,top:960,fontSize:15,color:C.muted,letterSpacing:.4}}>{index<3||(index===4&&f<190)?'DEMO ACCOUNT / MEZO TESTNET':index===4?'MEZO TESTNET / LIVE HTTP 402 REFERENCE':index===5&&f>=90?'MEZO TESTNET / CONTROLLED POLICY SCENARIOS':'MEZO TESTNET / READ-ONLY EVIDENCE'}</div>
  </AbsoluteFill>;
}
function Film(){
  const f=useCurrentFrame(),t=f/30;
  const current=timings.captions.find(c=>t>=c.start&&t<c.end);
  return <AbsoluteFill style={{background:C.bg}}>
    <style>{`@font-face{font-family:Manrope;src:url('${staticFile('manrope.ttf')}')} *{box-sizing:border-box}`}</style>
    {timings.chapters.map((c,i)=>{const start=i===0?0:Math.floor(c.start*30);const end=i===7?3600:Math.floor(timings.chapters[i+1].start*30);return <Sequence key={i} from={start} durationInFrames={end-start}><Scene index={i}/></Sequence>;})}
    <div style={{position:'absolute',top:991,left:72,right:72,height:66,display:'flex',justifyContent:'center',alignItems:'center',fontFamily:font,color:C.text,fontSize:24,lineHeight:1.3,textAlign:'center'}}>{current&&<span style={{background:'#060a0f',padding:'10px 22px',maxWidth:1660,borderRadius:6}}>{current.text}</span>}</div>
    <div style={{position:'absolute',bottom:0,left:0,height:3,width:`${f/3600*100}%`,background:C.lime}}/>
  </AbsoluteFill>;
}
registerRoot(()=> <Composition id="RelayGuard" component={Film} durationInFrames={3600} fps={30} width={1920} height={1080}/>);
