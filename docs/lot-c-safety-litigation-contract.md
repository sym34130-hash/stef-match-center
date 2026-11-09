# Lot C — sécurité et litiges : contrat de préparation

Statut : **saisie manuelle développée et en recette, non déployée**. Décision métier : la date du dernier accident sera une donnée temporaire, à ressaisir si le serveur perd ses fichiers. L'écriture du compteur est autorisée en production par défaut ; les litiges restent verrouillés sans stockage durable.

## Situation constatée dans le dépôt

- Le carrousel « Le collectif en chiffres » comprend déjà la carte `injuries` / « NB DE BLESSURES (A.T) ».
- Sa valeur est saisie manuellement et enregistrée en `localStorage` par **agence et date du match**. Elle n'est ni partagée entre navigateurs ni une date certifiée de dernier accident.
- Le modèle `dailyIndicators` importé du PDF 106J ne contient pas de date de dernier accident ni de référentiel des litiges.
- Ne pas déduire l'absence d'accident du nombre de blessures d'une journée, ni fabriquer un total à partir de données manquantes.

## Implémentation de la saisie manuelle (PR #31)

- Interface « Jours sans accident du travail » située sous le carrousel « Le collectif en chiffres » : compteur visible en lecture, formulaire rétractable et historique pour un responsable ayant le droit `canImport`.
- Endpoint `GET /api/agencies/:agencyCode/safety` : lecture avec authentification agence, jours calculés au serveur selon la date civile Europe/Paris et état explicite « Non renseigné ».
- Endpoint `PUT /api/agencies/:agencyCode/safety` : date manuelle valide et non future, révision obligatoire, refus des écritures concurrentes (409), motif de correction obligatoire lorsqu'une date est déjà enregistrée, et historique par agence.
- Stockage serveur `<STEF_DATA_DIR>/<agency>/safety.json`, séparé du snapshot Excel/PDF et des chiffres de blessure A.T. locaux du navigateur.
- **Décision métier : donnée éphémère acceptée.** L'écriture de la date est disponible par défaut, y compris en `NODE_ENV=production` sans volume persistant. Elle reste isolée par agence dans `safety.json`, mais la date et son historique **peuvent disparaître au redéploiement / redémarrage / réinitialisation**. Un responsable doit alors ressaisir la date, même ancienne, avant qu'un compteur soit affiché. Un exploitant peut désactiver explicitement la saisie avec `STEF_SAFETY_WRITES_ENABLED=false`. Le risque de perte de données d'autres modules demeure indépendant.
- Rafraîchissement de l'affichage toutes les 60 secondes tant que l'onglet est visible, ainsi qu'au retour à la page, permettant le changement de jour.
- Les événements d'audit enregistrent la date précédente, nouvelle date, motif, horodatage et la catégorie de session autorisée ; **les codes de connexion ne sont pas enregistrés**. Sans identité nominative dans l'authentification existante, l'auteur individuel ne peut pas être identifié : une identité nominative nécessite une évolution distincte des comptes.
- L'API ne modifie aucun import ni les neuf cartes personnalisables du Lot A.

## C2 — compteur de jours sans accident du travail

**Contrat technique préparé** : `calculateAccidentFreeDays(lastAccidentDate, asOfDate)`, avec deux **dates civiles agence** au format strict `YYYY-MM-DD` (pas des horodatages UTC).

- Le jour du dernier accident vaut **0** ; le jour civil suivant vaut **1**.
- Une donnée manquante, invalide ou postérieure à la date de référence retourne `status: unavailable`, `days: null`.
- Le calcul ne convertit pas des timestamps ambigus et ne compte pas des périodes glissantes de 24 h : il ne varie donc pas aux passages heure d'été/hiver.
- La date de référence devra provenir d'une **date métier confirmée** ; pour un affichage « aujourd'hui », déterminer au serveur la date civile en `Europe/Paris` et non à partir de l'horloge du navigateur ou de la date UTC.
- Le dernier accident devra provenir d'une **source officielle** ou d'une saisie autorisée, datée et auditable, stockée au niveau de l'agence, pas au niveau du seul match.
- La donnée de dernier accident doit être isolée des imports Excel/PDF et protégée contre écrasement, suppression silencieuse, concurrence d'édition et lecture interagence.
- Tant qu'aucune date n'est saisie, ou après sa perte liée à l'hébergement éphémère, afficher « Non renseigné », jamais un zéro ni un nombre estimé.
- Ne pas remplacer ni étendre d'office les neuf cartes déjà personnalisables du Lot A ; l'emplacement de restitution reste indépendant des KPI du score.

