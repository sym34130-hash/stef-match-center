# Filtre réservé au graphique « % passes réussies par heure »

## Demande métier

Le **graphique du carrousel 1/5** et son total affiché retiennent uniquement
les opérations répondant simultanément à :

- `Données!C` : déchargement (`DECHG`, code interne du libellé « DÉCHARGEMENT »).
- `Données!G` : `AQ`, `ED`, `EX` ou cellule vide. Espaces et casse sont normalisés.
- Respect des filtres existants : opérateur, positions non zonées, exclusions
  de voyages, plage horaire choisie à la minute et seuil de zonage de la ligue.
- `LIV` et les autres segments ainsi que `ZONAGE` et `CHG` sont exclus **du graphique uniquement**.

Le regroupement est par heure réelle de l'opération éligible ; les heures
partielles et les périodes chevauchant minuit sont préservées. Pour un code
voyage mêlant `EX` et `LIV`, seules les lignes `EX` sont représentées
dans le graphique. Les annotations des arrivées affichées sur la courbe
respectent le même sous-ensemble de types d'opérations et de segments.

## Protection des résultats officiels

Le KPI **% passes réussies** utilisé par les quatre indicateurs du score football
conserve son historique de calcul : toutes les lignes de score éligibles,
sans nouveau filtre par opération/segment. Le total visible dans le graphique
est renommé « Total filtré » et calculé avec le numérateur et le dénominateur
réels de la courbe ; il peut donc différer du KPI officiel.

Les KPI **% duels gagnés**, leurs détails et le graphique
**Temps de réception par créneau** sont restaurés exactement à la logique
qui précédait la PR #11 ; le filtre erronément appliqué à la réception a été retiré.
Le diagnostic, les chargements, la possession, le DST et les scores ne changent pas.

## Contrôle qualité

`scripts/hourly-pass-chart-scope.test.mjs` couvre les quatre valeurs G
autorisées, les cas `LIV` et autres segments, les lignes `CHG` et `ZONAGE`,
les codes mixtes, les objectifs de ligue, les exclusions, les plages partielles
et l'absence de déchargement autorisé. La CI exécute également les tests de
réception et de score existants.

Le fichier Excel privé n'est pas ajouté au dépôt ; la comparaison des valeurs
affichées avec un import réel reste un contrôle métier après le redéploiement.

## Validation des références

Sur la fixture jour `HM 058 A V11.xlsx`, plage 13:00-22:30 et cible 30 min,
les séries Excel brutes donnent 66/111 = 59,5 % dans le sous-ensemble du
graphique, contre 2528/3517 = 71,9 % pour le KPI officiel. Ces valeurs ne
doivent pas être échangées dans les tests UI. Les heures sans ligne admissible
ne sont pas recréées depuis le TCD historique. Les contrôles indépendants
figurent dans `scripts/reconcile-import.mjs` ; les fixtures synthétiques de
`scripts/hourly-pass-chart-scope.test.mjs` couvrent aussi les segments rejetés,
les exclusions et les critères actifs. Le DST reste ouvert, accepté et hors périmètre.

## Lecture et fiabilité visuelle du graphique (correctif novembre 2026)

Une courbe à `100 %` ne signifie pas qu'un grand volume d'opérations a été
traité : `1/1` et `50/50` valent tous deux 100 %. Aucune correction
statistique ni seuil d'éligibilité supplémentaire n'est appliqué aux KPI.

L'interface affiche :
- le total du **sous-ensemble filtré** avec son nombre de réussites et
  d'opérations éligibles ;
- le nombre de créneaux avec données et un avertissement purement informatif
  lorsqu'au moins un créneau a moins de cinq opérations ;
- un tableau dépliable des numérateurs, dénominateurs et pourcentages **par heure** ;
- les points aux heures réellement écoulées, **sans interpolation à travers
  une heure absente**. Une absence de données n'est jamais remplacée par 0 %.

Les calculs métier, la population retenue (DECHG avec segments
AQ/ED/EX/vides), les ligues, les exclusions et le KPI officiel restent
inchangés. Test synthétique 13:00–22:30 : les taux peuvent être 100 % (1/1)
sur neuf heures et 60 % (3/5) à 19 h, pour un total graphique de 12/14
et un KPI officiel différent. Pour confirmer une extraction **réelle**, il
faut contrôler les volumes du classeur importé, non les seuls pourcentages.
