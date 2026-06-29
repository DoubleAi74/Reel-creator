import { chromium } from "playwright"; import fs from "fs";
const SC=process.env.SC; const PROJECT=JSON.parse(fs.readFileSync(SC+"/real-project.json","utf8"));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const click=(pg,t)=>pg.evaluate(x=>{const b=[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===x);b&&b.click();return !!b;},t);
const b=await chromium.launch();
const pg=await b.newPage({viewport:{width:Number(process.env.VW||1680),height:Number(process.env.VH||1000)},deviceScaleFactor:Number(process.env.DPR||1)});
await pg.addInitScript(()=>{
  window.__snap=()=>{
    const g=s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height)];};
    const sh=document.querySelector(".prototype-shell"); const cs=sh?getComputedStyle(sh):null;
    const vars=cs?Object.fromEntries(["--board-width","--board-height","--board-scale","--tile-layout-scale"].map(k=>[k,cs.getPropertyValue(k).trim()])):null;
    const ls=document.querySelector(".line-stack");
    return {t:Math.round(performance.now()-window.__t0),wb:g(".wb"),slot:g(".wb-slot"),shell:g(".prototype-shell"),frame:g(".board-frame"),stage:g(".stage"),pager:g(".pager-strip"),sel:g(".selection-panel"),ctrl:g(".board-control-panel"),rm:g(".roman-toggle"),plus:g(".mobile-size-button"),aspect:cs?cs.aspectRatio:null,disp:cs?cs.display:null,vars,tiles:document.querySelectorAll(".word-button").length,hidden:ls?ls.getAttribute("style"):null};
  };
  window.__capture=(ms)=>{window.__t0=performance.now();window.__caps=[];const loop=()=>{window.__caps.push(window.__snap());if(performance.now()-window.__t0<ms)requestAnimationFrame(loop);};requestAnimationFrame(loop);};
});
async function importOnce(pg,label){
  await click(pg,"Audio");await sleep(150);await click(pg,"Get lyrics");await sleep(250);
  await click(pg,"Import JSON");await pg.waitForSelector("textarea");await pg.fill("textarea",JSON.stringify(PROJECT));
  // start capture + click import in one tick
  await pg.evaluate(()=>{window.__capture(2500);});
  await click(pg,"Import project");
  await sleep(2800);
  const caps=await pg.evaluate(()=>window.__caps);
  // print compact series: control size, stage h, frame, shell vars
  console.log(`\n===== IMPORT ${label} (snapshots) =====`);
  let prev=null;
  for(const s of caps){
    const key=JSON.stringify([s.shell,s.stage,s.ctrl,s.aspect,s.disp,s.vars]);
    if(key!==prev){ console.log(`t=${s.t}ms tiles=${s.tiles} shell=${JSON.stringify(s.shell)} stage=${JSON.stringify(s.stage)} ctrl=${JSON.stringify(s.ctrl)} rm=${JSON.stringify(s.rm)} aspect=${s.aspect} disp=${s.disp} vars=${JSON.stringify(s.vars)}`); prev=key; }
  }
  console.log(`(total ${caps.length} snapshots over ~2.5s)`);
  // screenshot of broken (first) + corrected (last)
  const wb=pg.locator(".wb").first(); if(await wb.count()){ await wb.screenshot({path:`${SC}/import-${label}-final.png`}); }
}
await pg.goto("http://localhost:3000/",{waitUntil:"networkidle"}); await sleep(1000);
for(const n of [1] ) await importOnce(pg,n);
await b.close();
