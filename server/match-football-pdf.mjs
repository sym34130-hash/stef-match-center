// Presentation layer only: two-page football match briefing.
// Calculations, source isolation, chart series and brief content stay in the existing model.
const PAGE_W = 842;
const PAGE_H = 595;
const S = Object.freeze({
  background: [0.032, 0.067, 0.124],
  surface: [0.071, 0.134, 0.208],
  surface2: [0.096, 0.170, 0.251],
  line: [0.173, 0.275, 0.365],
  pitch: [0.147, 0.255, 0.334],
  white: [1, 1, 1],
  text: [0.867, 0.923, 0.965],
  muted: [0.666, 0.771, 0.845],
  aqua: [0.49, 0.88, 0.80],
  blue: [0.58, 0.79, 0.95],
  gold: [0.94, 0.78, 0.50],
  red: [1, 0.59, 0.53],
});

const ink = color => color.map(channel => channel.toFixed(3)).join(" ");
const limited = (value, n = 160) => String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, n);
const safe = value => String(value ?? "").replace(/[\r\n\t]/g, " ");
const bounded = (value, low, high) => Math.max(low, Math.min(high, value));

function rule(p, x, y, x2, y2, color = S.line, width = 0.8) {
  p.ops.push(ink(color) + " RG " + width.toFixed(2) + " w "
    + x.toFixed(2) + " " + y.toFixed(2) + " m "
    + x2.toFixed(2) + " " + y2.toFixed(2) + " l S\n");
}

function outline(p, x, y, w, h, color = S.pitch) {
  p.ops.push(ink(color) + " RG 0.80 w " + [x, y, w, h].map(v => v.toFixed(2)).join(" ") + " re S\n");
}

function circle(p, x, y, r, color = S.pitch) {
  const k = 0.55228475 * r;
  const num = v => v.toFixed(2);
  p.ops.push(ink(color) + " RG 0.80 w "
    + num(x + r) + " " + num(y) + " m "
    + num(x + r) + " " + num(y + k) + " " + num(x + k) + " " + num(y + r) + " " + num(x) + " " + num(y + r) + " c "
    + num(x - k) + " " + num(y + r) + " " + num(x - r) + " " + num(y + k) + " " + num(x - r) + " " + num(y) + " c "
    + num(x - r) + " " + num(y - k) + " " + num(x - k) + " " + num(y - r) + " " + num(x) + " " + num(y - r) + " c "
    + num(x + k) + " " + num(y - r) + " " + num(x + r) + " " + num(y - k) + " " + num(x + r) + " " + num(y) + " c S\n");
}

// One subtle pitch watermark: the visual football cue must not compete with KPIs.
function pitch(p, x, y, w, h) {
  outline(p, x, y, w, h);
  rule(p, x + w / 2, y, x + w / 2, y + h, S.pitch);
  circle(p, x + w / 2, y + h / 2, h * 0.20);
  outline(p, x, y + h * 0.23, w * 0.16, h * 0.54);
  outline(p, x + w * 0.84, y + h * 0.23, w * 0.16, h * 0.54);
}

function page(doc, m, number, label) {
  const p = doc.add(String(number).padStart(2, "0") + " / " + label);
  // Replace the legacy PDF page skin only on the compact, HTTP-exported pages.
  p.ops = [];
  p.box(0, 0, PAGE_W, PAGE_H, S.background);
  p.box(0, PAGE_H - 7, PAGE_W, 7, S.aqua);
  rule(p, 29, 520, 813, 520);
  rule(p, 29, 31, 813, 31);
  p.text(29, 560, 16, "STEF MATCH CENTER", S.white, true);
  p.text(29, 539, 9, number === 1 ? "APRÈS-MATCH / FEUILLE DE SCORE" : "APRÈS-MATCH / PLAN DE JEU", S.aqua, true);
  p.text(812, 560, 12, limited(m.agency.name + " [" + m.agency.code + "]", 48), S.white, true, "right");
  p.text(812, 539, 9, limited(m.league.label + " / " + m.match.date + " / " + m.match.timeRangeLabel, 75), S.muted, false, "right");
  // Mandatory, explicit source provenance on BOTH pages. Never infer an origin.
  const origin = "Sources : Excel [" + (m.sourceAgency?.excel || "origine indéterminée")
    + "] / 106J [" + (m.sourceAgency?.pdf106j || "non indiquée")
    + "] (" + (m.sourceAgency?.pdfDate || "date non indiquée") + ")";
  p.text(30, 17, 7.8, limited(origin, 131), S.muted);
  p.text(812, 17, 8, String(number) + " / 2", S.muted, false, "right");
  return p;
}

