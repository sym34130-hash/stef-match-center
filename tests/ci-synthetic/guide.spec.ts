import { expect, test } from "@playwright/test";

// Production-like guide smoke test: uses the disposable P1 CI agencies and no
// confidential Excel/PDF inputs. Read-only navigation must never mutate data.
const sections=[
  "Démarrer","Préparer Excel","Importer et actualiser","Lire les écrans",
  "Analyser les anomalies","Modifier le plan","Administrateur",
  "Personnaliser le score","Exporter le PDF","Points d’attention",
];
const codes:Record<string,string>={desktop:"058",tablet:"059",mobile:"060"};

test("Guide utilisateur V4 : dix rubriques cohérentes et lisibles sur tous les formats",async({page},info)=>{
  const code=codes[info.project.name];
  const errors:string[]=[];
  const writes:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  page.on("request",request=>{
    if(request.url().includes("/api/agencies/")&&request.method()!=="GET")
      writes.push(request.method()+" "+request.url());
  });
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption(code);
  await page.getByLabel("Code d'accès").fill("CI-ONLY-"+code);
  await page.getByRole("button",{name:"Accéder au match"}).click();
  await page.getByRole("button",{name:"? Guide",exact:true}).click();
  const guide=page.locator(".guide-page"),nav=guide.getByRole("navigation",{name:"Sommaire du guide"});
  await expect(guide).toBeVisible();
  await expect(nav.locator(".guide-nav-item")).toHaveCount(10);
  const progress=guide.getByRole("progressbar");
  await expect(progress).toHaveAttribute("aria-valuemax","10");
  for(let i=0;i<sections.length;i++){
    const name=String(i+1).padStart(2,"0")+" "+sections[i];
    const item=nav.getByRole("button",{name,exact:true});
    await item.click();
    await expect(item).toHaveAttribute("aria-current","step");
    await expect(progress).toHaveAttribute("aria-valuenow",String(i+1));
    await expect(guide.locator(".guide-panel-heading .eyebrow")).toHaveText(
      new RegExp("^"+String(i+1).padStart(2,"0")+" ·"));
    await expect.poll(()=>page.evaluate(()=>
      document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  await expect(guide.getByRole("button",{name:"Étape suivante",exact:true})).toBeDisabled();
  await nav.getByRole("button",{name:"08 Personnaliser le score",exact:true}).click();
  await expect(guide).toContainText("Choisir 2 à 6 KPI");
  await expect(guide).toContainText("strictement supérieur");
  await expect(guide).toContainText("score de référence");
  await expect(guide).toContainText("Célébration activée");
  await nav.getByRole("button",{name:"09 Exporter le PDF",exact:true}).click();
  await expect(guide).toContainText("deux pages A4 paysage");
  await expect(guide).toContainText("N/D");
  await expect(guide).toContainText("Une valeur 106J ne s’imprime pas deux fois");
  await nav.getByRole("button",{name:"10 Points d’attention",exact:true}).click();
  await expect(guide).toContainText("KPI sélectionné absent des bulles");
  await expect(guide).toContainText("barèmes personnalisés");
  await expect(guide).not.toContainText("CI-ONLY-"+code);

  if(info.project.name==="desktop"){
    for(const [width,height] of [[320,700],[390,844],[768,1024],[1366,768],[1920,1080]]){
      await page.setViewportSize({width,height});
      for(const index of [0,6,7,8,9]){
        const item=nav.getByRole("button",{
          name:String(index+1).padStart(2,"0")+" "+sections[index],exact:true});
        await item.click();
        await expect.poll(()=>page.evaluate(()=>
          document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
        const dimensions=await guide.locator(".guide-panel").evaluate(node=>{
          const box=node.getBoundingClientRect();
          return {left:box.left,right:box.right,inside:node.scrollWidth<=node.clientWidth+1};
        });
        expect(dimensions.left).toBeGreaterThanOrEqual(-1);
        expect(dimensions.right).toBeLessThanOrEqual(width+1);
        expect(dimensions.inside,"Guide panel overflow at "+width+" px").toBe(true);
      }
    }
  }
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});
