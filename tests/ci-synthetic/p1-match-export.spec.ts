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
  await expect(page.getByRole("button", { name: "Personnaliser l'export PDF", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Personnaliser l'export PDF", exact: true }).click();
  await expect(page.getByRole("button", { name: /Enregistrer et télécharger le PDF/ })).toBeVisible();
  // The bulky source-tonnage notification must never be recreated in preferences.
  await expect(page.getByText("Tonnage du PDF : vérification de la source")).toHaveCount(0);
  // Display all eligible DECHG at 19h, including LIV; global KPI still differs.
  // Mock only the in-memory browser response, never mutate a server import.
  const chartSnapshot = structuredClone(snapshot);
  chartSnapshot.match.periodStart = "13:00";
  chartSnapshot.match.periodEnd = "22:30";
  chartSnapshot.match.timeRangeLabel = "13:00 - 22:30";
  chartSnapshot.hourlyPerformance = [
    { label: "13h", hour: 13, won: 1, total: 1, rate: 100 },
    { label: "19h", hour: 19, won: 3, total: 6, rate: 50 },
    { label: "22h", hour: 22, won: 1, total: 1, rate: 100 },
  ];
  chartSnapshot.overallHourlyPerformance = [
    { label: "13h", hour: 13, won: 10, total: 12, rate: 83.3 },
    { label: "19h", hour: 19, won: 6, total: 8, rate: 75 },
    { label: "22h", hour: 22, won: 9, total: 10, rate: 90 },
  ];
  await page.route(`**/api/agencies/${agency}/snapshot**`, route =>
    route.fulfill({ json: { snapshot: chartSnapshot } }));
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  const nav = page.getByRole("navigation", { name: "Navigation de la feuille de match" });
  await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  const chartPanel = page.locator(".performance-chart-panel");
  // One outer carousel vignette, two mutually exclusive inner views.
  const operational = page.getByRole("region", { name: "Graphiques de lecture opérationnelle" });
  await expect(operational.locator(".performance-chart-panel")).toHaveCount(1);
  await expect(page.locator(".operational-charts-carousel-counter")).toContainText("1 / 5");
  await expect(chartPanel.locator(".performance-chart")).toHaveCount(1);
  const overallButton = chartPanel.getByRole("button", { name: /1\/2 Performance globale/ });
  const filteredButton = chartPanel.getByRole("button", { name: /2\/2 Tous les déchargements/ });
  await expect(overallButton).toHaveAttribute("aria-pressed", "true");
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("25/30 opérations");
  await filteredButton.click();
  await expect(filteredButton).toHaveAttribute("aria-pressed", "true");
  await expect(chartPanel.locator(".performance-chart-caption")).toContainText("tous segments dont LIV");
  await expect(chartPanel.locator(".performance-chart-heading strong")).toContainText("déchargements dans le délai");
  await expect(overallButton).toHaveAttribute("aria-pressed", "false");
  await expect(chartPanel.locator(".performance-chart-sample")).toContainText("2 h à faible volume");
  await expect(chartPanel.locator(".performance-chart-sample")).toContainText("Pointillés");
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("5/8 opérations");
  const plotted = chartPanel.locator(".performance-chart-point circle");
  await expect(plotted).toHaveCount(3);
  const x = await plotted.evaluateAll(nodes => nodes.map(node => Number(node.getAttribute("cx"))));
  expect((x[1] - x[0]) / (x[2] - x[0])).toBeCloseTo(6 / 9, 2);
  const d = await chartPanel.locator(".performance-chart-line").getAttribute("d");
  expect((d?.match(/M /g) ?? []).length).toBe(3);
  // The line remains readable across gaps: dashed bridges are NOT measurements.
  await expect(chartPanel.locator(".performance-chart-gap")).toHaveCount(2);
  await expect(chartPanel.locator(".performance-chart-area")).toHaveCount(2);
  await expect(chartPanel.locator(".performance-chart-empty-hour")).toHaveCount(7);
  await expect(chartPanel.locator(".performance-chart-empty-bucket")).toHaveCount(7);
  await expect(chartPanel.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-empty-hour").first()).toContainText("14h");
  // Even when the 22h bucket has data, show the exact selected end at 22h30.
  await expect(chartPanel.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(chartPanel.locator(".performance-chart-no-data-tail")).toHaveCount(0);
  await chartPanel.locator(".performance-chart-breakdown summary").click();
  const dataRows = chartPanel.locator(".performance-chart-breakdown tbody tr");
  await expect(dataRows).toHaveCount(3);
  await expect(dataRows.nth(0)).toContainText("13h");
  await expect(dataRows.nth(0)).toContainText("100%");
  await expect(dataRows.nth(1)).toContainText("19h");
  await expect(dataRows.nth(1)).toContainText("50%");
  await expect(dataRows.nth(2)).toContainText("22h");
  // Both views share the unchanged zoom/modal behavior, including on mobile.
  await chartPanel.getByRole("button", { name: "Agrandir le graphique" }).click();
  const zoom = page.getByRole("dialog", { name: "Graphique Performance horaire agrandi" });
  await expect(zoom).toBeVisible();
  await expect(zoom.locator(".performance-chart")).toHaveCount(1);
  await expect(zoom.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await zoom.getByRole("button", { name: /1\/2 Performance globale/ }).click();
  await expect(zoom.locator(".performance-chart-total")).toContainText("25/30 opérations");
  await zoom.getByRole("button", { name: /2\/2 Tous les déchargements/ }).click();
  await expect(zoom.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await zoom.getByRole("button", { name: "Fermer le graphique agrandi" }).click();
  await expect(zoom).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await expect(page.locator(".operational-charts-carousel-counter")).toContainText("1 / 5");

  // Regression: 1/2 has no operations after 21h, 2/2 after 20h,
  // but BOTH must display empty 22h and the 22h30 selected-period boundary.
  chartSnapshot.overallHourlyPerformance = [
    { label: "13h", hour: 13, won: 10, total: 12, rate: 83.3 },
    { label: "19h", hour: 19, won: 6, total: 8, rate: 75 },
    { label: "21h", hour: 21, won: 9, total: 10, rate: 90 },
  ];
  chartSnapshot.hourlyPerformance = [
    { label: "13h", hour: 13, won: 1, total: 1, rate: 100 },
    { label: "19h", hour: 19, won: 3, total: 6, rate: 50 },
    { label: "20h", hour: 20, won: 1, total: 1, rate: 100 },
  ];
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await expect(chartPanel.locator(".performance-chart-point")).toHaveCount(3);
  await expect(chartPanel.locator(".performance-chart-point").last().locator(".performance-chart-hour")).toHaveText("21h");
  await expect(chartPanel.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(chartPanel.locator(".performance-chart-empty-hour")).toContainText(["14h","15h","16h","17h","18h","20h","22h"]);
  await expect(chartPanel.locator(".performance-chart-empty-bucket")).toHaveCount(7);
  await expect(chartPanel.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart")).not.toContainText("21h mesuré");
  // The visual no-data band must begin DIRECTLY at the last plotted dot,
  // without a one-hour hole. A 21h reading still describes 21:00–21:59:
  // the first truly empty bucket remains 22h, not 21h.
  const expectNoGreenAfterLastPoint = async (expectedLastPoint: string, expectedNoDataFrom: string) => {
    const geometry = await chartPanel.locator(".performance-chart").evaluate(svg => {
      const dots = [...svg.querySelectorAll<SVGCircleElement>(".performance-chart-point circle")];
      const lastX = dots.length ? Number(dots[dots.length - 1].getAttribute("cx")) : null;
      const greenRight = [...svg.querySelectorAll<SVGPathElement>(".performance-chart-area")].reduce(
        (max, path) => Math.max(max, path.getBBox().x + path.getBBox().width), -Infinity);
      const empty = svg.querySelector<SVGRectElement>(".performance-chart-no-data-tail rect");
      return { lastX, greenRight, emptyX: empty ? Number(empty.getAttribute("x")) : null };
    });
    expect(geometry.lastX).not.toBeNull();
    expect(geometry.greenRight).toBeLessThanOrEqual(geometry.lastX! + 0.5);
    expect(geometry.emptyX).toBeCloseTo(geometry.lastX!, 4);
    await expect(chartPanel.locator(".performance-chart-no-data-tail")).toHaveAttribute(
      "aria-label", `Pas de nouveau point après ${expectedLastPoint} ; aucun créneau éligible à partir de ${expectedNoDataFrom}`);
    await expect(chartPanel.locator(".performance-chart-no-data-tail title")).toContainText(
      `Les créneaux entièrement sans opération éligible commencent à ${expectedNoDataFrom}`);
    await expect(chartPanel.locator(".performance-chart-no-data-tail text")).toContainText("Sans données");
  };
  await expectNoGreenAfterLastPoint("21h", "22h");
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).toContainText("Sans données");
  // The neutral tail now fills the space directly after 21h, so the label
  // fits horizontally instead of being restricted to only 22h–22h30.
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).not.toHaveAttribute("transform", /rotate\(-90\)/);
  await expect(chartPanel.locator(".performance-chart-no-data-tail")).toContainText("Aucune donnée");
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("25/30 opérations");

  await chartPanel.getByRole("button", { name: /2\/2 Tous les déchargements/ }).click();
  await expect(chartPanel.locator(".performance-chart-point").last().locator(".performance-chart-hour")).toHaveText("20h");
  await expect(chartPanel.locator(".performance-chart-empty-hour")).toContainText(["14h","15h","16h","17h","18h","21h","22h"]);
  await expect(chartPanel.locator(".performance-chart-empty-bucket")).toHaveCount(7);
  await expect(chartPanel.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart")).not.toContainText("20h mesuré");
  await expectNoGreenAfterLastPoint("20h", "21h");
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).toContainText("Sans données");
  // 21h–22h30 has room for a horizontal label.
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).not.toHaveAttribute("transform", /rotate\(-90\)/);
  await expect(chartPanel.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(chartPanel.locator(".performance-chart-no-data-tail")).toContainText("Aucune donnée");
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await chartPanel.getByRole("button", { name: "Agrandir le graphique" }).click();
  await expect(zoom.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(zoom.locator(".performance-chart-no-data-tail")).toContainText("Aucune donnée");
  await expect(zoom.locator(".performance-chart-no-data-tail")).toHaveAttribute(
    "aria-label", "Pas de nouveau point après 20h ; aucun créneau éligible à partir de 21h");
  await expect(zoom.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await zoom.getByRole("button", { name: /1\/2 Performance globale/ }).click();
  await expect(zoom.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(zoom.locator(".performance-chart-point").last().locator(".performance-chart-hour")).toHaveText("21h");
  await expect(zoom.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await zoom.getByRole("button", { name: "Fermer le graphique agrandi" }).click();

  // Even if no measured points exist, the time window must remain visible.
  chartSnapshot.overallHourlyPerformance = [];
  chartSnapshot.hourlyPerformance = [];
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await expect(chartPanel.locator(".performance-chart")).toHaveCount(1);
  await expect(chartPanel.locator(".performance-chart-point")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-empty-hour")).toHaveCount(10);
  await expect(chartPanel.locator(".performance-chart-empty-bucket")).toHaveCount(10);
  await expect(chartPanel.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(chartPanel.locator(".performance-chart-no-data-message")).toContainText("Aucune opération éligible");
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("Volumes non disponibles");
});