function score(p, m, fmt) {
  const s = m.score;
  const valid = s?.status === "available";
  const left = valid ? fmt(s.goalsFor) : "N/D";
  const right = valid ? fmt(s.goalsAgainst) : "N/D";
  p.box(29, 409, 784, 99, S.surface);
  p.box(29, 409, 5, 99, S.aqua);
  pitch(p, 280, 421, 122, 72);
  p.text(48, 484, 10, m.league.label + " / RÉSULTAT DU JOUR", S.gold, true);
  p.text(48, 454, 23, "FEUILLE DE MATCH", S.white, true);
  p.text(48, 434, 9, "Zonage <= " + fmt(m.criteria.zonageMinutes) + " min  |  CHG <= "
    + fmt(m.criteria.loadingSeconds) + " s/poz  |  DECHG <= "
    + fmt(m.criteria.unloadingSeconds) + " s/poz", S.muted);
  rule(p, 417, 425, 417, 489);
  p.text(502, 482, 9, "BUTS MARQUÉS", S.aqua, true, "center");
  p.text(691, 482, 9, "BUTS ENCAISSÉS", S.red, true, "center");
  const fsLeft = left.length > 3 ? 23 : 46;
  const fsRight = right.length > 3 ? 23 : 46;
  p.text(502, 425, fsLeft, left, S.white, true, "center");
  p.text(595, 446, 23, "-", S.muted, true, "center");
  p.text(691, 425, fsRight, right, S.white, true, "center");
}

function rateCard(p, x, y, width, label, value, target, percent) {
  const valid = Number.isFinite(value) && value >= 0 && value <= 100;
  const adverse = valid && value <= target;
  const accent = adverse ? S.red : S.aqua;
  const printed = percent(value);
  p.box(x, y, width, 68, S.surface);
  p.box(x, y, 4, 68, accent);
  p.text(x + 12, y + 49, 8.7, label.toUpperCase(), S.muted, true);
  p.text(x + 12, y + 20, valid ? 25 : 11, printed, S.white, true);
  p.box(x + 12, y + 8, width - 24, 3, S.line);
  if (valid) p.box(x + 12, y + 8, (width - 24) * value / 100, 3, accent);
}

function metric(p, x, y, w, item) {
  p.box(x, y, w, 61, S.surface);
  p.box(x, y + 58, 42, 3, S.blue);
  p.text(x + 12, y + 45, 8.5, limited(item.label, 36).toUpperCase(), S.muted, true);
  const value = safe(item.value || "Indisponible");
  const size = bounded((w - 25) / Math.max(1, value.length * 0.55), 8.5, 19);
  if (value.length * size * 0.55 > w - 24) {
    throw new Error("KPI imprimable trop long : " + item.label);
  }
  p.text(x + 12, y + 22, size, value, S.white, true);
  if (item.detail) p.text(x + 12, y + 8, 7.4,
    limited(item.detail, Math.max(12, Math.floor((w - 24) / 4.1))), S.muted);
}

