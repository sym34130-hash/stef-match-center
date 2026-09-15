# Dictionnaire KPI - STEF Match Center

Statut : `READY_FOR_REVIEW`

Source de verification : Excel actuellement importé `HM 058 A V10 (3).xlsx`.

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
| Score officiel | Match filtre + `Poz non zonees` vide | Score, duels gagnes, duels a reprendre |

## KPI

| KPI | Formule | Denominateur | Affichage |
| --- | --- | --- | --- |
| Operations | Nombre de lignes du match filtre | Lignes `Filtre operateur` vide + heure de début dans la plage active | Volume filtre Excel |
| Positions | Nombre distinct de `N° Position` dans le match filtre | Positions du match filtre | Positions retenues |
| Joueurs | Nombre distinct d'`Operateur` dans le match filtre | Operateurs retenus dans la plage active | Joueurs actifs |
| Duels gagnes | `SUM(indicateur gagné) / COUNT(indicateur disponible)` ; `DZ <=` la cible de zonage active lorsqu'il est renseigné, sinon le drapeau `Duels gagnés` | Lignes score officiel | Score collectif |
| Taux de duels | `Duels gagnes / lignes score officiel` | Lignes score officiel ; indisponible si vide | Pourcentage de duels gagnes |
| Passes réussies par heure | Reprise des lignes valides de la table graphique Excel `X!FG8:FG18`, dont les heures viennent de `X!FF8:FF18` ; taux affiché recalculé par ligne avec `EX / (EW + EX)` pour aligner le pourcentage sur ses compteurs | Lignes horaires présentes dans la table Excel et comprises dans la plage active | Courbe horaire `% passes réussies` |
| Tonnage Expédition 106J | Valeur de la ligne `Expédition > Tonnage` du dernier PDF SIE.106J importé | Rapport PDF 106J associé à l’agence | Tonnage importé en tonnes |
| Ponctualité 106J | Valeur `Site` de la ligne correspondante du PDF SIE.106J | Dernier PDF 106J importé | Carrousel des indicateurs journaliers |
| Chargements cadres | Pour chaque ligne du bloc `Chargement` de `TCD PPT`, `TC / Nombre de N° Position` lu en colonne `U` ; résultat `<=` à la cible de la ligue | Voyages avec au moins 15 positions, durée brute positive et début dans la plage active | Pourcentage charge dans le delai |
| Temps de reception | Pour chaque voyage `DECHG`, `(derniere operation - premiere operation) / nombre de positions`; dans la cible si `<=` au seuil de la ligue | Voyages `DECHG` avec au moins une position et une duree strictement positive, sur la plage active | Pourcentage de voyages dans la cible et moyenne par position |
| Possession Zody | Positions RECEPTION uniques ayant aussi un ZONAGE / positions RECEPTION uniques, dans le meme perimetre actif | Positions RECEPTION distinctes du match filtre ; indisponible si le denominateur manque | Part des receptions associees a un zonage, bornee entre 0 et 100 % |
| Score operationnel | Nombre des 3 indicateurs dont le pourcentage depasse strictement l'objectif de la ligue active | Passes reussies, chargements cadres et temps de reception dans la cible, tous disponibles | Score au format football `atteints - sous objectif` |
| Indice volume | Operations joueur / meilleur volume joueur | Plus gros volume joueur du match filtre | Fiche joueur |
| Polyvalence | `0` si une seule activite ; sinon moyenne des volumes CHG, ZONAGE et DECHG rapportes au meilleur volume de chaque activite | Meilleur volume observe dans chaque activite du match filtre | Diversite et volume multi-activite |
| Contribution equipe | Operations joueur / operations du match filtre | Operations du match filtre | Detail fiche joueur |
| Joueur Attaque | Max `CHG` joueur dans le match filtre | Joueurs du match filtre | Valeur CHG gagnante |
| Joueur Milieu | Max `ZONAGE` joueur dans le match filtre | Joueurs du match filtre | Valeur ZONAGE gagnante |
| Joueur Defense | Max `DECHG` joueur dans le match filtre | Joueurs du match filtre | Valeur DECHG gagnante |
| Repartition terrain | Match complet : joueurs distincts par `Poste` Excel ; mi-temps, quart-temps et plage personnalisee : poste dominant recalcule selon l'activite `CHG`, `ZONAGE` ou `DECHG` de la periode | Joueurs du match filtre ou de la sous-plage selectionnee | Equilibre composition |

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

Pour le fichier importe `HM 058 A V10 (3).xlsx`, sur la plage `13:00-22:30` et la ligue Argent, les valeurs attendues sont :

- Source : 6 395 lignes A:G ; 247 exclues par plage, 795 par filtre opérateur.
- Match filtre : 5 498 lignes ; score officiel : 3 517 lignes.
- Duels gagnes : 2 528 ; taux : 71,9 % ; score duel affiché : 72 / 100.
- Possession Zody : 55,7 % (797 positions RECEPTION associees a un ZONAGE / 1 432 positions RECEPTION).
- Score operationnel Argent : 3 - 0, avec un objectif de 50 % par indicateur.
- Chargement : 33 voyages dans la cible, 2 hors cible, source brute `TCD PPT!U`.
- Dechargement : 39 voyages dans la cible, 30 hors cible, moyenne 182 secondes par position.
- Joueurs : 17 ; composition : 8 Attaquants, 3 Milieux, 6 Defenseurs.
- Distinctions : Attaque = JEAN LUC LASSORT, Milieu = MORGAN JOUY, Defense = SYLVIE JACQUIER.

Commande :

```bash
pnpm test
```

Limite : si le classeur est remplace par une nouvelle extraction, les valeurs attendues du test doivent etre mises a jour apres un nouvel audit de reconciliation. Le classeur actuel comporte aussi des erreurs de cache/formules dans des onglets secondaires ; l'original n'est pas modifie par le site.
