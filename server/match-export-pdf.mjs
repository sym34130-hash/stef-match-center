// Zero-dependency PDF writer: vector geometry and selectable text.
// A4 landscape, dark sport scoreboard theme aligned with the Match Center.
// No server-side browser or external service; no files written to disk.
const WIDTH = 842, HEIGHT = 595;
const C = {
  bg: [0.035, 0.082, 0.153], panel: [0.085, 0.185, 0.285],
  panel2: [0.145, 0.29, 0.405], white: [1, 1, 1],
  text: [0.85, 0.92, 0.98], muted: [0.63, 0.75, 0.84],
  aqua: [0.49, 0.88, 0.80], blue: [0.58, 0.79, 0.95],
  gold: [0.94, 0.78, 0.50], red: [1, 0.59, 0.53],
};
const rgb = value => value.map(number => number.toFixed(3)).join(" ");
const trim = (value, limit = 160) => String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, limit);
const ascii = value => trim(value, 2000).replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...").replace(/\u0153/g, "oe")
  .replace(/\u0152/g, "OE").replace(/\u20ac/g, "EUR").replace(/[^\u0020-\u00ff]/g, "?");
const escape = value => ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const fmt = value => Number.isFinite(value) ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(value) : "Indisponible";
const percent = value => Number.isFinite(value) ? fmt(value) + " %" : "Indisponible";
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function wrap(value, maxChars = 70) {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const result = []; let line = "";
  for (const word of words) {
    if ((line + " " + word).trim().length > maxChars && line) { result.push(line); line = ""; }
    if (word.length > maxChars) {
      if (line) { result.push(line); line = ""; }
      for (let i = 0; i < word.length; i += maxChars) result.push(word.slice(i, i + maxChars));
    } else line = (line + " " + word).trim();
  }
  if (line) result.push(line);
  return result.length ? result : ["-"];
}
function jpegDimensions(data) {
  if (!Buffer.isBuffer(data) || data.length < 16 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let i = 2;
  while (i + 8 < data.length) {
    if (data[i] !== 0xff) { i++; continue; }
    while (i < data.length && data[i] === 0xff) i++;
    const marker = data[i++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (i + 1 >= data.length) return null;
    const length = data.readUInt16BE(i);
    if (length < 2 || i + length > data.length) return null;
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb].includes(marker)) {
      if (length < 8) return null;
      const height = data.readUInt16BE(i + 3), width = data.readUInt16BE(i + 5);
      return width > 0 && height > 0 ? { width, height } : null;
    }
    i += length;
  }
  return null;
}
class Page {
  constructor(title, m, number) {
    this.title = title; this.ops = []; this.images = []; this.number = number;
    this.box(0, 0, WIDTH, HEIGHT, C.bg);
    this.box(0, HEIGHT - 8, WIDTH, 8, C.aqua);
    this.text(29, 552, 17, "STEF MATCH CENTER", C.white, true);
    this.text(29, 528, 10, `LOT E / ${title}`, C.aqua, true);
    this.text(813, 552, 12, `${m.agency.name} [${m.agency.code}]`, C.white, true, "right");
    this.text(813, 531, 10, `${m.league.label} / ${m.match.date} / ${m.match.timeRangeLabel}`, C.muted, false, "right");
    this.box(29, 509, 784, 1, C.panel2);
    this.box(29, 30, 784, 1, C.panel2);
    this.text(30, 17, 8, "MATCH agence / document genere depuis la feuille active", C.muted);
    this.text(812, 17, 8, String(number), C.muted, false, "right");
  }
  box(x, y, w, h, fill) { this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`); }
  text(x, y, size, content, color = C.text, bold = false, align = "left") {
    const str = ascii(content);
    const estimated = str.length * size * (bold ? 0.55 : 0.50);
    const pos = align === "right" ? x - estimated : align === "center" ? x - estimated / 2 : x;
    this.ops.push(`${rgb(color)} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${pos.toFixed(2)} ${y.toFixed(2)} Tm (${escape(str)}) Tj ET\n`);
  }
  card(x, y, w, h, label, value, detail = "", accent = C.aqua) {
    this.box(x, y, w, h, C.panel);
    this.box(x, y + h - 3, w, 3, accent);
    this.text(x + 13, y + h - 26, 10, label.toUpperCase().slice(0, 45), accent, true);
    const shown = trim(value, 42);
    this.text(x + 13, y + h - 72, shown.length > 18 ? 18 : 32, shown, C.white, true);
    if (detail) this.text(x + 13, y + 13, 8.5, trim(detail, Math.max(16, Math.floor(w / 5.4))), C.muted);
  }
  image(x, y, w, h, data) {
    const dims = jpegDimensions(data);
    if (!dims) return false;
    const index = this.images.length;
    this.images.push({ data, ...dims });
    const scale = Math.min(w / dims.width, h / dims.height);
    const imageW = dims.width * scale, imageH = dims.height * scale;
    const posX = x + (w - imageW) / 2, posY = y + (h - imageH) / 2;
    this.ops.push(`q ${imageW.toFixed(2)} 0 0 ${imageH.toFixed(2)} ${posX.toFixed(2)} ${posY.toFixed(2)} cm /Im${index} Do Q\n`);
    return true;
  }
  lines(x, y, values, options = {}) {
    const { width = 84, size = 11, step = 17, maxY = 55, color = C.text } = options;
    let cur = y;
    for (const value of values) {
      for (const text of wrap(value, width)) {
        if (cur < maxY) return { y: cur, complete: false };
        this.text(x, cur, size, text, color);
        cur -= step;
      }
    }
    return { y: cur, complete: true };
  }
}
class Pdf {
  constructor(m) { this.model = m; this.pages = []; }
  add(name) { const p = new Page(name, this.model, this.pages.length + 1); this.pages.push(p); return p; }
  render() {
    const objects = [null, null, null,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
    const pageIds = [];
    for (const p of this.pages) {
      const imageIds = p.images.map(img => {
        const id = objects.length;
        objects.push(Buffer.concat([
          Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.data.length} >>\nstream\n`),
          img.data, Buffer.from("\nendstream"),
        ]));
        return id;
      });
      const content = Buffer.from(p.ops.join(""), "latin1");
      const contentsId = objects.length;
      objects.push(Buffer.concat([
        Buffer.from(`<< /Length ${content.length} >>\nstream\n`),
        content, Buffer.from("endstream"),
      ]));
      const id = objects.length;
      const xobjects = imageIds.length
        ? `/XObject << ${imageIds.map((id, i) => `/Im${i} ${id} 0 R`).join(" ")} >>`
        : "";
      objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${WIDTH} ${HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> ${xobjects} >> /Contents ${contentsId} 0 R >>`);
      pageIds.push(id);
    }
    objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map(i => i + " 0 R").join(" ")}] /Count ${pageIds.length} >>`;
    const pieces = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")], offsets = [0];
    let size = pieces[0].length;
    for (let i = 1; i < objects.length; i++) {
      offsets.push(size);
      const objectContent = Buffer.isBuffer(objects[i]) ? objects[i] : Buffer.from(objects[i], "latin1");
      const section = Buffer.concat([Buffer.from(`${i} 0 obj\n`), objectContent, Buffer.from("\nendobj\n")]);
      pieces.push(section); size += section.length;
    }
    const xref = size;
    pieces.push(Buffer.from(`xref\n0 ${objects.length}\n0000000000 65535 f \n`));
    for (let i = 1; i < objects.length; i++) pieces.push(Buffer.from(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`));
    pieces.push(Buffer.from(`trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`));
    return Buffer.concat(pieces);
  }
}
function section(p, y, title) {
  p.box(29, y - 6, 784, 29, C.panel2);
  p.text(41, y + 3, 12, title.toUpperCase(), C.white, true);
  return y - 36;
}
function listing(doc, title, items, options = {}) {
  let p = doc.add(title), y = 475;
  const step = options.step ?? 23;
  for (const [label, raw] of items) {
    const lines = wrap(raw ?? "-", options.chars ?? 105);
    if (y < 70 + lines.length * 14) { p = doc.add(title + " / suite"); y = 475; }
    p.box(29, y - 7, 784, Math.max(step, 18 + (lines.length - 1) * 14), C.panel);
    p.text(40, y + 5, 9.5, trim(label, 34), C.aqua, true);
    lines.forEach((line, index) => p.text(205, y + 5 - index * 14, 9.5, line, C.text));
    y -= Math.max(step + 5, 18 + lines.length * 14 + 5);
  }
  if (!items.length) p.text(41, 452, 14, "Aucune donnée disponible sur cette période.", C.muted);
}
function cards(doc, title, items) {
  let p = null;
  items.forEach((item, i) => {
    const local = i % 9;
    if (local === 0) p = doc.add(title + (i ? " / suite" : ""));
    const x = 29 + (local % 3) * 266;
    const y = 348 - Math.floor(local / 3) * 145;
    p.card(x, y, 252, 132, item.label, item.value, item.detail, item.accent ?? C.aqua);
  });
  if (!items.length) doc.add(title).text(41, 457, 13, "Aucune vignette selectionnee.", C.muted);
}
function bar(p, x, y, label, value, maximum, color = C.aqua) {
  p.text(x, y + 6, 9.5, label.slice(0, 24), C.text);
  p.box(x + 172, y, 420, 15, C.panel2);
  if (Number.isFinite(value)) p.box(x + 172, y, 420 * clamp(value / (maximum || 1), 0, 1), 15, color);
  p.text(x + 680, y + 3, 11, fmt(value), C.white, true, "right");
}
function scorePage(doc, m) {
  const p = doc.add("01 - COUP DE SIFFLET FINAL");
  const score = m.score;
  p.text(42, 465, 24, "FEUILLE DE MATCH", C.white, true);
  p.text(42, 435, 11, `Agence ${m.agency.name} / ${m.league.label} / ${m.match.timeRangeLabel}`, C.muted);
  p.card(29, 303, 374, 107, "Buts marques", score?.status === "available" ? fmt(score.goalsFor) : "Indisponible", "Calcul officiel du score", C.aqua);
  p.card(417, 303, 395, 107, "Buts encaisses", score?.status === "available" ? fmt(score.goalsAgainst) : "KPI sous les cibles de la ligue", C.red);
  const rates = [
    ["Passes reussies", score?.indicators?.passRate, `Zonage <= ${m.criteria.zonageMinutes} min`],
    ["Tirs cadres", score?.indicators?.loadingPercent, `CHG <= ${m.criteria.loadingSeconds} s/poz`],
    ["Duels gagnes", score?.indicators?.unloadingPercent, `DECHG <= ${m.criteria.unloadingSeconds} s/poz`],
    ["Possession", score?.indicators?.possessionPercent, "Positions zonees"],
  ];
  rates.forEach(([name, value, detail], i) => {
    const x = 29 + i * 200;
    p.card(x, 144, 189, 133, name, percent(value), detail, value !== null && Number.isFinite(value) && value < m.criteria.scoreTargetPercent ? C.red : C.blue);
  });
  p.text(42, 104, 10, `Objectif commun : ${m.criteria.scoreTargetPercent} % | Cartons jaunes : ${m.yellowCards.length}`, C.gold, true);
  p.text(42, 85, 9, `Source : ${trim(m.sourceName, 60)} / import ${trim(m.importedAt, 28)}`, C.muted);
}
function indicatorCards(m) {
  const d = m.dailyIndicators, p = d?.punctuality ?? {};
  const pool = {
    performance: { label: "Performance d'equipe", value: m.match.status ?? "Indisponible" },
    injuries: { label: "Blessures A.T", value: m.manualInjuries === null ? "Non renseigne" : String(m.manualInjuries), detail: "Saisie manuelle du navigateur" },
    "accident-free-days": { label: "Jours sans A.T", value: Number.isFinite(m.safety.days) ? fmt(m.safety.days) : "Non renseigne", detail: m.safety.lastAccidentDate ? "Dernier A.T : " + m.safety.lastAccidentDate : "Date non renseignee" },
    "tonnage-distribution": { label: "Tonnage distribution", value: Number.isFinite(d?.distribution?.tonnage) ? fmt(d.distribution.tonnage) + " t" : "Indisponible" },
    "tonnage-expedition": { label: "Tonnage expedition", value: Number.isFinite(d?.expedition?.tonnage) ? fmt(d.expedition.tonnage) + " t" : "Indisponible" },
    positions: { label: "Positions", value: fmt(m.summary?.positions), detail: "Volume sur plage active" },
    arrival: { label: "Ponctualite arrivage", value: percent(p.arrivalPunctuality) },
    departure: { label: "Ponctualite depart", value: percent(p.departurePunctuality) },
    destination: { label: "Ponctualite destination", value: percent(p.destinationPunctuality) },
    temperature: { label: "Temperature retour ramasse", value: percent(p.temperatureReturn) },
  };
  return m.visibleIndicators.map(id => ({ ...pool[id], detail: pool[id]?.detail ?? "Indicateur du collectif", accent: C.aqua })).filter(x => x.label);
}
function awardsPage(doc, m) {
  const p = doc.add("02 - CEREMONIE DES PERFORMANCES");
  const awards = [
    ["HOMME DU MATCH", m.highlights?.manOfTheMatch],
    ["MEILLEUR BUTEUR", m.highlights?.bestScorer],
    ["MEILLEUR PASSEUR", m.highlights?.bestPasser],
    ["MUR DEFENSIF", m.highlights?.defensiveWall],
  ];
  awards.forEach(([title, award], i) => {
    const x = 29 + (i % 2) * 395, y = 280 + (i < 2 ? 0 : -193);
    p.card(x, y, 380, 178, title, award?.name || "Non attribue",
      award ? `${trim(award.role, 24)} / ${trim(award.valueLabel || award.detail, 55)}` : "Donnees insuffisantes",
      i === 0 ? C.gold : C.blue);
    if (award) p.text(x + 14, y + 68, 11, `${fmt(award.value)} / ${fmt(award.positions ?? award.operations)} operations ou positions`, C.text);
  });
}
function analyticsPages(doc, m) {
  const p = doc.add("03 - STATISTIQUES DU MATCH");
  section(p, 470, "Chiffres de reference");
  [
    ["Operations", m.summary?.operations],
    ["Positions", m.summary?.positions],
    ["Voyages", m.summary?.travels],
    ["Collaborateurs", m.summary?.players],
    ["Duels gagnes", m.summary?.duelWon],
    ["Duels totaux", m.summary?.duelTotal],
  ].forEach(([label, value], i) => p.card(29 + (i % 3) * 266, 270 - Math.floor(i / 3) * 120, 252, 110, label, fmt(value), "", C.blue));
  const slots = (m.hourlyPerformance ?? []).filter(row => row && typeof row === "object");
  for (let start = 0; start < Math.max(1, slots.length); start += 17) {
    const page = doc.add(start ? "03 - PASSES PAR HEURE / SUITE" : "03 - PASSES PAR HEURE");
    page.text(34, 477, 12, "Passes reussies / creneau horaire", C.aqua, true);
    slots.slice(start, start + 17).forEach((entry, i) => bar(page, 43, 448 - i * 22,
      entry.label || String(entry.hour ?? ""), entry.rate, 100));
    if (!slots.length) page.text(43, 445, 12, "Donnees horaires indisponibles", C.muted);
  }
  const receptionSlots = m.unloadingHourlyAnalysis?.items ?? [];
  for (let start = 0; start < Math.max(1, receptionSlots.length); start += 17) {
    const page = doc.add(start ? "03 - RECEPTION PAR CRENEAU / SUITE" : "03 - RECEPTION PAR CRENEAU");
    page.text(34, 477, 12, "Temps moyen de reception par creneau - secondes / position", C.aqua, true);
    receptionSlots.slice(start, start + 17).forEach((entry, i) =>
      bar(page, 43, 448 - i * 22, entry.label || entry.start || "-",
        entry.meanSecondsPerPosition, Math.max(1, m.unloadingHourlyAnalysis?.targetSeconds ?? 60,
          entry.meanSecondsPerPosition ?? 0), C.blue));
    if (!receptionSlots.length) page.text(43, 445, 12, "Donnees de reception par creneau indisponibles", C.muted);
  }
  const p2 = doc.add("03 - QUALITE DES FLUX");
  let items = [
    ["CHG / tirs cadres", m.loadingQuality?.targetedPercent],
    ["CHG / hors cible", m.loadingQuality?.offTargetPercent],
    ["DECHG / duels gagnes", m.unloadingDuelQuality?.wonPercent],
    ["DECHG / duels perdus", m.unloadingDuelQuality?.lostPercent],
    ["Centres reussis", m.unloadingQuality?.targetedPercent],
    ["Centres hors cible", m.unloadingQuality?.offTargetPercent],
  ];
  items.forEach(([name, value], i) => p2.card(29 + i % 3 * 266, 337 - Math.floor(i / 3) * 172, 252, 151, name, percent(value), "", C.blue));
  const top = m.zonageDiagnostic?.top5 ?? [];
  listing(doc, "03 - DIAGNOSTIC OPERATIONNEL", [
    ["Positions hors delai", fmt(m.zonageDiagnostic?.latePositions)],
    ["Positions non verifiables", fmt(m.zonageDiagnostic?.unqualifiablePositions)],
    ["Positions verifiables", fmt(m.zonageDiagnostic?.qualifiablePositions)],
    ["Couverture", percent(m.zonageDiagnostic?.coverageRate)],
    ["Reception hors cible", `${fmt(m.anomalySummary?.unloading?.offTargetTravels)} sur ${fmt(m.anomalySummary?.unloading?.eligibleTravels)} voyages`],
    ["Chargement hors cible", `${fmt(m.anomalySummary?.loading?.offTargetTravels)} sur ${fmt(m.anomalySummary?.loading?.eligibleTravels)} voyages`],
    ...top.map((t, i) => [`FLOP zonage #${i + 1}`, `${t.travelCode} : ${t.latePositions} retards / ${t.receivedPositions} recues`]),
    ["Exclusions generales", (m.excludedTravelCodes ?? []).length ? m.excludedTravelCodes.join(", ") : "Aucune"],
    ["Exclusions chargement", (m.loadingScope?.excludedTravels ?? []).map(x => x.code).join(", ") || "Aucune"],
    ["Exclusions reception", (m.receptionScope?.excludedTravels ?? []).map(x => x.code).join(", ") || "Aucune"],
  ], { chars: 95 });
}
function causeriePages(doc, m) {
  const c = m.causerie;
  const rows = [
    ["Equipe", c.team || "Non renseignee"],
    ["Manager", c.manager || "Non renseigne"],
    ...["attack", "midfield", "defense"].flatMap((key, i) => {
      const label = ["ATTAQUE", "MILIEU", "DEFENSE"][i];
      return (c[key] ?? []).length ? c[key].map((v, n) => [label + " " + (n + 1), v]) : [[label, "Aucune consigne"]];
    }),
    ["Tactique", c.coach?.tactic || "Non renseignee"],
    ["Priorite", c.coach?.priority || "Non renseignee"],
    ["Arbitrage", c.coach?.arbitration || "Non renseigne"],
    ["Revue", c.coach?.review || "Non renseignee"],
    ["Mercato", c.mercato || "Aucun mouvement"],
    ["Cartons rouges", c.redCards || "Aucune saisie"],
    ["Captures du brief", `Attaque ${c.attachmentCounts?.attack ?? 0}, Milieu ${c.attachmentCounts?.midfield ?? 0}, Defense ${c.attachmentCounts?.defense ?? 0}. Pieces visuelles a consulter sur le site.`],
  ];
  listing(doc, "04 - BRIEF EQUIPE", rows, { chars: 104 });
}
function yellowCardsPages(doc, m) {
  if (!m.yellowCards.length) return;
  listing(doc, "01 - CARTONS JAUNES", m.yellowCards.map((card, i) => [
    `Carton #${i + 1}`,
    `${card.playerName ?? "Inconnu"} / ${card.travelCode ?? "-"} / ${card.time ?? "-"} / ${card.reason ?? "-"}`,
  ]), { chars: 105, step: 25 });
}
export function renderMatchPdf(model) {
  const doc = new Pdf(model);
  scorePage(doc, model);
  cards(doc, "01 - LE COLLECTIF EN CHIFFRES", indicatorCards(model));
  yellowCardsPages(doc, model);
  awardsPage(doc, model);
  analyticsPages(doc, model);
  causeriePages(doc, model);
  return doc.render();
}
