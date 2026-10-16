# Stabilisation responsive - rapport local

Rapport historique : validation locale terminee le 2026-10-07. Les statuts Git et resultats ci-dessous decrivent cette intervention initiale.

## Consolidation responsive et Jour/Nuit du 2026-10-16

- Le patch local responsive-final-diff.patch contient 33 fichiers. Leurs 33 empreintes cibles correspondent exactement aux blobs du commit 6392dc5, deja ancetre du main courant.
- Sur la base e0c1448, 20 fichiers restent identiques a ces cibles ; 13 ont evolue depuis. Le patch n'est pas rejoue : cela annulerait des corrections posterieures validees.
- Les regles responsive actuelles et les controles renforces du carrousel sont conserves, notamment la visibilite et l'accessibilite par defilement de reception-hour-chart.
- Les travaux Jour/Nuit preserves sont reportes sur cette base sans conflit. Ils neutralisent la terminologie visible et documentent les periodes deja retenues par le moteur ; aucun contrat technique ni calcul KPI n'est renomme.
- DST : Ouvert - Accepte - Hors perimetre. Aucune correction des conversions temporelles n'est incluse.
- Le fichier patch reste un artefact local non suivi. Cette consolidation ne comporte aucun push ni deploiement.

Validation de consolidation sur une copie isolee, avec Node 22.23.3 et stockage de test temporaire :

| Commande | Resultat du 2026-10-16 |
| --- | --- |
| pnpm lint | PASS |
| pnpm build | PASS |
| pnpm test | PASS : 53 tests et reconciliation Excel |
| pnpm test:pdf | PASS : 15 tests |
| pnpm test:deploy | PASS : smoke local, stockage temporaire |
| node --test scripts/data-integrity-api.test.mjs | PASS : 1 test HTTP |
| pnpm test:pdf:import avec Excel de reference et PDF 106J reel | PASS : navigateur, relecture, quatre ligues, plage, reimport et redemarrage |
| pnpm test:ui | PASS : 124 reussis, 4 ignores, 13,2 min |
| pnpm test:ui:responsive | PASS : 2 reussis, 3,9 min |
| Playwright operational-analysis.spec.ts --grep jour/nuit | PASS : 3 reussis, desktop/tablette/mobile, normal et Celebration |
| git diff --check | PASS |

Les quatre tests ignores restent les exclusions desktop-only existantes. Aucune reference visuelle n'a ete remplacee et aucune regle CSS n'a ete ajoutee ou modifiee pour cette consolidation.

Les 13 formats de la matrice ci-dessous passent en normal et Celebration. Les tests d'analyse couvrent aussi 768x1024, 390x844, 320x740 et 320x700. Revue ciblee des captures du diagnostic sur PC et mobile, ainsi que du rendu de jour en Celebration. La revue sur les PC professionnels reels reste recommandee.

Comparaison complete de huit snapshots construits depuis le classeur Montpellier : plages 08:00-16:00, 14:00-22:00, 21:30-06:30 et 00:00-08:00, avec et sans exclusions. Hors date d'import et reformulation attendue de l'avertissement, les snapshots sont identiques a la base e0c1448 : KPI, compteurs et classements inchanges.

Controle SHA-256 final : 30 fichiers de donnees locales, le patch et les deux originaux Excel/PDF inchanges ; aucun ajout ni suppression de fichier dans les donnees d'origine. Preuves locales : /tmp/stef-consolidation-AeNvMv/ (journaux, inventaire des 33 blobs, comparaisons et captures). Les sauvegardes Git precedentes sont conservees.

## Etat initial

- Depot : /Users/arnaudszy/Documents/GitHub/stef-match-center.
- Etat de depart : main propre, commit 374a7e3e71cb5fdd8f482744705bbaa23b5287a9.
- Branche locale : fix/responsive-stabilization.
- Sauvegarde initiale des donnees : /tmp/stef-responsive-baseline-data.tgz.
- Aucun push, deploiement, secret Render ou fichier de configuration de production modifie.

| Baseline avant modification | Resultat |
| --- | --- |
| pnpm lint | PASS |
| pnpm build | PASS |
| pnpm test | PASS : 3 tests de classement + reconciliation Excel |
| pnpm test:deploy | PASS : serveur local temporaire uniquement |
| pnpm test:ui | FAIL : 56 passes, 4 ignores, 1 echec |
| pnpm test:ui:responsive | FAIL : reference 1366x768-normal-slide-1 |

