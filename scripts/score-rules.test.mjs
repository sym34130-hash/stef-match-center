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


test("matrix: 4 leagues, all 2–6 KPI cardinalities and weighted percentage rules",()=>{
  const ids=SCORE_KPI_CATALOG.map(item=>item.id);
  const readings={
    passRate:70,loadingPercent:88,unloadingPercent:80,possessionPercent:49,
    arrivalPunctuality:93,departurePunctuality:50,destinationPunctuality:79,temperatureReturn:100,
  };
  const dailyIndicators={
    referenceDate:"10 septembre 2026", agencyCode:"058",
    punctuality:{
      arrivalPunctuality:93,departurePunctuality:50,
      destinationPunctuality:79,temperatureReturn:100,
    },
  };
  const source=snapshot([70,88,80,49],dailyIndicators);
  for(const [league,threshold] of Object.entries({
    bronze:40,argent:50,or:65,platine:80,
  })){
    for(let count=2;count<=6;count++){
      for(let start=0;start<ids.length;start++){
        const selected=Array.from({length:count},(_,i)=>ids[(start+i)%ids.length]);
        const rules=only(selected.map((id,i)=>({
          id,targetPercent:i%2?null:threshold,
          goalsFor:1+(i%3),goalsAgainst:1+((i+1)%3),
        })));
        const before=structuredClone(source);
        const result=evaluateScoreRules(source,rules,threshold);
        const expectedFor=rules.indicators.reduce((acc,rule)=>
          acc+(readings[rule.id]>threshold?rule.goalsFor:0),0);
        const expectedAgainst=rules.indicators.reduce((acc,rule)=>
          acc+(readings[rule.id]<=threshold?rule.goalsAgainst:0),0);
        assert.deepEqual([result.status,result.goalsFor,result.goalsAgainst],
          ["available",expectedFor,expectedAgainst],
          league+" / "+count+" KPI / window "+start);
        assert.equal(result.indicators.length,count);
        assert.deepEqual(result.indicators.map(item=>item.value),
          selected.map(id=>readings[id]));
        assert.deepEqual(result.referenceScore,{status:"available",goalsFor:3,goalsAgainst:1});
        assert.deepEqual(source,before,"Evaluation may not mutate imported source values");
      }
    }
  }
});

test("106J parsing: percentages and independent source dates are preserved end-to-end",async()=>{
  const {parse106jText}=await import("../server/pdf-106j.mjs");
  const sourceText=[
    "Site : AGEN [058]",
    "Date de référence de calcul : 10 septembre 2026",
    "taux de ponctualité arrivage % 88,9 % 1 % 95 %",
    "taux de ponctualité départ % 49,9 % 1 % 92 %",
    "taux de ponctualité destination % 100 % 1 % 98 %",
    "taux de prise de température retour ramasse % 0 % 1 % 95 %",
  ].join("\n");
  const pdf=parse106jText(sourceText,"106J-synthetique.pdf");
  assert.equal(pdf.referenceDate,"10 septembre 2026");
  assert.equal(pdf.agencyCode,"058");
  assert.equal(evaluateScoreRules(snapshot(undefined,pdf),only([
    custom({id:"passRate"}),custom({id:"arrivalPunctuality"}),
  ]),50).indicators[1].sourceAgency,"058");
  assert.deepEqual(pdf.punctuality,{
    arrivalPunctuality:88.9,departurePunctuality:49.9,
    destinationPunctuality:100,temperatureReturn:0,
  });
  const data=snapshot(undefined,pdf);
  const rules=only([
    custom({id:"arrivalPunctuality",targetPercent:88,goalsFor:3}),
    custom({id:"departurePunctuality",targetPercent:50,goalsAgainst:2}),
    custom({id:"destinationPunctuality",targetPercent:100,goalsAgainst:1}),
    custom({id:"temperatureReturn",targetPercent:50,goalsAgainst:3}),
  ]);
  const result=evaluateScoreRules(data,rules,50);
  assert.equal(result.status,"available");
  assert.deepEqual([result.goalsFor,result.goalsAgainst],[3,6]);
  assert.deepEqual(result.indicators.map(r=>r.reached),[true,false,false,false]);
  assert.deepEqual(result.indicators.map(r=>r.value),[88.9,49.9,100,0]);
  assert.ok(result.indicators.every(r=>r.sourceDate==="10 septembre 2026"));
});
