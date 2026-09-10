# STEF Match Center - V1

Application web locale de pilotage opérationnel inspirée du football.

## Principe

- Une agence = un espace privé.
- Le fichier Excel est uniquement importé et lu.
- Le site ne modifie jamais le classeur Excel.
- Chaque import crée un snapshot web par agence.
- Le fichier importé est archivé dans `data/agencies/<agence>/uploads/`.

## Accès V1

La configuration locale de test contient quatre espaces agence :

- Code agence : `058`
- Nom : `Agen - 058`
- Code d'accès : `STEF-058`
- Code agence : `01K` - `Montpellier` - code d'accès : `STEF-01K`
- Code agence : `05R` - `Toulouse` - code d'accès : `STEF-05R`
- Code agence : `04P` - `Bordeaux` - code d'accès : `STEF-04P`

Avant tout usage réel, remplacer cette configuration dans `server/agencies.json`
ou via la variable d'environnement `STEF_AGENCIES_JSON`.

Chaque agence dispose de son propre import, snapshot et dossier de causeries.
Les chemins sont séparés par code agence sous `data/agencies/<code>`. En
production, renseigner les quatre entrées dans `STEF_AGENCIES_JSON` sur Render.

## Version web partageable

La version complète doit être hébergée comme une application Node, pas comme un
simple site statique. L'import Excel, la Causerie et les espaces agence passent
par l'API du serveur.

Configuration importante pour un hébergement :

- `STEF_DATA_DIR` : dossier persistant des agences, imports et causeries.
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

Le fichier doit être un `.xlsx` avec un onglet `Données`.

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

## Calculs V1

Source de vérité retenue : Excel filtré actuel.

- Les volumes, joueurs, positions, compositions et highlights utilisent les lignes avec `Filtre opérateur` vide et `Filtre heure` vide.
- Le score et les duels utilisent ces mêmes lignes en excluant aussi les lignes où `Poz non zonées` est marqué.
- Le taux de duels gagnés est calculé avec `Duels gagnés / lignes éligibles au score`.
- La possession Zody compte les positions RECEPTION uniques qui ont aussi une opération ZONAGE, divisées par les positions RECEPTION uniques du même périmètre filtré ; elle reste donc entre `0 %` et `100 %`, y compris sur une plage personnalisée.
- Le score opérationnel affiché au format football compte, sur 4, les indicateurs qui atteignent l'objectif de la ligue active : taux de duels gagnés, chargements cadrés, déchargements dans la cible et possession Zody. Le format est `indicateurs atteints - indicateurs sous l'objectif`.
- Les objectifs par défaut sont : Bronze `45 min / 00:03:15 / 00:01:15 / 45%`, Argent `30 min / 00:02:45 / 00:01:00 / 50%`, Or `25 min / 00:02:30 / 00:00:55 / 60%`, Platine `20 min / 00:02:15 / 00:00:50 / 70%` pour zonage, chargement, déchargement et objectif du score.
- Le temps de déchargement est calculé sur les lignes `DECHG` de la plage active, par voyage : `(dernière opération - première opération) / nombre de positions`. Un voyage est dans la cible si ce temps moyen par position est inférieur ou égal au seuil de la ligue. Les voyages sans durée positive ne sont pas comptabilisés.
- Le seuil de déchargement est configurable et affiché dans les ligues. Le pourcentage de voyages dans la cible entre dans le score opérationnel à 4 indicateurs, avec la même cible de réussite que les autres indicateurs.
- La composition utilise le champ Excel `Poste`.
- La fiche joueur affiche un `Indice volume`, pas une contribution équipe.
- Les distinctions affichent la valeur du KPI gagné : CHG, ZONAGE ou DECHG selon le cas.

Le dictionnaire KPI complet est disponible dans `docs/kpi-dictionary.md`.

Ces règles doivent rester validées avec les utilisateurs terrain avant usage officiel.