OBSERVATION : la reference utilisait les anciens champs horaires, alors que le code actuel utilisait deja des listes de selection. La date d'actualisation variait aussi. L'echec initial de capture interrompait la matrice : il ne prouvait pas que les geometries suivantes etaient correctes. Logs conserves dans /tmp/stef-baseline-*.log.

## Causes identifiees

Audit de l'ensemble de src/styles.css avec PostCSS, pas seulement de sa fin. Inventaire initial : 21 984 lignes, 3 542 regles hors keyframes, 134 blocs media et 41 conditions distinctes. Inventaire detaille : /tmp/stef-responsive-css-audit.json.

1. Des couches tardives reimposaient une hauteur viewport et des masques, apres les regles prevues pour autoriser le defilement naturel.
2. Deux grandes couches compactes 901-1080px repetaient les regles et annulaient les protections des petites hauteurs. Certains textes normaux descendaient a 7-8px.
3. La largeur nominale ne representait pas la place disponible : a 1366px, la sidebar et les marges laissent seulement 1010px utiles.
4. Les pistes fixes titre/contenu/pied des cartes KPI pouvaient entrer en collision avec des textes longs.
5. Un selecteur tres specifique du brief normal contaminait la celebration : sa slide 4 avait 960px de contenu pour 730px autorises a 1600x900.
6. Des details de graphiques et cartes compactes de presentation utilisaient des masques au lieu de conserver un acces par defilement.
7. Un halo decoratif incline provoquait 2px de debordement horizontal a 1180x640.
8. Le parent principal utilisait overflow-y: auto sans hauteur contrainte : la navigation sticky ne restait donc pas ancree au viewport. Reproduction a 1366x768 : navigation a -193px apres 477px de defilement ; correction verifiee a 4px.

## Corrections et fichiers

| Fichier | Modification et raison |
| --- | --- |
| src/styles.css | Suppression des couches contradictoires ; hauteur naturelle en application normale ; isolation du Brief/Celebration ; colonnes selon largeur utile ; restauration de la navigation sticky ; details accessibles ; halo recentre ; espacement chiffre/libelle des recompenses |
| src/match-indicators.css | Une seule grille KPI a pistes determinees par le contenu ; defilement interne possible en presentation ; masque photo Mercato conserve |
| tests/responsive-regression.spec.ts | Recette existante conservee et renforcee : 4 formats supplementaires, collisions ciblees, textes longs, controles apres defilement et animations, captures pleine page |
| tests/ui-smoke.spec.ts | Remplacement d'une contrainte objectivement incompatible avec le besoin : le document normal devait tenir entierement dans 768px. Le test verifie maintenant que son bas est atteignable, egalement sur mobile |
| tests/responsive-regression.spec.ts-snapshots/ | References modifiees apres revue des changements volontaires et correction de leur metadata de test ; nouvelles references 1440x900 |
| docs/responsive-stabilization.md | Audit, controles, limites et compte rendu |

Les controles de non-rognage, navigation, clavier, nombre de slides actives, contenu, presentation et metier n'ont pas ete retires. Deux executions UI de diagnostic ont ete interrompues pour corriger respectivement la contrainte de test obsolete et le defaut sticky reproduit dans le navigateur ; elles ne sont pas comptabilisees comme validations finales.

Composition, Coach, Coup d'envoi, Brief principal, Import, Guide et Administrateur ont ete controles. Leurs regles saines ont ete conservees, sans refonte inutile. Les noms longs sont testes en Composition et Terrain ; les consignes longues en Coach/briefing et Brief.

## CSS

- 21 984 -> 21 078 lignes : 906 lignes en moins.
- 3 542 -> 3 379 regles hors keyframes.
- 134 -> 125 blocs media ; 41 -> 38 conditions media distinctes.
- 78 -> 70 declarations important ; aucune ajoutee.
- Deux container queries ciblees, avec un seul conteneur inline-size sur main-area.
- Colonnes des panneaux et recompenses pilotees par la largeur reellement utilisable.
- Suppression des pistes KPI fixes et de leur ancienne hauteur normale devenue inutile.
- En mode normal : hauteurs naturelles, contenu accessible, defilement du document et navigation sticky.
- En presentation : cadre viewport conserve, acces interne aux contenus qui depassent.
- Masques decoratifs, photos et carrousels conserves ; aucune utilisation de scale sur l'application.
- Pas de nouvelle grande couche corrective en fin de fichier, pas de reformatage global.

## References et captures