function briefBlock(p, x, y, w, h, label, content, errorType) {
  p.box(x, y, w, h, S.surface);
  p.box(x, y + h - 3, 46, 3, S.aqua);
  p.text(x + 12, y + h - 19, 9.2, label.toUpperCase(), S.white, true);
  const size = 8.7;
  const leading = 10.1;
  const maxChars = Math.max(14, Math.floor((w - 26) / (size * 0.54)));
  const words = safe(content || "Non renseigné").split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = ""; }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars));
    } else if ((current + " " + word).trim().length > maxChars) {
      lines.push(current);
      current = word;
    } else current = (current + " " + word).trim();
  }
  if (current) lines.push(current);
  if (!lines.length) lines.push("Non renseigné");
  const capacity = Math.max(1, 1 + Math.floor((h - 41) / leading));
  if (lines.length > capacity) {
    throw new errorType(422, "La rubrique « " + label + " » contient " + lines.length
      + " lignes (maximum " + capacity + " sur 2 pages). Raccourcis uniquement cette synthèse dans « Personnaliser le PDF ».");
  }
  lines.forEach((line, i) => p.text(x + 12, y + h - 33 - i * leading, size, line, S.text));
}

export function renderFootballPdf(m, deps) {
  const { Pdf, indicatorCards, compactChart, effectiveBriefText, fmt, percent, MatchExportError } = deps;
  const doc = new Pdf(m);
  const first = page(doc, m, 1, "FEUILLE DE MATCH");
  score(first, m, fmt);
  const metrics = [
    ["Passes réussies", m.score?.indicators?.passRate],
    ["Tirs cadrés", m.score?.indicators?.loadingPercent],
    ["Duels gagnés", m.score?.indicators?.unloadingPercent],
    ["Possession", m.score?.indicators?.possessionPercent],
  ];
  metrics.forEach(([label, value], i) => rateCard(first, 29 + i * 199, 333, 187,
    label, value, m.criteria.scoreTargetPercent, percent));

  // Effective profile already filters hidden cards; no added KPI and no changed calculation.
  const pool = indicatorCards(m);
  const byId = new Map(m.visibleIndicators.map((id, i) => [id, pool[i]]));
  const chosen = m.pdfProfile.indicatorIds.map(id => byId.get(id)).filter(Boolean);
  const columns = chosen.length <= 4 ? 2 : 3;
  chosen.forEach((item, i) => {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const x = columns === 2 ? 29 + column * 399
      : 29 + column * 266 + (chosen.length === 5 && row === 1 ? 133 : 0);
    metric(first, x, 264 - row * 70, columns === 2 ? 385 : 252, item);
  });
  if (!chosen.length) first.text(43, 284, 9, "Aucun KPI complémentaire visible dans le Match.", S.muted);
  compactChart(first, m, m.pdfProfile.chartId);

  const second = page(doc, m, 2, "PLAN DE JEU");
  second.text(29, 488, 23, "PLAN DE JEU", S.white, true);
  second.text(30, 470, 9, "BRIEF OPÉRATIONNEL DU JOUR", S.aqua, true);
  const identity = [m.causerie?.team, m.causerie?.manager].filter(Boolean).join(" / ");
  if (identity) second.text(812, 487, 8.2, limited(identity, 50), S.muted, false, "right");
  // The tactical analogy stays in the composition, not in fake métier labels.
  const brief = effectiveBriefText(m);
  briefBlock(second, 29, 404, 784, 58, "Sécurité / vigilance", brief.safety, MatchExportError);
  briefBlock(second, 29, 272, 784, 123, "Service client", brief.attack, MatchExportError);
  briefBlock(second, 29, 149, 482, 115, "Expédition / Ramasse & Emballage", brief.midfield, MatchExportError);
  briefBlock(second, 523, 149, 290, 115, "SST", brief.defense, MatchExportError);
  briefBlock(second, 29, 43, 385, 98, "Priorités opérationnelles", brief.priorities, MatchExportError);
  briefBlock(second, 428, 43, 385, 98, "Décisions / arbitrages", brief.decisions, MatchExportError);
  const captures = m.causerie?.attachmentCounts ?? {};
  if (Object.values(captures).some(value => Number(value) > 0)) {
    second.text(34, 35, 7.4, "Captures sur le site : Service client " + (captures.attack ?? 0)
      + " / Expedition " + (captures.midfield ?? 0) + " / SST " + (captures.defense ?? 0), S.muted);
  }

  if (doc.pages.length !== 2) throw new MatchExportError(500, "Nombre de pages inattendu.");
  return doc.render();
}
