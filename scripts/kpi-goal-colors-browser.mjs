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
      {id:"bronze",label:"LIGUE 2",tone:"bronze",target:45,accent:"#d08a52",cardColor:"rgb(255, 255, 255)",cardBackground:"rgb(245, 210, 178)",badgeBackground:"rgb(244, 208, 176)"},
      {id:"argent",label:"LIGUE 1",tone:"silver",target:50,accent:"#8bb5dc",cardColor:"rgb(255, 255, 255)",cardBackground:"rgb(219, 233, 248)",badgeBackground:"rgb(220, 234, 250)"},
      {id:"or",label:"LDC",tone:"gold",target:60,accent:"#d7a52f",cardColor:"rgb(255, 255, 255)",cardBackground:"rgb(247, 221, 160)",badgeBackground:"rgb(247, 223, 167)"},
      {id:"platine",label:"CDM",tone:"platinum",target:70,accent:"#c58ee8",cardColor:"rgb(255, 255, 255)",cardBackground:"rgb(241, 220, 255)",badgeBackground:"rgb(239, 223, 255)"},
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
      assert.equal(league.label, league.label.toLocaleUpperCase("fr-FR"),
        "Competition labels are actual uppercase data, not merely a CSS effect");
      assert.equal(await leagueBadge.getAttribute("aria-label"),"Ligue active : "+league.label);
      const displayFont=await leagueBadge.locator("strong").evaluate(el=>getComputedStyle(el).fontFamily);
      assert.match(displayFont,/Archivo Black/,"Competition display face on heading");
      const themeAccent=await page.locator(".app-shell").evaluate(el =>
        getComputedStyle(el).getPropertyValue("--league-accent").trim().toLowerCase());
      assert.equal(themeAccent,league.accent,"Original league theme accent must be preserved");
      const headline=await leagueBadge.locator("strong").evaluate(el=>{
        const css=getComputedStyle(el);
        return {
          color:css.color,fontFamily:css.fontFamily,fontWeight:css.fontWeight,
          fontStyle:css.fontStyle,letterSpacing:css.letterSpacing,
          stroke:css.webkitTextStrokeWidth,shadow:css.textShadow,transform:css.transform,
        };
      });
      assert.equal(headline.color,league.cardColor,"White lettering on every league");
      assert.match(headline.fontFamily,/Archivo Black/,"Heavy sports-headline face");
      assert.equal(headline.fontWeight,"400","Archivo Black is intrinsically heavy");
      assert.equal(headline.fontStyle,"normal","Forward lean supplied by the CSS skew");
      assert.equal(headline.stroke,"1px","White lettering requires a fine dark stroke over pale backgrounds");
      assert.notEqual(headline.shadow,"none","White lettering requires a restrained text-only shadow");
      assert.match(headline.transform,/^matrix\(1, 0, -0\./,"Sports masthead must lean sharply forward");
      await page.getByRole("button",{name:"ADM Administrateur",exact:true}).click();
      await page.locator(".administrator-leagues").waitFor({state:"visible"});
      const allCards=page.locator(".administrator-leagues .league-card");
      assert.equal(await allCards.count(),4,"All four leagues remain available");
      const labels=await allCards.locator(".league-card-top strong").allTextContents();
      assert.deepEqual(labels.map(s=>s.trim()),["LIGUE 2","LIGUE 1","LDC","CDM"]);
      const leagueCard=page.locator(".administrator-leagues .league-card." + league.tone);
      const cardInk=await leagueCard.locator(".league-card-top strong").evaluate(el =>
        getComputedStyle(el).color);
      assert.equal(cardInk,league.cardColor,"Only heading ink is white; card backgrounds remain unchanged");
      const cardBackground=await leagueCard.evaluate(el => getComputedStyle(el).backgroundImage);
      assert.ok(cardBackground.includes(league.cardBackground),
        "Previous league card background MUST remain unchanged: "+league.id+": "+cardBackground);
      const selectedBadge=page.locator(".administrator-active-badge");
      const badgeBackground=await selectedBadge.evaluate(el => getComputedStyle(el).backgroundImage);
      assert.ok(badgeBackground.includes(league.badgeBackground),
        "Previous admin badge background MUST remain unchanged: "+league.id+": "+badgeBackground);
      const selectedBadgeInk=await selectedBadge.locator("strong").evaluate(el=>getComputedStyle(el).color);
      assert.equal(selectedBadgeInk,league.cardColor,"Only active competition name ink changes");
      const backgroundIsUnchanged=await selectedBadge.evaluate(el=>getComputedStyle(el).backgroundColor);
      assert.ok(backgroundIsUnchanged,"Active league badge remains styled");
      const cardFont=await leagueCard.locator(".league-card-top strong").evaluate(el =>
        getComputedStyle(el).fontFamily);
      assert.match(cardFont,/Archivo Black/,"Competition display face on admin card");
      const cardTypography=await leagueCard.locator(".league-card-top strong").evaluate(el=>{
        const cs=getComputedStyle(el);
        return {style:cs.fontStyle,weight:cs.fontWeight,stroke:cs.webkitTextStrokeWidth};
      });
      assert.deepEqual(cardTypography,{style:"normal",weight:"400",stroke:"1px"});
      const shortLabel=league.id==="or" || league.id==="platine";
      if(shortLabel)assert.equal(league.label.length,3,"Upper tier acronyms must render with three letters");
      const cardSize=await leagueCard.locator(".league-card-top strong").evaluate(el =>
        parseFloat(getComputedStyle(el).fontSize));
      assert.ok(cardSize>=25,"Sports-headline lettering must remain prominent");
      // Icon and action share the first row; the title MUST occupy the
      // full second row. Compare actual rendered rectangles, not just CSS.
      for (const card of await allCards.all()) {
        const layout=await card.evaluate(el=>{
          const medal=el.querySelector(".league-medal");
          const button=el.querySelector(".league-select-button");
          const heading=el.querySelector(".league-card-top");
          const title=heading?.querySelector("strong");
          const description=el.querySelector(".league-description");
          const bounds=node=>node.getBoundingClientRect();
          const rect=r=>({left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height});
          const textRange=document.createRange();
          textRange.selectNodeContents(title);
          return {
            card:rect(bounds(el)),medal:rect(bounds(medal)),
            button:rect(bounds(button)),heading:rect(bounds(heading)),
            title:rect(bounds(title)),ink:rect(textRange.getBoundingClientRect()),
            description:rect(bounds(description)),
            text: title.textContent.trim(),
            whiteSpace:getComputedStyle(title).whiteSpace,
            grid:getComputedStyle(el).gridTemplateColumns,
            buttonWhiteSpace:getComputedStyle(button).whiteSpace,
          };
        });
        assert.equal(layout.whiteSpace,"nowrap",layout.text+" must never wrap");
        assert.equal(layout.buttonWhiteSpace,"nowrap",layout.text+" action must never wrap");
        assert.ok(layout.medal.right<layout.button.left,layout.text+" medal/action must be separate");
        assert.ok(layout.title.top>=Math.max(layout.medal.bottom,layout.button.bottom)+4,
          layout.text+" title must sit BELOW icon and action: "+JSON.stringify(layout));
        assert.ok(layout.description.top>=layout.title.bottom+4,
          layout.text+" description must sit BELOW the title: "+JSON.stringify(layout));
        assert.ok(layout.ink.right <= layout.card.right-7 && layout.ink.left>=layout.card.left+7,
          layout.text+" glyphs must stay INSIDE their card: "+JSON.stringify(layout));
        assert.ok(layout.ink.height<=layout.title.height+2,
          layout.text+" title must use exactly one line");
      }
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
