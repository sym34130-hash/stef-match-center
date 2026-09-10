# Dictionnaire KPI - STEF Match Center

Statut : `READY_FOR_REVIEW`

Source de verification : Excel filtre actuel du classeur `HM 58 J V10 MAJ.xlsx`.

## Regle generale

Le site ne recalcule plus les KPI a partir des seules colonnes A:G.

Il lit l'onglet `Donnees` complet et reprend les colonnes Excel calculees :

- `Filtre operateur`
- `Filtre heure`
- `Poste`
- `Poz non zonees`
- `DZ`
- `Duels gagnes`

## Jeux de lignes officiels

| Jeu de lignes | Definition | Usage |
| --- | --- | --- |
| Source | Lignes A:G exploitables | Controle import |
| Match filtre | `Filtre operateur` vide + `Filtre heure` vide | Volumes, joueurs, positions, composition, highlights |
| Score officiel | Match filtre + `Poz non zonees` vide | Score, duels gagnes, duels a reprendre |

## KPI

| KPI | Formule | Denominateur | Affichage |
| --- | --- | --- | --- |
| Operations | Nombre de lignes du match filtre | Lignes `Filtre operateur` vide + `Filtre heure` vide | Volume filtre Excel |
| Positions | Nombre distinct de `N° Position` dans le match filtre | Positions du match filtre | Positions retenues |
| Joueurs | Nombre distinct d'`Operateur` dans le match filtre | Operateurs retenus Excel | Joueurs actifs |
| Duels gagnes | Duels recalcules avec `DZ <=` la cible de zonage active lorsque `DZ` est renseigne, sinon indicateur disponible | Lignes score officiel | Score collectif |
| Taux de duels | `Duels gagnes / lignes score officiel` | Lignes score officiel ; indisponible si vide | Pourcentage de duels gagnes |
| Chargements cadres | Chargements dont le temps par position est `<=` a la cible de la ligue active | Chargements exploitables ; indisponible si aucun chargement | Pourcentage charge dans le delai |
| Temps de dechargement | Pour chaque voyage `DECHG`, `(derniere operation - premiere operation) / nombre de positions`; dans la cible si `<=` au seuil de la ligue | Voyages `DECHG` avec au moins une position et une duree strictement positive, sur la plage active | Pourcentage de voyages dans la cible et moyenne par position |
| Possession Zody | Positions RECEPTION uniques ayant aussi un ZONAGE / positions RECEPTION uniques, dans le meme perimetre actif | Positions RECEPTION distinctes du match filtre ; indisponible si le denominateur manque | Part des receptions associees a un zonage, bornee entre 0 et 100 % |
| Score operationnel | Nombre des 4 indicateurs dont le pourcentage atteint l'objectif de la ligue active | Duels gagnes, chargements cadres, dechargements dans la cible et possession Zody, tous disponibles | Score au format football `atteints - sous objectif` |
| Indice volume | Operations joueur / meilleur volume joueur | Plus gros volume joueur du match filtre | Fiche joueur |
| Polyvalence | `0` si une seule activite ; sinon moyenne des volumes CHG, ZONAGE et DECHG rapportes au meilleur volume de chaque activite | Meilleur volume observe dans chaque activite du match filtre | Diversite et volume multi-activite |
| Contribution equipe | Operations joueur / operations du match filtre | Operations du match filtre | Detail fiche joueur |
| Joueur Attaque | Max `CHG` joueur dans le match filtre | Joueurs du match filtre | Valeur CHG gagnante |
| Joueur Milieu | Max `ZONAGE` joueur dans le match filtre | Joueurs du match filtre | Valeur ZONAGE gagnante |
| Joueur Defense | Max `DECHG` joueur dans le match filtre | Joueurs du match filtre | Valeur DECHG gagnante |
| Repartition terrain | Joueurs distincts par `Poste` Excel | Joueurs du match filtre | Equilibre composition |

## Objectifs par ligue

Les objectifs actifs recalculent les indicateurs concernés et le score operationnel.

| Ligue | Zonage | Chargement | Dechargement | Objectif d'un indicateur du score |
| --- | ---: | ---: | ---: | ---: |
| Bronze | 45 min | 00:03:15 | 00:01:15 | 45 % |
| Argent | 30 min | 00:02:45 | 00:01:00 | 50 % |
| Or | 25 min | 00:02:30 | 00:00:55 | 60 % |
| Platine | 20 min | 00:02:15 | 00:00:50 | 70 % |

Le seuil de dechargement est configurable et affiche dans les ligues. Le site calcule
desormais le temps moyen par position pour chaque voyage `DECHG` exploitable de la
plage active. Le pourcentage de voyages dans la cible devient le quatrieme indicateur
du score operationnel ; la duree moyenne detaillee reste disponible dans le graphique
des dechargements.

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

Pour le fichier importe `HM 58 J V10 MAJ.xlsx`, les valeurs attendues sont :

- Source : 5 742 lignes.
- Match filtre : 4 595 lignes.
- Score officiel : 2 925 lignes.
- Duels gagnes : 2 064.
- Score duels : 70,6 %, affiche 71 / 100.
- Possession Zody : 50,2 % (568 positions RECEPTION associees a un ZONAGE / 1 131 positions RECEPTION).
- Score operationnel Argent : 4 - 0, avec un objectif de 50 % par indicateur.
- Joueurs : 20.
- Composition : 10 Attaquants, 5 Milieux, 5 Defenseurs.
- Distinctions : Attaque = JEAN LUC LASSORT, Milieu = THIERRY BOUGNAGUE, Defense = YOUNES EL KICH.

Commande :

```bash
pnpm test
```

Limite : si le classeur est remplace par une nouvelle extraction, les valeurs attendues du test doivent etre mises a jour apres un nouvel audit de reconciliation.
