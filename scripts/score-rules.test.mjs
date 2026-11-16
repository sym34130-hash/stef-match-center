import test from "node:test";
import assert from "node:assert/strict";
import { defaultScoreRules, normalizeScoreRules, evaluateScoreRules,
  SCORE_KPI_CATALOG, ScoreRulesError } from "../server/score-rules.mjs";

const snapshot=(rates=[70,88,80,49],dailyIndicators=null)=>({
  match:{date:"2026-09-11"},
  operationalScore:{ status:"available",goalsFor:3,goalsAgainst:1,
    indicators:Object.fromEntries(["passRate","loadingPercent","unloadingPercent","possessionPercent"]
      .map((key,i)=>[key,rates[i]])) },
  dailyIndicators,
});
const custom=({ id="passRate",targetPercent=null,goalsFor=1,goalsAgainst=1 }={})=>({
  id,targetPercent,goalsFor,goalsAgainst,
});
const only=(items)=>({version:1,indicators:items});

test("default weighted score exactly matches current four-KPI 3–1 score",()=>{
  const before=snapshot();
  const original=structuredClone(before);
  const result=evaluateScoreRules(before,defaultScoreRules(),50);
  assert.equal(result.status,"available");
  assert.deepEqual([result.goalsFor,result.goalsAgainst],[3,1]);
  assert.deepEqual(result.referenceScore,{status:"available",goalsFor:3,goalsAgainst:1});
  assert.deepEqual(before,original,"Calculating custom score must never mutate the reference snapshot");
  assert.deepEqual(defaultScoreRules().indicators.map(x=>x.id),
    ["passRate","loadingPercent","unloadingPercent","possessionPercent"]);
});

test("weights, independent targets, strict > equality and order are preserved",()=>{
  const model=only([custom({id:"possessionPercent",targetPercent:49,goalsAgainst:3}),
    custom({id:"passRate",targetPercent:60,goalsFor:3}),
    custom({id:"loadingPercent",targetPercent:88,goalsAgainst:2})]);
  const result=evaluateScoreRules(snapshot(),model,50);
  assert.equal(result.status,"available");
  assert.deepEqual([result.goalsFor,result.goalsAgainst],[3,5]);
  assert.equal(result.possibleGoalsFor,5);
  assert.equal(result.possibleGoalsAgainst,6);
  assert.deepEqual(result.indicators.map(x=>x.reached),[false,true,false]);
  assert.deepEqual([result.referenceScore.goalsFor,result.referenceScore.goalsAgainst],[3,1]);
});

test("valid 2–6 KPI rules can use punctuality from the attached 106J",()=>{
  const d={referenceDate:"11 septembre 2026",punctuality:{
    arrivalPunctuality:93,departurePunctuality:50,destinationPunctuality:79,
    temperatureReturn:100,
  }};
  const six=only([custom({id:"passRate"}),custom({id:"loadingPercent"}),
    custom({id:"arrivalPunctuality",goalsFor:2}),
    custom({id:"departurePunctuality",targetPercent:50,goalsAgainst:3}),
    custom({id:"destinationPunctuality"}),custom({id:"temperatureReturn",goalsFor:3})]);
  const result=evaluateScoreRules(snapshot(undefined,d),six,50);
  assert.equal(result.status,"available");
  assert.deepEqual([result.goalsFor,result.goalsAgainst],[8,3]);
  assert.equal(result.indicators[2].source,"106J");
});

test("attached 106J dated differently remains eligible and preserves source provenance",()=>{
  const otherDay={referenceDate:"10 septembre 2026",punctuality:{arrivalPunctuality:25}};
  const model=only([custom({id:"passRate",goalsFor:2}),
    custom({id:"arrivalPunctuality",goalsAgainst:3})]);
  const score=evaluateScoreRules(snapshot(undefined,otherDay),model,50);
  assert.equal(score.status,"available");
  assert.deepEqual([score.goalsFor,score.goalsAgainst],[2,3]);
  assert.equal(score.indicators[1].sourceDate,"10 septembre 2026");
  assert.equal(score.indicators[1].source,"106J");
  assert.equal(score.missingIndicators.length,0);
  assert.deepEqual([score.referenceScore.goalsFor,score.referenceScore.goalsAgainst],[3,1]);
});

test("selected 106J KPI without an actual numeric rate still produces incomplete score",()=>{
  const model=only([custom({id:"passRate"}),custom({id:"arrivalPunctuality"})]);
  const result=evaluateScoreRules(snapshot(undefined,{referenceDate:"10 septembre 2026",punctuality:{}}),model,50);
  assert.equal(result.status,"unavailable");
  assert.equal(result.goalsFor,null);
  assert.equal(result.missingIndicators[0].id,"arrivalPunctuality");
  assert.match(result.missingIndicators[0].reason,/indisponible/);
});

test("missing or out-of-range source values never become losses or fake 0%",()=>{
  const rates=[50,null,undefined,99];
  const score=evaluateScoreRules(snapshot(rates),defaultScoreRules(),50);
  assert.equal(score.status,"unavailable");
  assert.equal(score.missingIndicators.length,2);
  assert.equal(score.goalsFor,null);
  assert.equal(score.goalsAgainst,null);
  assert.equal(score.indicators[0].reached,false,"Threshold equality is not reached");
  assert.equal(score.indicators[1].reached,null);
  const invalid=evaluateScoreRules(snapshot([120,50,20,30]),defaultScoreRules(),50);
  assert.equal(invalid.status,"unavailable");
});

test("rules reject unknown fields, repeats, fractional weights, missing target, incorrect count",()=>{
  const base=defaultScoreRules();
  const invalid=[
    only(base.indicators.slice(0,1)),
    only([...base.indicators,...base.indicators.slice(0,3)]),
    only([...base.indicators.slice(0,3),custom({id:"unexpected"})]),
    only([...base.indicators.slice(0,3),custom({id:"passRate"})]),
    only([...base.indicators.slice(0,3),custom({id:"temperatureReturn",targetPercent:101})]),
    only([...base.indicators.slice(0,3),custom({id:"temperatureReturn",goalsFor:1.5})]),
    only([...base.indicators.slice(0,3),{id:"temperatureReturn",goalsFor:1,goalsAgainst:2}]),
    {...base,version:2},
  ];
  const validTwo=normalizeScoreRules(only(base.indicators.slice(0,2)));
  assert.equal(validTwo.indicators.length,2);
  for(const p of invalid){
    assert.throws(()=>normalizeScoreRules(p), e=>e instanceof ScoreRulesError&&e.status===400);
  }
  assert.equal(SCORE_KPI_CATALOG.length,8);
  assert.ok(!SCORE_KPI_CATALOG.some(item=>item.id==="accidentFreeDays"),
    "Accident-free days are a count, not a rate eligible for the percent rule");
});
