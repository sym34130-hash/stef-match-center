// Match 106J daily figures only to the selected Europe/Paris operating night.
// This module is independent of HTTP and filesystem state so its rules can be tested.
const MONTHS = new Map(Object.entries({
  janvier: 1, fevrier: 2, mars: 3, avril: 4, mai: 5, juin: 6,
  juillet: 7, aout: 8, septembre: 9, octobre: 10, novembre: 11, decembre: 12,
}));

export function pdfReferenceDay(referenceDate) {
  const normalized = String(referenceDate ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const match = normalized.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTHS.get(match[2]);
  if (!month) return null;
  const iso = `${match[3]}-${String(month).padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  const noon = Date.parse(`${iso}T12:00:00Z`);
  return Number.isFinite(noon) && new Date(noon).toISOString().slice(0, 10) === iso ? iso : null;
}

export function parisDay(iso) {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function normalizedAgencyId(value) {
  return String(value ?? "").trim().toUpperCase().replace(/^0+(?=[0-9A-Z])/, "");
}

export function pdfAssociation(pdf, snapshot) {
  const date = pdfReferenceDay(pdf?.referenceDate);
  const reportedAgency = normalizedAgencyId(pdf?.agencyCode);
  const targetAgency = normalizedAgencyId(snapshot?.agency?.code);
  if (reportedAgency && targetAgency && reportedAgency !== targetAgency) return {
    status: "mismatched-agency", referenceDate: pdf?.referenceDate ?? null,
    reportedAgency: pdf.agencyCode, targetAgency: snapshot.agency.code,
    message: `Le PDF 106J provient de l'agence ${pdf.agencyCode}, différente de l'agence ${snapshot.agency.code} de cet espace. Aucun indicateur n'a été associé.`,
  };
  const night = snapshot?.zonageDiagnostic?.night ?? snapshot?.anomalySummary?.night;
  const start = night?.startDate ?? parisDay(snapshot?.match?.firstOperation);
  const end = night?.endDate ?? parisDay(snapshot?.match?.lastOperation);
  if (!date || !start || !end) return {
    status: "unverified", referenceDate: pdf?.referenceDate ?? null,
    message: "La date de référence du PDF 106J ne peut pas être rapprochée de la période Excel. Import autorisé : vérifie la date propre aux indicateurs PDF.",
  };
  if (date !== start && date !== end) return {
    status: "mismatched", referenceDate: pdf.referenceDate,
    message: `Le rapport 106J correspond au ${pdf.referenceDate}, hors des dates d'exploitation ${start} à ${end}.`,
  };
  return { status: "matched", referenceDate: pdf.referenceDate, message: "PDF 106J associé à la période du match." };
}

// A report from a different day remains a valid daily source for the selected agency.
// Only a known different agency must prevent using the PDF figures.
export function canUsePdfIndicators(association) {
  return association?.status === "matched" || association?.status === "mismatched" || association?.status === "unverified";
}
