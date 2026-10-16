import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import { chromium } from "@playwright/test";
import * as XLSX from "xlsx";
import { buildSnapshotFromWorkbook } from "../server/match-engine.mjs";

const agencyCode = "01K";
const accessCode = "GOAL-UI-INTEGRATION-01K";
const values = { passRate: 50, loadingPercent: 60, unloadingPercent: 50.1, possessionPercent: 49.9 };
const bubbles = ["pass-score-bubble", "loading-score-bubble", "reception-score-bubble", "possession-score-bubble"];

async function port() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const result = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return result;
}
async function ready(url) {
  for (let index = 0; index < 120; index++) {
    try { if ((await fetch(url)).ok) return; } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Local test service not ready: " + url);
}
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
  ["Operateur","Date Heure de debut d operation","Type operation","N position","Code voyage",
    "Agence segment","Type segment","Filtre operateur","Filtre heure","Poste","Poz non zonees","DZ","Duels gagnes","Heure OP"],
  ["Player","2026-09-17T22:00:00+02:00","DECHG","P1","TR1","01K","TR","","","Défenseur","",20/1440,1,22],
  ["Player","2026-09-17T22:05:00+02:00","DECHG","P2","TR1","01K","TR","","","Défenseur","",20/1440,1,22],
  ["Player","2026-09-17T22:10:00+02:00","ZONAGE","P1","TR1","01K","TR","","","Milieu","",10/1440,1,22],
]),"Données");
const fixture = buildSnapshotFromWorkbook(
  XLSX.write(book,{type:"buffer",bookType:"xlsx"}), "goal-ui-fixture.xlsx", agencyCode,
  {start:"21:30",end:"06:30",criteria:{zonageMinutes:30,loadingSeconds:165,unloadingSeconds:60,scoreTargetPercent:50}},
);
assert.equal(fixture.ok,true,JSON.stringify(fixture.error ?? null));
const base = fixture.snapshot;

const root = await fs.mkdtemp(os.tmpdir()+"/stef-kpi-goals-");
const apiPort = await port(), webPort = await port();
const baseURL = `http://127.0.0.1:${webPort}`;
const env = { ...process.env, PORT:String(apiPort), VITE_PORT:String(webPort), NODE_ENV:"test",
  STEF_BIND_HOST:"127.0.0.1", STEF_DATA_DIR:root,
  STEF_AGENCIES_JSON:JSON.stringify([{code:agencyCode,name:"Montpellier",accessCode,canImport:true}]) };
