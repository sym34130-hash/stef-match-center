// Zero-dependency PDF writer: vector geometry and selectable text.
// A4 landscape, dark sport scoreboard theme aligned with the Match Center.
// No server-side browser or external service; no files written to disk.
import { MatchExportError } from "./match-export-model.mjs";
import { effectivePdfProfile } from "./match-pdf-profile.mjs";

const WIDTH = 842, HEIGHT = 595;
const C = {
  // V3: mid-navy broadcast palette. Lighter differentiated surfaces improve
  // print contrast without changing the underlying operational data.
  bg: [0.075, 0.145, 0.235], panel: [0.145, 0.265, 0.375],
  panel2: [0.255, 0.395, 0.505], white: [1, 1, 1],
  text: [0.94, 0.97, 1], muted: [0.78, 0.86, 0.92],
  aqua: [0.47, 0.94, 0.83], blue: [0.69, 0.86, 1],
  gold: [1, 0.82, 0.48], red: [1, 0.52, 0.49],
  // Separate print surfaces create an editorial tactical-board contrast.
  paper: [0.925, 0.958, 0.975], paperWarm: [0.995, 0.962, 0.895],
  navyInk: [0.09, 0.20, 0.31], slateInk: [0.30, 0.40, 0.48],
  pitchLine: [0.25, 0.39, 0.49],
};
const rgb = value => value.map(number => number.toFixed(3)).join(" ");
const trim = (value, limit = 160) => String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, limit);
const ascii = value => String(value ?? "").replace(/[\r\n\t]/g, " ").slice(0, 12000).replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'")
  .replace(/[\u201c\u201d]/g, '"').replace(/\u2026/g, "...").replace(/\u0153/g, "oe")
  .replace(/\u0152/g, "OE").replace(/\u20ac/g, "EUR").replace(/[\u202f\u00a0]/g, " ").replace(/[^\u0020-\u00ff]/g, "?");
const escape = value => ascii(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
const printedNumber = (value, digits = 1) => Number.isFinite(value)
  ? new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits }).format(value).replace(/[\u202f\u00a0]/g, " ")
  : "Indisponible";
