import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

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
// distinct positions: the plot must display POSITIONS, not operations.
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
    for (const slot of slots) {
      const b=graph.getByRole("button",{name:new RegExp(slot.distinctPositions+" positions distinctes")});
      const value=b.locator(".reception-hour-value");
      assert.equal((await value.innerText()).trim(),slot.distinctPositions+" pos.");
      assert.equal(await value.isVisible(),true,viewport.width+"px: count must remain visible");
      assert.equal((await b.getAttribute("aria-label")).includes("moyenne"),true);
      assert.equal((await b.getAttribute("aria-label")).includes(slot.meanSecondsPerPosition+" s"),true);
    }
    const target=graph.getByRole("button",{name:/23:00–00:00/});
    await target.click();
    const detail=page.locator("#reception-hour-detail");
    assert.match(await detail.innerText(),/Positions distinctes\s*15/);
    assert.match(await detail.innerText(),/Voyages\s*1/);
    assert.match(await detail.innerText(),/Moyenne/);
    assert.match(await detail.innerText(),/Objectif/);
    assert.deepEqual(errors,[]);
    console.log(`Reception volume labels at ${viewport.width}px: positions visible, mean retained`);
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
