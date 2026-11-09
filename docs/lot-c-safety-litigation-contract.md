# Lot C — sécurité et litiges : contrat de préparation

Statut : **foundation only / not production-ready**. L'implémentation actuelle de cette branche introduit uniquement un calcul calendaire pur, sans donnée réelle, API, écran ni mise en production.

## Situation constatée dans le dépôt

- Le carrousel « Le collectif en chiffres » comprend déjà la carte `injuries` / « NB DE BLESSURES (A.T) ».
- Sa valeur est saisie manuellement et enregistrée en `localStorage` par **agence et date du match**. Elle n'est ni partagée entre navigateurs ni une date certifiée de dernier accident.
- Le modèle `dailyIndicators` importé du PDF 106J ne contient pas de date de dernier accident ni de référentiel des litiges.
- Ne pas déduire l'absence d'accident du nombre de blessures d'une journée, ni fabriquer un total à partir de données manquantes.

## C2 — compteur de jours sans accident du travail

**Contrat technique préparé** : `calculateAccidentFreeDays(lastAccidentDate, asOfDate)`, avec deux **dates civiles agence** au format strict `YYYY-MM-DD` (pas des horodatages UTC).

- Le jour du dernier accident vaut **0** ; le jour civil suivant vaut **1**.
- Une donnée manquante, invalide ou postérieure à la date de référence retourne `status: unavailable`, `days: null`.
- Le calcul ne convertit pas des timestamps ambigus et ne compte pas des périodes glissantes de 24 h : il ne varie donc pas aux passages heure d'été/hiver.
- La date de référence devra provenir d'une **date métier confirmée** ; pour un affichage « aujourd'hui », déterminer au serveur la date civile en `Europe/Paris` et non à partir de l'horloge du navigateur ou de la date UTC.
- Le dernier accident devra provenir d'une **source officielle** ou d'une saisie autorisée, datée et auditable, stockée au niveau de l'agence, pas au niveau du seul match.
- La donnée de dernier accident doit être isolée des imports Excel/PDF et protégée contre écrasement, suppression silencieuse, concurrence d'édition et lecture interagence.
- Tant que cette source et un stockage durable ne sont pas opérationnels, afficher « Non renseigné », jamais un nombre estimé.
- Ne pas remplacer ni étendre d'office les neuf cartes déjà personnalisables du Lot A ; l'emplacement de restitution reste indépendant des KPI du score.

### Critères de recette à venir

1. Saisie/modification uniquement par une session autorisée ; historiser auteur, date, valeur précédente, motif et révision.
2. Valeur identique pour deux navigateurs autorisés de la même agence ; aucune donnée visible depuis une autre agence.
3. Date métier et changement de jour fiables, y compris passage d'année et changements d'heure.
4. Modification concurrente refusée sur révision obsolète ; persistance réellement testée après redéploiement.
5. Aucun impact sur imports, exclusions, scores, neuf indicateurs du carrousel et blessés A.T saisis localement.

## C3 — suivi des litiges

**Périmètre métier restant à fixer** : source officielle, identifiant unique, états, dates d'ouverture/résolution, clés de rattachement (agence/voyage), et éventuelle valorisation financière. Ne jamais calculer un « nombre de litiges » en assimilant des anomalies Excel ou PDF non validées.

Contrat cible recommandé (non encore implémenté) :

- Une fiche litige issue d'une source identifiable, associée à une agence, avec identifiant stable.
- Historique des statuts et corrections, traçabilité, droits de modification et contrôle de révision.
- Indicateurs calculés uniquement à partir de fiches qualifiées : nouveaux cas sur la période, cas ouverts à date, cas clôturés sur la période, ancienneté si les dates source sont validées.
- Affichage de « Données non disponibles » si la source n'est pas connectée ; jamais zéro par défaut.
- Restitution dans un module dédié, sans modifier les quatre KPI du score, les neuf cartes du Lot A ni les listes de cartons.

## Blocage production

Les fichiers d'agence actuellement hébergés sur Render Free peuvent ne pas survivre à un redéploiement. **Aucun registre d'accident ou de litige ne doit être déclaré fiable tant qu'un support persistant, sauvegardé et restaurable n'a pas été testé.**

Cette fondation n'ajoute ni endpoint ni écriture, et ne touche ni aux données réelles ni à la production.
