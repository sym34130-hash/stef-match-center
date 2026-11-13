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
  // Four operational slides; the hourly chart exposes unloading data only.
  const operational = page.getByRole("region", { name: "Graphiques de lecture opérationnelle" });
  await expect(operational.locator(".operational-chart-slide")).toHaveCount(4);
  await expect(operational.locator(".performance-chart-panel")).toHaveCount(1);
  await expect(page.locator(".operational-charts-carousel-counter")).toContainText("1 / 4");
  await expect(page.locator(".operational-charts-carousel-dots button")).toHaveCount(4);
  await expect(page.getByRole("tab", { name: "Afficher % centres réussis" })).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart")).toHaveCount(1);
  await expect(chartPanel.getByRole("button", { name: /Performance globale|Tous les déchargements/ })).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-caption")).toContainText("tous segments dont LIV");
  await expect(chartPanel.locator(".performance-chart-heading strong")).toContainText("déchargements dans le délai");
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
  // Zoom remains functional with the unloading-only series.
  await chartPanel.getByRole("button", { name: "Agrandir le graphique" }).click();
  const zoom = page.getByRole("dialog", { name: "Graphique Performance horaire agrandi" });
  await expect(zoom).toBeVisible();
  await expect(zoom.locator(".performance-chart")).toHaveCount(1);
  await expect(zoom.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await expect(zoom.getByRole("button", { name: /Performance globale|Tous les déchargements/ })).toHaveCount(0);
  await zoom.getByRole("button", { name: "Fermer le graphique agrandi" }).click();
  await expect(zoom).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await expect(page.locator(".operational-charts-carousel-counter")).toContainText("1 / 4");

  // Regression: the unloading curve ends at 20h; the official 21h
  // observations must never reappear as an extra plotted point.
  chartSnapshot.hourlyPerformance = [
    { label: "13h", hour: 13, won: 1, total: 1, rate: 100 },
    { label: "19h", hour: 19, won: 3, total: 6, rate: 50 },
    { label: "20h", hour: 20, won: 1, total: 1, rate: 100 },
  ];
  await page.reload();
  await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
  await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
  await expect(chartPanel.locator(".performance-chart-point")).toHaveCount(3);
  await expect(chartPanel.locator(".performance-chart-point").last().locator(".performance-chart-hour")).toHaveText("20h");
  await expect(chartPanel.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(chartPanel.locator(".performance-chart-empty-hour")).toContainText(["14h","15h","16h","17h","18h","21h","22h"]);
  await expect(chartPanel.locator(".performance-chart-empty-bucket")).toHaveCount(7);
  await expect(chartPanel.locator(".performance-chart-last-bucket")).toHaveCount(0);
  await expect(chartPanel.locator(".performance-chart")).not.toContainText("20h mesuré");
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
  await expectNoGreenAfterLastPoint("20h", "21h");
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).toHaveText("Sans données");
  await expect(chartPanel.locator(".performance-chart-no-data-tail text")).not.toHaveAttribute("transform", /rotate\(-90\)/);
  await expect(chartPanel.locator(".performance-chart-total")).toContainText("5/8 opérations");
  await chartPanel.getByRole("button", { name: "Agrandir le graphique" }).click();
  await expect(zoom.locator(".performance-chart-end-boundary")).toContainText("22h30");
  await expect(zoom.locator(".performance-chart-no-data-tail")).toHaveAttribute(
    "aria-label", "Pas de nouveau point après 20h ; aucun créneau éligible à partir de 21h");
  await expect(zoom.locator(".performance-chart-point").last().locator(".performance-chart-hour")).toHaveText("20h");
  await zoom.getByRole("button", { name: "Fermer le graphique agrandi" }).click();

  // The duel-details columns are narrowed ONLY in this card. No data-model change.
  await page.locator(".operational-charts-carousel-dots").getByRole("tab", { name: "Afficher % duels gagnés" }).click();
  const duelDetails = page.locator(".reception-quality-card .duel-quality-details");
  await duelDetails.locator("summary").click();
  await expect(duelDetails.locator(".duel-quality-table-row.is-head > span")).toHaveText(
    ["Voyage", "Heure", "Nb poz", "Temps/poz", "Résultat"]);
  await expect(duelDetails.locator(".duel-destination")).toHaveCount(0);
  const hourly = page.locator(".reception-hourly-analysis");
  const slots = chartSnapshot.unloadingHourlyAnalysis?.items ?? [];
  const measured = slots.find((slot: { state: string; meanSecondsPerPosition: number | null }) =>
    slot.state === "disponible" && slot.meanSecondsPerPosition != null);
  expect(measured, "Fixture must cover the available reception average").toBeTruthy();
  const measuredIndex = slots.indexOf(measured!);
  const timeLabel = (seconds: number) => {
    const rounded = Math.max(0, Math.round(seconds));
    return rounded < 60 ? `${rounded}s` : `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
  };
  const measuredBar = hourly.locator(".reception-hour-button").nth(measuredIndex);
  await expect(measuredBar.locator(".reception-hour-bar-volume")).toHaveText(measured!.distinctPositions.toLocaleString("fr-FR"));
  await expect(measuredBar.locator(".reception-hour-value")).toHaveText(timeLabel(measured!.meanSecondsPerPosition!));
  await measuredBar.click();
  await expect(page.locator("#reception-hour-detail")).toContainText("Positions distinctes");
  await expect(page.locator("#reception-hour-detail")).toContainText("Moyenne");

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

  // Lot B: the first diagnostic screen exposes three facts only; all details
  // remain optional. Synthetic data only, never a real agency snapshot.
  chartSnapshot.zonageDiagnostic = {
    ...(chartSnapshot.zonageDiagnostic ?? {}),
    state: "disponible",
    night: chartSnapshot.zonageDiagnostic?.night ?? null,
    latePositions: 3,
    onTimePositions: 2,
    qualifiablePositions: 5,
    unqualifiablePositions: 2,
    receivedPositions: 7,
    anomalyRate: 60,
    coverageRate: 71.4,
    targetMinutes: 30,
    top5: [{
      travelCode: "CI-TRIP", latePositions: 3, onTimePositions: 2,
      unqualifiablePositions: 2, qualifiablePositions: 5, receivedPositions: 7,
      anomalyRate: 60, coverageRate: 71.4,
    }],
    travels: [],
    details: [{ travelCode: "CI-TRIP", position: "CI-P01", classification: "hors_delai", delaySeconds: 2100 }],
  };
  const openDiagnostic = async () => {
    await page.reload();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await nav.getByRole("button", { name: "Aller à Statistiques du match", exact: true }).click();
    await page.locator(".operational-charts-carousel-dots")
      .getByRole("tab", { name: "Afficher Diagnostic opérationnel" }).click();
  };
  await openDiagnostic();
  const diagnostic = page.locator(".operational-diagnostic-card");
  await expect(diagnostic.locator(".diagnostic-big-number")).toHaveText("3");
  await expect(diagnostic.locator(".diagnostic-priority")).toContainText("CI-TRIP");
  await expect(diagnostic.locator(".diagnostic-priority")).toContainText("3 positions en retard");
  await expect(diagnostic.locator(".diagnostic-unknown")).toContainText("2 positions à vérifier");
  await expect(diagnostic.locator(".diagnostic-more")).not.toHaveAttribute("open", "");
  await expect(diagnostic.locator(".diagnostic-ranking")).not.toBeVisible();
  await diagnostic.getByRole("button", { name: "Voir les positions du voyage CI-TRIP" }).click();
  const details = page.getByRole("dialog", { name: "Positions à examiner · CI-TRIP" });
  await expect(details).toBeVisible();
  await expect(details.locator(".zonage-detail-list li")).toHaveCount(1);
  await details.getByRole("button", { name: "Fermer les positions à examiner" }).click();
  await diagnostic.locator(".diagnostic-more > summary").click();
  await expect(diagnostic.locator(".diagnostic-top5 > li")).toHaveCount(1);

  // Regression: the expanded ranking must never print two texts on top of
  // each other, including unusually long journey codes on narrow screens.
  const shortTrip = chartSnapshot.zonageDiagnostic.top5[0];
  chartSnapshot.zonageDiagnostic = {
    ...chartSnapshot.zonageDiagnostic,
    top5: [
      { ...shortTrip, travelCode: "VOYAGE-AVEC-UN-CODE-EXCEPTIONNELLEMENT-LONG", latePositions: 3 },
      ...[2, 3, 4, 5].map((n) => ({ ...shortTrip, travelCode: `CI-TRIP-${n}`, latePositions: Math.max(1, 6 - n) })),
    ],
  };
  await openDiagnostic();
  await diagnostic.locator(".diagnostic-more > summary").click();
  const ranking = diagnostic.locator(".diagnostic-ranking");
  await expect(ranking.locator(".diagnostic-top5 > li")).toHaveCount(5);
  for (const width of [320, 390, 768, 1024, 1536]) {
    await page.setViewportSize({ width, height: width < 400 ? 740 : 864 });
    const geometry = await ranking.evaluate((root) => {
      const rect = (element: Element) => element.getBoundingClientRect();
      const textRect = (element: Element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      const overlap = (a: DOMRect, b: DOMRect) => Math.min(a.right,b.right)-Math.max(a.left,b.left)>1
        && Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1;
      const bounds = rect(root);
      const rows = Array.from(root.querySelectorAll(".diagnostic-top5 > li"));
      const measured = rows.map(row => {
        const box = rect(row);
        const code = textRect(row.querySelector(".diagnostic-trip-main strong")!);
        const count = textRect(row.querySelector(".diagnostic-trip-main > span")!);
        const button = row.querySelector(".diagnostic-detail-button");
        const arrow = button ? rect(button) : null;
        return {
          inSection: box.left >= bounds.left - 2 && box.right <= bounds.right + 2,
          noOverlap: !overlap(code,count) && (!arrow || (!overlap(code,arrow) && !overlap(count,arrow))),
          inRow: code.left >= box.left - 2 && code.right <= box.right + 2
            && count.left >= box.left - 2 && count.right <= box.right + 2,
          top: box.top, bottom: box.bottom,
        };
      });
      return {
        measured,
        headerEndsBeforeRows: rect(root.querySelector("h4")!).bottom <= measured[0].top,
        noInterRowOverlap: measured.every((item,index) => !index || item.top >= measured[index-1].bottom-1),
        noPageOverflow: document.documentElement.scrollWidth <= window.innerWidth+1,
      };
    });
    expect(geometry.measured, `${width}px should contain five rows`).toHaveLength(5);
    expect(geometry.headerEndsBeforeRows, `${width}px heading/ranking collision`).toBe(true);
    expect(geometry.noInterRowOverlap, `${width}px adjacent ranking rows collide`).toBe(true);
    expect(geometry.noPageOverflow, `${width}px page overflow`).toBe(true);
    for (const [index,row] of geometry.measured.entries()) {
      expect(row.inSection, `${width}px row ${index} exceeds ranking`).toBe(true);
      expect(row.noOverlap, `${width}px row ${index} overlaps text or button`).toBe(true);
      expect(row.inRow, `${width}px row ${index} text outside card`).toBe(true);
    }
  }

  chartSnapshot.zonageDiagnostic = {
    ...chartSnapshot.zonageDiagnostic,
    latePositions: 0, top5: [], details: [], unqualifiablePositions: 0,
  };
  await openDiagnostic();
  await expect(diagnostic.locator(".diagnostic-big-number")).toHaveText("0");
  await expect(diagnostic.locator(".diagnostic-priority")).toContainText("Aucun voyage en retard");
  chartSnapshot.zonageDiagnostic = {
    ...chartSnapshot.zonageDiagnostic,
    state: "indisponible", onTimePositions: 0, qualifiablePositions: 0,
    unqualifiablePositions: 7, receivedPositions: 7,
  };
  await openDiagnostic();
  await expect(diagnostic.locator(".diagnostic-big-number")).toHaveText("—");
  await expect(diagnostic.locator(".diagnostic-priority")).toContainText("Analyse indisponible");
  await expect(diagnostic.locator(".diagnostic-unknown")).toContainText("7 positions à vérifier");
  await expect(diagnostic.locator(".diagnostic-unknown")).toContainText("ne sont pas comptées comme des retards");
});
