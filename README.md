# STEF Match Center - V1

Application web locale de pilotage opérationnel inspirée du football.

## Principe

- Une agence = un espace privé.
- Les fichiers Excel et PDF 106J sont uniquement importés et lus.
- Le site ne modifie jamais le classeur Excel.
- Chaque import crée un snapshot web par agence.
- Les fichiers importés sont archivés dans `data/agencies/<agence>/uploads/`.

## Accès V1

La configuration locale de test contient quatre espaces agence et des codes
réservés au développement. Ils ne doivent jamais être réutilisés en production.
Pour un déploiement, créer un code d'accès unique et aléatoire par agence et le
stocker uniquement dans le secret `STEF_AGENCIES_JSON` de l'hébergeur.

Chaque agence dispose de son propre import, snapshot et dossier de causeries.
Les chemins sont séparés par code agence sous `data/agencies/<code>`. En
production, renseigner les quatre entrées dans `STEF_AGENCIES_JSON` sur Render.

## Version web partageable

La version complète doit être hébergée comme une application Node, pas comme un
simple site statique. L'import Excel, la Causerie et les espaces agence passent
par l'API du serveur.

Configuration importante pour un hébergement :

- `STEF_DATA_DIR` : dossier de stockage des agences, imports et causeries ; la
  persistance depend du support de stockage configure par l'hebergeur.
- `STEF_AGENCIES_JSON` : liste des agences et codes d'accès.
- `STEF_UPLOAD_LIMIT_MB` : limite de taille des fichiers Excel importés.

Le guide de mise en ligne est disponible dans `docs/web-deployment.md`.

## Démarrage local

```bash
pnpm install
pnpm dev
```

Interface web :

```text
http://localhost:5173
```

API :

```text
http://localhost:4174/api/health
```

## Import attendu

Le fichier Excel doit être un `.xlsx` avec un onglet `Données`. Le rapport PDF
`SIE.106J` est importé séparément pour compléter les indicateurs journaliers.

Colonnes obligatoires :

- `Opérateur`
- `Date/Heure de début d'opération`
- `Type d'opération`
- `N° Position`
- `Code Voyage`
- `Agence Segment`
- `Type Segment`
- `Filtre opérateur`
- `Filtre heure`
- `Poste`
- `Poz non zonées`
- `DZ`
- `Duels gagnés`

Le site attend le classeur complet, pas un export limité aux colonnes A:G.

Le PDF 106J alimente les taux de ponctualité arrivage, départ, destination,
prise de température retour ramasse, ainsi que le tonnage de la seule ligne
`Expédition`. Le nombre de positions reste calculé exclusivement depuis
l'Excel importé. Les lignes `Distribution`, `Total`, `OT` et les autres
indicateurs PDF ne sont pas utilisées.

Le carrousel `Le collectif en chiffres` réunit performance, effectif réel,
blessures, tonnage, positions et quatre taux du PDF. Les taux restent journaliers
et portent la date du rapport ; seules les positions Excel suivent la plage
active. Un PDF absent ou une cellule manquante ne sont pas remplacés par zéro.

Contrôles PDF :

```bash
pnpm lint
pnpm test:pdf
pnpm build
pnpm test:pdf:import "/chemin/Excel.xlsx" "/chemin/106J.pdf"
```

Le contrôle d'import utilise un serveur et un stockage temporaires, puis teste
le dépôt dans le navigateur, la confirmation, les ligues, la plage horaire,
le réimport et le redémarrage avec le même stockage. Ses valeurs de référence
correspondent au PDF SIE.106J du 11 septembre 2026 fourni pour l'agence 58.
Il n'écrit pas dans les données de l'agence locale ni dans celles en ligne.

## Calculs V1

Source de vérité retenue : l'onglet `Données` du dernier Excel importé, avec le
filtre opérateur Excel et la plage horaire réellement sélectionnée dans
l'application. La plage est appliquée sur l'heure de début d'opération, avec
une borne de fin incluse. Le site ne dépend pas de la colonne calculée
`Filtre heure` : dans le classeur actuel, sa formule de recherche renvoie une
erreur Excel.

- Les volumes, joueurs, positions, compositions et highlights utilisent les lignes avec `Filtre opérateur` vide et heure de début dans la plage active.
- Les duels utilisent ces mêmes lignes en excluant aussi les lignes où `Poz non zonées` est marqué.
- Le score opérationnel utilise le taux global de passes réussies issu de la table horaire Excel, le taux de tirs cadrés calculé depuis la valeur brute de `TCD PPT!U` dans le bloc `Chargement`, le taux de voyages dans la cible pour le temps de réception (affiché « % Duels gagnés ») et la possession (anciennement « Possession Zody »).
- Le taux de duels gagnés est calculé avec `Duels gagnés / lignes éligibles au score`.
- La possession compte les positions RECEPTION uniques qui ont aussi une opération ZONAGE, divisées par les positions RECEPTION uniques du même périmètre filtré ; elle reste donc entre `0 %` et `100 %`, y compris sur une plage personnalisée.
- Le score opérationnel affiché au format football compte, sur 4, les indicateurs qui dépassent strictement l'objectif de la ligue active : passes réussies, tirs cadrés, « Duels gagnés » (taux de voyages dans la cible pour le temps de réception) et possession. Le format est `indicateurs atteints - indicateurs sous l'objectif`.
- Les objectifs par défaut sont : Bronze `45 min / 00:03:15 / 00:01:15 / 45%`, Argent `30 min / 00:02:45 / 00:01:00 / 50%`, Or `25 min / 00:02:30 / 00:00:55 / 60%`, Platine `20 min / 00:02:15 / 00:00:50 / 70%` pour zonage, chargement, déchargement et objectif du score.
- Le temps de réception est calculé sur les lignes `DECHG` de la plage active, par voyage : `(dernière opération - première opération) / nombre de positions`. Un voyage est dans la cible si ce temps moyen par position est inférieur ou égal au seuil de la ligue. Les voyages sans durée positive ne sont pas comptabilisés ; le score opérationnel utilise le pourcentage de voyages dans la cible.
- Le KPI chargement lit le bloc `Chargement` de `TCD PPT` : `TC / Nombre de N° Position` dans la colonne `U` (valeur brute `T/S`), uniquement pour les voyages d'au moins 15 positions et dans la plage active. La colonne `V` est une formule de présentation et n'est pas utilisée pour le calcul.
- Le détail chargement reprend le lexique de frappe `TCD PPT!X:Y` via le commentaire du TCD.
- La composition du match complet utilise le champ Excel `Poste`. Les
  mi-temps, quart-temps et plages personnalisees recalculent le poste dominant
  de chaque joueur selon ses activites de la periode (`CHG`, `ZONAGE` ou
  `DECHG`) afin que la ligne affichee puisse changer entre deux vues.
- La fiche joueur affiche un `Indice volume`, pas une contribution équipe.
- Les distinctions affichent la valeur du KPI gagné : CHG, ZONAGE ou DECHG selon le cas.

Le dictionnaire KPI complet est disponible dans `docs/kpi-dictionary.md`.

Sur le classeur actuellement importé (`HM 058 A V11.xlsx`), la réconciliation
de référence donne : 6 395 lignes source A:G, 5 498 lignes match, 3 517 lignes
de score, 2 528 duels gagnés (71,9 %), 1 708 positions, 17 joueurs, 55,7 % de
possession, 33 tirs cadrés / 2 hors cible, et 39 déchargements dans la
cible / 30 hors cible. Ces chiffres dépendent de la plage et de la ligue
active.

Ces règles doivent rester validées avec les utilisateurs terrain avant usage officiel.
