# Version web partageable

## Décision technique

FACT: la V1 complète de STEF Match Center n'est pas un site statique.

Elle a besoin d'un serveur Node/Express pour :

- contrôler le code agence et le code d'accès ;
- importer un fichier Excel `.xlsx` ;
- recalculer le snapshot Match Center ;
- enregistrer la Causerie ;
- conserver un espace séparé par agence.

RECOMMENDATION: héberger la V1 comme une application web Node avec stockage
persistant.

## Architecture V1 recommandée

```text
Collaborateurs
  ↓ HTTPS
Application Node STEF Match Center
  ↓
Stockage persistant agences
  ├─ 058/latest.json
  ├─ 058/uploads/*.xlsx
  └─ 058/causeries/*.json
```

## Variables d'environnement

```bash
PORT=4174
STEF_DATA_DIR=/var/lib/stef-match-center/agencies
STEF_UPLOAD_LIMIT_MB=20
STEF_AGENCIES_JSON='[{"code":"058","name":"Agence 058","accessCode":"CHANGE_ME_BEFORE_SHARING","canImport":true}]'
```

`STEF_DATA_DIR` doit pointer vers un disque persistant. Sans disque persistant,
les fichiers Excel importés et les Causeries peuvent disparaître lors d'un
redémarrage de l'hébergeur.

## Commandes de production

```bash
pnpm install
pnpm build
pnpm start
```

L'application sert ensuite l'interface web et l'API depuis le même domaine.

## Déploiement Docker

La V1 peut aussi être déployée avec le `Dockerfile` du projet.

```bash
docker build -t stef-match-center .
docker run \
  -p 4174:4174 \
  -e STEF_AGENCIES_JSON='[{"code":"058","name":"Agence 058","accessCode":"CHANGE_ME_BEFORE_SHARING","canImport":true}]' \
  -v stef-match-center-data:/data \
  stef-match-center
```

Dans ce mode, `STEF_DATA_DIR=/data/agencies`. Le volume
`stef-match-center-data` conserve les imports Excel, les snapshots et les
Causeries entre deux redémarrages.

## Hébergeurs adaptés

RECOMMENDATION: utiliser un hébergeur acceptant une application Node ou Docker
avec disque persistant.

Exemples adaptés :

- Render avec service web + persistent disk ;
- Railway avec volume persistant ;
- Fly.io avec volume ;
- VPS interne ou cloud avec Docker.

Éviter un hébergement statique pur : l'import Excel et la sauvegarde de la
Causerie ne fonctionneraient pas.

## Contrôles avant partage

- Remplacer le code d'accès de démonstration `match-058`.
- Vérifier que l'URL est en HTTPS.
- Vérifier que `STEF_DATA_DIR` est réellement persistant.
- Importer le dernier classeur Excel et contrôler le score.
- Lancer la réconciliation :

```bash
pnpm test
```

- Lancer le smoke test de déploiement :

```bash
pnpm test:deploy
```

Ce test démarre le serveur en mode production avec un `STEF_DATA_DIR`
temporaire, importe réellement le dernier classeur `.xlsx` via l'API, vérifie
les KPI clés, relit le snapshot depuis le stockage et teste l'écriture de la
Causerie. Il ne modifie pas les données originales.

## Paquet prêt à envoyer

Créer une archive contrôlée :

```bash
pnpm deploy:package
```

Cette commande lance d'abord `pnpm build`, `pnpm test` et `pnpm test:deploy`.
Elle produit ensuite une archive dans `.deploy/` et exclut les données sensibles
ou locales : `node_modules`, `dist`, `.env`, `.git`, `.deploy` et
`data/agencies/*`.

Le détail AppDeploy est documenté dans `docs/appdeploy-readiness.md`.

## Limites assumées de la V1

DECISION_REQUIRED: la V1 utilise un accès par code agence + code d'accès. C'est
suffisant pour un pilote privé, mais ce n'est pas encore une gestion complète
des comptes utilisateurs avec SSO, journal d'audit ou rôles avancés.

RECOMMENDATION: pour partager rapidement avec des collaborateurs, démarrer avec
un hébergement privé, un code d'accès fort par agence, et un stockage persistant.
Renforcer ensuite l'authentification si l'usage s'élargit.
