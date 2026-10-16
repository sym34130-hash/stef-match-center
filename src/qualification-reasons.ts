export const NON_QUALIFIABLE_NOTICE = "Non qualifiable ne signifie pas en retard.";

export const qualificationReasons: Record<string, { label: string; explanation: string; summary: string }> = {
  zonage_uniquement_anterieur: {
    label: "Zonage uniquement antérieur",
    explanation: "Le zonage a été enregistré avant la réception de la palette. Aucun zonage ultérieur n'a été retrouvé dans les données analysées. Le délai ne peut donc pas être calculé.",
    summary: "Un zonage précède la réception, mais aucun zonage ultérieur n'a été retrouvé.",
  },
  zonage_absent: {
    label: "Zonage absent",
    explanation: "Aucun zonage n'a été retrouvé pour cette position dans les données analysées. Impossible de calculer son délai.",
    summary: "Aucun zonage retrouvé pour cette position dans les données analysées.",
  },
  voyage_reception_absent: {
    label: "Voyage de réception absent",
    explanation: "Le voyage de réception n'a pas pu être identifié de manière fiable.",
    summary: "Le voyage de réception ne peut pas être identifié de manière fiable.",
  },
  receptions_contradictoires: {
    label: "Réceptions contradictoires",
    explanation: "Plusieurs voyages différents sont associés aux réceptions de cette position. Le voyage de référence est incertain.",
    summary: "Les réceptions de la position sont associées à plusieurs voyages différents.",
  },
};

const unknownReason = {
  label: "Association non qualifiable",
  explanation: "Les données disponibles ne permettent pas de vérifier ce délai de manière fiable. Aucun motif plus précis n'est disponible.",
  summary: "Le délai ne peut pas être vérifié de manière fiable avec les données disponibles.",
};

export function describeQualificationReason(reason: string | null | undefined) {
  return reason && Object.hasOwn(qualificationReasons, reason) ? qualificationReasons[reason] : unknownReason;
}
