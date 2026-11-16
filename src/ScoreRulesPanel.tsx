import { useEffect, useMemo, useState } from "react";
import "./score-rules-panel.css";

type ScoreRule = {
  id: string;
  targetPercent: number | null;
  goalsFor: number;
  goalsAgainst: number;
};
type ScoreProfile = { version: number; indicators: ScoreRule[] };
type CatalogItem = { id: string; label: string; source: "Excel" | "106J" };
type Missing = { id: string; label: string; reason: string };
type Preview = {
  status: "available" | "unavailable" | "no_match";
  goalsFor?: number | null;
  goalsAgainst?: number | null;
  missingIndicators?: Missing[];
  referenceScore?: { status: string; goalsFor: number | null; goalsAgainst: number | null };
  message?: string;
};
type State = {
  catalog: CatalogItem[];
  profile: ScoreProfile;
  defaultProfile: ScoreProfile;
  scoreRulesRevision: string | null;
  preview: Preview | null;
};

export function ScoreRulesPanel({
  agencyCode, accessCode, canEdit, leagueId, leagueTargetPercent, onSaved,
}: {
  agencyCode: string;
  accessCode: string;
  canEdit: boolean;
  leagueId: string;
  leagueTargetPercent: number;
  onSaved?: () => void;
}) {
  const [state,setState]=useState<State | null>(null);
  const [draft,setDraft]=useState<ScoreProfile | null>(null);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  const [notice,setNotice]=useState("");
  const [preview,setPreview]=useState<Preview | null>(null);
  const key=agencyCode+"|"+leagueId;
  const url="/api/agencies/"+encodeURIComponent(agencyCode)+"/score-rules";
  const headers={"x-access-code":accessCode};
  const dirty=Boolean(draft&&state&&JSON.stringify(draft)!==JSON.stringify(state.profile));
  const activeCount=draft?.indicators.length??0;
  const maxGoals=useMemo(()=>(draft?.indicators??[]).reduce((sum,item)=>sum+item.goalsFor,0),[draft]);

  useEffect(()=>{
    let valid=true;
    setLoading(true);setError("");setNotice("");setPreview(null);setState(null);setDraft(null);
    const retrieve=async()=>{
      try{
        const response=await fetch(url+"?leagueId="+encodeURIComponent(leagueId),{
          headers,cache:"no-store",
        });
        const payload=await response.json();
        if(!response.ok)throw new Error(payload.message??"Impossible de charger les règles du score.");
        if(!valid)return;
        const value=payload as State;
        setState(value);
        setDraft(structuredClone(value.profile));
      }catch(caught){
        if(valid)setError(caught instanceof Error?caught.message:"Règles indisponibles.");
      }finally{
        if(valid)setLoading(false);
      }
    };
    void retrieve();
    return ()=>{valid=false};
  // The session and league identity are the only loading keys.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key,accessCode]);

  function toggle(id:string){
    if(!draft || !canEdit || busy)return;
    const includes=draft.indicators.some(rule=>rule.id===id);
    if(includes&&draft.indicators.length<=2){
      setError("Conserve au moins 2 indicateurs pour le score.");
      return;
    }
    if(!includes&&draft.indicators.length>=6){
      setError("Le score peut inclure au maximum 6 indicateurs.");
      return;
    }
    setError("");setNotice("");setPreview(null);
    setDraft({...draft,indicators:includes
      ?draft.indicators.filter(rule=>rule.id!==id)
      :[...draft.indicators,{id,targetPercent:null,goalsFor:1,goalsAgainst:1}]});
  }

  function modify(id:string,field:"targetPercent"|"goalsFor"|"goalsAgainst",value:number|null){
    if(!draft || !canEdit || busy)return;
    setDraft({...draft,indicators:draft.indicators.map(rule=>rule.id===id
      ?{...rule,[field]:value}:rule)});
    setNotice("");setPreview(null);
  }

  async function simulate(){
    if(!draft)return;
    setBusy(true);setError("");setNotice("");
    try {
      const response=await fetch(url+"/preview",{
        method:"POST",headers:{"Content-Type":"application/json",...headers},
        body:JSON.stringify({leagueId,profile:draft}),cache:"no-store",
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message??"Prévisualisation impossible.");
      setPreview(result.preview as Preview);
    }catch(caught){setError(caught instanceof Error?caught.message:"Prévisualisation impossible.");}
    finally{setBusy(false);}
  }

  async function save(){
    if(!state || !draft || !canEdit)return;
    setBusy(true);setError("");setNotice("");
    try{
      const response=await fetch(url,{
        method:"PUT",headers:{"Content-Type":"application/json",...headers},
        body:JSON.stringify({leagueId,profile:draft,expectedRevision:state.scoreRulesRevision}),
      });
      const result=await response.json();
      if(!response.ok)throw new Error(result.message??"Enregistrement impossible.");
      const next={...state,profile:result.profile as ScoreProfile,
        scoreRulesRevision:result.scoreRulesRevision as string,preview:null};
      setState(next);
      setDraft(structuredClone(next.profile));
      onSaved?.();
      setPreview(null);
      setNotice("Règles enregistrées pour cette agence et cette ligue. Les autres écrans sont actualisés.");
    }catch(caught){
      setError(caught instanceof Error?caught.message:"Enregistrement impossible.");
    }finally{setBusy(false);}
  }

  return (
    <section className="score-rules-panel" aria-labelledby="score-rules-heading">
      <header className="score-rules-heading">
        <div>
          <span className="score-rules-kicker">BUREAU DU COACH · BARÈME</span>
          <h3 id="score-rules-heading">Personnaliser le score du MATCH</h3>
          <p>Choisis 2 à 6 indicateurs, leur objectif et leurs buts. Les KPI calculés restent inchangés.</p>
        </div>
        <span className="score-rules-pill">{activeCount} KPI sélectionnés</span>
      </header>
      {loading && <p role="status">Chargement des règles de cette ligue…</p>}
      {!loading && draft && state && (
        <>
          <div className="score-rules-guide">
            <p><strong>But marqué :</strong> taux strictement supérieur à l'objectif.</p>
            <p><strong>But encaissé :</strong> taux inférieur ou égal à l'objectif.</p>
            <p>Si une donnée sélectionnée est absente, le résultat reste incomplet.</p>
          </div>
          <div className="score-rules-headline">
            <span>{dirty?"Configuration non enregistrée":"Règles de l'agence enregistrées"}</span>
            <span>Maximum possible : {maxGoals} buts marqués</span>
          </div>
          <div className="score-rules-grid">
            {state.catalog.map(item=>{
              const rule=draft.indicators.find(row=>row.id===item.id);
              const enabled=Boolean(rule);
              return <article key={item.id} className={"score-rules-item"+(enabled?" is-selected":"")}>
                <label className="score-rules-item-title">
                  <input type="checkbox" checked={enabled} disabled={!canEdit||busy}
                    onChange={()=>toggle(item.id)} aria-label={"Activer "+item.label}/>
                  <span>{item.label}</span>
                  <small>{item.source}</small>
                </label>
                {rule && <div className="score-rules-fields">
                  <label>Objectif (%)
                    <select value={rule.targetPercent===null?"league":"custom"}
                      aria-label={"Mode d'objectif "+item.label}
                      disabled={!canEdit||busy}
                      onChange={e=>modify(item.id,"targetPercent",
                        e.target.value==="league"?null:leagueTargetPercent)}>
                      <option value="league">Ligue ({leagueTargetPercent} %)</option>
                      <option value="custom">Personnalisé</option>
                    </select>
                    {rule.targetPercent!==null && <input type="number" min={1} max={100}
                      value={rule.targetPercent}
                      aria-label={"Objectif personnalisé "+item.label}
                      disabled={!canEdit||busy}
                      onChange={e=>modify(item.id,"targetPercent",Number(e.target.value))}/>}
                  </label>
                  <label>Buts marqués
                    <select aria-label={"Buts marqués "+item.label} value={rule.goalsFor}
                      disabled={!canEdit||busy}
                      onChange={e=>modify(item.id,"goalsFor",Number(e.target.value))}>
                      {[1,2,3].map(num=><option value={num} key={num}>+{num}</option>)}
                    </select>
                  </label>
                  <label>Buts encaissés
                    <select aria-label={"Buts encaissés "+item.label} value={rule.goalsAgainst}
                      disabled={!canEdit||busy}
                      onChange={e=>modify(item.id,"goalsAgainst",Number(e.target.value))}>
                      {[1,2,3].map(num=><option value={num} key={num}>+{num}</option>)}
                    </select>
                  </label>
                </div>}
              </article>;
            })}
          </div>
          <p className="score-rules-warning">
            Les valeurs 106J participent au score même si leur date diffère de celle de l’Excel. La date source reste visible et les valeurs absentes ne sont pas assimilées à un échec.
            Les KPI sélectionnés passent dans les bulles du score et quittent le carrousel. Le score de référence à 4 KPI reste disponible pour les comparaisons entre agences.
          </p>
          <div className="score-rules-actions">
            <button type="button" className="secondary-button compact" disabled={busy}
              onClick={()=>{setDraft(structuredClone(state.defaultProfile));setPreview(null);setNotice("");setError("");}}>
              Rétablir les 4 KPI par défaut
            </button>
            <button type="button" className="secondary-button compact" disabled={busy}
              onClick={()=>void simulate()}>Prévisualiser le score</button>
            {canEdit && <button type="button" className="primary-button" disabled={!dirty||busy}
              onClick={()=>void save()}>Enregistrer le barème</button>}
          </div>
          {preview && <div className="score-rules-preview" role="status">
            <h4>Simulation sur le dernier MATCH de cette agence</h4>
            {preview.status==="available" && <strong className="score-rules-score">
              {preview.goalsFor} – {preview.goalsAgainst}
            </strong>}
            {preview.status==="unavailable" && <>
              <strong>Score incomplet — aucune défaite fictive</strong>
              <p>{preview.missingIndicators?.map(m=>m.label+" : "+m.reason).join(" · ")}</p>
            </>}
            {preview.status==="no_match" && <p>{preview.message}</p>}
            {preview.referenceScore?.status==="available" &&
              <p>Score de référence : {preview.referenceScore.goalsFor} – {preview.referenceScore.goalsAgainst}</p>}
          </div>}
        </>
      )}
      {!canEdit&&!loading&&<p>Accès en lecture seule : seuls les responsables habilités peuvent modifier le barème.</p>}
      {error&&<p className="score-rules-error" role="alert">{error}</p>}
      {notice&&<p className="score-rules-success" role="status">{notice}</p>}
    </section>
  );
}
