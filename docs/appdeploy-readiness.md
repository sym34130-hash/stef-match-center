# Préparation AppDeploy

## État

FACT: le projet est prêt côté code pour un hébergement web avec backend.

FACT: AppDeploy est détecté dans les permissions plugin, mais les outils de
déploiement AppDeploy ne sont pas exposés dans cette session Codex au moment de
cette préparation.

DECISION_REQUIRED: ne déployer via AppDeploy que si la plateforme confirme :

- backend Node compatible ;
- variables d'environnement serveur ;
- upload de fichiers `.xlsx` ;
- stockage persistant pour `STEF_DATA_DIR`.

## Condition non négociable

Le site ne doit pas être publié comme site statique pur.

Raison : l'import Excel, la sauvegarde du snapshot, les espaces agence et la
Causerie passent par l'API serveur.

## Contrôle avant publication

Avant toute publication, lancer :

```bash
pnpm build
pnpm test
pnpm test:deploy
```

Le contrôle `test:deploy` démarre le serveur en mode production temporaire,
importe réellement le classeur Excel via l'API et vérifie les KPI principaux.

## Paquet de déploiement

Créer un paquet propre :

```bash
pnpm deploy:package
```

Le paquet exclut volontairement :

- `node_modules` ;
- `dist` ;
- `.env` ;
- `.git` ;
- `.deploy` ;
- `data/agencies/*`.

Les fichiers Excel importés ne doivent pas être emballés dans l'application.
Ils doivent être déposés depuis le site après mise en ligne, dans le stockage
persistant de l'agence.

## Variables à configurer

```bash
PORT=4174
STEF_DATA_DIR=/data/agencies
STEF_UPLOAD_LIMIT_MB=20
STEF_AGENCIES_JSON='[{"code":"058","name":"Agen - 058","accessCode":"CHANGE_ME_BEFORE_SHARING","canImport":true}]'
```

RECOMMENDATION: remplacer `CHANGE_ME_BEFORE_SHARING` par un code fort avant de
partager le lien.
