import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";
import { formatKpiDuration } from "../src/kpi-duration.ts";

async function freePort() {
  const s = net.createServer(); s.listen(0, "127.0.0.1");
  await once(s, "listening");
  const result = s.address().port;
  await new Promise(resolve => s.close(resolve));
  return result;
}
async function ready(url) {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* service starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Service unavailable: " + url);
}
const headers = ["Operateur", "Date Heure de debut d operation", "Type operation",
  "N position", "Code voyage", "Agence segment", "Type segment", "Filtre operateur",
  "Filtre heure", "Poste", "Poz non zonees", "DZ", "Duels gagnes", "Heure OP"];
const rows = [];
// Two qualifying trips. Second trip has 16 DECHG operations but only 15
// distinct positions: the plot must display POSITION COUNTS inside bars, not operations.
for (let i = 0; i < 15; i++) {
  rows.push(["Test", `2026-09-17T22:${String(i).padStart(2,"0")}:00+02:00`,
    "DECHG", `A-${i}`, "A", "01K", "EX", "", "", "", "", 10/1440, 1, 22]);
}
for (let i = 0; i < 16; i++) {
  rows.push(["Test", `2026-09-17T23:${String(i*2).padStart(2,"0")}:00+02:00`,
    "DECHG", `B-${i % 15}`, "B", "01K", "EX", "", "", "", "", 10/1440, 1, 23]);
}
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([headers, ...rows]), "Données");
const response = buildSnapshotFromWorkbook(
  XLSX.write(book, {type:"buffer",bookType:"xlsx"}), "reception-volume.xlsx", "01K",
  {start:"21:30",end:"06:30",criteria:{zonageMinutes:30,loadingSeconds:165,unloadingSeconds:60,scoreTargetPercent:50}},
);
assert.equal(response.ok, true, JSON.stringify(response.error ?? null));
const snapshot = response.snapshot;
const slots = snapshot.unloadingHourlyAnalysis.items.filter(item => item.state === "disponible");
assert.deepEqual(slots.map(({label, operationRows, distinctPositions}) => [label,operationRows,distinctPositions]),
  [["22h",15,15],["23h",16,15]], "The fixture proves the position-count distinction");
const sourceMean = slots.map(item => item.meanSecondsPerPosition);
assert.notEqual(sourceMean[0], sourceMean[1], "Two distinct average durations remain plot heights");
assert.ok(Math.abs(sourceMean[0]-60)<=5,"Fixture includes an average adjacent to the 60s target, as in the reported collision");

const dir = await fs.mkdtemp(os.tmpdir()+"/stef-reception-volume-");
const apiPort = await freePort(), webPort = await freePort();
const url = `http://127.0.0.1:${webPort}`;
const env = {...process.env, PORT:String(apiPort), STEF_BIND_HOST:"127.0.0.1",
  STEF_DATA_DIR:dir, NODE_ENV:"test", STEF_AGENCIES_JSON: JSON.stringify([
    {code:"01K",name:"Montpellier",accessCode:"VOLUME-01K",canImport:true},
  ])};