const fmt = value => printedNumber(value, 1);
// Keep the same precision as the live Match carousel for tonnage (2 decimals).
const fmtTonnage = value => printedNumber(value, 2);
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
    // Stadium-inspired top rail and floodlight ticks: vector-only.
    this.box(0, HEIGHT - 8, WIDTH, 8, C.aqua);
    this.box(0, HEIGHT - 14, 273, 6, C.panel2);
    this.box(273, HEIGHT - 14, 296, 6, C.gold);
    this.box(569, HEIGHT - 14, 273, 6, C.panel2);
    for (let i = 0; i < 16; i++) {
      this.box(35 + i * 48, 577, 21, 1, C.pitchLine);
    }
    this.text(29, 552, 17, "STEF MATCH CENTER", C.white, true);
    this.text(29, 528, 10, title, C.aqua, true);
    this.text(813, 552, 12, `${m.agency.name} [${m.agency.code}]`, C.white, true, "right");
    this.text(813, 531, 10, `${m.league.label} / ${m.match.date} / ${m.match.timeRangeLabel}`, C.muted, false, "right");
    this.box(29, 509, 784, 1.4, C.panel2);
    this.box(29, 509, 160, 2.5, C.gold);
    this.box(29, 30, 784, 1, C.panel2);
    // The signed-in agency and the source agencies are different concepts.
    // Show provenance on both printed pages without changing access scope.
    const excel = m.sourceAgency?.excel || "origine indéterminée";
    const report = m.sourceAgency?.pdf106j || "non indiquée";
    const reportDate = m.sourceAgency?.pdfDate || "date non indiquée";
    const originNote = "Sources : Excel [" + excel + "] / 106J [" + report + "] (" + reportDate + ")";
    this.text(30, 17, 7.8, trim(originNote, 131), C.muted);
    this.text(812, 17, 8, String(number), C.muted, false, "right");
  }
  box(x, y, w, h, fill) { this.ops.push(`${rgb(fill)} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f\n`); }
  line(x1, y1, x2, y2, color = C.pitchLine, width = 0.8, dash = null) {
    const stroke = dash?.length ? "[" + dash.join(" ") + "] 0 d" : "[] 0 d";
    this.ops.push(`q ${rgb(color)} RG ${width} w ${stroke} ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S Q\n`);
  }
  outline(x, y, w, h, color = C.pitchLine, width = 0.8) {
    this.ops.push(`q ${rgb(color)} RG ${width} w ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re S Q\n`);
  }
  circle(x, y, r, color = C.pitchLine, width = 0.8) {
    const k = r * 0.5522847498;
    this.ops.push(`q ${rgb(color)} RG ${width} w ${(x+r).toFixed(2)} ${y.toFixed(2)} m `
      + `${(x+r).toFixed(2)} ${(y+k).toFixed(2)} ${(x+k).toFixed(2)} ${(y+r).toFixed(2)} ${x.toFixed(2)} ${(y+r).toFixed(2)} c `
      + `${(x-k).toFixed(2)} ${(y+r).toFixed(2)} ${(x-r).toFixed(2)} ${(y+k).toFixed(2)} ${(x-r).toFixed(2)} ${y.toFixed(2)} c `
      + `${(x-r).toFixed(2)} ${(y-k).toFixed(2)} ${(x-k).toFixed(2)} ${(y-r).toFixed(2)} ${x.toFixed(2)} ${(y-r).toFixed(2)} c `
      + `${(x+k).toFixed(2)} ${(y-r).toFixed(2)} ${(x+r).toFixed(2)} ${(y-k).toFixed(2)} ${(x+r).toFixed(2)} ${y.toFixed(2)} c S Q\n`);
  }
  text(x, y, size, content, color = C.text, bold = false, align = "left") {
    const str = ascii(content);
    const estimated = str.length * size * (bold ? 0.55 : 0.50);
    const pos = align === "right" ? x - estimated : align === "center" ? x - estimated / 2 : x;
    this.ops.push(`${rgb(color)} rg BT /${bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 ${pos.toFixed(2)} ${y.toFixed(2)} Tm (${escape(str)}) Tj ET\n`);
  }
  card(x, y, w, h, label, value, detail = "", accent = C.aqua) {
    this.box(x, y, w, h, C.panel);
    this.box(x, y + h - 3, w, 3, accent);
    this.box(x, y, 3, h - 3, C.panel2);
    const labelText = ascii(label).toUpperCase();
    const labelSize = clamp((w - 25) / Math.max(1, labelText.length * 0.56), 7.5, 10);
    const compact = h <= 75;
    this.text(x + 13, y + h - (compact ? 20 : 25), labelSize, labelText, accent, true);
    const shown = ascii(value || "Indisponible");
    // Short scoreboard cards must use their own baselines. The legacy
    // "h - 66" baseline otherwise prints outside a condensed card.
    if (compact) {
      const fontsize = clamp((w - 26) / Math.max(1, shown.length * 0.58), 13, 24);
      const fitted = shown.length * fontsize * 0.58 <= w - 26;
      if (!fitted) throw new MatchExportError(422, "La valeur du score est trop longue pour l'impression.");
      this.text(x + 13, y + 8, fontsize, shown, C.white, true);
      return;
    }
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
    "tonnage-distribution": { label: "Tonnage distribution", value: Number.isFinite(d?.distribution?.tonnage) ? fmtTonnage(d.distribution.tonnage) + " t" : "Indisponible",
      detail: "106J " + (d?.referenceDate ?? "date inconnue") + (Number.isFinite(d?.total?.tonnage) ? " · Total " + fmtTonnage(d.total.tonnage) + " t" : "") },
    "tonnage-expedition": { label: "Tonnage expédition", value: Number.isFinite(d?.expedition?.tonnage) ? fmtTonnage(d.expedition.tonnage) + " t" : "Indisponible",
      detail: "106J " + (d?.referenceDate ?? "date inconnue") + (Number.isFinite(d?.total?.tonnage) ? " · Total " + fmtTonnage(d.total.tonnage) + " t" : "") },
    positions: { label: "Positions", value: fmt(m.summary?.positions), detail: "Excel · " + (m.match?.timeRangeLabel ?? "plage active") },
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
    page.text(34, 477, 12, "Passes reussies - tous dechargements / heure", C.aqua, true);
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
function compactMetric(p, x, y, width, label, value, detail = "") {
  p.box(x, y, width, 64, C.panel);
  p.box(x, y + 61, width, 3, C.blue);
  p.box(x, y, 3, 61, C.panel2);
  p.text(x + 10, y + 43, 8.5, trim(label, 27).toUpperCase(), C.aqua, true);
  const valueText = ascii(value ?? "Indisponible");
  const fontSize = valueText.length > 30 ? 10 : valueText.length > 17 ? 13 : 21;
  const parts = wrap(valueText, Math.max(12, Math.floor((width - 20) / (fontSize * 0.55))));
  if (parts.length > 2) throw new MatchExportError(422, "Le libellé d'un KPI est trop long pour le briefing papier.");
  parts.forEach((line, i) => p.text(x + 10, y + 18 - i * 12, fontSize, line, C.white, true));
  if (detail && parts.length === 1) p.text(x + 10, y + 5, 7.4, trim(detail, Math.floor((width - 20) / 4.1)), C.muted);
}

/** Every printed chart is an operationally faithful *summary* of its on-screen
 * carousel source, never a reinterpreted percentage or a screenshot crop.
 * All vector primitives are confined to the same 784 x 116 pt page-one panel. */
function chartFrame(p, title, subtitle) {
  p.box(29, 43, 784, 146, C.panel);
  p.box(29, 186, 784, 3, C.aqua);
  p.box(29, 43, 3, 143, C.panel2);
  p.text(42, 170, 11, title, C.aqua, true);
  if (subtitle) p.text(42, 155, 9, subtitle, C.text);
}
function chartPercentRow(p, y, label, rate, volume, color = C.aqua) {
  p.text(42, y + 10, 9, label, C.white, true);
  p.box(238, y + 6, 398, 11, C.panel2);
  if (Number.isFinite(rate) && rate >= 0 && rate <= 100) {
    p.box(238, y + 6, 398 * rate / 100, 11, color);
  }
  p.text(650, y + 8, 9, Number.isFinite(rate) ? percent(rate) : "N/D", C.text, true);
  if (volume) p.text(800, y + 8, 8, volume, C.muted, false, "right");
}
function slotClock(slot, index) {
  const label = typeof slot?.label === "string" ? slot.label.trim() : "";
  if (/^\d{1,2}\s*h(?::?\d{2})?$/.test(label)) return label;
  const start = typeof slot?.start === "string" ? slot.start : "";
  if (/^\d{1,2}:\d{2}$/.test(start)) return start.slice(0, 2) + "h";
  const date = new Date(start);
  if (start && Number.isFinite(date.getTime())) {
    // fr-FR may already include an hour unit ("00 h"). Read only the
    // numeric hour part, then append the unit exactly once, across DST dates.
    const parts = new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Europe/Paris", hour: "2-digit", hourCycle: "h23",
    }).formatToParts(date);
    const hour = parts.find(part => part.type === "hour")?.value;
    if (hour && /^\d{1,2}$/.test(hour)) return hour.padStart(2, "0") + "h";
  }
  return label && label.length <= 7 ? label : String(index + 1);
}
function compactChart(p, m, chartId) {
  if (chartId === "passes-hourly") {
    const rows = Array.isArray(m.hourlyPerformance) ? m.hourlyPerformance
      .filter(row => row && Number.isFinite(row.rate) && row.rate >= 0 && row.rate <= 100) : [];
    const won = rows.reduce((sum, row) => sum + (Number.isFinite(row.won) ? row.won : 0), 0);
    const total = rows.reduce((sum, row) => sum + (Number.isFinite(row.total) ? row.total : 0), 0);
    const weightedRate = total > 0 ? Math.round(won / total * 1000) / 10 : null;
    chartFrame(p, "PASSES RÉUSSIES / HEURE",
      "Tous DECHG eligibles, tous segments dont LIV ; zonage <= " + fmt(m.criteria?.zonageMinutes) + " min  |  Total : " + percent(weightedRate));
    if (!rows.length) { p.text(43, 91, 10, "Aucune donnée horaire éligible dans la plage choisie.", C.muted); return; }
    const x = 78, baseline = 85, w = 699, h = 51;
    for (const value of [0, 50, 100]) {
      const y = baseline + value / 100 * h;
      p.box(x, y, w, 0.6, C.panel2);
      p.text(42, y - 2.5, 7.4, String(value) + "%", C.muted);
    }
    // Match the website's temporal scale: use the selected period and true
    // clock-hour offsets, not equally spaced array indices. Missing hours
    // remain gaps and use dashed connectors rather than fabricated samples.
    const parseMinutes = value => {
      const match = /^(\\d{1,2}):(\\d{2})$/.exec(String(value ?? ""));
      if (!match) return null;
      const hour = Number(match[1]), minute = Number(match[2]);
      return hour < 24 && minute < 60 ? hour * 60 + minute : null;
    };
    const periodStart = parseMinutes(m.match?.periodStart);
    const periodEnd = parseMinutes(m.match?.periodEnd);
    const firstHour = periodStart == null
      ? (Number.isInteger(rows[0]?.hour) ? rows[0].hour : Number.parseInt(rows[0]?.label ?? "0", 10) || 0)
      : Math.floor(periodStart / 60);
    const offsets = rows.map((row, index) => Number.isInteger(row.hour) && row.hour >= 0 && row.hour < 24
      ? (row.hour - firstHour + 24) % 24 : index);
    const selectedMinutes = periodStart != null && periodEnd != null
      ? ((periodEnd - periodStart + 1440) % 1440 || 1440) : null;
    const selectedSpan = selectedMinutes == null ? 0 : (periodStart % 60 + selectedMinutes) / 60;
    const spanHours = Math.max(1, selectedSpan, ...offsets);
    const points = rows.map((row, i) => ({
      row, offset: offsets[i], x: x + offsets[i] / spanHours * w,
      y: baseline + row.rate / 100 * h,
    }));
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      if (i > 0) {
        const prev = points[i - 1];
        const gap = point.offset - prev.offset > 1;
        // The line itself is continuous only between consecutive observed hours.
        p.ops.push(rgb(C.aqua) + " RG 1.6 w " + (gap ? "[3 3] 0 d " : "[] 0 d ")
          + prev.x.toFixed(2) + " " + prev.y.toFixed(2) + " m "
          + point.x.toFixed(2) + " " + point.y.toFixed(2) + " l S [] 0 d\n");
      }
      p.box(point.x - 1.8, point.y - 1.8, 3.6, 3.6, C.aqua);
    }
    // Include the complete selected time window, even when observations start
    // late or stop early. This also distinguishes an empty hour from 0%.
    const axisStart = firstHour;
    const lastTick = Math.floor(spanHours);
    const labelEvery = Math.max(1, Math.ceil((lastTick + 1) / 10));
    for (let hour = 0; hour <= lastTick; hour += labelEvery) {
      const tickX = x + hour / spanHours * w;
      p.text(tickX, 76, 7, String((axisStart + hour) % 24).padStart(2, "0") + "h", C.muted);
    }
    if (periodEnd !== null && periodEnd % 60 !== 0) {
      const endLabel = String(Math.floor(periodEnd / 60)).padStart(2, "0") + "h"
        + String(periodEnd % 60).padStart(2, "0");
      p.text(x + w, 76, 7.4, endLabel, C.gold, true, "right");
      p.line(x + w, baseline, x + w, baseline + h, C.gold, 0.65);
    }
    // Preserve both exact source labels in the printed recap, including
    // historical/synthetic snapshots whose numeric hour field is inconsistent.
    const first = rows[0], last = rows[rows.length - 1];
    p.text(x, 62, 8, trim(String(first.label ?? first.hour ?? "Début"), 20) + " : " + percent(first.rate), C.text);
    p.text(x + w, 62, 8, trim(String(last.label ?? last.hour ?? "Fin"), 20) + " : " + percent(last.rate), C.text, false, "right");
    const empty = [];
    const observed = new Set(offsets);
    for (let hour = 0; hour <= lastTick; hour++) {
      if (!observed.has(hour)) empty.push(hour);
    }
    if (empty.length) p.text(x + w / 2, 61, 7.3, empty.length + " h sans donnée", C.muted, false, "center");
    p.text(42, 49, 8.4, "Tous dechargements eligibles ; périmètre distinct du KPI officiel toutes opérations.", C.muted);
    return;
  }
  if (chartId === "reception-time") {
    const hourly = m.unloadingHourlyAnalysis;
    const slots = hourly?.state === "indisponible" ? [] : (hourly?.items ?? [])
      .filter(slot => Number.isFinite(slot?.meanSecondsPerPosition)
        && slot.meanSecondsPerPosition >= 0 && slot.state !== "indisponible");
    const target = m.criteria.unloadingSeconds;
    chartFrame(p, "DUELS GAGNÉS / TEMPS DE RÉCEPTION",
      "Duels au score : " + percent(m.score?.indicators?.unloadingPercent)
        + "  |  Barres : secondes moyennes par position  |  Cible : " + fmt(target) + " s/poz");
    if (!slots.length) { p.text(43, 90, 10, "Aucun créneau réception exploitable (15 poz min, hors AQ).", C.muted); return; }
    const x = 78, baseline = 87, w = 699, h = 47;
    const maxRate = Math.max(target, ...slots.map(slot => slot.meanSecondsPerPosition));
    const ceiling = Math.max(60, Math.ceil(maxRate * 1.2 / 60) * 60);
    p.text(43, baseline + h - 2, 7.4, fmt(ceiling) + "s", C.muted);
    p.text(43, baseline - 2, 7.4, "0s", C.muted);
    p.box(x, baseline, w, 0.6, C.panel2);
    const goalY = baseline + Math.min(1, target / ceiling) * h;
    p.ops.push(rgb(C.gold) + " RG 1 w " + x.toFixed(2) + " " + goalY.toFixed(2)
      + " m " + (x + w).toFixed(2) + " " + goalY.toFixed(2) + " l S\n");
    const step = w / slots.length, labelEvery = Math.max(1, Math.ceil(slots.length / 11));
    slots.forEach((slot, index) => {
      const left = x + index * step + Math.min(2, step / 8);
      const width = Math.max(1.4, step - Math.min(4, step / 4));
      const height = Math.max(1, Math.min(h, slot.meanSecondsPerPosition / ceiling * h));
      p.box(left, baseline, width, height, slot.meanSecondsPerPosition > target ? C.red : C.aqua);
      // The web carousel prints positions above each column, while its height
      // represents seconds per position. Preserve both concepts on paper.
      if ((index % labelEvery === 0 || index === slots.length - 1) && Number.isFinite(slot.distinctPositions)) {
        p.text(left, Math.min(144, baseline + height + 4), 7.6, fmt(slot.distinctPositions) + " pos", C.text);
      }
      if (index % labelEvery === 0 || index === slots.length - 1) {
        p.text(left, 68, 7.7, slotClock(slot, index), C.muted);
      }
    });
    const positions = slots.map(slot => slot.distinctPositions).filter(Number.isFinite);
    p.text(42, 49, 7.8,
      String(slots.length) + " créneaux | Positions/créneau : "
      + (positions.length ? fmt(Math.min(...positions)) + " a " + fmt(Math.max(...positions)) : "N/D")
      + " | Rouge = au-dessus de la cible, or = seuil de ligue.", C.muted);
    return;
  }
  if (chartId === "loading") {
    const q = m.loadingQuality;
    chartFrame(p, "TIRS CADRES / QUALITE DES CHARGEMENTS",
      "TCD PPT, plage active  |  Temps par position <= " + fmt(m.criteria.loadingSeconds) + " s/poz (ligue " + m.league.label + ")");
    const total = Number.isFinite(q?.targeted) && Number.isFinite(q?.offTarget)
      ? q.targeted + q.offTarget : null;
    if (!total || total <= 0 || !Number.isFinite(q?.targetedPercent) || !Number.isFinite(q?.offTargetPercent)) {
      p.text(43, 91, 10, "Aucun chargement exploitable sur le perimetre selectionne.", C.muted); return;
    }
    chartPercentRow(p, 112, "Chargements cadrés", q.targetedPercent, fmt(q.targeted) + " / " + fmt(total), C.aqua);
    chartPercentRow(p, 82, "Chargements hors cible", q.offTargetPercent, fmt(q.offTarget) + " / " + fmt(total), C.red);
    p.text(42, 52, 8.4, "Source : TCD PPT / exclusions chargement de l'agence appliquees au MATCH.", C.muted);
    return;
  }
  if (chartId === "centers") {
    const d = m.dailyIndicators;
    const value = d?.punctuality?.destinationPunctuality;
    const target = d?.punctualityTargets?.destinationPunctuality;
    const date = d?.referenceDate ?? "date non renseignee";
    chartFrame(p, "CENTRES RÉUSSIS / PONCTUALITÉ DESTINATION",
      "Source PDF 106J du " + String(date) + "  |  Périmètre journalier, distinct de la plage Excel.");
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      p.text(43, 92, 10, "Donnée 106J indisponible : aucun taux de centres ne peut etre affiche.", C.muted); return;
    }
    p.text(43, 105, 23, percent(value), C.white, true);
    p.box(210, 109, 558, 21, C.panel2);
    p.box(210, 109, 558 * value / 100, 21, C.aqua);
    p.box(210 + 558 * value / 100, 109, 558 * (100 - value) / 100, 21, C.red);
    if (Number.isFinite(target) && target >= 0 && target <= 100) {
      const mark = 210 + 558 * target / 100;
      p.box(mark - 1, 106, 2, 27, C.gold);
    }
    p.text(210, 88, 9, "Réussis : " + percent(value) + "  |  Hors cible : " + percent(100 - value), C.text);
    p.text(42, 52, 8.6,
      Number.isFinite(target) ? "Objectif 106J : " + percent(target) + " (repere or ; pas le seuil de ligue)"
        : "Objectif 106J non fourni : aucun seuil n'est présumé.", C.muted);
    return;
  }
  if (chartId === "operational-diagnostic") {
    const z = m.zonageDiagnostic;
    chartFrame(p, "DIAGNOSTIC OPERATIONNEL / ZONAGE",
      "Ligue " + m.league.label + "  |  Cible zonage <= " + fmt(m.criteria.zonageMinutes) + " min  |  Période d'exploitation retenue.");
    if (!z || z.state === "indisponible" || !Number.isFinite(z.receivedPositions)
      || z.receivedPositions <= 0) {
      p.text(43, 90, 10, "Perimetre zonage indisponible ; aucun retard n'est présumé.", C.muted); return;
    }
    p.text(43, 132, 9.7,
      "Hors délai : " + fmt(z.latePositions) + "/" + fmt(z.qualifiablePositions)
      + " vérifiables   |   Délais inconnus : " + fmt(z.unqualifiablePositions)
      + "/" + fmt(z.receivedPositions) + " reçues", C.text);
    const complete = [z.latePositions, z.onTimePositions, z.unqualifiablePositions].every(v =>
      Number.isFinite(v) && v >= 0) && z.latePositions + z.onTimePositions + z.unqualifiablePositions === z.receivedPositions;
    if (complete) {
      const x = 52, y = 103, w = 730;
      p.box(x, y, w, 14, C.panel2);
      p.box(x, y, w * z.latePositions / z.receivedPositions, 14, C.red);
      p.box(x + w * z.latePositions / z.receivedPositions, y, w * z.onTimePositions / z.receivedPositions, 14, C.aqua);
      p.box(x + w * (z.latePositions + z.onTimePositions) / z.receivedPositions, y,
        w * z.unqualifiablePositions / z.receivedPositions, 14, C.muted);
    } else p.text(42, 104, 8, "Répartition indisponible : nombres de positions incohérents.", C.muted);
    p.text(42, 84, 9,
      "Anomalie (qualifiables) : " + percent(z.anomalyRate)
      + "  |  Couverture (reçues) : " + percent(z.coverageRate), C.text);
    const worst = Array.isArray(z.top5) && z.top5.length ? z.top5[0] : null;
    p.text(42, 49, 8,
      worst ? "Premier voyage à examiner : " + trim(worst.travelCode, 32) + " / " + fmt(worst.latePositions) + " retards"
        : "Aucun voyage prioritaire identifié dans la population qualifiable.", C.muted);
    return;
  }
  chartFrame(p, "ANALYSE INDISPONIBLE", "La sélection du graphique a changé. Recharge le MATCH.");
}

