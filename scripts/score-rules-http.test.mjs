import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const owned=(name,code,canImport)=>({code,name,accessCode:"TEST-"+code,canImport});
const profiles=()=>{
  const ids=["passRate","loadingPercent","unloadingPercent","possessionPercent"];
  return {version:1,indicators:ids.map(id=>({id,targetPercent:null,goalsFor:1,goalsAgainst:1}))};
};

test("score rules HTTP: secured per agency/league, revisioned, immutable on rejected writes",async()=>{
  const dataDir=await fs.mkdtemp(path.join(os.tmpdir(),"stef-score-rules-"));
  const socket=net.createServer();
  socket.listen(0,"127.0.0.1");await once(socket,"listening");
  const port=socket.address().port;
  await new Promise(resolve=>socket.close(resolve));
  const url="http://127.0.0.1:"+port;
  const server=spawn(process.execPath,["server/index.mjs"],{
    env:{...process.env,STEF_DATA_DIR:dataDir,STEF_BIND_HOST:"127.0.0.1",PORT:String(port),
      NODE_ENV:"test",STEF_AGENCIES_JSON:JSON.stringify([
        owned("Agen","058",true),owned("Autre","059",true),owned("Lecture seule","060",false),
      ])},
    stdio:["ignore","pipe","pipe"],
  });
  let stderr="";
  server.stderr.on("data",part=>{stderr+=part.toString()});
  const api=(agency,league="argent")=>url+"/api/agencies/"+agency+"/score-rules?leagueId="+league;
  const get=(agency,league="argent",code="TEST-"+agency)=>
    fetch(api(agency,league),{headers:{"x-access-code":code}});
  const put=(agency,league,profile,revision,code="TEST-"+agency)=>
    fetch(url+"/api/agencies/"+agency+"/score-rules",{
      method:"PUT",headers:{"Content-Type":"application/json","x-access-code":code},
      body:JSON.stringify({leagueId:league,profile,expectedRevision:revision}),
    });
  try {
    let started=false;
    for(let attempt=0;attempt<100;attempt++){
      try {if((await fetch(url+"/api/health")).ok){started=true;break}}catch{/* start */}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(started,stderr);
    assert.equal((await get("058","argent","wrong")).status,401);
    assert.equal((await get("059","argent","TEST-058")).status,401);
    assert.equal((await get("058","unknown")).status,400);
    const defaultResp=await get("058");
    assert.equal(defaultResp.status,200);
    const initial=await defaultResp.json();
    assert.equal(initial.scoreRulesRevision,null);
    assert.equal(initial.profile.indicators.length,4);
    assert.equal(initial.catalog.length,8);
    assert.equal(initial.preview,null);
    const preview=await fetch(api("058")+"&preview=1",{
      headers:{"x-access-code":"TEST-058"}});
    assert.equal(preview.status,200);
    assert.equal((await preview.json()).preview.status,"no_match");
    const draftSimulation=await fetch(url+"/api/agencies/058/score-rules/preview",{
      method:"POST",headers:{"Content-Type":"application/json","x-access-code":"TEST-058"},
      body:JSON.stringify({leagueId:"argent",profile:profiles()}),
    });
    assert.equal(draftSimulation.status,200);
    assert.equal((await draftSimulation.json()).preview.status,"no_match");
    assert.equal((await fetch(url+"/api/agencies/058/score-rules/preview",{
      method:"POST",headers:{"Content-Type":"application/json","x-access-code":"TEST-058"},
      body:JSON.stringify({leagueId:"argent",profile:{version:1,indicators:[]}}),
    })).status,400);
    assert.equal((await put("060","argent",profiles(),null)).status,403);
    assert.equal((await put("058","argent",{version:1,indicators:[]},null)).status,400);
    assert.deepEqual(await fs.readdir(dataDir),[],"Invalid rules must not write any agency file");

    const p=profiles();
    p.indicators[0].goalsFor=3;
    p.indicators[1].goalsAgainst=2;
    const saved=await put("058","argent",p,null);
    assert.equal(saved.status,200,await saved.clone().text());
    const data=await saved.json();
    assert.equal(data.profile.indicators[0].goalsFor,3);
    assert.ok(data.scoreRulesRevision);
    assert.equal((await put("058","argent",p,null)).status,409,
      "An outdated revision may not overwrite the newer profile");
    const invalid=structuredClone(p);
    invalid.indicators[1].id="passRate";
    assert.equal((await put("058","argent",invalid,data.scoreRulesRevision)).status,400);
    assert.equal((await (await get("058")).json()).profile.indicators[0].goalsFor,3);
    const otherAgency=await (await get("059")).json();
    assert.equal(otherAgency.profile.indicators[0].goalsFor,1);
    assert.equal(otherAgency.scoreRulesRevision,null);
    const otherLeague=await (await get("058","or")).json();
    assert.equal(otherLeague.profile.indicators[0].goalsFor,1);
    assert.equal(otherLeague.scoreRulesRevision,data.scoreRulesRevision,
      "Optimistic lock protects the complete per-agency file");

    const savedLdc=await put("058","or",{
      ...profiles(),indicators:profiles().indicators.slice(0,3),
    },data.scoreRulesRevision);
    assert.equal(savedLdc.status,200);
    const result=await savedLdc.json();
    assert.equal(result.profile.indicators.length,3);
    assert.equal((await (await get("058")).json()).profile.indicators[0].goalsFor,3,
      "Saving a second league cannot replace the first");

    const concurrent=profiles();concurrent.indicators[0].goalsFor=2;
    const revision=result.scoreRulesRevision;
    const [a,b]=await Promise.all([put("058","argent",concurrent,revision),
      put("058","or",concurrent,revision)]);
    assert.deepEqual([a.status,b.status].sort((x,y)=>x-y),[200,409],
      "Concurrent writes must have one winner and one conflict");
    const persisted=JSON.parse(await fs.readFile(path.join(dataDir,"058","score-rules.json"),"utf8"));
    assert.deepEqual(Object.keys(persisted.leagues).sort(),["argent","or"]);
    assert.equal((await get("060")).status,200,"Read-only agency may inspect the rules");
  } finally {
    if(server.exitCode===null&&server.signalCode===null){
      const closed=once(server,"close");
      server.kill("SIGTERM");await closed;
    }
    await fs.rm(dataDir,{recursive:true,force:true});
  }
});
