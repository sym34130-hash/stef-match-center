# STEF Match Center — revue transversale du code, du scoring et de l'exploitation

**Date :** 9 novembre 2026  
**Référence production analysée :** `main` à `e84e9ca1eff1de2958ff7441ed2aa4fb35d2ab1e` (Render `LIVE`).  
**Évolution non livrée :** PR #36, Lot D (branche `feature/lot-d-score-simulation`), vérifiée au commit `f6ed74e5d0b9cd47b22902bb7175d6426e468875`, toujours en brouillon.  
**Nature :** audit statique et analyse des résultats des contrôles GitHub/Render ; **pas** une certification complète ni un pentest.

## Synthèse

**Verdict : NON CERTIFIÉ POUR UN DÉPLOIEMENT MULTI-AGENCES SANS RÉSERVES.** La version production fonctionne d'après Render et les CI récentes sont vertes, mais des risques métier, de déploiement et de pérennité restent ouverts. La PR #36 ne doit pas être fusionnée avant arbitrage du référentiel des agences sans zonage.

| ID | Gravité | Fait vérifié | Risque | Recommandation |
| --- | --- | --- | --- | --- |
| **P0-01** | Critique — intégrité | `server/source-provenance.mjs` retourne `mismatched-agency` pour un PDF 106J d'une autre agence **et** `canUsePdfIndicators` autorise ce statut (lignes 35–59). `server/index.mjs`, route PDF (env. 782–806), l'enregistre sans deuxième confirmation métier. | Attribution d'indicateurs PDF à une agence différente de celle inscrite dans le PDF. | **Bloquer** l'import inter-agence ou exiger une confirmation explicite distincte, avec trace. Ne pas remettre en cause la simple différence **de date** Excel/PDF précédemment acceptée. |
| **P0-02** | Critique — chaîne de livraison | Branche `main` signalée non protégée par l'API GitHub ; workflows de lint/tests et Docker déclenchés sur `pull_request` vers `main` mais **pas** sur tout `push` `main` ; Render déploie automatiquement les commits `main`. | Un push direct par une personne disposant de droits pourrait contourner les vérifications PR puis déclencher la production. | Protéger `main`, exiger PR + checks obligatoires, ajouter `push: main` pour surveillance post-fusion ; si possible privilégier un déploiement conditionné aux checks. |
| **P1-03** | Élevée — équité du score | `server/match-engine.mjs` (env. 1162–1178) exige les 4 KPI ; la possession utilise DECHG+ZONAGE (env. 1188–1215) ; les passes s'appuient notamment sur DZ/duelWonFlag (env. 1611–1645 et 1988–2048). | Pour une plateforme sans zonage, le score peut être pénalisant (0) ou indisponible. | Déclarer durablement les activités **pratiquées** par agence (ne pas les inférer d'un seul import) ; créer un barème métier explicite et versionné pour chaque profil. Un socle commun CHG+DECHG nécessite aussi des seuils comparables. |
| **P1-04** | Élevée — continuité de service | Render plan `free` avec fichiers d'agence dans `/tmp/stef-match-center/agencies`. Excel, PDF, dernières synthèses, exclusions, paramètres et causeries sont sauvegardés sur ce filesystem ; pas de sauvegarde persistante garantie. | Perte lors de redéploiement/redémarrage ; impossibilité de reconstituer sans réimport. | Organiser au minimum export/restore vérifié avant déploiement, puis stockage durable si usage multi-agences pérenne. **Risque explicitement accepté pour les précédents déploiements**, mais pas supprimé. |
| **P1-05** | Élevée — couverture tests | `package.json` déclare 22 scripts/étapes dans `pnpm test`. Le workflow principal ne couvre pas 5 de ces scripts : `import-contract.test.mjs`, `lot1-api.test.mjs`, `calendar-validation.test.mjs`, `auth-attempts.test.mjs`, `reconcile-import.mjs` (ce dernier exige un vrai fichier absent du dépôt). | Tests de date, auth, API et rapprochement complet non systématiquement bloquants à chaque PR. | Ajouter les 4 tests autonomes à la CI, exécuter la réconciliation sur fichier fixture anonymisé ou dans un environnement séparé autorisé ; ne pas exposer les données réelles. |
| **P2-06** | Moyenne — barème | `scoreTargetPercent` autorise la valeur 100 dans l'API et l'UI ; le moteur n'accorde un but que si le KPI est **strictement supérieur** à l'objectif. | Objectif impossible à atteindre à 100 %, d'où 0 but marqué même si tous les KPI valent 100 %. | Limiter l'objectif à 99 %, ou expliciter une règle métier `>=` validée puis testée. |
| **P2-07** | Moyenne — traçabilité | Le contrôle d'accès repose sur un `accessCode` partagé par agence et un droit `canImport`; l'historique sécurité indique l'acteur générique « session agence autorisée » (server/index env. 153–160). | Pas d'attribution fiable des modifications à une personne en cas d'erreur ou de contestation. | Prévoir identité/roles et journal d'audit lorsque l'application sort du pilote. |
| **P2-08** | Moyenne — maintenabilité | `src/App.tsx` >5 300 lignes (~292 Ko), `src/styles.css` ~539 Ko, `server/index.mjs` ~1 745 lignes, `server/match-engine.mjs` ~2 158 lignes. | Fort couplage des modules, régressions visuelles/écrasement CSS, revues difficiles. | Extraire progressivement formulaires, services de scoring, routeurs, composants et tokens CSS. Ne pas refondre massivement en une PR. |
| **P2-09** | Moyenne — recette métier | Les tests automatisés emploient des fixtures ; la vraie matrice QFC et l'Excel de l'agence 058 ne sont pas inclus dans ce dépôt (volontairement). `pnpm test:ui:responsive` n'est pas exécuté par le workflow CI principal. | Impossible de certifier la réconciliation sur chaque vrai format Excel et toutes les variantes d'interface à partir des seuls checks. | Recette contrôlée/anonymisée multi-agences et ajout de responsive Playwright aux checks. |
| **P2-10** | Moyenne — dépendances / sécurité | CI installe en mode verrouillé et construit Docker, mais aucun job explicite de vérification des vulnérabilités des dépendances ni analyse de secrets/SAST n'a été trouvé dans les workflows inspectés. | Les checks verts ne démontrent pas l'absence de CVE, de secret ou de faiblesse applicative. | Audit dépendances/SAST, revue des variables de production, rotation des codes partagés si nécessaire. |
| **OBS-11** | À analyser — source métier | Le KPI affiché « Passes réussies » est en partie calculé depuis `duelWonFlag` / `Duels gagnés` et `DZ` dans les lignes de scoring de l'Excel. | Une confusion de sens métier est possible si le champ ne mesure pas effectivement les « passes » au sens attendu. | Vérifier cette correspondance avec les responsables opérationnels et un classeur représentatif avant de modifier la formule. |
| **OBS-12** | À tester — heures | Conversions Excel → heure locale Europe/Paris impliquent des heures ambiguës au changement hiver/été (`server/match-engine.mjs`, env. 1760–1840). | Cas limites non certifiés pour les plages nocturnes aux transitions DST. | Ajouter des fixtures précises sur passages d'heure ; ne pas modifier à l'aveugle les dates déjà importées. |

