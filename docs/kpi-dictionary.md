# Dictionnaire KPI - STEF Match Center

Statut : `READY_FOR_REVIEW`

Source de verite retenue : Excel filtre actuel du classeur `HM 58 J V10 MAJ.xlsx`.

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
| Duels gagnes | Somme des lignes `Duels gagnes = 1` dans le score officiel | Lignes score officiel | Score collectif |
| Score match | `Duels gagnes / lignes score officiel` | Lignes score officiel | Score /100 |
| Indice volume | Operations joueur / meilleur volume joueur | Plus gros volume joueur du match filtre | Fiche joueur |
| Contribution equipe | Operations joueur / operations du match filtre | Operations du match filtre | Detail fiche joueur |
| Joueur Attaque | Max `CHG` joueur dans le match filtre | Joueurs du match filtre | Valeur CHG gagnante |
| Joueur Milieu | Max `ZONAGE` joueur dans le match filtre | Joueurs du match filtre | Valeur ZONAGE gagnante |
| Joueur Defense | Max `DECHG` joueur dans le match filtre | Joueurs du match filtre | Valeur DECHG gagnante |
| Repartition terrain | Joueurs distincts par `Poste` Excel | Joueurs du match filtre | Equilibre composition |

## Controle de reconciliation actuel

Pour le fichier importe `HM 58 J V10 MAJ.xlsx`, les valeurs attendues sont :

- Source : 5 742 lignes.
- Match filtre : 4 595 lignes.
- Score officiel : 2 925 lignes.
- Duels gagnes : 2 060.
- Score : 70,4 %, affiche 70 / 100.
- Joueurs : 20.
- Composition : 10 Attaquants, 5 Milieux, 5 Defenseurs.
- Distinctions : Attaque = JEAN LUC LASSORT, Milieu = THIERRY BOUGNAGUE, Defense = YOUNES EL KICH.

Commande :

```bash
pnpm test
```

Limite : si le classeur est remplace par une nouvelle extraction, les valeurs attendues du test doivent etre mises a jour apres un nouvel audit de reconciliation.
