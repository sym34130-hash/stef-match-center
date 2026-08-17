# STEF Match Center - V1

Application web locale de pilotage opérationnel inspirée du football.

## Principe

- Une agence = un espace privé.
- Le fichier Excel est uniquement importé et lu.
- Le site ne modifie jamais le classeur Excel.
- Chaque import crée un snapshot web par agence.
- Le fichier importé est archivé dans `data/agencies/<agence>/uploads/`.

## Accès V1

La V1 contient un accès de démonstration :

- Code agence : `058`
- Code d'accès : `match-058`

Avant tout usage réel, remplacer cette configuration dans `server/agencies.json`
ou via la variable d'environnement `STEF_AGENCIES_JSON`.

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
- Le score est calculé avec `Duels gagnés / lignes éligibles au score`.
- La composition utilise le champ Excel `Poste`.
- La fiche joueur affiche un `Indice volume`, pas une contribution équipe.
- Les distinctions affichent la valeur du KPI gagné : CHG, ZONAGE ou DECHG selon le cas.

Le dictionnaire KPI complet est disponible dans `docs/kpi-dictionary.md`.

Ces règles doivent rester validées avec les utilisateurs terrain avant usage officiel.