## Points positifs vérifiés

- Les routes d'agence inspectées utilisent `requireAgency` et les écritures principales vérifient `canImport`.
- Limites de taille des uploads et du JSON, contrôles de format, en-têtes de sécurité et limitation des échecs d'authentification existent.
- Verrous asynchrones par agence, écriture par fichier temporaire + renommage, et contrôles de révision existent sur les paramètres ligue, causeries et date accident.
- Les exclusions CHG/DECHG sont séparées ; le recalcul repose sur les sources Excel et les motifs sont vérifiés.
- La date du dernier accident est saisie explicitement et la valeur manquante n'est pas convertie en faux zéro.
- Le Lot C mis en production n'inclut pas les litiges ; la PR #36 reste séparée de `main`.
- Les deux workflows GitHub de la PR #36 (Docker + lint/build/import/API/navigateur) se sont terminés **en succès** au dernier commit examiné.
- Render indique `LIVE` sur `main` au commit `e84e9ca…` ; les journaux de démarrage disponibles confirment le lancement de l'API.

## Ce qui n'a PAS été certifié

1. Aucun test manuel authentifié en production avec un compte d'agence réel et les **vrais fichiers Excel/PDF** n'a été lancé dans cette revue.
2. Impossible de prouver l'absence de perte de données temporaires, ni leur restaurabilité, à partir du seul état Render.
3. Les tests automatisés ont été **consultés via les résultats GitHub Actions** ; ce rapport ne revendique pas une exécution locale indépendante de l'intégralité du dépôt.
4. Aucun audit d'intrusion, exploitation de CVE, mesure de charge ni revue exhaustive des dépendances et fichiers binaires n'a été mené.
5. La revue du code a couvert l'arborescence, les modules critiques API/score/import/exclusions/sécurité et les tests, mais ne constitue pas une preuve formelle de correction de **chaque ligne** ou de chaque flux navigateur.

## Ordre recommandé

1. **Bloquer d'abord les PDF 106J d'agence différente** sans validation métier (P0-01), puis vérifier Excel/PDF à agence identique et dates différentes.
2. **Sécuriser la chaîne main → Render** (P0-02), avec checks obligatoires et pas de mise en prod sur push non validé.
3. **Améliorer la couverture CI** (P1-05), conserver le contrôle des quatre KPI et des anciens Lots A/B/C.
4. **Décider du stockage durable ou du plan de reprise** (P1-04) avant une diffusion multi-agences officielle.
5. **Arbitrer le référentiel avec/sans zonage** (P1-03) ; valider le socle commun CHG/DECHG avec des seuils identiques si comparaison inter-sites.
6. Résoudre progressivement P2 et observations, avec tests de non-régression à chaque étape.

**Décision technique proposée :** laisser la PR #36 en brouillon et la production inchangée ; ne pas entamer le Lot D2 tant que les deux risques P0 ne sont pas maîtrisés.