const api = spawn(process.execPath,["server/index.mjs"],{env,stdio:["ignore","pipe","pipe"]});
const vite = spawn("./node_modules/.bin/vite",["--host","127.0.0.1","--port",String(webPort),"--strictPort"],{env,stdio:["ignore","pipe","pipe"]});
let browser;
let stderr="";
for (const proc of [api,vite]) proc.stderr.on("data",value => { stderr+=value.toString(); });
try {
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`),ready(url)]);
  browser=await chromium.launch({headless:true});
  for (const viewport of [{width:1366,height:768},{width:390,height:844},{width:320,height:740}]) {
    const page=await browser.newPage({viewport,reducedMotion:"reduce"});
    const errors=[];
    page.on("pageerror",err=>errors.push(err.message));
    await page.route("**/api/agencies/01K/snapshot**",
      route=>route.fulfill({json:{snapshot}}));
    await page.goto(url);
    await page.getByLabel("Code agence").selectOption("01K");
    await page.getByLabel("Code d'accès").fill("VOLUME-01K");
    await page.getByRole("button",{name:"Accéder au match",exact:true}).click();
    await page.getByRole("button",{name:"02 Feuille de match",exact:true}).click();
    await page.getByRole("navigation",{name:"Navigation de la feuille de match"})
      .getByRole("button",{name:"Aller à Statistiques du match",exact:true}).click();
    await page.getByRole("tab",{name:"Afficher % duels gagnés",exact:true}).click();
    const graph=page.getByRole("group",{name:"Histogramme des temps moyens, en secondes par position"});
    await graph.waitFor({state:"visible"});
    const targetLine=graph.locator(".reception-hour-target");
    const targetRect=await targetLine.boundingBox();
    assert.ok(targetRect,"Objective dashed line must exist");
    assert.notEqual(await targetLine.evaluate(el=>getComputedStyle(el).bottom),"auto",
      "Dashed line and labels must share the same target height");
    const chartPlot=await graph.locator(".reception-hour-plot").boundingBox();
    assert.ok(chartPlot,"Chart plot should have measurable bounds");
    const ceiling=Math.max(60,Math.ceil(Math.max(snapshot.unloadingHourlyAnalysis.targetSeconds,...slots.map(s=>s.meanSecondsPerPosition??0))*1.2/60)*60);
    const mmss=seconds=>Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");
    assert.deepEqual(await graph.locator(".reception-hour-axis span").allInnerTexts(),
      [mmss(ceiling),mmss(ceiling/2),"0:00"],"The scale must use the same minutes:seconds units as each bar");
    assert.equal(mmss(206),"3:26");
    assert.equal(mmss(300),"5:00");
    for (const slot of slots) {
      const b=graph.getByRole("button",{name:new RegExp("^"+slot.label.slice(0,2)+":00–")});
      const value=b.locator(".reception-hour-value");
      const rounded=Math.max(0,Math.round(slot.meanSecondsPerPosition));
      const expectedDuration=Math.floor(rounded/60)+":"+String(rounded%60).padStart(2,"0");
      assert.equal((await value.innerText()).trim(),expectedDuration,
        "Above each bar must be mean duration per position, not the position count");
      assert.equal(await value.isVisible(),true,viewport.width+"px: mean duration must remain visible");
      const labelRect=await value.boundingBox();
      assert.ok(labelRect,"Mean duration label must have measurable bounds");
      assert.ok(labelRect.y+labelRect.height <= targetRect.y-5,
        viewport.width+"px: "+slot.label+" mean duration must be ABOVE dashed objective, got "+
        JSON.stringify({labelRect,targetRect,mean:slot.meanSecondsPerPosition,target:60}));
      assert.ok(labelRect.x>=chartPlot.x-3 && labelRect.x+labelRect.width<=chartPlot.x+chartPlot.width+3,
        viewport.width+"px: mean duration must not extend outside graph");
      const renderedTime = await value.evaluate(el => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const textRect = range.getBoundingClientRect();
        const plotRect = el.closest(".reception-hour-plot").getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          left: textRect.left, right: textRect.right, width: textRect.width,
          plotLeft: plotRect.left, plotRight: plotRect.right,
          overflow: style.overflowX,
        };
      });
      assert.equal(renderedTime.overflow, "visible",
        viewport.width+"px: average duration must not be masked by its slot");
      assert.ok(renderedTime.width>0
        && renderedTime.left>=renderedTime.plotLeft-2
        && renderedTime.right<=renderedTime.plotRight+2,
        viewport.width+"px: mean duration rendered text must fit inside graph: "+
        JSON.stringify(renderedTime));
      const height=await b.evaluate(el=>parseFloat(el.style.getPropertyValue("--bar-height")));
      assert.ok(Math.abs(height-slot.meanSecondsPerPosition/ceiling*100)<0.02,
        "Bar height must still be proportional to its duration in seconds");
      const volume=b.locator(".reception-hour-bar-volume");
      assert.equal((await volume.innerText()).trim(),String(slot.distinctPositions),
        "Inside each bar must be the count of distinct positions");
      const volumeRect=await volume.boundingBox();
      const barRect=await b.locator(".reception-hour-bar").boundingBox();
      assert.ok(volumeRect && barRect,"Position count and bar bounds must be available");
      assert.ok(volumeRect.x>=barRect.x-1 && volumeRect.x+volumeRect.width<=barRect.x+barRect.width+1,
        viewport.width+"px: position count must remain inside its bar horizontally");
      assert.ok(volumeRect.y>=barRect.y-1 && volumeRect.y+volumeRect.height<=barRect.y+barRect.height+1,
        viewport.width+"px: position count must remain inside its bar vertically");
      assert.equal((await b.getAttribute("aria-label")).includes("moyenne"),true);
      assert.equal((await b.getAttribute("aria-label")).includes(formatKpiDuration(slot.meanSecondsPerPosition)),true);
    }
    const target=graph.getByRole("button",{name:/23:00–00:00/});
    await target.click();
    const detail=page.locator("#reception-hour-detail");
    assert.match(await detail.innerText(),/Positions distinctes\s*15/);
    assert.match(await detail.innerText(),/Voyages\s*1/);
    assert.match(await detail.innerText(),/Moyenne/);
    assert.match(await detail.innerText(),/Objectif/);
    assert.deepEqual(errors,[]);
    console.log(`Reception volume labels at ${viewport.width}px: mean above, positions inside bar`);
    await page.close();
  }
} finally {
  if (browser) await browser.close();
  for (const proc of [api,vite]) if (proc.exitCode===null && proc.signalCode===null) {
    proc.kill("SIGTERM");
    await Promise.race([once(proc,"close"),new Promise(resolve=>setTimeout(resolve,2000))]);
  }
  await fs.rm(dir,{recursive:true,force:true});
  if (stderr) console.log("Server diagnostics: ",stderr.slice(-1200));
}
