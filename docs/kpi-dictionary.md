# Dictionnaire KPI - STEF Match Center

Statut : `READY_FOR_REVIEW`

Sources de verification distinctes : fixture jour `HM 058 A V11.xlsx` et
classeur de reference Montpellier `HM 1K N V11.xlsx`. Les chiffres d'un fichier
ne constituent pas les valeurs attendues d'un autre fichier ou d'une autre plage.

## Regle generale

Le site ne recalcule plus les KPI a partir des seules colonnes A:G.

Il lit l'onglet `Donnees` complet et reprend les colonnes Excel calculees :

- `Filtre operateur`
- heure de début d'opération et plage active choisie dans l'application
- `Filtre heure` est conservé comme colonne de contrôle de structure, mais ne
  pilote pas la plage active : sa formule Excel est en erreur dans le classeur
  actuellement importé
- `Poste`
- `Poz non zonees`
- `DZ`
- `Duels gagnes`

## Jeux de lignes officiels

| Jeu de lignes | Definition | Usage |
| --- | --- | --- |
| Source | Lignes A:G exploitables | Controle import |
| Match filtre | `Filtre operateur` vide + heure de début comprise dans la plage active, fin incluse | Volumes, joueurs, positions, composition, highlights |
| Score officiel | Match filtre + `Poz non zonees` vide | Score, duels gagnes, lignes hors cible |

## KPI

| KPI | Formule | Denominateur | Affichage |
| --- | --- | --- | --- |
| Operations | Nombre de lignes du match filtre | Lignes `Filtre operateur` vide + heure de début dans la plage active | Volume filtre Excel |
| Positions | Nombre distinct de `N° Position` dans le match filtre | Positions du match filtre | Positions retenues |
| Joueurs | Nombre distinct d'`Operateur` dans le match filtre | Operateurs retenus dans la plage active | Joueurs actifs |
| Passes réussies officielles | `SUM(indicateur gagné) / COUNT(indicateur disponible)` ; `DZ <=` la cible de zonage active lorsqu'il est renseigné, sinon le drapeau `Duels gagnés` | Lignes score officiel avec indicateur 0/1 ; aucune restriction supplémentaire d'opération/segment | `summary.passRate` ; les noms techniques `duelWon`, `duelTotal`, `duelRate` restent historiques, pas les duels de réception |
| Passes réussies par heure | Même indicateur, mais uniquement DECHG de type segment AQ/ED/EX/vide, regroupé par heure Europe/Paris réelle ; `won / total` | Sous-ensemble filtré des lignes score, heures partielles comprises | Courbe et « Total filtré », indépendants du KPI officiel ; table X historique en fallback seulement en l'absence de lignes parsées |
| Tonnage Expédition 106J | Valeur de la ligne `Expédition > Tonnage` du dernier PDF SIE.106J importé | Rapport PDF 106J associé à l’agence | Tonnage importé en tonnes |
| Ponctualité 106J | Valeur `Site` de la ligne correspondante du PDF SIE.106J | Dernier PDF 106J importé | Carrousel des indicateurs journaliers |
| Tirs cadres | Pour chaque ligne du bloc `Chargement` de `TCD PPT`, `TC / Nombre de N° Position` lu en colonne `U` ; résultat `<=` à la cible de la ligue | Voyages avec au moins 15 positions, durée brute positive et début dans la plage active | Pourcentage de tirs cadres dans le delai |
| Duels gagnés / temps de réception | Pour chaque voyage `DECHG`, `(derniere operation - premiere operation) / nombre de lignes DECHG`; dans la cible si `<= unloadingSeconds` | Cohorte datée sélectionnée, code voyage renseigné, segment non-AQ, au moins 15 lignes DECHG et durée positive ; exclusions appliquées en amont | Même cohorte pour `unloadingQuality`, `unloadingDuelQuality` et `unloadingHourlyAnalysis`, pas le TCD historique multi-dates |
| Possession | Positions RECEPTION uniques avec au moins un ZONAGE à ou après leur première réception / positions RECEPTION uniques, dans le même périmètre actif | Positions RECEPTION distinctes du match filtré ; indisponible si le dénominateur manque | Part des réceptions suivies d'un zonage, bornée entre 0 et 100 % |
| Score operationnel | Nombre des 4 indicateurs dont le pourcentage depasse strictement l'objectif de la ligue active | Passes reussies, tirs cadres, « Duels gagnes » (taux de voyages dans la cible pour le temps de reception) et possession, tous disponibles | Score au format football `atteints - sous objectif` |
| Indice volume | Operations joueur / meilleur volume joueur | Plus gros volume joueur du match filtre | Fiche joueur |
| Polyvalence | `0` si une seule activite ; sinon moyenne des volumes CHG, ZONAGE et DECHG rapportes au meilleur volume de chaque activite | Meilleur volume observe dans chaque activite du match filtre | Diversite et volume multi-activite |
| Contribution equipe | Operations joueur / operations du match filtre | Operations du match filtre | Detail fiche joueur |
| Joueur Attaque | Max `CHG` joueur dans le match filtre | Joueurs du match filtre | Valeur CHG gagnante |
| Joueur Milieu | Max `ZONAGE` joueur dans le match filtre | Joueurs du match filtre | Valeur ZONAGE gagnante |
| Joueur Defense | Max `DECHG` joueur dans le match filtre | Joueurs du match filtre | Valeur DECHG gagnante |
| Repartition terrain | Match complet : joueurs distincts par `Poste` Excel ; mi-temps, quart-temps et plage personnalisee : poste dominant recalcule selon l'activite `CHG`, `ZONAGE` ou `DECHG` de la periode | Joueurs du match filtre ou de la sous-plage selectionnee | Equilibre composition |

