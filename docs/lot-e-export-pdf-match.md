# Lot E — Export PDF complet du MATCH (contrat métier et recette)

## Objectif

Offrir aux agences dépourvues d'écran un bouton « Télécharger le MATCH en PDF ».
Le document est autonome, lisible au format paysage 16:9, imprimable et fidèle
aux couleurs, cartes, podiums, typographies et graphiques du site. Un PDF n'est
**jamais** une capture de la seule vignette ou du seul graphique visible.

## Source de vérité, version et agence

- **Identification** : le PDF est lié à un seul triplet agence connectée +
  date du MATCH + `importedAt` du snapshot. Le code agence est contrôlé
  contre `snapshot.agency.code`, puis présent sur la couverture et les pages.
- **Ligue choisie** : LIGUE 2, LIGUE 1, LDC ou CDM. Son code, son libellé et
  ses objectifs sont figés au lancement. Les critères réellement contenus dans
  le snapshot priment sur les valeurs par défaut de la ligue ; aucune
  réinterprétation d'un score enregistré à partir d'un autre barème.
- **Quatre KPI du score** : reprend les valeurs du MATCH courant, sans les
  recalculer depuis une autre agence ou un autre profil. Si une mesure est
  indisponible ou non applicable (future évolution du Lot D), le PDF l'indique,
  sans la convertir en zéro.
- **Indicateurs de « Le collectif en chiffres »** : reprend les neuf cartes
  personnalisables qui ont été sélectionnées pour **ce** MATCH. La vignette
  « Jours sans accident du travail » demeure présente ; le Mercato n'apparaît
  que si les informations correspondantes sont présentes.
- **Saisies manuelles** : blessures A.T et effectif prévu proviennent de la
  dernière valeur **enregistrée** pour agence + date, jamais d'un brouillon.
  Le compteur jours sans A.T doit être lu pour cette même agence et daté du
  jour de l'export.
- **Brief / Causerie** : la version récupérée doit correspondre exactement à
  `agence:date:importedAt`. En cas de chargement ou d'incohérence, l'export
  est bloqué plutôt que de reprendre silencieusement un brief précédent.
- **PDF 106J** : s'il porte un code agence, celui-ci doit correspondre au
  MATCH connecté. La date de référence 106J peut être différente de la date
  Excel : les deux dates sont affichées séparément et jamais assimilées.
- **Exclusions** : reprendre le périmètre effectivement utilisé par le
  snapshot, avec mention des exclusions; aucune modification des calculs.

## Pagination exhaustive et design

1. **Résultat** : score, ligue, objectifs, cartons et les quatre KPI.
2. **Le collectif en chiffres** : toutes les vignettes sélectionnées, y compris
   celles hors écran dans le carrousel ; autant de pages que nécessaire.
3. **Cérémonie des performances** : podiums et récompenses réellement attribués.
4. **Lecture opérationnelle** : toutes les cartes du carrousel de graphiques,
   et diagnostics/exclusions pertinentes (pas seulement la slide active).
5. **Brief équipe** : plan de jeu, priorités, consignes et visuels du MATCH
   courant, pagination au besoin.

Les blocs ne sont ni rognés ni écrasés. Adapter les sauts de page et la
résolution au contenu, sans introduire des sections provenant d'autres agences.
Conserver un numéro de page et un cartouche discret
« agence · date du MATCH · ligue » sur chaque page. Le fichier est nommé
`STEF-MATCH-<agence>-<date>-<ligue>.pdf`.

## Contrôles obligatoires avant déploiement

1. Agence A et B avec mêmes dates, noms d'opérateurs différents : jamais une
   ligne ou un intitulé de B dans l'export de A.
2. Changement de session d'agence pendant la génération : interrompre
   sans produire de fichier partiel.
3. Changement de ligue, seuils, date, import, exclusions, sélection des
   vignettes, saisies manuelles ou brief pendant la génération : interrompre,
   réactualiser et recommencer.
4. PDF 106J d'une autre agence : blocage ; 106J d'une autre date mais de la
   bonne agence : autorisation avec provenance visible.
5. LIGUE 1 / LDC / CDM / LIGUE 2, variantes de seuils, KPI manquants,
   présence et absence de zonage.
6. Toutes les cartes de carrousel sont exportées; aucune coupure de graphique,
   police, badge, tableau ou légende.
7. Vérification sur jeu factice de deux agences, rendu réel du PDF, ouverture
   avec visionneuse, nombre de pages, texte lisible et impression A4 paysage.
8. Aucun code d'accès, secret de connexion ou snapshot brut n'est stocké dans
   le nom, les métadonnées ni un dossier public. Éviter de conserver des PDF
   sur Render Free. Envoyer avec Content-Disposition attachment et cache no-store
   si l'export est généré côté serveur.

## Découpage

- **E1 — Contrat métier / anti-mélange** : fonction pure et tests du contexte
  de génération (agence, snapshot, ligue, barèmes, vignettes, KPI et causerie).
- **E2 — Moteur PDF, même design** : rendre les composants existants dans une
  mise en page statique multipage, avec téléchargement direct.
- **E3 — Recette exhaustive** : tests d'isolation entre deux agences, tests
  visuels du document final, performance, puis fusion et déploiement.

La présente branche correspond au premier jalon. **Ne pas fusionner E1 seul**
comme si l'export PDF était disponible : le bouton et le moteur de rendu ne
doivent être activés qu'après la recette E2/E3.
