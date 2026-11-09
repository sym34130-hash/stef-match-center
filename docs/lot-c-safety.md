# Lot C2 — compteur de jours sans accident du travail

## Décision métier

Un responsable autorisé renseigne manuellement la date du dernier accident de son agence. La date n'est pas déduite du nombre de blessures A.T affiché sur le match. La valeur est **temporaire sur Render Free** : une perte du fichier lors d'un redéploiement ou d'une réinitialisation est explicitement acceptée. Le responsable doit alors ressaisir la date.

## Comportement

- API authentifiée par agence : `GET /api/agencies/:agencyCode/safety` (lecture), `PUT` (écriture réservée aux profils `canImport`).
- Date civile réelle non future au format strict `YYYY-MM-DD`, référencée à la date serveur `Europe/Paris` ; 0 jour le jour de l'accident, puis +1 par jour civil.
- Sans date, ou après une perte de données du serveur, afficher **« Non renseigné »** et non un faux zéro ou un décompte estimé.
- Écriture par révision optimiste obligatoire (409 si un autre responsable a changé la date), motif requis en cas de correction et historique conservé **tant que le fichier existe**.
- Fichier temporaire : `<STEF_DATA_DIR>/<agency>/safety.json`. Pas de sauvegarde/persistance garantie, et l'historique n'est pas un registre d'accidents officiel.
- En production, l'édition est active par défaut et peut être désactivée via `STEF_SAFETY_WRITES_ENABLED=false`.
- Le composant est indépendant des KPI du score, des neuf indicateurs configurables, des exclusions ciblées et des cartons jaunes.
- Tests : dates bissextiles, passage d'heure d'été, accès agence, 409 concurrent, suppression simulée du fichier, puis ressaisie.

## Mise en production

**La non-persistance consentie ne s'applique qu'à cette date.** Les imports Excel/PDF, snapshots, causeries et paramètres déjà présents sur Render Free peuvent également être perdus au redéploiement. Vérifier leur conservation/sauvegarde ou prévoir une restauration contrôlée avant tout déploiement. Aucun déploiement n'est déclenché par cette documentation.