## Objectifs par ligue

Les objectifs actifs recalculent les indicateurs concernés et le score operationnel.

| Ligue visible (ID technique conservé) | Zonage | Chargement | Dechargement | Objectif d'un indicateur du score |
| --- | ---: | ---: | ---: | ---: |
| LIGUE 2 (`bronze`) | 45 min | 00:03:15 | 00:01:15 | 45 % |
| LIGUE 1 (`argent`) | 30 min | 00:02:45 | 00:01:00 | 50 % |
| LDC (`or`) | 25 min | 00:02:30 | 00:00:55 | 60 % |
| CDM (`platine`) | 20 min | 00:02:15 | 00:00:50 | 70 % |

Le seuil de dechargement est configurable et affiche dans les ligues. Le site calcule
desormais le temps moyen par position pour chaque voyage `DECHG` exploitable de la
plage active. Le pourcentage de voyages dans la cible est l'indicateur `Temps de
reception` du score operationnel ; la duree moyenne detaillee reste visible dans le
carrousel.

### Controle de coherence de la possession

La formule historique `X!BJ4` divisait deux compteurs distincts issus de populations
differentes : des positions ZONAGE d'un cote et des positions DECHG de l'autre. Sur
une sous-plage, le numerateur pouvait donc depasser le denominateur et produire une
valeur impossible comme `126,8 %`. Cette cellule reste un repere de comparaison, mais
elle n'est plus utilisee comme pourcentage operationnel.

Le site utilise maintenant le meme filtre de match que les autres KPI. Le numerateur
compte uniquement les positions RECEPTION qui disposent aussi d'une operation ZONAGE,
puis le divise par le nombre de positions RECEPTION uniques. Le resultat est donc
recalculable par plage et toujours compris entre `0 %` et `100 %`.

## Controle de reconciliation actuel

Pour le fichier importe `HM 058 A V11.xlsx`, sur la plage `13:00-22:30` et la ligue Argent, les valeurs attendues sont :

- Source : 6 395 lignes A:G ; 247 exclues par plage, 795 par filtre opérateur.
- Match filtre : 5 498 lignes ; score officiel : 3 517 lignes.
- Duels gagnes : 2 528 ; taux : 71,9 % ; score duel affiché : 72 / 100.
- Possession : 55,7 % (797 positions RECEPTION associees a un ZONAGE / 1 432 positions RECEPTION).
- Score operationnel Argent : 4 - 0, avec un objectif de 50 % par indicateur.
- Chargement : 33 voyages dans la cible, 2 hors cible, source brute `TCD PPT!U`.
- Reception : 29/50 = 58 %, soit 21 hors cible, sur la cohorte datée non-AQ
  de 15 lignes DECHG minimum. Les anciens 39/30 du TCD multi-dates ne sont
  plus une référence pour ce KPI.
- Courbe passes filtrée : 66/111 = 59,5 %, distincte des passes officielles
  2528/3517 = 71,9 %. Les deux numérateurs/dénominateurs sont réconciliés
  indépendamment depuis les séries Excel brutes.
- Joueurs : 17 ; composition : 8 Attaquants, 3 Milieux, 6 Defenseurs.
- Distinctions : Attaque = JEAN LUC LASSORT, Milieu = MORGAN JOUY, Defense = SYLVIE JACQUIER.

Commande :

```bash
pnpm test
```

Limite : si le classeur est remplace par une nouvelle extraction, les valeurs attendues du test doivent etre mises a jour apres un nouvel audit de reconciliation. Le classeur actuel comporte aussi des erreurs de cache/formules dans des onglets secondaires ; l'original n'est pas modifie par le site.

## Référence Montpellier et contrôles indépendants

Sur `HM 1K N V11.xlsx`, période du 17 septembre 2026 à 21:30 au
18 septembre à 06:30, critères LIGUE 1 : passes 926/1499 = 61,8 %,
chargement 9/12 = 75 %, réception 19/23 = 82,6 % (4 hors cible),
possession 489/677 = 72,2 %. Ce ne sont pas les compteurs du diagnostic :
celui-ci a 676 positions reçues, 488 qualifiables, 184 en retard,
304 conformes et 188 non qualifiables (couverture 72,2 %, retards 37,7 %).
Ne pas fusionner ces populations.

Les taux sont arrondis à une décimale après division ; le score compare les
quatre taux à l'objectif actif avec `>` strict. Les durées DZ sont arrondies
à la seconde avant comparaison, les ratios de réception restent non arrondis
pour le seuil. Un dénominateur absent donne une indisponibilité, pas un faux zéro.

Validation : `scripts/kpi-integrity.test.mjs` (chronologie et frontières),
`scripts/hourly-pass-chart-scope.test.mjs` (séparation courbe/KPI),
`scripts/reception-cohort.test.mjs` (seuil 14/15, AQ, durée et dates),
`scripts/reconcile-import.mjs` (classeur jour, critères et exclusions),
`scripts/operational-analysis.test.mjs` avec `STEF_OPERATIONAL_WORKBOOK`
(classeur Montpellier fourni localement). Les fichiers privés ne sont pas committés.

Les destinations sont des enrichissements exacts du classeur : codes normalisés
par trim/majuscules, séparateurs explicites `/` ou `;`, jamais de rapprochement
partiel/flou ni de substitution par Agence Segment. Priorité : destination/site,
agence destination, libellé voyage. Absence/ambiguïté : `null`, affiché `—`.
Les destinations ne participent à aucun calcul KPI.

## Cartes du carrousel journalier

Neuf cartes de base : performance d'équipe, blessures, tonnage Distribution,
tonnage Expédition, positions, ponctualités arrivage/départ/destination et
température retour ramasse. Une carte Mercato supplémentaire apparaît uniquement
si le brief contient au moins un entrant. Le contrat est donc neuf cartes sans
Mercato, dix avec Mercato (en l'absence de personnalisation).
Les deux tonnages s'affichent quelle que soit la plage horaire ; chaque carte peut
être masquée indépendamment. La recette responsive et les tests Mercato
utilisent ces effectifs révisés.


## Lot A — Affichage des indicateurs du brief et tonnage 106J

Le parseur 106J conserve séparément `expedition.tonnage` (valeur historique)
et `distribution.tonnage` (nouvelle donnée). Les valeurs ne sont pas
additionnées ni substituées l'une à l'autre. En l'absence de la ligne demandée,
l'indicateur est indisponible, sans conversion en zéro.

Deux cartes indépendantes affichent systématiquement les sections « Distribution »
et « Expédition » du PDF 106J, en journée comme de nuit, sans sélection automatique
de source selon la plage horaire. Les deux sections peuvent être masquées
individuellement dans les préférences d'affichage du brief ; une ligne absente
reste indisponible et n'est jamais remplacée par l'autre ligne.

`visibleIndicators` conserve la liste des cartes autorisées pendant le brief.
Les anciennes causeries affichent les neuf cartes par défaut. Une carte au
minimum est conservée. Le masquage n'affecte aucun KPI, score, export ni
calcul, et ne supprime aucune information des sources. Les choix ne sont
appliqués qu'au carrousel « Le collectif en chiffres » ; les cartes Mercato
restent dépendantes de la présence d'entrants.

Compatibilité : l'ancien identifiant de visibilité `tonnage` est migré en
`tonnage-distribution` + `tonnage-expedition` lorsqu'il était actif.
S'il était masqué, les deux cartes restent masquées. Le champ historique
`tonnageActivity`, devenu inutile, n'est plus appliqué.
