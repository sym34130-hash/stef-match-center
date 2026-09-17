export type MercatoEntrant = {
  id: string;
  key: string;
  name: string;
  detail: string;
};

export type MercatoProfile = "female" | "male";
export type MercatoProfiles = Record<string, MercatoProfile>;

const placeholderText = /^(?:à renseigner|ex\.?\s|exemple|aucun(?:e)?(?:\s+(?:nouvel(?:le)?|joueur(?:se)?|arrivant(?:e)?))?|pas de (?:nouvel(?:le)?|joueur)|rien à signaler)\b/i;
const placeholderName = /^(?:prénom(?:\s+nom)?|nom(?:\s+prénom)?|joueur(?:se)?)$/i;
const descriptionLead = /^(?:nouvel(?:le)?|nouveaux?|nouvelles?|renforts?|recrues?|arrivant(?:e)?s?|joueurs?|joueuses?|équipe|equipe|service|poste|présenter|presenter|intègre|integre|rejoint|arrive|arrivé(?:e)?s?|sera|sont|est|avec|pour|dans|sur|meilleur(?:e)?s?)\b/i;

export function parseMercatoEntrants(value: string): MercatoEntrant[] {
  const seen = new Set<string>();
  const entrants: MercatoEntrant[] = [];
  const entries = value.split(/\r?\n|[;•]+/);

  for (const entry of entries) {
    const detail = entry.trim().replace(/^(?:\d+[.)]|[-*•])\s*/, "");
    if (!detail || placeholderText.test(detail)) continue;

    const withoutIntro = stripMercatoIntro(detail);
    const beforeDescription = withoutIntro
      .split(/\s+(?:rejoint|rejoignent|intègre|intègrent|arrive|arrivent|arrivé(?:e)?s?|sera|seront|est|sont)\b/i, 1)[0]
      .split(/\s*(?::|\||—|–)\s*/, 1)[0]
      .split(/\s+[-–—]\s+/, 1)[0];
    const commaParts = beforeDescription.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
    const names: string[] = [];

    for (const part of commaParts) {
      const candidates = splitMercatoNames(part);
      if (!candidates.length || !candidates.every(isLikelyPersonName)) break;
      names.push(...candidates);
    }

    if (names.length < 2) {
      names.splice(0, names.length, ...splitMercatoNames(commaParts[0] ?? beforeDescription));
    }

    const sharedDetail = names.length > 1 ? getMercatoContext(detail, names) : detail;
    for (const rawName of names) {
      const name = rawName.replace(/^[\s"“”'.,!?;:]+|[\s"“”'.,!?;:]+$/g, "").trim().replace(/\s+/g, " ");
      if (!name || placeholderName.test(name)) continue;

      const normalized = name.normalize("NFKC").toLocaleLowerCase("fr-FR");
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      entrants.push({ id: normalized, key: normalized, name, detail: sharedDetail || name });
    }
  }

  return entrants;
}

function stripMercatoIntro(value: string) {
  return value
    .replace(/^mercato\s*[:\-–—]\s*/i, "")
    .replace(/^(?:accueillir\s+|bienvenue(?:\s+(?:à|au|aux))?\s*[:,\-–—]?\s*|(?:nouvel(?:le)?|nouveaux|nouvelles)\s+arrivant(?:e)?s?\s*[:\-–—]\s*|joueur(?:se)?s?\s*[:\-–—]\s*)/i, "");
}

function splitMercatoNames(value: string) {
  return value.split(/\s+(?:et|&|\/|\+)\s+/i).map((part) => part.trim()).filter(Boolean);
}

function isLikelyPersonName(value: string) {
  const name = value.replace(/[.!?]+$/g, "").trim();
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 5 || descriptionLead.test(words[0])) return false;
  return words.every((word) => /^[\p{L}][\p{L}'’.-]*$/u.test(word));
}

function getMercatoContext(detail: string, names: string[]) {
  let context = stripMercatoIntro(detail);
  for (const name of [...names].sort((left, right) => right.length - left.length)) {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    context = context.replace(new RegExp(`(^|[^\\p{L}])${escapedName}(?=$|[^\\p{L}])`, "giu"), "$1 ");
  }

  return context
    .replace(/(?:^|\s)(?:et|&|\/|\+)(?=\s|$)/giu, " ")
    .replace(/\b(?:rejoint|rejoignent|intègre|intègrent|integre|arrive|arrivent|arrivé(?:e)?s?|sera|seront|sont|est)\b/giu, " ")
    .replace(/[,:;|/–—-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s.!?]+|[\s.!?]+$/g, "")
    .trim();
}
