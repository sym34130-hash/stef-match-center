// Explicit, reception-only exclusions. Never infer a tri customer from a
// destination or a segment; use only a named client field in the source Excel.
export const RECEPTION_EXCLUSION_VERSION = 1;
const MAX_ITEMS = 400;
const MAX_CODE_LENGTH = 120;
const MAX_REASON_LENGTH = 240;

export function normalizeReceptionCode(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().replace(/\\s+/g, " ").slice(0, MAX_CODE_LENGTH) : "";
}

export function receptionClientKey(value) {
  return normalizeReceptionCode(value).toLocaleUpperCase("fr-FR");
}

export function normalizeReceptionExclusions(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = (items, kind) => {
    const result = new Map();
    for (const item of Array.isArray(items) ? items.slice(0, MAX_ITEMS) : []) {
      const code = normalizeReceptionCode(item?.code);
      if (!code) continue;
      const key = kind === "clients" ? receptionClientKey(code) : code;
      const reason = normalizeReceptionCode(item?.reason).slice(0, MAX_REASON_LENGTH);
      const updatedAt = typeof item?.updatedAt === "string" && !Number.isNaN(Date.parse(item.updatedAt)) ? item.updatedAt : null;
      result.set(key, { code, reason, updatedAt });
    }
    return Array.from(result.values()).sort((a, b) => a.code.localeCompare(b.code, "fr"));
  };
  return { travels: entries(input.travels, "travels"), clients: entries(input.clients, "clients") };
}

// All 'rows' belong to the already selected operating period. A client-level
// exclusion applies to an entire transport voyage only if ALL its reception
// lines have a known and excluded client: mixed/unknown client assignments are
// never silently removed or used to recompute a partial travel duration.
export function prepareReceptionScope(rows, input, { clientColumnPresent = false } = {}) {
  const excluded = normalizeReceptionExclusions(input);
  const eligible = (rows ?? []).filter(row => row.operationType === "DECHG" &&
    String(row.segmentType ?? "").trim().toUpperCase() !== "AQ");
  const groups = new Map();
  for (const row of eligible) {
    const code = normalizeReceptionCode(row.travelCode);
    if (!code) continue;
    if (!groups.has(code)) groups.set(code, []);
    groups.get(code).push(row);
  }
  const excludedTravelCodes = new Set(excluded.travels.map(x => x.code));
  const excludedClientKeys = new Set(excluded.clients.map(x => receptionClientKey(x.code)));
  const availableClients = new Map();
  for (const [travelCode, operations] of groups) {
    for (const row of operations) {
      const client = normalizeReceptionCode(row.triClient);
      if (!client) continue;
      const key = receptionClientKey(client);
      const entry = availableClients.get(key) ?? { code: client, travelCodes: new Set() };
      entry.travelCodes.add(travelCode);
      availableClients.set(key, entry);
    }
  }

  const clientExcludedTravelCodes = new Set();
  const ambiguousClientTravels = [];
  for (const [code, operations] of groups) {
    if (excludedTravelCodes.has(code) || excludedClientKeys.size === 0) continue;
    const keys = operations.map(row => receptionClientKey(row.triClient));
    if (keys.every(key => key && excludedClientKeys.has(key))) clientExcludedTravelCodes.add(code);
    else if (keys.some(key => key && excludedClientKeys.has(key))) ambiguousClientTravels.push(code);
  }
  const allExcludedCodes = new Set([...excludedTravelCodes, ...clientExcludedTravelCodes]);
  return {
    rows: (rows ?? []).filter(row => row.operationType !== "DECHG" || !allExcludedCodes.has(normalizeReceptionCode(row.travelCode))),
    excludedTravelCodes: allExcludedCodes,
    scope: {
      version: RECEPTION_EXCLUSION_VERSION,
      excludedTravels: excluded.travels,
      excludedClients: excluded.clients,
      availableTravels: Array.from(groups.keys()).sort((a, b) => a.localeCompare(b, "fr")),
      availableClients: Array.from(availableClients.values()).map(({ code, travelCodes }) => ({ code, travels: travelCodes.size }))
        .sort((a, b) => a.code.localeCompare(b.code, "fr")),
      clientColumnPresent,
      excludedByTravelCount: [...excludedTravelCodes].filter(code => groups.has(code)).length,
      excludedByClientCount: clientExcludedTravelCodes.size,
      ambiguousClientTravels: ambiguousClientTravels.sort((a, b) => a.localeCompare(b, "fr")),
    },
  };
}