- Captures viewport et pleine page produites pour les six resolutions principales.
- Revue visuelle de vues representatives sur chacune de ces six resolutions, en plus des controles geometriques.
- 21 anciennes references renouvelees, 14 conservees et 7 nouvelles references 1440x900.
- Resultat normal : hauteur naturelle et colonnes selon la largeur utile.
- Recompenses : colonnes plus lisibles et separation chiffre/libelle.
- Statistiques : hauteur naturelle et ratio natif du graphique.
- Brief normal : consignes et priorites Coach separees.
- Composition : seules les references de header/selecteurs existants et metadata ont ete rafraichies ; aucune reimplementation du terrain.
- Une reference de presentation 1536x864 reflete les nouvelles pistes KPI ; les autres references de presentation existantes sont conservees.
- Les seuils restent maxDiffPixelRatio: 0.02 et threshold: 0.2.
- Les echecs d'images sont des assertions soft strictes : ils font toujours echouer le test, mais laissent terminer les controles suivants.
- Les fixtures de textes longs modifient seulement le DOM. La date d'import est fixee dans les reponses de test ; les valeurs KPI sont conservees, sans ecriture dans les donnees sauvegardees.
- Captures de la derniere execution : test-results/responsive-regression-*/.
- Copie des artefacts de validation : /tmp/stef-responsive-review/.

## Tests finaux

| Commande | Resultat |
| --- | --- |
| pnpm lint | PASS |
| pnpm build | PASS |
| pnpm test | PASS : 3 tests + reconciliation Excel |
| pnpm test:deploy | PASS : serveur local temporaire, aucun deploiement |
| pnpm test:ui | PASS : 58 passes, 4 ignores, aucun echec (9,5 min) |
| pnpm test:ui:responsive | PASS : 2 tests, 13 formats, aucun echec (4,4 min) |
| pnpm test:pdf (controle supplementaire) | PASS : 5 tests |

Les 4 tests ignores sont les exclusions desktop-only deja presentes pour eviter de dupliquer les memes controles de polling/redimensionnement sur chaque projet. Logs des six validations finales : /tmp/stef-final-lint.log, /tmp/stef-final-build.log, /tmp/stef-final-test.log, /tmp/stef-final-deploy.log, /tmp/stef-final-ui-complete.log et /tmp/stef-final-responsive.log. Controle PDF : /tmp/stef-final-pdf.log.

## Resolutions effectivement controlees

Matrice responsive complete (normal, celebration, slides, carrousels, graphiques, Composition ; contrat supplementaire sur Coach, Terrain, Brief, ecrans secondaires et textes longs) :

1366x768, 1440x900, 1536x864, 1600x900, 1920x1080, 2560x1440,
1366x650, 1536x720, 1920x800, 1920x900, 1024x768, 1180x640, 2560x800.

Suite UI supplementaire, vues principales/intermediaires :

1536x1024, 390x844, 820x1180, 768x1024, 360x800, 320x740.

Controles supplementaires du carrousel KPI, sans pretendre a une recette de toutes les vues sur ces seuls formats :

2842x620, 2560x1000, 1920x1000, 1280x1000, 768x1000, 360x1000, 320x1000.

Les viewports reduits exercent aussi des conditions proches d'une densite/zoom augmentes. Aucun test direct du zoom du systeme d'exploitation n'est revendique.

## Donnees, metier et Git

- Comparaison SHA-256 apres la derniere suite responsive : 30 fichiers de donnees identiques a la sauvegarde initiale ; aucun ajout ni suppression.
- Aucun changement de server/, src/App.tsx, src/types.ts ou scripts/.
- Aucun changement de calcul KPI, lecture Excel, parser PDF, classement, plage horaire, API, authentification, permissions ou stockage.
- Branche fix/responsive-stabilization ; HEAD initial conserve ; aucun commit cree.
- Fichiers de travail : les fichiers CSS/tests/document cites ci-dessus et les references visuelles.
- Aucun push. Aucun deploiement. Aucun appel de modification Render.
- Apercu local : http://127.0.0.1:5189/.

## Validation humaine restante

- Verifier le confort visuel sur les PC professionnels reels, notamment les polices et le zoom/densite Windows.
- Verifier le confort du Brief/Celebration sur l'ecran de presentation reel.
- Les tests valident leurs scenarios, pas toutes les donnees futures ni tous les navigateurs.
- Validation locale terminee ; revue humaine requise avant toute autorisation distincte de mise en production.
