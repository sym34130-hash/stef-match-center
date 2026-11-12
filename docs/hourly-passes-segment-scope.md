# Graphiques horaires de passes réussies — règles applicables (12/11/2026)

## Vignette 1/5 : deux sous-vues exclusives

- **1/2 — Performance globale** : utilise `overallHourlyPerformance`, calculée sur toutes les lignes éligibles au score officiel. Tous les types d'opérations et tous les segments restent soumis aux filtres officiels.
- **2/2 — Tous les déchargements** : utilise `hourlyPerformance`, calculée sur toutes les lignes **DECHG éligibles**, sans filtre sur la colonne G des segments. **LIV, AQ, ED, EX, blancs et autres segments sont inclus**. Les opérations CHG et ZONAGE ne sont pas comptées dans la vue 2/2.
- Les vues utilisent chacune leurs vrais numérateurs/dénominateurs et le taux pondéré ; une heure sans opération n'est pas présentée comme 0 %.
- Le carrousel externe reste à cinq vignettes, avec une seule courbe visible. Zoom, tableau de détail, exclusions et navigation conservés.
- Les annotations de voyages sur la vue 2/2 utilisent désormais les déchargements éligibles de **tous** segments.

## Définition d'une ligne éligible

Pour la vue 2/2 : `operationType === "DECHG"` dans les `scoringRows` officiels, après application de la plage active à la minute, du filtre opérateur, de `Poz non zonées`, des exclusions globales de voyages, et du seuil de zonage défini par la ligue. Le résultat de succès est déterminé par `DZ` lorsqu'il est renseigné, sinon le drapeau `Duels gagnés`, selon le moteur historique.

La vue 1/2 continue d'utiliser toutes les `scoringRows`, sans sélection DECHG. **Le KPI officiel `summary.passRate`, les buts, la possession, les duels et les autres KPI ne changent pas.**

## Export PDF

Le graphique `passes-hourly` du PDF présente la même série DECHG (tous segments) que la vue 2/2. Ses légendes précisent que cette population ne représente pas l'intégralité du KPI officiel. Les autres sections du PDF sont inchangées.

## Réconciliation et limites

- `scripts/hourly-pass-chart-scope.test.mjs` : LIV inclus, autres segments, CHG/ZONAGE exclus de la vue 2/2, fenêtres nuit/jour, cible de ligue, exclusions de voyages, KPI officiel.
- `scripts/reconcile-import.mjs` : références indépendantes tirées des lignes Excel brutes, taux et compteurs heure par heure, distincts du score officiel.
- `tests/ci-synthetic/p1-match-export.spec.ts` : deux vues dans une seule vignette, calculs distincts, zoom, sortie PDF et compatibilité desktop/tablette/mobile.
- Les séries pré-calculées de l'onglet `X` ne sont jamais utilisées comme source d'une plage active différente. Les dates traversant minuit et le DST demeurent soumis aux limites documentées du moteur.

## Historique (périmètre abandonné)

L'ancien graphique limité à `DECHG + segments AQ/ED/EX/vides` et excluant `LIV` a été remplacé par l'ensemble des déchargements éligibles. Les références 66/111 (ancienne fixture jour) **ne sont plus attendues** pour la vue 2/2 ; un nouveau calcul indépendant doit reconstruire les volumes à partir de toutes les lignes DECHG éligibles.
