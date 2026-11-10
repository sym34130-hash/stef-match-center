# Lot E V2 — Briefing PDF dynamique (2 pages maximum)

## Objectif
Le MATCH reste complet dans l'application. Le téléchargement produit une synthèse **deux pages A4 paysage**, dédiée au briefing papier des filiales sans écran.

- Page 1 — score du MATCH, quatre indicateurs sportifs, 4 à 6 KPI complémentaires (ou tous les KPI visibles si moins de 4 sont actifs), un graphique opérationnel.
- Page 2 — sécurité, Service client, Expédition / Ramasse & Emballage, SST, priorités et arbitrages.
- Aucun tableau Excel, annexe 106J, capture historique ou carrousel multipage n'est exporté automatiquement.

## Sources et parité métier
Le pipeline existant /api/agencies/:agencyCode/export/match.pdf et son contrat d'agence/date/import/ligue restent la seule source du PDF. Le code de présentation ne recalcule pas les KPI officiels du score.

Les identifiants des graphiques disponibles sont :
- passes-hourly : taux du graphique horaire (périmètre spécifique, distinct du KPI officiel du score) ;
- reception-time : KPI de duel du score et synthèse des créneaux de réception ;
- loading : qualité des chargements ;
- centers : ponctualité destination issue de 106J (même indicateur que la carte du site) ;
- operational-diagnostic : couverture, retards et positions non vérifiables.

Chaque graphique est une synthèse vectorielle imprimable, non une capture tronquée de la carte interactive. Les critères sont ceux de la ligue active.

## Personnalisation et stockage
GET/PUT /api/agencies/:agencyCode/export/profile est protégé par requireAgency :
- GET accessible aux utilisateurs autorisés de l'agence ;
- PUT réservé aux utilisateurs disposant du droit canImport ;
- mise à jour optimiste par expectedRevision ;
- stockage dans STEF_DATA_DIR/<agence>/pdf-profile.json ;
- pas de stockage du PDF généré sur Render.

Ce profil contient 4 à 6 KPI complémentaires (parmi les 10 identifiants supportés), l'ID du graphique prioritaire et six synthèses facultatives, associées à la **date du MATCH**. Les textes des autres dates sont ignorés dans le PDF. La configuration ne modifie pas le carrousel visible ni la causerie d'origine. Les KPI masqués dans le MATCH sont retirés du PDF au moment de l'export.

En cas de modification du profil ou de la causerie entre affichage et export, une erreur 409 force un rechargement. En cas de texte obligatoire trop long pour la deuxième page, une erreur 422 demande une synthèse : ne jamais imprimer un troisième feuillet ni couper le texte critique.

**Render Free** : ce fichier dépend du même stockage éphémère que les autres états d'agence. La persistance après redéploiement nécessitera le stockage persistant prévu pour le projet.

## Recette avant toute fusion
- Vérifier les quatre ligues et au moins deux agences isolées (058/059 synthétiques).
- Tester 2 (cas exceptionnel), 4/5/6 KPI, les cinq graphiques, les indicateurs masqués et les valeurs absentes.
- Tester la conservation des sélections, le blocage des profils périmés et les droits.
- Vérifier les PDF réels avec pdf-parse : 2 pages, texte, identité et absence de mélange.
- Inspecter visuellement les deux pages de chaque PDF synthétique (workflow lot-e-pdf-audit) : chevauchements, lisibilité et contraste imprimé.
- Exécuter lint, build, tests Node/HTTP/UI et l'image Docker.

**Ne pas fusionner/deployer tant que la recette visuelle et les cas métier réels ne sont pas validés.**

## Lot E V8 — origine des sources et export du brief

L'utilisateur d'une agence autorisée peut importer un Excel et un PDF 106J dont les **agences source diffèrent de l'agence connectée**. L'import conserve la provenance exacte et le PDF indique, sur ses deux pages, les codes Excel et 106J ainsi que la date de référence du 106J. Le code agence de connexion reste le propriétaire des données stockées ; les droits d'accès inter-agences ne changent pas. Les Excel aux segments d'une autre agence connue conservent leur étape de confirmation d'import.

Au téléchargement, la Feuille de match charge la version du BRIEF ÉQUIPE propre à la date **depuis le serveur**, sans déduire de l'absence d'une révision locale que le brief serait non enregistré. Si le contenu local diverge, un avertissement demande de confirmer l'utilisation du brief enregistré sur le serveur ; aucun contenu local n'est envoyé ni incorporé secrètement au PDF. Le mécanisme d'optimistic locking sur les versions du profil PDF et de la causerie reste actif.

La sauvegarde avant fusion est `backup/pre-lot-e-v8-2026-11-10`. Elle protège le code, pas les données éphémères Render Free. La recette en production nécessite une vérification authentifiée d'un MATCH réel.