const api = spawn(process.execPath,["server/index.mjs"],{env,stdio:["ignore","pipe","pipe"]});
const vite = spawn("./node_modules/.bin/vite",["--host","127.0.0.1","--port",String(webPort),"--strictPort"],{env,stdio:["ignore","pipe","pipe"]});
let stderr = "";
for(const proc of [api,vite])proc.stderr.on("data",chunk=>{stderr += chunk.toString()});
let browser;
try {
  await Promise.all([ready(`http://127.0.0.1:${apiPort}/api/health`),ready(baseURL)]);
  browser = await chromium.launch({headless:true});
  for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
    for(const league of [
      {id:"bronze",label:"Ligue 2",tone:"bronze",target:45,accent:"#d08a52",cardColor:"rgb(17, 103, 77)",cardBackground:"rgb(245, 210, 178)",badgeBackground:"rgb(244, 208, 176)"},
      {id:"argent",label:"Ligue 1",tone:"silver",target:50,accent:"#8bb5dc",cardColor:"rgb(20, 88, 154)",cardBackground:"rgb(219, 233, 248)",badgeBackground:"rgb(220, 234, 250)"},
      {id:"or",label:"Ligue des champions",tone:"gold",target:60,accent:"#d7a52f",cardColor:"rgb(52, 59, 132)",cardBackground:"rgb(247, 221, 160)",badgeBackground:"rgb(247, 223, 167)"},
      {id:"platine",label:"Coupe du monde",tone:"platinum",target:70,accent:"#c58ee8",cardColor:"rgb(129, 84, 21)",cardBackground:"rgb(241, 220, 255)",badgeBackground:"rgb(239, 223, 255)"},
    ]) {
      const context = await browser.newContext({viewport,reducedMotion:"reduce"});
      const page = await context.newPage();
      const errors=[];
      page.on("pageerror",e=>errors.push(e.message));
      await page.addInitScript(id=>{
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem("stef-match-active-league-01K",id);
      },league.id);
      const scored = Object.values(values).filter(v=>v>league.target).length;
      const snapshot = {
        ...base,
        performanceCriteria:{...base.performanceCriteria,scoreTargetPercent:league.target},
        operationalScore:{...base.operationalScore,status:"available",targetPercent:league.target,
          indicators:values,goalsFor:scored,goalsAgainst:4-scored},
      };
      await page.route("**/api/agencies/01K/snapshot**",route=>route.fulfill({json:{snapshot}}));
      await page.goto(baseURL);
      await page.getByLabel("Code agence").selectOption("01K");
      await page.getByLabel("Code d'accès").fill(accessCode);
      await page.getByRole("button",{name:"Accéder au match",exact:true}).click();
      const leagueBadge=page.locator(".top-league-badge");
      await leagueBadge.waitFor({state:"visible"});
      assert.equal((await leagueBadge.locator("strong").textContent()).trim(),league.label,
        "League display name must follow the saved technical ID");
      assert.equal(await leagueBadge.getAttribute("aria-label"),"Ligue active : "+league.label);
      const displayFont=await leagueBadge.locator("strong").evaluate(el=>getComputedStyle(el).fontFamily);
      assert.match(displayFont,/Barlow Condensed/,"Competition display face on heading");
      const themeAccent=await page.locator(".app-shell").evaluate(el =>
        getComputedStyle(el).getPropertyValue("--league-accent").trim().toLowerCase());
      assert.equal(themeAccent,league.accent,"Original league theme accent must be preserved");
      const titleColor=await leagueBadge.locator("strong").evaluate(el=>getComputedStyle(el).color);
      assert.equal(titleColor,league.cardColor,"Only competition name ink changes, not its backdrop");
      await page.getByRole("button",{name:"ADM Administrateur",exact:true}).click();
      await page.locator(".administrator-leagues").waitFor({state:"visible"});
      const allCards=page.locator(".administrator-leagues .league-card");
      assert.equal(await allCards.count(),4,"All four leagues remain available");
      const labels=await allCards.locator(".league-card-top strong").allTextContents();
      assert.deepEqual(labels.map(s=>s.trim()),["Ligue 2","Ligue 1","Ligue des champions","Coupe du monde"]);
      const leagueCard=page.locator(".administrator-leagues .league-card." + league.tone);
      const cardInk=await leagueCard.locator(".league-card-top strong").evaluate(el =>
        getComputedStyle(el).color);
      assert.equal(cardInk,league.cardColor,"Competition-specific TEXT color");
      const cardBackground=await leagueCard.evaluate(el => getComputedStyle(el).backgroundImage);
      assert.ok(cardBackground.includes(league.cardBackground),
        "Previous league card background MUST remain unchanged: "+league.id+": "+cardBackground);
      const selectedBadge=page.locator(".administrator-active-badge");
      const badgeBackground=await selectedBadge.evaluate(el => getComputedStyle(el).backgroundImage);
      assert.ok(badgeBackground.includes(league.badgeBackground),
        "Previous admin badge background MUST remain unchanged: "+league.id+": "+badgeBackground);
      const selectedBadgeInk=await selectedBadge.locator("strong").evaluate(el=>getComputedStyle(el).color);
      assert.equal(selectedBadgeInk,league.cardColor,"Only active competition name ink changes");
      const cardFont=await leagueCard.locator(".league-card-top strong").evaluate(el =>
        getComputedStyle(el).fontFamily);
      assert.match(cardFont,/Barlow Condensed/,"Competition display face on admin card");
      const noOverflow=await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2);
      assert.equal(noOverflow,true,"Competition name cards must not overflow viewport");

      const badgeClipped=await leagueBadge.evaluate(element => {
        const strong=element.querySelector("strong");
        return !strong || strong.getBoundingClientRect().right > window.innerWidth + 1;
      });
      assert.equal(badgeClipped,false,"League name must not overflow the viewport on desktop/mobile");
      await page.getByRole("button",{name:"02 Feuille de match",exact:true}).click();
      const board=page.locator(".match-score-bubbles");
      await board.waitFor({state:"visible"});
      assert.equal(await board.locator(".match-score-bubble").count(),4);
      for(const kind of bubbles) {
        const card=board.locator("." + kind);
        const relevantValue=values[
          kind === "pass-score-bubble" ? "passRate" :
          kind === "loading-score-bubble" ? "loadingPercent" :
          kind === "reception-score-bubble" ? "unloadingPercent" : "possessionPercent"
        ];
        const conceded=relevantValue <= league.target;
        const className=await card.getAttribute("class");
        assert.equal(className.includes("is-goal-conceded"),conceded,kind+" / "+league.id);
        const warnings=await card.locator(".match-score-goal-warning").allTextContents();
        assert.equal(warnings.length,conceded?1:0,kind);
        if(conceded) {
          assert.match(warnings[0],/But encaissé/i);
          assert.ok(warnings[0].includes(`objectif > ${league.target}%`),warnings[0]);
          const color=await card.locator("strong").first().evaluate(el=>getComputedStyle(el).color);
          assert.equal(color,"rgb(255, 120, 138)",kind+" bright red");
        }
      }
      assert.equal(await board.locator(".is-goal-conceded").count(),4-scored);
      await page.getByRole("button",{name:"Mode célébration",exact:true}).click();
      assert.equal(await board.locator(".is-goal-conceded").count(),4-scored);
      assert.deepEqual(errors,[],"No browser exception");
      console.log(`KPI conceded goal colours: ${league.id}, ${viewport.width}px, ${4-scored} concessions OK`);
      await context.close();
    }
  }
} finally {
  if(browser)await browser.close();
  for(const proc of [api,vite])if(proc.exitCode===null&&proc.signalCode===null){
    proc.kill("SIGTERM");
    await Promise.race([once(proc,"close"),new Promise(resolve=>setTimeout(resolve,2000))]);
  }
  await fs.rm(root,{recursive:true,force:true});
  if(stderr)console.log("Server diagnostics: ",stderr.slice(-1400));
}
