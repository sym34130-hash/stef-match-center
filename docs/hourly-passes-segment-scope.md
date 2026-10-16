# Filtre réservé au graphique « % passes réussies par heure »

## Demande métier

Le **graphique du carrousel 1/5** et son total affiché retiennent uniquement
les opérations répondant simultanément à :

- `Données!C` : déchargement (`DECHG`, code interne du libellé « DÉCHARGEMENT »).
- `Données!G` : `AQ`, `ED`, `EX` ou cellule vide. Espaces et casse sont normalisés.
- Respect des filtres existants : opérateur, positions non zonées, exclusions
  de voyages, plage horaire choisie à la minute et seuil de zonage de la ligue.
- `LIV` et les autres segments ainsi que `ZONAGE` et `CHG` sont exclus **du graphique uniquement**.

Le regroupement est par heure réelle de l'opération éligible ; les heures
partielles et les périodes chevauchant minuit sont préservées. Pour un code
voyage mêlant `EX` et `LIV`, seules les lignes `EX` sont représentées
dans le graphique. Les annotations des arrivées affichées sur la courbe
respectent le même sous-ensemble de types d'opérations et de segments.

## Protection des résultats officiels

Le KPI **% passes réussies** utilisé par les quatre indicateurs du score football
conserve son historique de calcul : toutes les lignes de score éligibles,
sans nouveau filtre par opération/segment. Le total visible dans le graphique
est renommé « Total filtré » et calculé avec le numérateur et le dénominateur
réels de la courbe ; il peut donc différer du KPI officiel.

Les KPI **% duels gagnés**, leurs détails et le graphique
**Temps de réception par créneau** sont restaurés exactement à la logique
qui précédait la PR #11 ; le filtre erronément appliqué à la réception a été retiré.
Le diagnostic, les chargements, la possession, le DST et les scores ne changent pas.

## Contrôle qualité

`scripts/hourly-pass-chart-scope.test.mjs` couvre les quatre valeurs G
autorisées, les cas `LIV` et autres segments, les lignes `CHG` et `ZONAGE`,
les codes mixtes, les objectifs de ligue, les exclusions, les plages partielles
et l'absence de déchargement autorisé. La CI exécute également les tests de
réception et de score existants.

Le fichier Excel privé n'est pas ajouté au dépôt ; la comparaison des valeurs
affichées avec un import réel reste un contrôle métier après le redéploiement.
