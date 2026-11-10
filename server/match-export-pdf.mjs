// Zero-dependency PDF writer: vector geometry and selectable text.
// A4 landscape, dark sport scoreboard theme aligned with the Match Center.
// No server-side browser or external service; no files written to disk.
import { MatchExportError } from "./match-export-model.mjs";
import { effectivePdfProfile } from "./match-pdf-profile.mjs";

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
const ascii = value => String(value ?? "").replace(/[\r\n\t]/g, " ").slice(0, 12000).replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
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
    this.text(29, 528, 10, title, C.aqua, true);
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
    const labelText = ascii(label).toUpperCase();
    const labelSize = clamp((w - 25) / Math.max(1, labelText.length * 0.56), 7.5, 10);
    this.text(x + 13, y + h - 25, labelSize, labelText, accent, true);
    const shown = ascii(value || "Indisponible");
    // Up to three lines, fitted into the available space; card values are not
    // silently truncated to 42 characters as in the initial prototype.
    const fontSize = shown.length > 57 ? 11 : shown.length > 25 ? 15 : 27;
    const charCount = Math.max(10, Math.floor((w - 26) / (fontSize * .57)));
    const lines = wrap(shown, charCount);
    const maxLines = Math.min(lines.length, 3);
    for (let i = 0; i < maxLines; i++) {
      this.text(x + 13, y + h - 66 - i * (fontSize + 5), fontSize, lines[i], C.white, true);
    }
    if (lines.length > maxLines) this.text(x + 13, y + 27, 8, "(valeur longue : consultez le brief)", C.muted);
    if (detail && lines.length === 1) this.text(x + 13, y + 12, 8.5,
      trim(detail, Math.max(16, Math.floor(w / 5.4))), C.muted);
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
    let offset = 0;
    // Long team instructions may be 3,000+ characters. Break a single entry
    // over consecutive pages, rather than draw below the printable area.
    while (offset < lines.length) {
      if (y < 95) { p = doc.add(title + " / suite"); y = 475; }
      const available = Math.max(1, 1 + Math.floor((y - 67) / 14));
      const chunk = lines.slice(offset, offset + available);
      const height = Math.max(step, 26 + (chunk.length - 1) * 14);
      const bottom = y + 15 - height;
      if (bottom < 51) { p = doc.add(title + " / suite"); y = 475; continue; }
      p.box(29, bottom, 784, height, C.panel);
      p.text(40, y, 9.5, trim(label, 28) + (offset ? " / suite" : ""), C.aqua, true);
      chunk.forEach((line, index) => p.text(205, y - index * 14, 9.5, line, C.text));
      offset += chunk.length;
      y -= height + 7;
    }
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
  if (Number.isFinite(m.manualExpectedPlayers) && m.manualExpectedPlayers > 0) {
    p.text(42, 67, 9, `Effectif reel : ${fmt(m.summary?.players)} / prevu : ${fmt(m.manualExpectedPlayers)} = ${percent(Math.round(1000 * m.summary.players / m.manualExpectedPlayers) / 10)}`, C.aqua);
  }
  p.text(42, 85, 9, `Source : ${trim(m.sourceName, 60)} / import ${trim(m.importedAt, 28)}`, C.muted);
}
function indicatorCards(m) {
  const d = m.dailyIndicators, p = d?.punctuality ?? {};
  const pool = {
    performance: { label: "Performance d'equipe", value: m.score?.status !== "available"
      ? "Performance a completer"
      : m.score.goalsFor > m.score.goalsAgainst ? "Performance d'equipe validee"
      : m.score.goalsFor === m.score.goalsAgainst ? "Collectif en maitrise"
      : "Reconnaissance et reprise terrain" },
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
  const awards = m.awards ?? [];
  awards.forEach((award, i) => {
    const x = 29 + (i % 2) * 395, y = 280 - Math.floor(i / 2) * 193;
    p.card(x, y, 380, 178, award.label, award.name,
      "", i === 0 ? C.gold : C.blue);
    p.text(x + 13, y + 67, 10,
      `${fmt(award.value)} ${award.valueLabel ?? "positions"} / ${trim(award.role, 24)}`, C.text);
    if (award.challengers?.length) {
      p.text(x + 13, y + 48, 8.5, "CHALLENGERS", C.aqua, true);
      award.challengers.slice(0, 2).forEach((item, index) =>
        p.text(x + 13, y + 33 - index * 16, 8.5,
          `${item.name} / ${fmt(item.value)}`, C.muted));
    } else {
      p.text(x + 13, y + 32, 8.5, "Aucun challenger disponible", C.muted);
    }
  });
  if (!awards.length) p.text(41, 425, 14, "Aucune distinction disponible", C.muted);
  if (!awards.some(award => award.kind === "polyvalent")) {
    p.text(41, 55, 9, "Polyvalence : aucun candidat eligible non deja recompense.", C.muted);
  }
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
    ["Captures du brief", `Attaque ${c.attachmentCounts?.attack ?? 0}, Milieu ${c.attachmentCounts?.midfield ?? 0}, Defense ${c.attachmentCounts?.defense ?? 0}. Pages de captures en annexe.`],
  ];
  listing(doc, "04 - BRIEF EQUIPE", rows, { chars: 104 });
}
function briefCapturePages(doc, m) {
  const captures = [];
  for (const [key, title] of [["attack", "ATTAQUE"], ["midfield", "MILIEU"], ["defense", "DEFENSE"]]) {
    (m.causerie.attachments?.[key] ?? []).forEach((source, i) => {
      captures.push({ title, index: i + 1, source });
    });
  }
  for (let start = 0; start < captures.length; start += 4) {
    const page = doc.add(start ? "04 - CAPTURES DU BRIEF / SUITE" : "04 - CAPTURES DU BRIEF");
    const group = captures.slice(start, start + 4);
    group.forEach((item, i) => {
      const single = group.length === 1;
      const two = group.length === 2;
      const width = single ? 784 : 380;
      const height = single ? 392 : two ? 385 : 209;
      const x = single ? 29 : 29 + (i % 2) * 395;
      const y = single ? 86 : two ? 87 : 266 - Math.floor(i / 2) * 223;
      page.box(x, y, width, height, C.panel);
      page.box(x, y + height - 3, width, 3, C.aqua);
      page.text(x + 12, y + height - 23, 10, `${item.title} / CAPTURE ${item.index}`, C.aqua, true);
      const match = typeof item.source === "string"
        ? item.source.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/) : null;
      const data = match && item.source.length <= 260_000 ? Buffer.from(match[1], "base64") : null;
      if (!data || !page.image(x + 10, y + 9, width - 20, height - 46, data)) {
        page.text(x + 12, y + height / 2, 10,
          "Image non exportable (format source ancien ou invalide)", C.red);
      }
    });
  }
}
function yellowCardsPages(doc, m) {
  if (!m.yellowCards.length) return;
  listing(doc, "01 - CARTONS JAUNES", m.yellowCards.map((card, i) => [
    `Carton #${i + 1}`,
    `${card.playerName ?? "Inconnu"} / ${card.travelCode ?? "-"} / ${card.time ?? "-"} / ${card.reason ?? "-"}`,
  ]), { chars: 105, step: 25 });
}
export function renderMatchPdfFull(model) {
  const doc = new Pdf(model);
  scorePage(doc, model);
  cards(doc, "01 - LE COLLECTIF EN CHIFFRES", indicatorCards(model));
  yellowCardsPages(doc, model);
  awardsPage(doc, model);
  analyticsPages(doc, model);
  causeriePages(doc, model);
  briefCapturePages(doc, model);
  return doc.render();
}


