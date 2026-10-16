# Reconciliation des indicateurs — audit du 16 octobre 2026

## Périmètre
Les quatre corrections corrigent les KPI de **zonage/passes** et de **possession**,
sans toucher aux règles de réception et au DST (anomalie historique acceptée).

### 1. Passes réussies par heure
Le graphique n'utilise plus l'ancienne liste d'heures de `X!FF:FG` comme filtre.
Il regroupe les **scoringRows** déjà retenues par le moteur (filtre opérateur,
plage horaire exacte, lignes non zonées exclues et voyages masqués), selon
l'heure Europe/Paris de leur horodatage réel.
L'heure de début et l'heure de fin **partielles** comptent uniquement
les opérations éligibles de cette partie d'heure.

Invariants vérifiables:
- somme des `hourlyPerformance[].total` = `summary.duelTotal`;
- somme des `hourlyPerformance[].won` = `summary.duelWon`;
- `summary.passRate = summary.duelRate` pour les modèles de données pris en charge;
- l'objectif de zonage actif détermine les gagnés, sans réutiliser un cache de TCD
  antérieur à un changement de ligue.

La courbe Excel historique reste disponible comme référence documentaire,
mais ne contrôle plus ni la sélection horaire ni le taux du score opérationnel.

### 2. Précision des délais
`DZ` est converti en secondes et arrondi à la seconde avant `<= objectif`.
Ainsi un intervalle calculé à `1800.000000000001` seconde est traité comme
30 minutes, sans faux dépassement causé par le format flottant Excel.

### 3. Possession
Une position distincte DECHG contribue au dénominateur.
Elle ne contribue au numérateur que si au moins un ZONAGE de la même position
se situe **à ou après sa première réception** dans la plage active.
Le diagnostic zonage reste distinct de la possession : il traite aussi
l'absence de code voyage et les réceptions contradictoires.

### 4. Poste de joueur
Dans la fiche joueur, l'intitulé `Poste de référence` précise le rôle stocké
dans Excel. Le pourcentage voisin demeure celui de l'activité majoritaire
observée, indépendamment de ce poste de référence.
Aucun reclassement automatique des joueurs n'a été appliqué.

## Recalcul indépendant du classeur HM 1K N V11(1).xlsx
Période 17/09/2026 21h30 → 18/09/2026 06h30, cible 30 min:
- passes: 926 / 1 499 = 61,8 %, après prise en compte des heures de bord;
- possession: 489 / 677 = 72,2 %, quatre positions avaient un zonage antérieur;
- réceptions 2/5: 19 / 23 = 82,6 %, inchangé.

Ces chiffres sont issus du contrôle de données indépendant, et ne constituent
pas une exécution du moteur JS complet sur ce fichier privé dans le runner CI.

## Vérifications
- `scripts/kpi-integrity.test.mjs` : créneaux horaires incomplets, changement
  de cible, flottants aux frontières, chronologie et exclusion de voyage;
- `scripts/reception-carousel-integration.test.mjs` : carrousel 2 inchangé;
- suites CI existantes : lint, build, PDF, API, navigateur.

## Limites
- Les résultats recalculés sur les fichiers privés de l'agence 058 doivent encore
  être comparés au moteur sur cet XLSX, absent de GitHub Actions.
- Le regroupement des arrivées affichées en annotation du graphique dépend
  encore du premier événement connu par code voyage; il n'est pas le
  dénominateur du taux horaire.
- Le score football peut changer après correction du taux de passes/possession,
  mais les règles de comptage des buts (`%` strictement supérieur à la cible)
  ne changent pas.
