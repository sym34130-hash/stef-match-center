# P1 — Contrat de validation CI de STEF Match Center (10 novembre 2026)

## Principes
La CI ne doit **jamais** obtenir un résultat vert par absence silencieuse de
fichier de test, ni dépendre d'un export réel de l'agence 058 ou d'un accès à
Render. Les contrôles de production restent en lecture seule. La CI tourne sur
un runner GitHub vierge et sur un répertoire temporaire indépendant.

## Bloquants automatiques à chaque PR vers main et push sur main
1. `Validate data integrity and imports` : lint, compilation, tests d'intégrité,
   API d'import et de confirmation, navigateurs ciblés et KPI.
2. `Validate production Docker image` : image Docker et smoke HTTP.
3. `P1 — Recette obligatoire autonome` :
   - 7 suites de tests API, PDF, contrôle des révisions, sécurité, 106J et erreur de saisie ;
   - 20 PDF synthétiques (4 ligues × 5 graphiques) et rapport JSON comprenant les
     comparaisons source/PDF ; aucune affirmation de certification des agences réelles ;
   - Playwright Chromium sous trois viewports, avec trois agences synthétiques
     058 / 059 / 060, chacune avec son propre mot de passe de **test** ;
   - génération en mémoire d'un Excel fictif, import réel HTTP, lecture/écriture
     du brief et de la personnalisation PDF, exports à 4 et 6 KPI,
     séparation des accès et lecture de l'interface.
4. `Lot E PDF visual audit` conserve les artefacts de revue visuelle à la demande
   ou quand les sources du rendu changent.

## Tests historiques réservés à la recette avec fichiers privés
Les fichiers `data/agencies/058/latest.xlsx` et `latest.json` ne sont pas
dans GitHub ; plusieurs scripts `reconcile-import`, `import-contract` et
le Playwright historique `playwright.config.ts` y font référence.
Ils ne sont **pas** déclarés réussis par la CI autonome. Pour exécuter
la recette intégrale de ce jeu de référence, fournir les sources originales
dans un environnement de test fermé, puis lancer `pnpm test` et
`pnpm test:ui` sans modifier une instance de production.
Les tests synthétiques obligatoires n'en constituent pas un remplacement métier.

## Défauts connus en dehors du lot P1
- P2 : minuit peut être imprimé `00 hh` dans un graphique de réception.
  Une assertion tolère temporairement l'ancien et le bon format sans
  neutraliser le contrôle des volumes/cibles/ligues. À fermer dans le lot P2.
- P2 : origine Excel inconnue : pied de page PDF à corriger pour indiquer
  « origine indéterminée » plutôt que supposer une agence.

## Limites des garanties
Une CI verte ne prouve pas l'absence totale de bugs ni la concordance avec
tous les fichiers Excel et 106J des agences. Elle garantit que les scénarios
explicitement exécutés ont réussi sur leur jeu de données annoncé.

La restauration de code de référence est la branche
`backup/pre-p1-ci-2026-11-10`. Le stockage Render Free reste éphémère ;
son comportement est accepté, et aucun test CI ne s'appuie dessus.
