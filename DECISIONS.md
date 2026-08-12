# Décisions — chantier multi-benchmarks (2026-08-12)

Journal des arbitrages pris pendant le chantier, avec leur raison. Chaque entrée : contexte → décision → pourquoi.

## D1 — Branche de travail : `nuit-2026-08-12`, pas de push sur `main`
`main` déclenche le déploiement Vercel en production. Tout le travail du chantier
vit sur `nuit-2026-08-12` (créée depuis `phase-0-setup`), commits atomiques, à
relire puis merger. La migration DB est appliquée en mode expand/contract pour
que la production déployée continue de fonctionner d'ici là (voir D2).

## D2 — `benchmark_id` = généralisation de `season`, pas une colonne à côté
`bench_runs.season` (`voltaic-s5`) identifie déjà *le jeu de données qui relit la
passe* — c'est exactement la sémantique demandée pour `benchmark_id` (un
benchmark versionné : `voltaic-s5`, `viscose-…`). Deux colonnes porteraient la
même vérité et divergeraient. Décision : renommer `season` → `benchmark_id` (le
rename préserve les données, l'historique reste rattaché à `voltaic-s5`), et le
registre code passe de « saisons Voltaic » à « benchmarks » avec formule
d'énergie branchable. `palier` existe déjà (`bench_runs.tier`).

## D3 — Qualification des scénarios : par la passe, pas par une colonne dupliquée
`scenario_scores` est lié à `bench_runs` par `run_id`, et la passe porte
`benchmark_id` : un scénario homonyme entre deux benchmarks est donc déjà
désambiguïsé par jointure. Ajouter une colonne `benchmark_id` sur
`scenario_scores` dupliquerait une vérité et pourrait diverger de la passe
parente. Décision : pas de colonne dupliquée ; les requêtes « meilleur score par
scénario » joignent `bench_runs` (l'index existant `scenario_scores_run` +
`bench_runs_user_season_date` suffisent à l'échelle mono-utilisateur actuelle).

## D4 — Le registre de benchmarks est l'évolution du registre de saisons
`src/lib/energy/seasons.ts` fait déjà tout ce que demande le registre cible
(identifiant → jeu de données complet, verrou de relecture, résolution
qualifiée). On le généralise en registre de **benchmarks** (`benchmarks.ts`) au
lieu de construire un second système à côté : `SeasonDefinition` devient
`BenchmarkDefinition` avec les métadonnées produit (nom, éditeur, statut
stable/beta/incomplet, source, date de version, aim trainer) et une
`energyFormula` branchable. Le cœur mathématique Voltaic (`energy.ts`, audité)
n'est PAS réécrit : il devient l'implémentation de la formule `voltaic-anchors`,
sélectionnée par le registre.

## D5 — `TierId` cesse d'être une union fermée
`"novice" | "intermediate" | "advanced"` est une structure Voltaic. Un autre
benchmark peut avoir d'autres paliers (ou un seul). `TierId` devient un string
validé contre les paliers du benchmark de la passe — même patron que
`toSeasonId`. La contrainte SQL `tier in (...)` est relâchée en conséquence
(migration), les valeurs existantes restent valides.

## D6 — Sélection du benchmark actif : colonne `profiles.active_benchmark`
Le benchmark actif est une préférence durable de l'utilisateur (le tracker,
l'historique, le coach la suivent) : elle vit dans `profiles`, pas dans le
localStorage (elle doit suivre l'utilisateur d'un appareil à l'autre et être
lisible par les endpoints serveur pour le contexte du coach). Défaut :
`voltaic-s5`. Même migration pour `profiles.game` (vocabulaire, D7).

## D7 — Couche jeu = vocabulaire uniquement
`profiles.game` (valorant | cs2 | apex | overwatch | autre) pilote : les
libellés/placeholders du profil (« agent principal » → « perso/rôle »), la
phrase d'identité des 5 prompts système et le vocabulaire in-game qu'ils
emploient. Aucune logique, aucun écran par jeu. Les stats Riot/Valorant ne
s'affichent que si un compte Riot est lié, indépendamment du champ.

## D8 — Viscose : intégré en `incomplete`, masqué, données vérifiées versionnées
Les seuils Viscose S2/Entry/S1 sont complets et vérifiés (API officielle
KovaaK's `player-progress-rank-benchmark`, recoupée avec le spreadsheet S1),
mais la formule officielle d'agrégation du rang global n'est documentée nulle
part (l'« énergie » d'evxl est la logique de leur tracker, pas celle de
Viscose). Règle d'honnêteté : pas de formule inventée → l'entrée existe dans le
registre en `status: 'incomplete'` (donc invisible dans l'UI), avec les seuils
vérifiés versionnés et un TODO listant ce qui manque (formule officielle, noms
des groupes S2, resynchronisation des seuils susceptibles d'équilibrage).

## D10 — Vague 2 : trois arbitrages de navigation entérinés
1. Les tendances/ventilations/pont bench↔in-game Valorant ne sont PAS supprimés
   avec l'onglet : ils vivent derrière un repli en pied de la carte Valorant de
   l'Accueil (1 clic, chunk différé). « Rang + parties récentes » au sens strict
   aurait jeté des écrans qui marchent — contraire au principe 5.
2. Générer une SECONDE routine le même jour coûte 3 clics, volontairement : un
   appel modèle payant ne doit pas être à portée de double-clic quand une séance
   existe déjà. La première du jour reste à 2 clics.
3. L'invitation « lier un Riot ID » quitte l'Accueil (le bloc Valorant n'y
   apparaît que si un compte est lié) ; elle reste au Profil.

## D11 — Modèle IA de la plateforme : la cause racine des fautes de français
La config de production (table platform_settings) sert les utilisateurs
plateforme via OpenRouter avec `deepseek/deepseek-v4-flash-0731` — un petit
modèle rapide. Les fautes de structure capturées en prod viennent très
probablement de lui, pas seulement des prompts. Décision : mesurer le taux de
fautes sur le VRAI chemin (harnais QA pointé sur OpenRouter/DeepSeek), durcir
les prompts, et si le taux ne tombe pas à zéro sur 20 générations, documenter
le taux résiduel et recommander un changement de modèle plateforme (décision
de coût qui appartient à Alex) plutôt que de le changer en douce.

## D12 — Incident : compte de test QA et colonnes NULL de GoTrue (résolu)
Pour vérifier visuellement les écrans authentifiés, un compte de test
(`ui-test@aimforge.local`, isolé par RLS) a été créé par INSERT direct dans
`auth.users`. GoTrue exige des chaînes vides (pas NULL) dans ses colonnes de
tokens : le login de CE compte renvoyait 500 « Database error querying schema ».
Impact confiné à la ligne de test (le login interroge la ligne de l'email
demandé) ; les trois comptes réels vérifiés sains avant et après. Correctif
appliqué (coalesce → ''), login re-testé : 200. Le compte de test sera supprimé
en fin de chantier. Leçon consignée : ne jamais créer d'utilisateur GoTrue par
INSERT partiel — passer par l'API admin ou renseigner toutes les colonnes texte.

## D13 — Attente IA : pas de SSE, une attente honnête
Les sorties IA sont du JSON validé côté serveur (police anti-hallucination,
relance corrective, garde-fou de français) : streamer les jetons exposerait du
texte non validé et casserait la relance. Décision : pas de SSE — à la place,
génération portée par un état global (l'app reste navigable, le résultat
atterrit où qu'on soit), squelette progressif honnête avec temps écoulé, erreur
avec « Réessayer », et alignement des timeouts client/serveur/maxDuration.

## D14 — Énergie partielle : affichage provisoire, moteur intact
« Énergie partielle sur N/9 sous-catégories » = moyenne harmonique des seules
sous-catégories complètes, fonction pure séparée, jamais persistée, toujours
étiquetée « partiel », aucun rang dérivé. L'overall officiel (0 si bench
incomplet) ne change pas — c'est la règle du benchmark, pas un bug.

## D15 — Objectif de rang : préférence locale (localStorage)
Le rang cible par benchmark+palier vit en localStorage : pas de migration pour
une préférence d'affichage à un seul appareil ; à promouvoir en base si le
besoin multi-appareil se confirme. Commenté dans le code.

## D16 — Démo publique sans compte : le vrai moteur, des données d'exemple
`#/demo` rend les composants réels du dashboard alimentés par une fabrique de
données posées sur des ancres réelles du registre (aucun seuil inventé, tests
qui recalculent l'affiché par le moteur). Bandeau « les chiffres sont un
exemple », aucun appel réseau, pas de faux coach ni de fausses conversations.
La landing rend les mêmes composants en visuels vivants plutôt que des
captures figées : impossible à désynchroniser du produit.

## D17 — SEO : redirections d'URLs propres maintenant, routing history différé
Basculer tout le routeur en history (`/perfs` au lieu de `/#/perfs`) en fin de
run autonome, juste après une refonte de navigation fraîchement testée, est le
genre de changement large qui mérite une session dédiée avec vérification
humaine. Fait cette nuit : robots.txt, sitemap.xml, page 404, et des
redirections Vercel `/perfs` → `/#/perfs` (URLs propres partageables — 90 % de
la valeur pour 5 % du risque). Différés avec ce raisonnement : routing history
complet + prerender/SSG de la landing (le `<head>` OG/description est déjà
statique dans index.html, les crawlers modernes exécutent le JS — la perte
SEO immédiate est faible).

## D9 — Piège d'outillage : gabarit d'environnement masqué par le sandbox
Le sandbox de la session refuse la lecture des fichiers d'environnement à la
racine : git voit alors le gabarit d'exemple comme « supprimé » alors qu'il
existe sur disque (vérifié par listage du répertoire). Conséquence : ne JAMAIS
`git add -A` à la racine pendant ces sessions (la fausse suppression serait
commitée) ; tous les adds sont scopés par chemin. Fausse alerte de revue
classée, fichier intact.
