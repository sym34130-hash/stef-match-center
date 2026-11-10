import { expect, test } from "@playwright/test";
import * as XLSX from "xlsx";
import pdfParse from "pdf-parse/lib/pdf-parse.js";

const base = "http://127.0.0.1:4287";
const ids = ["performance", "accident-free-days", "injuries", "positions", "arrival", "departure"];
function workbook(agency: string) {
  const wb = XLSX.utils.book_new();
  const columns = ["Opérateur", "Date heure de début d'opération", "Type d'opération",
    "N° Position", "Code Voyage", "Agence Segment", "Type Segment",
    "Filtre opérateur", "Filtre heure", "Poste", "Poz non zonées", "DZ", "Duels gagnés", "Client de tri"];
  const rows = [];
  for (let i = 0; i < 26; i++) {
    rows.push([`OP CI ${i % 3}`, `17/09/2026 22:${String(i).padStart(2, "0")}:00`,
      i % 5 === 0 ? "ZONAGE" : "DECHG", `P-${String(i).padStart(3, "0")}`,
      "EX-CI-001", agency, "EX", "", "", "Défenseur", "",
      (100 + i) / 86400, 1, "TRI CI"]);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([columns, ...rows]), "Données");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ["Chargement"],
    ["Code Voyage", "Min. de Date/Heure de début d'opération", "Nombre de N° Position", "TC", "TC/poz", "Commentaire"],
    ["CHG-CI-OK", "17/09/2026 22:00:00", 20, 90 / 86400, 90 / 86400, ""],
  ]), "TCD PPT");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}
