import { existsSync } from "node:fs";
import { chromium } from "@playwright/test";

// Render the actual MATCH UI, rather than reconstructing KPI/league formulas.
// Browser contexts are ephemeral and never reused between agency requests.
const PRINT_STYLE = `
@page { size: 13.333in 7.5in; margin: 0.24in; }
@media print {
  *, *::before, *::after {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    animation: none !important;
    transition: none !important;
  }
  html, body, #root {
    width: 100% !important; max-width: none !important;
    height: auto !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important;
    overflow: visible !important; background: #07192c !important;
  }
  body.match-pdf-export .app-shell, body.match-pdf-export .main-area,
  body.match-pdf-export .screen-transition, body.match-pdf-export .match-page {
    display: block !important; position: static !important;
    width: 100% !important; max-width: none !important;
    height: auto !important; min-height: 0 !important;
    margin: 0 !important; padding: 0 !important;
    overflow: visible !important; transform: none !important;
  }
  body.match-pdf-export .sidebar, body.match-pdf-export .top-bar,
  body.match-pdf-export .match-carousel-navigation,
  body.match-pdf-export .match-header-actions,
  body.match-pdf-export .match-indicators-customization,
  body.match-pdf-export .match-indicators-navigation,
  body.match-pdf-export .operational-charts-carousel-toolbar,
  body.match-pdf-export .operational-charts-carousel-dots,
  body.match-pdf-export .match-indicators-index,
  body.match-pdf-export .match-indicator-settings,
  body.match-pdf-export .match-kpi-actions,
  body.match-pdf-export .reception-scope-controls button,
  body.match-pdf-export .travel-exclusion-panel button,
  body.match-pdf-export .safety-card-form,
  body.match-pdf-export .safety-card-edit,
  body.match-pdf-export .match-exit-celebration,
  body.match-pdf-export button:not(.award-card) { display: none !important; }
  body.match-pdf-export .match-pdf-banner {
    display: flex !important; flex-wrap: wrap; align-items: center; justify-content: space-between;
    gap: 8px; padding: 12px 18px; margin-bottom: 8px;
    border: 1px solid #89d9c866; border-radius: 7px;
    background: linear-gradient(120deg,#0d314b,#20465e) !important;
    color: #f6fbff !important; font: 800 13px/1.4 Arial, sans-serif;
  }
  body.match-pdf-export .match-slide-viewport, body.match-pdf-export .match-slide-track,
  body.match-pdf-export .match-ceremony, body.match-pdf-export .awards-ceremony,
  body.match-pdf-export .match-statistics-section, body.match-pdf-export .match-brief-slide {
    display: block !important; position: static !important;
    inset: auto !important; opacity: 1 !important; visibility: visible !important;
    transform: none !important; overflow: visible !important;
    width: 100% !important; max-width: none !important;
    height: auto !important; min-height: 0 !important;
    margin: 0 !important;
    pointer-events: auto !important;
  }
  body.match-pdf-export .match-ceremony, body.match-pdf-export .awards-ceremony,
  body.match-pdf-export .match-statistics-section {
    page-break-after: always; break-after: page; padding: 10px !important;
    background: #092039 !important;
  }
  body.match-pdf-export .match-result-stage, body.match-pdf-export .match-scoreboard,
  body.match-pdf-export .match-indicators-area, body.match-pdf-export .match-stat-grid,
  body.match-pdf-export .awards-stage, body.match-pdf-export .special-awards,
  body.match-pdf-export .match-brief-slide { height: auto !important; overflow: visible !important; }
  body.match-pdf-export .match-indicators { display: block !important; height: auto !important; }
  body.match-pdf-export .match-indicators-viewport,
  body.match-pdf-export .match-indicators-track {
    display: grid !important; overflow: visible !important;
    height: auto !important; width: 100% !important; max-width: none !important;
    transform: none !important; mask-image: none !important;
  }
  body.match-pdf-export .match-indicators-track {
    grid-template-columns: repeat(3,minmax(0,1fr)) !important;
    gap: 12px !important; padding: 12px 0 !important;
  }
  body.match-pdf-export .match-indicator-slide { width: 100% !important; min-width: 0 !important; height: auto !important; break-inside: avoid; }
  body.match-pdf-export .match-indicator-card {
    width: 100% !important; height: 260px !important; min-height: 260px !important;
    opacity: 1 !important; transform: none !important; overflow: visible !important;
    break-inside: avoid;
  }
  body.match-pdf-export .match-indicators-index,
  body.match-pdf-export .match-indicators-navigation { display: none !important; }
  body.match-pdf-export .category-awards, body.match-pdf-export .award-card,
  body.match-pdf-export .category-awards-stage { break-inside: avoid; overflow: visible !important; }
  body.match-pdf-export .operational-charts-carousel,
  body.match-pdf-export .operational-charts-carousel-viewport,
  body.match-pdf-export .operational-charts-carousel-track {
    display: block !important; position: static !important; overflow: visible !important;
    width: 100% !important; max-width: none !important;
    height: auto !important; min-height: 0 !important; transform: none !important;
  }
  body.match-pdf-export .operational-chart-slide {
    display: block !important; position: relative !important;
    width: 100% !important; max-width: none !important;
    height: auto !important; min-height: 420px !important;
    opacity: 1 !important; visibility: visible !important;
    transform: none !important; overflow: visible !important;
    break-before: page; break-inside: avoid; break-after: page; padding: 10px !important;
    background: #092039 !important;
  }
  body.match-pdf-export .match-brief-slide {
    break-before: page; padding: 12px !important;
    background: #092039 !important;
  }
  body.match-pdf-export .match-brief-slide > *, body.match-pdf-export .match-brief-slide article {
    break-inside: avoid;
  }
  body.match-pdf-export .safety-card-date-row { display: flex !important; }
}
`;