/** Size the text to the actual printable geometry, not an arbitrary line cap.
 * All six fields can use their documented input limits while staying on page 2.
 * Unknown excess still raises 422 with the exact section; never silently crop. */
function shortBlock(p, { x, y, w, h, title, value, accent = C.aqua, marker = "" }) {
  // V3 tactile editorial surface: light tactical panels over a navy pitch.
  // Padding and available line capacity match the historical brief exactly.
  const fill = title === "Sécurité / vigilance" ? C.paperWarm : C.paper;
  p.box(x, y, w, h, fill);
  p.box(x, y + h - 3, w, 3, accent);
  p.box(x, y, 4, h - 3, accent);
  p.text(x + 11, y + h - 17, 9.5, title.toUpperCase(), C.navyInk, true);
  if (marker) {
    // Section identifiers are informational, not extra brief content.
    p.text(x + w - 12, y + h - 17, 7.6, marker, C.slateInk, true, "right");
  }
  const size = 8.7, lineHeight = 9.9;
  const maxChars = Math.max(14, Math.floor((w - 24) / (size * 0.54)));
  const lines = wrap(value || "Non renseigné", maxChars);
  const firstBaseline = y + h - 28;
  const capacity = Math.max(1, 1 + Math.floor((h - 35) / lineHeight));
  if (lines.length > capacity) {
    throw new MatchExportError(422,
      `La rubrique « ${title} » contient ${lines.length} lignes (maximum ${capacity} sur 2 pages). Raccourcis uniquement cette synthèse dans « Personnaliser le PDF ».`);
  }
  lines.forEach((line, i) => p.text(x + 11, firstBaseline - i * lineHeight, size, line, C.navyInk));
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
  p.text(806, 486, 8.2, "RÉSULTAT DU MATCH", C.gold, true, "right");
  p.text(36, 468, 9,
    `Zonage <= ${fmt(m.criteria.zonageMinutes)} min  |  CHG <= ${fmt(m.criteria.loadingSeconds)} s/poz  |  DECHG <= ${fmt(m.criteria.unloadingSeconds)} s/poz`,
    C.muted);
  const score = m.score;
  // Full-width match scoreboard: gold top rail, subtle pitch geometry,
  // oversized result numbers, and two contrasting performance territories.
  p.box(29, 400, 784, 66, C.panel);
  p.box(29, 463, 784, 3, C.gold);
  p.box(29, 400, 16, 63, C.panel2);
  p.box(797, 400, 16, 63, C.panel2);
  // Stadium / pitch center circle: deliberately subtle to keep the score dominant.
  p.circle(421, 433, 19, C.pitchLine, 1.2);
  p.line(421, 411, 421, 455, C.pitchLine, 0.8);
  p.outline(374, 410, 94, 46, C.pitchLine, 0.65);
  p.text(229, 444, 9.5, "BUTS MARQUÉS", C.aqua, true, "center");
  p.text(613, 444, 9.5, "BUTS ENCAISSÉS", C.red, true, "center");
  const scored = score?.status === "available" ? fmt(score.goalsFor) : "Indisponible";
  const conceded = score?.status === "available" ? fmt(score.goalsAgainst) : "Indisponible";
  const scoreFont = value => value.length > 8 ? 15 : 34;
  p.text(229, 409, scoreFont(scored), scored, C.white, true, "center");
  p.text(613, 409, scoreFont(conceded), conceded, C.white, true, "center");
  p.text(421, 423, 16, "-", C.gold, true, "center");
  const rates = [
    ["Passes réussies", score?.indicators?.passRate],
    ["Tirs cadrés", score?.indicators?.loadingPercent],
    ["Duels gagnés", score?.indicators?.unloadingPercent],
    ["Possession", score?.indicators?.possessionPercent],
  ];
  rates.forEach(([label, val], i) =>
    p.card(29 + i * 199, 337, 187, 58, label, percent(val), "",
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
    compactMetric(p, x, 265 - row * 69, columns === 2 ? 385 : 252, card.label, card.value, card.detail);
  });
  compactChart(p, m, m.pdfProfile.chartId);
}
function compactBriefPage(doc, m) {
  const p = doc.add("02 / LE PLAN DE JEU");
  p.text(36, 477, 20, "BRIEF OPERATIONNEL DU JOUR", C.white, true);
  p.box(29, 469, 784, 2, C.gold);
  p.text(777, 479, 8, trim([m.causerie?.team, m.causerie?.manager].filter(Boolean).join(" / "), 42), C.muted, false, "right");
  const brief = effectiveBriefText(m);
  // Keep the exact labels of BRIEF ÉQUIPE, not the old football metaphors.
  shortBlock(p, { x: 29, y: 405, w: 784, h: 58, title: "Sécurité / vigilance", value: brief.safety, accent: C.gold, marker: "00 / VIGILANCE" });
  shortBlock(p, { x: 29, y: 273, w: 784, h: 126, title: "Service client", value: brief.attack, accent: C.blue, marker: "01 / PROMESSE CLIENT" });
  shortBlock(p, { x: 29, y: 149, w: 482, h: 118, title: "Expédition / Ramasse & Emballage", value: brief.midfield, accent: C.aqua, marker: "02 / FLUX" });
  shortBlock(p, { x: 523, y: 149, w: 290, h: 118, title: "SST", value: brief.defense, accent: C.red, marker: "03 / PROTECTION" });
  shortBlock(p, { x: 29, y: 43, w: 385, h: 100, title: "Priorités opérationnelles", value: brief.priorities, accent: C.gold, marker: "04 / PRIORITÉS" });
  shortBlock(p, { x: 428, y: 43, w: 385, h: 100, title: "Décisions / arbitrages", value: brief.decisions, accent: C.aqua, marker: "05 / DÉCISIONS" });
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
