// Always identify the report's own agency/date. Never relabel external 106J figures as local KPIs.
export function pdfSourceLabel(pdf: { agencyCode?: string | null; referenceDate?: string | null } | null | undefined, agencyCode?: string | null) {
  if (!pdf) return "PDF 106J";
  const source = String(pdf.agencyCode ?? "").trim().toUpperCase();
  const destination = String(agencyCode ?? "").trim().toUpperCase();
  const comparable = (code: string) => code.replace(/^0+(?=[0-9A-Z])/, "");
  const differentAgency = source && destination && comparable(source) !== comparable(destination);
  const origin = source ? `agence source ${source}${differentAgency ? " (autre agence)" : ""}` : "agence source non indiquée";
  const date = pdf.referenceDate?.trim() || "date non indiquée";
  return `PDF 106J · ${origin} · ${date}`;
}