function chromiumBinary() {
  if (process.env.STEF_PDF_CHROMIUM_PATH) return process.env.STEF_PDF_CHROMIUM_PATH;
  for (const candidate of ["/usr/bin/chromium-browser", "/usr/bin/chromium"]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("Chromium n'est pas installé pour la génération PDF.");
}

export async function renderMatchPdf({ origin, agency, accessCode, identity, kpis }) {
  let browser;
  try {
    browser = await chromium.launch({
      headless: true, executablePath: chromiumBinary(),
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      timeout: 20000,
    });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      locale: "fr-FR", reducedMotion: "reduce", colorScheme: "dark",
    });
    // Browser-local values are keyed to this agency AND match date. No browser
    // context is shared across exports.
    await context.addInitScript(({ agencyCode, leagueId, matchDate, manualKpis }) => {
      window.localStorage.setItem(`stef-match-active-league-${agencyCode}`, leagueId);
      window.localStorage.setItem(
        `stef-match-kpis-v3:${agencyCode}:${matchDate}`,
        JSON.stringify(manualKpis),
      );
    }, { agencyCode: agency.code, leagueId: identity.leagueId, matchDate: identity.matchDate, manualKpis: kpis });

    const page = await context.newPage();
    // Never make external network requests from the PDF worker.
    await page.route("**/*", route => {
      const url = new URL(route.request().url());
      if (url.protocol === "data:" || url.protocol === "blob:" ||
          (url.hostname === "127.0.0.1" && url.port === new URL(origin).port)) {
        return route.continue();
      }
      return route.abort();
    });
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.getByLabel("Code agence").selectOption(agency.code);
    await page.getByLabel("Code d'accès").fill(accessCode);
    await page.getByRole("button", { name: "Accéder au match", exact: true }).click();
    await page.getByRole("button", { name: "02 Feuille de match", exact: true }).click();
    await page.locator(".match-page[data-export-agency]").waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => document.querySelector(".match-page")?.getAttribute("data-export-brief-ready") === "true", { timeout: 30000 });

    const details = await page.locator(".match-page").evaluate(element => ({
      code: element.getAttribute("data-export-agency"),
      date: element.getAttribute("data-export-date"),
      sourceName: element.getAttribute("data-export-source"),
      league: element.getAttribute("data-export-league"),
    }));
    if (details.code !== identity.agencyCode || details.date !== identity.matchDate ||
        details.sourceName !== identity.sourceName || details.league !== identity.leagueId) {
      throw new Error("Le MATCH affiché ne correspond pas au périmètre validé pour le PDF.");
    }
    await page.waitForFunction(() => {
      const value = document.querySelector(".match-indicator-card.is-safety .match-indicator-value");
      return !value || !value.textContent?.includes("Chargement");
    }, { timeout: 10000 }).catch(() => {});

    await page.evaluate(({ code, name, date, league, criteria, pdf106j }) => {
      const match = document.querySelector(".match-page");
      if (!match) throw new Error("Feuille de MATCH manquante.");
      document.body.classList.add("match-pdf-export");
      const banner = document.createElement("div");
      banner.className = "match-pdf-banner";
      const label = document.createElement("strong");
      label.textContent = "STEF MATCH CENTER · EXPORT COMPLET";
      const scope = document.createElement("span");
      scope.textContent = `${name} [${code}] · ${date} · ${league}`;
      const thresholds = document.createElement("span");
      thresholds.textContent = `DZ ${criteria.zonageMinutes} min · CHG ${criteria.loadingSeconds}s · DECHG ${criteria.unloadingSeconds}s · Objectif ${criteria.scoreTargetPercent}%`;
      banner.append(label, scope, thresholds);
      if (pdf106j?.referenceDate) {
        const source = document.createElement("span");
        source.textContent = `106J : ${pdf106j.referenceDate}`;
        banner.append(source);
      }
      match.prepend(banner);
      match.classList.remove("is-celebration-mode");
      for (const section of match.querySelectorAll(".match-ceremony, .awards-ceremony, .match-statistics-section, .match-brief-slide, .operational-chart-slide")) {
        section.removeAttribute("inert");
        section.setAttribute("aria-hidden", "false");
      }
    }, { code: identity.agencyCode, name: identity.agencyName, date: identity.matchDate,
      league: identity.leagueLabel, criteria: identity.performanceCriteria, pdf106j: identity.pdf106j });
    await page.addStyleTag({ content: PRINT_STYLE });
    // Wait for chart fonts, and images in this agency's current brief, to settle.
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images, img =>
        img.complete ? Promise.resolve() : new Promise(resolve => { img.onload = resolve; img.onerror = resolve; setTimeout(resolve, 5000); })
      ));
    });
    const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 45000 });
    if (pdf.byteLength < 6000) throw new Error("Le PDF généré est anormalement vide.");
    return Buffer.from(pdf);
  } finally {
    if (browser) await browser.close();
  }
}