### Critères de recette à venir

1. Saisie/modification uniquement par une session autorisée ; historiser auteur, date, valeur précédente, motif et révision.
2. Valeur identique pour deux navigateurs autorisés de la même agence ; aucune donnée visible depuis une autre agence.
3. Date métier et changement de jour fiables, y compris passage d'année et changements d'heure.
4. Modification concurrente refusée sur révision obsolète ; perte simulée du fichier éphémère, valeur remise à « Non renseigné » et possibilité de ressaisie testées.
5. Aucun impact sur imports, exclusions, scores, neuf indicateurs du carrousel et blessés A.T saisis localement.

## Implémentation du registre manuel des litiges (PR empilée après #31)

- `GET /api/agencies/:agencyCode/litigations` : lecture autorisée par agence. Si aucune source manuelle n'est initialisée, `sourceAvailable: false` et `totals: null`, **jamais zéro inventé**.
- `PUT /api/agencies/:agencyCode/litigations` : création ou modification d'une fiche unique par référence (insensible à la casse), avec révision obligatoire et erreur 409 en cas de concurrence.
- Champs : référence stable, voyage facultatif, date d'ouverture, description du motif, statut `open` (ouvert) ou `closed` (clôturé), date de clôture obligatoire pour un cas clôturé. Aucune imputation financière n'est inventée.
- Toute correction d'un enregistrement existant exige un motif (au moins 5 caractères) et historise précédent, nouvelle valeur et horodatage. **Pas de suppression destructive**.
- Le compteur décrit uniquement les litiges **saisis** dans le registre ; il ne constitue pas une déclaration d'exhaustivité des litiges de l'agence.
- Registre serveur `<STEF_DATA_DIR>/<agency>/litigations.json`, indépendant des imports et KPI. Limite technique : 500 fiches par agence et 500 événements d'historique conservés ; un archivage durable devra précéder cette limite.
- Modification autorisée uniquement pour `canImport`. L'auteur individuel n'est pas disponible dans l'authentification agence actuelle : la trace renseigne « session agence autorisée » et ne doit pas être présentée comme une signature nominative.
- **Sécurité production :** `STEF_LITIGATION_WRITES_ENABLED=true` ne doit être activé que sur un stockage persistant, sauvegardé et restaurable. Par défaut, les écritures sont désactivées en `NODE_ENV=production`.
- L'écran se situe sous les indicateurs du match, séparé des quatre KPI de score et des neuf cartes de personnalisation, avec formulaire de saisie et **liste repliée par défaut** (défilement horizontal sur mobile) pour préserver l'espace des graphiques. L'historique est également rétractable.

## C3 — suivi des litiges

**Première version retenue** : un registre de saisie manuelle, identifié et historisé, pour les litiges enregistrés par les responsables. Les données d'une éventuelle source officielle externe, leur exhaustivité, les règles d'imputation et la valorisation financière restent à définir. Ne jamais déduire des litiges d'anomalies Excel/PDF non qualifiées.

Contrat cible recommandé (non encore implémenté) :

- Une fiche litige issue d'une source identifiable, associée à une agence, avec identifiant stable.
- Historique des statuts et corrections, traçabilité, droits de modification et contrôle de révision.
- Indicateurs calculés uniquement à partir de fiches qualifiées : nouveaux cas sur la période, cas ouverts à date, cas clôturés sur la période, ancienneté si les dates source sont validées.
- Affichage de « Données non disponibles » si la source n'est pas connectée ; jamais zéro par défaut.
- Restitution dans un module dédié, sans modifier les quatre KPI du score, les neuf cartes du Lot A ni les listes de cartons.

## Blocage production

Les fichiers d'agence sur Render Free peuvent ne pas survivre à un redéploiement. **Exception expressément acceptée pour la seule date du dernier accident :** saisie manuelle provisoire, compteur à recalculer après ressaisie, et avertissement visible. Cette donnée et son historique ne constituent pas un registre d'accidents durable. **Pas d'exception pour les litiges :** leurs écritures restent verrouillées en production sans stockage persistant, sauvegardé et restaurable.

Les branches ajoutent des routes API et des écrans, sans modifier les données réelles ni déclencher de déploiement en production. Un déploiement de l'application demeure une opération séparée, soumise à la protection des autres données existantes (imports, briefs, paramètres).