test("P1 — parcours réel API → navigateur → brief → PDF sur données synthétiques isolées", async ({ page, request }, info) => {
  const agency = ({ desktop: "058", tablet: "059", mobile: "060" } as Record<string, string>)[info.project.name];
  const headers = { "x-access-code": `CI-ONLY-${agency}` };
  const agencyUrl = `${base}/api/agencies/${agency}`;
  const imported = await request.post(`${agencyUrl}/import`, {
    headers, multipart: { file: { name: `CI_SYNTHETIQUE_${agency}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: workbook(agency) } },
  });
  expect(imported.status(), await imported.text()).toBe(200);
  const { snapshot } = await imported.json();
  expect(snapshot.agency.code).toBe(agency);
  expect(snapshot.summary.operations).toBeGreaterThan(0);
  expect(snapshot.summary.positions).toBeGreaterThan(0);
  const leagueResponse = await request.get(`${agencyUrl}/league-configs`, { headers });
  expect(leagueResponse.status()).toBe(200);
  const league = ((await leagueResponse.json()).configs as Array<{ id: string; zonageMinutes: number; loadingSeconds: number; unloadingSeconds: number; scoreTargetPercent: number }>).find(c => c.id === "argent");
  expect(league).toBeTruthy();
  const existingBrief = await request.get(`${agencyUrl}/causerie?matchDate=${snapshot.match.date}`, { headers });
  expect(existingBrief.status()).toBe(200);
  const current = await existingBrief.json();
  const savedBrief = await request.post(`${agencyUrl}/causerie`, {
    headers, data: {
      expectedRevision: current.causerieRevision, matchDate: snapshot.match.date,
      plan: {
        briefLayoutVersion: 2, visibleIndicatorsVersion: 2, visibleIndicators: ids,
        team: `ÉQUIPE CI ${agency}`, manager: "RESPONSABLE TEST",
        attack: ["Service client : priorité aux départs CI"],
        midfield: ["Expédition : remonter les anomalies"],
        defense: ["SST : rester vigilant"],
        coach: { tactic: "Contrôler les quais", priority: "Départs", arbitration: "Arbitrer" },
        attachments: { attack: [], midfield: [], defense: [] },
      },
    },
  });
  expect(savedBrief.status(), await savedBrief.text()).toBe(200);
  const savedBriefState = await savedBrief.json();
  const profileGet = await request.get(`${agencyUrl}/export/profile`, { headers });
  expect(profileGet.status()).toBe(200);
  let profileState = await profileGet.json();
  const pdfWithRevision = async () => {
    const q = new URLSearchParams({
      leagueId: "argent", matchDate: snapshot.match.date, importedAt: snapshot.importedAt,
      causerieRevision: savedBriefState.causerieRevision ?? "",
      pdfProfileRevision: profileState.profileRevision ?? "",
      zonageMinutes: String(league!.zonageMinutes), loadingSeconds: String(league!.loadingSeconds),
      unloadingSeconds: String(league!.unloadingSeconds),
      scoreTargetPercent: String(league!.scoreTargetPercent),
    });
    return request.get(`${agencyUrl}/export/match.pdf?${q}`, { headers });
  };
  for (const count of [4, 6]) {
    const savedProfile = await request.put(`${agencyUrl}/export/profile`, {
      headers, data: { expectedRevision: profileState.profileRevision,
        profile: { version: 1, chartId: count === 4 ? "reception-time" : "passes-hourly",
          indicatorIds: ids.slice(0, count),
          dailyBrief: { matchDate: snapshot.match.date, safety: "Vérifier les EPI",
            priorities: "Priorité service client", attack: "Service client CI : consigne enregistrée",
            midfield: "Expédition CI : plan de départ", defense: "SST CI : contrôle à quai",
            decisions: "Arbitrage CI : confirmer les créneaux" },
        } },
    });
    expect(savedProfile.status(), await savedProfile.text()).toBe(200);
    profileState = await savedProfile.json();
    const exported = await pdfWithRevision();
    expect(exported.status(), await exported.text()).toBe(200);
    expect(exported.headers()["content-type"]).toContain("application/pdf");
    const parsed = await pdfParse(await exported.body());
    expect(parsed.numpages).toBe(2);
    expect(parsed.text).toContain("Service client CI");
    expect(parsed.text).toContain("SST CI");
    expect(parsed.text).toContain(`Agence synthétique ${agency}`.normalize("NFD").replace(/[\u0300-\u036f]/g, "").slice(0,10)); // render title
    expect(parsed.text).toContain("LIGUE 1");
    expect(parsed.text).toContain(count === 4 ? "RÉCEPTION" : "PASSES");
  }
  // Strict optimistic lock: an obsolete PDF profile revision must not be accepted.
  const stale = await request.get(`${agencyUrl}/export/match.pdf?${new URLSearchParams({
    leagueId: "argent", matchDate: snapshot.match.date, importedAt: snapshot.importedAt,
    causerieRevision: savedBriefState.causerieRevision ?? "", pdfProfileRevision: "stale",
    zonageMinutes: String(league!.zonageMinutes), loadingSeconds: String(league!.loadingSeconds),
    unloadingSeconds: String(league!.unloadingSeconds), scoreTargetPercent: String(league!.scoreTargetPercent),
  })}`, { headers });
  expect(stale.status()).toBe(409);
  const cross = await request.get(`${base}/api/agencies/${agency === "058" ? "059" : "058"}/snapshot`, { headers });
  expect(cross.status()).toBe(401);
  await page.goto("/");
  await page.getByLabel("Code agence").selectOption(agency);
  await page.getByLabel("Code d'accès").fill(`CI-ONLY-${agency}`);
  await page.getByRole("button", { name: "Accéder au match" }).click();
  await expect(page.getByRole("button", { name: "02 Feuille de match", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await expect(page.getByRole("button", { name: /Personnaliser le PDF/ })).toBeVisible();
  await page.getByRole("button", { name: /Personnaliser le PDF/ }).click();
  await expect(page.getByRole("button", { name: /Enregistrer et télécharger le PDF/ })).toBeVisible();
  // The bulky source-tonnage notification must never be recreated in preferences.
  await expect(page.getByText("Tonnage du PDF : vérification de la source")).toHaveCount(0);
});
