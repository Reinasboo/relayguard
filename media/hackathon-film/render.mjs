import {bundle} from '@remotion/bundler';
import {renderMedia,renderStill,selectComposition} from '@remotion/renderer';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const pub=path.join(root,'tmp/film-public'),out=path.join(root,'output/hackathon/video');
await mkdir(pub,{recursive:true});await mkdir(path.join(out,'stills'),{recursive:true});
const assets=['checkout.png','invoice.png','invoice-created.png','policy-review.png','policy-blocked.png','policy-unavailable.png','x402-challenge.png','invoice-motion.webm','api-motion.webm','api.png'];
for(const f of assets)await copyFile(path.join(root,'output/hackathon/captures',f),path.join(pub,f));
for(const f of ['receipt-cards.png','treasury-crop.png'])await copyFile(path.join(root,'output/hackathon/captures',f),path.join(pub,f));
await copyFile(path.join(root,'public/fonts/manrope.ttf'),path.join(pub,'manrope.ttf'));
const browserExecutable=process.env.CHROME_PATH||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':undefined);
console.log('Bundling composition');
const serveUrl=await bundle({entryPoint:path.join(here,'entry.jsx'),publicDir:pub,onProgress:p=>{if(p%20===0)console.log(`Bundle ${p}%`);}});
console.log('Opening browser composition',serveUrl);
const composition=await selectComposition({serveUrl,id:'RelayGuard',browserExecutable});
if(process.argv[2]==='repairs'){
  for(const [name,range] of [['invoice',[308,633]],['api-intro',[1528,1717]]]){
    console.log('Rendering repair',name);
    await renderMedia({composition,serveUrl,browserExecutable,codec:'h264',crf:18,pixelFormat:'yuv420p',concurrency:3,frameRange:range,outputLocation:path.join(out,`patch-${name}.mp4`)});
    console.log('Completed repair',name);
  }
}else if(process.argv[2]==='stills'){
  const times=JSON.parse(await readFile(path.join(root,'output/hackathon/audio/timings.json'),'utf8'));
  const frames=times.chapters.map(c=>Math.floor(c.start*30)+90);
  frames.push(2420,2590,3525);
  for(let i=0;i<frames.length;i++){await renderStill({composition,serveUrl,browserExecutable,output:path.join(out,'stills',`${String(i+1).padStart(2,'0')}.png`),frame:frames[i]});console.log(`Still ${i+1}/${frames.length}`);}
}else{
  const patch=process.argv[2]==='patch';
  const range=patch?process.argv[3].split(':').map(Number):undefined;
  let last=-1;
  await renderMedia({composition,serveUrl,browserExecutable,codec:'h264',crf:18,pixelFormat:'yuv420p',concurrency:3,frameRange:range,outputLocation:path.join(out,patch?'patch.mp4':'silent.mp4'),onProgress:({progress})=>{const p=Math.floor(progress*10);if(p!==last){last=p;console.log(`Rendering ${p*10}%`);}}});
  if(patch)process.exit(0);
  const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',path.join(out,'silent.mp4'),'-i',path.join(root,'output/hackathon/audio/narration.wav'),'-filter_complex','[1:a]apad,alimiter=limit=0.9,loudnorm=I=-16:TP=-1.5:LRA=9[a]','-map','0:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t','120','-movflags','+faststart',path.join(out,'relayguard-demo.mp4')],{stdio:'inherit'});
  if(result.status!==0)throw new Error('Audio mux failed');
  console.log('Rendered 120-second narrated product demo.');
}