/** Compact two-page briefing. The complete legacy report stays available only
 * as an exported diagnostic renderer; the HTTP endpoint calls this one. */
function compactMetric(p, x, y, width, label, value) {
  p.box(x, y, width, 64, C.panel);
  p.box(x, y + 61, width, 3, C.blue);
  p.text(x + 10, y + 43, 8.5, trim(label, 27).toUpperCase(), C.aqua, true);
  const valueText = ascii(value ?? "Indisponible");
  const fontSize = valueText.length > 30 ? 10 : valueText.length > 17 ? 13 : 21;
  const parts = wrap(valueText, Math.max(12, Math.floor((width - 20) / (fontSize * 0.55))));
  if (parts.length > 2) throw new MatchExportError(422, "Le libellé d'un KPI est trop long pour le briefing papier.");
  parts.forEach((line, i) => p.text(x + 10, y + 18 - i * 12, fontSize, line, C.white, true));
}
function compactBar(p, x, y, name, fraction, caption = "") {
  p.text(x, y + 19, 10, trim(name, 34), C.white, true);
  p.box(x, y + 3, 350, 12, C.panel2);
  if (Number.isFinite(fraction)) p.box(x, y + 3, 350 * clamp(fraction / 100, 0, 1), 12, C.aqua);
  p.text(x + 360, y + 5, 10, Number.isFinite(fraction) ? percent(fraction) : "N/D", C.text, true);
  if (caption) p.text(x + 495, y + 5, 8, trim(caption, 31), C.muted);
}
function compactChart(p, m, chartId) {
  const names = {
    "passes-hourly": "PASSES REUSSIES PAR HEURE",
    "reception-time": "DUELS GAGNES / RECEPTION",
    loading: "TIRS CADRES",
    centers: "CENTRES REUSSIS",
    "operational-diagnostic": "DIAGNOSTIC OPERATIONNEL",
  };
  p.box(29, 43, 784, 116, C.panel);
  p.box(29, 156, 784, 3, C.aqua);
  p.text(42, 139, 11, names[chartId] ?? "ANALYSE", C.aqua, true);
  if (chartId === "passes-hourly") {
    const rows = Array.isArray(m.hourlyPerformance) ? m.hourlyPerformance.filter(v => Number.isFinite(v?.rate)) : [];
    if (!rows.length) { p.text(44, 90, 11, "Analyse horaire indisponible", C.muted); return; }
    const x = 52, y = 63, w = 730, h = 57;
    p.box(x, y, w, 1, C.panel2);
    const first = rows[0], last = rows[rows.length - 1];
    for (let i = 0; i < rows.length; i++) {
      const pointX = x + i * w / Math.max(rows.length - 1, 1);
      const valueY = y + clamp(rows[i].rate, 0, 100) * h / 100;
      p.box(pointX - 2, valueY - 2, 4, 4, C.aqua);
      if (i > 0) {
        const previousX = x + (i - 1) * w / Math.max(rows.length - 1, 1);
        const previousY = y + clamp(rows[i - 1].rate, 0, 100) * h / 100;
        p.ops.push(`${rgb(C.aqua)} RG 1.6 w ${previousX.toFixed(2)} ${previousY.toFixed(2)} m ${pointX.toFixed(2)} ${valueY.toFixed(2)} l S\n`);
      }
    }
    p.text(x, 51, 8, trim(first.label ?? first.hour ?? "Début", 24), C.muted);
    p.text(x + w, 51, 8, trim(last.label ?? last.hour ?? "Fin", 24), C.muted, false, "right");
    p.text(520, 139, 8, "Périmètre horaire du graphique (distinct du score)", C.muted);
    return;
  }
  if (chartId === "reception-time") {
    // Keep the official duel rate AND the mean seconds/position for each slot.
    // Bar heights are time in seconds per position; red is above league target.
    const hourly = m.unloadingHourlyAnalysis;
    const slots = (hourly?.items ?? []).filter(slot =>
      Number.isFinite(slot?.meanSecondsPerPosition) && slot.meanSecondsPerPosition >= 0
      && slot?.state !== "indisponible");
    const target = Number.isFinite(hourly?.targetSeconds) ? hourly.targetSeconds : m.criteria.unloadingSeconds;
    const won = m.score?.indicators?.unloadingPercent;
    p.text(42, 124, 8.5,
      `Duels gagnés : ${percent(won)} (score)  |  Barres : moyenne en s/position  |  Cible : ${fmt(target)} s/poz`, C.text);
    if (!slots.length) {
      p.text(42, 91, 10, "Aucun créneau de réception exploitable sur la période.", C.muted);
      return;
    }
    const x0 = 52, baseline = 82, plotWidth = 724, plotHeight = 37;
    const ceiling = Math.max(1, target || 0, ...slots.map(slot => slot.meanSecondsPerPosition)) * 1.15;
    p.box(x0, baseline, plotWidth, 1, C.panel2);
    if (Number.isFinite(target) && target > 0) {
      const ty = baseline + Math.min(plotHeight, target / ceiling * plotHeight);
      p.ops.push(`${rgb(C.gold)} RG 0.9 w ${x0.toFixed(2)} ${ty.toFixed(2)} m ${(x0 + plotWidth).toFixed(2)} ${ty.toFixed(2)} l S\n`);
    }
    const step = plotWidth / slots.length;
    const labelEvery = Math.ceil(slots.length / 12);
    slots.forEach((slot, index) => {
      const left = x0 + index * step + Math.min(2, step / 8);
      const width = Math.max(1.5, step - Math.min(4, step / 4));
      const height = Math.max(1, Math.min(plotHeight, slot.meanSecondsPerPosition / ceiling * plotHeight));
      const failed = Number.isFinite(target) && slot.meanSecondsPerPosition > target;
      p.box(left, baseline, width, height, failed ? C.red : C.aqua);
      if (index % labelEvery === 0 || index === slots.length - 1) {
        const label = String(slot.start ?? slot.label ?? String(index + 1));
        p.text(left, 70, 7, label.length > 8 ? `#${index + 1}` : label, C.muted);
      }
    });
    const positions = slots.map(slot => slot.distinctPositions).filter(Number.isFinite);
    const positionSummary = positions.length
      ? `Positions/créneau : ${fmt(Math.min(...positions))} à ${fmt(Math.max(...positions))}`
      : "Positions/créneau : indisponibles";
    p.text(42, 52, 8,
      `${slots.length} créneaux exploitables  |  ${positionSummary}  |  Rouge : au-dessus de la cible`, C.muted);
    return;
  }
  if (chartId === "loading") {
    compactBar(p, 42, 96, "Tirs cadrés", m.loadingQuality?.targetedPercent);
    compactBar(p, 42, 62, "Chargements hors cible", m.loadingQuality?.offTargetPercent);
    return;
  }
  if (chartId === "centers") {
    compactBar(p, 42, 90, "Centres réussis (destination)", m.dailyIndicators?.punctuality?.destinationPunctuality,
      "Source PDF 106J");
    return;
  }
  compactBar(p, 42, 91, "Couverture du zonage", m.zonageDiagnostic?.coverageRate);
  p.text(42, 64, 10,
    `Positions hors délai : ${fmt(m.zonageDiagnostic?.latePositions)} / non vérifiables : ${fmt(m.zonageDiagnostic?.unqualifiablePositions)}`,
    C.text);
}
function shortBlock(p, { x, y, w, h, title, value, chars, maxLines = 3 }) {
  p.box(x, y, w, h, C.panel);
  p.box(x, y + h - 3, w, 3, C.blue);
  p.text(x + 11, y + h - 20, 10, title.toUpperCase(), C.aqua, true);
  const lines = wrap(value || "Non renseigné", chars ?? Math.floor((w - 22) / 5.35));
  if (lines.length > maxLines) {
    throw new MatchExportError(422,
      `Le briefing papier dépasse deux pages : raccourcis la rubrique « ${title} » dans Personnaliser l'export PDF.`);
  }
  lines.forEach((line, i) => p.text(x + 11, y + h - 42 - 14 * i, 9.5, line, C.text));
}
function effectiveBriefText(m) {
  const custom = m.pdfProfile.dailyBrief;
  const c = m.causerie ?? {};
  const combined = values => values.filter(value => typeof value === "string" && value.trim()).join(" ; ");
  // Screenshots cannot be faithfully converted to text in the printed PDF.
  // A section that contains ONLY captures requires a date-scoped short brief.
  for (const [field, label] of [
    ["attack", "Service client"],
    ["midfield", "Expédition / Ramasse & Emballage"],
    ["defense", "SST"],
  ]) {
    const captures = c.attachmentCounts?.[field] ?? c.attachments?.[field]?.length ?? 0;
    const sourceText = combined(Array.isArray(c[field]) ? c[field] : []);
    if (captures > 0 && !sourceText && !custom[field]?.trim()) {
      throw new MatchExportError(422,
        `La rubrique « ${label} » contient ${captures} capture(s) mais aucun texte imprimable. Renseigne une synthèse dans « Personnaliser le PDF » pour ce MATCH.`);
    }
  }
  const safetyMessage = combined([
    Number.isFinite(m.safety?.days) ? `${fmt(m.safety.days)} jours sans accident de travail` : "",
    c.redCards ? `Cartons rouges : ${c.redCards}` : "",
    custom.safety,
  ]);
  return {
    safety: safetyMessage,
    priorities: custom.priorities || c.coach?.priority || "",
    attack: custom.attack || combined(c.attack ?? []),
    midfield: custom.midfield || combined(c.midfield ?? []),
    defense: custom.defense || combined(c.defense ?? []),
    decisions: custom.decisions || combined([c.coach?.tactic, c.coach?.arbitration, c.coach?.review, c.mercato]),
  };
}
function compactScorePage(doc, m) {
  const p = doc.add("01 / PERFORMANCE DU JOUR");
  p.text(36, 486, 18, "COUP DE SIFFLET FINAL", C.white, true);
  p.text(36, 468, 9,
    `Zonage <= ${fmt(m.criteria.zonageMinutes)} min  |  CHG <= ${fmt(m.criteria.loadingSeconds)} s/poz  |  DECHG <= ${fmt(m.criteria.unloadingSeconds)} s/poz`,
    C.muted);
  const score = m.score;
  p.card(29, 386, 385, 76, "Buts marqués", score?.status === "available" ? fmt(score.goalsFor) : "Indisponible", "", C.aqua);
  p.card(428, 386, 385, 76, "Buts encaissés", score?.status === "available" ? fmt(score.goalsAgainst) : "Indisponible", "", C.red);
  const rates = [
    ["Passes réussies", score?.indicators?.passRate],
    ["Tirs cadrés", score?.indicators?.loadingPercent],
    ["Duels gagnés", score?.indicators?.unloadingPercent],
    ["Possession", score?.indicators?.possessionPercent],
  ];
  rates.forEach(([label, val], i) =>
    p.card(29 + i * 199, 303, 187, 76, label, percent(val), "",
      Number.isFinite(val) && val <= m.criteria.scoreTargetPercent ? C.red : C.blue));
  // Two rows: 2 x 2 when four are selected, 3 x 2 for five or six.
  // The chart keeps its own fixed area and the font size is unchanged.
  const allCards = indicatorCards(m);
  const byId = new Map(m.visibleIndicators.map((id, index) => [id, allCards[index]]));
  const selected = m.pdfProfile.indicatorIds.map(id => byId.get(id)).filter(Boolean);
  if (!selected.length) p.text(41, 236, 10, "Aucun KPI complémentaire visible dans le MATCH.", C.muted);
  const columns = selected.length <= 4 ? 2 : 3;
  selected.forEach((card, i) => {
    const row = Math.floor(i / columns);
    const column = i % columns;
    const x = columns === 2 ? 29 + column * 399
      : 29 + column * 266 + (selected.length === 5 && row === 1 ? 133 : 0);
    compactMetric(p, x, 235 - row * 68, columns === 2 ? 385 : 252, card.label, card.value);
  });
  compactChart(p, m, m.pdfProfile.chartId);
}
function compactBriefPage(doc, m) {
  const p = doc.add("02 / BRIEF DES SERVICES");
  p.text(36, 477, 20, "BRIEF OPERATIONNEL DU JOUR", C.white, true);
  p.text(777, 479, 8, trim([m.causerie?.team, m.causerie?.manager].filter(Boolean).join(" / "), 42), C.muted, false, "right");
  const brief = effectiveBriefText(m);
  // Keep the exact labels of BRIEF ÉQUIPE, not the old football metaphors.
  shortBlock(p, { x: 29, y: 405, w: 784, h: 58, title: "Sécurité / vigilance", value: brief.safety, maxLines: 2 });
  shortBlock(p, { x: 29, y: 273, w: 784, h: 126, title: "Service client", value: brief.attack, maxLines: 6 });
  shortBlock(p, { x: 29, y: 149, w: 482, h: 118, title: "Expédition / Ramasse & Emballage", value: brief.midfield, maxLines: 5 });
  shortBlock(p, { x: 523, y: 149, w: 290, h: 118, title: "SST", value: brief.defense, maxLines: 5 });
  shortBlock(p, { x: 29, y: 43, w: 385, h: 100, title: "Priorités opérationnelles", value: brief.priorities, maxLines: 4 });
  shortBlock(p, { x: 428, y: 43, w: 385, h: 100, title: "Décisions / arbitrages", value: brief.decisions, maxLines: 4 });
  const a = m.causerie?.attachmentCounts ?? {};
  if (Object.values(a).some(count => Number(count) > 0)) {
    p.text(36, 34, 7.5,
      `Captures sur le site : Service client ${a.attack ?? 0} / Expedition ${a.midfield ?? 0} / SST ${a.defense ?? 0}`, C.muted);
  }
}
export function renderMatchPdf(model) {
  if (!model?.agency?.code || !model?.match?.date) throw new MatchExportError(400, "MATCH invalide.");
  const m = { ...model, pdfProfile: effectivePdfProfile(model.pdfProfile, model.visibleIndicators, model.match.date) };
  const pdf = new Pdf(m);
  compactScorePage(pdf, m);
  compactBriefPage(pdf, m);
  if (pdf.pages.length !== 2) throw new MatchExportError(500, "Nombre de pages inattendu.");
  return pdf.render();
}
