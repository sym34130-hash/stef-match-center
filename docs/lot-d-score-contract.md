# Lot D — personnalisation des KPI du score

## Audit du scoring actuellement en production

Le score officiel du match est toujours calculé à partir de **quatre KPI**, dans cet ordre :

| KPI football | Champ moteur | Source et logique |
| --- | --- | --- |
| Passes réussies | `passRate` | Taux de passes calculé dans le périmètre Excel actif |
| Tirs cadrés | `loadingPercent` | Proportion de voyages CHG respectant le temps cible par position |
| Duels gagnés | `unloadingPercent` | Proportion de voyages DECHG respectant le temps cible par position |
| Possession | `possessionPercent` | Proportion de positions réceptionnées puis zonées suivant la règle temporelle |

Le moteur `server/match-engine.mjs` transforme **chacun** des quatre indicateurs en un but pour l'agence si sa valeur est **strictement supérieure** à `scoreTargetPercent`, sinon en but concédé. L'égalité au seuil est un échec. Si un seul des quatre est absent, le score global est indisponible. Le statut du match est « Maîtrisé » lorsque buts pour > buts contre, « À surveiller » à égalité, « Action nécessaire » sinon.

Une partie du Lot D est **déjà disponible** dans l'écran Administrateur : par agence et par ligue, on personnalise la cible de zonage, la durée maximale de chargement, la durée maximale de réception et le seuil commun `scoreTargetPercent`. Les paramètres sont partagés côté serveur via `league-configs.json`, avec révision/contrôle de concurrence, et actualisation des snapshots Excel selon la ligue active. Les ligues de départ : Ligue 2 = 45 %, Ligue 1 = 50 %, LDC = 60 %, CDM = 70 %.

## D1 — simulateur de sélection (branche dédiée, sans impact sur la production)

- Ajouter un encart « Simuler les KPI du score » dans **Administrateur**, sans remplacer le tableau des standards existant.
- Afficher les quatre KPI du match et leurs valeurs réellement calculées selon la ligue active.
- Autoriser une **sélection temporaire de 1 à 4 KPI**, pour montrer combien atteignent leur objectif et leur taux de réussite **sur les seuls KPI sélectionnés**.
- Garder en parallèle le **score officiel à quatre KPI** et afficher un avertissement de non-comparabilité des scénarios à périmètre réduit.
- Ne calculer aucune simulation sur un snapshot non synchronisé avec la ligue ou si un KPI sélectionné est manquant : afficher « Indisponible », jamais un score fictif.
- Ne modifier **ni** le score officiel, **ni** le classement, **ni** les paramètres par ligue, **ni** les imports, **ni** les fichiers d'agence. Aucune écriture serveur, localStorage ou API pour le scénario.
- Tests unitaires du seuil strict, absence de KPI, scénario 1/2/3/4 indicateurs, et non-mutation. Tests navigateur sur ordinateur et mobile contre le score officiel.

## D2 — décisions métier à prendre avant de modifier le score officiel

La sélection de KPI et les éventuelles pondérations modifient la signification d'un score de match. Avant toute évolution officielle :

1. Décider si les **quatre critères doivent rester communs** pour toutes les plateformes, ou si les plateformes peuvent choisir les leurs. Deux scores basés sur des dénominateurs différents ne doivent pas être comparés sans normalisation.
2. Définir une métrique comparable entre plateformes (ex. pourcentage de conformité sur les quatre KPI communs) et distinguer les KPI optionnels, utiles uniquement au diagnostic local.
3. Définir une version de barème et un historique de l'agence, conservant la règle de chaque match pour les analyses temporelles.
4. Spécifier les droits, les validations, le comportement lorsqu'une donnée manque et l'impact sur les ligues et le classement.

**Recommandation de cadrage :** conserver les quatre KPI obligatoires pour le score officiel et autoriser des analyses complémentaires configurables. Le simulateur D1 permet de tester des arbitrages métiers sans altérer le référentiel commun.

## Conditions de livraison

D1 peut être intégré après tests, car il n'entraîne **aucune modification des données ni des méthodes de calcul du score**. Le simulateur dépend d'un match importé pour afficher des résultats concrets. Dans Render Free, les sources Excel et paramètres d'agence restent éphémères ; ne jamais présenter une comparaison simulée comme un score de référence.
