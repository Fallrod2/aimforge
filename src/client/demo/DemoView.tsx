/**
 * La démonstration publique : l'application, avec des données d'exemple.
 *
 * Trois règles, et elles tiennent la page entière :
 *
 * 1. **aucune requête.** Pas de Supabase, pas de fonction serverless, pas de
 *    modèle. Tout ce qui s'affiche est calculé dans le navigateur par le vrai
 *    moteur d'énergie, à partir de scores posés sur des ancres du registre
 *    (`demo-data.ts`). Une démo qui lirait quelque chose finirait par exiger un
 *    compte, et ce serait exactement ce qu'elle prétend éviter ;
 * 2. **les vrais composants.** La carte du dernier bench, les sous-catégories
 *    les plus faibles, la synthèse du tracker avec sa jauge : ce sont ceux de
 *    l'application, nourris autrement. Des captures d'écran mentiraient dès la
 *    première évolution de l'interface, et une copie des composants mentirait
 *    plus tôt encore ;
 * 3. **rien qui n'existe pas.** Pas de bloc Valorant (il faut un compte lié),
 *    pas de conversation de coach et pas de debrief : inventer une réponse de
 *    modèle serait montrer un produit qu'on ne vend pas.
 *
 * La page est **la même pour tout le monde**, connecté ou non (cf. `App.tsx`) :
 * elle ne dépend d'aucune session, donc elle n'a pas à savoir s'il y en a une.
 */

import { useMemo } from "react";
import { Card, LastBench, Weaknesses } from "../dashboard/DashboardView";
import { LegalFooter } from "../legal/LegalFooter";
import { AUTH_ROUTE, DEFAULT_ROUTE, routeHash } from "../route";
import { SummaryPanel } from "../tracker/SummaryPanel";
import { DemoCurve } from "./DemoCurve";
import {
  DEMO_BENCHMARK_ID,
  DEMO_TIER,
  demoBench,
  demoCurveLabel,
  demoScenarioCount,
} from "./demo-data";

const AUTH_HASH = routeHash(AUTH_ROUTE);
/** Sans session, la route par défaut affiche la landing (cf. `App.tsx`). */
const HOME_HASH = routeHash(DEFAULT_ROUTE);

export function DemoView() {
  // Les six passes sont datées par rapport à « maintenant » : on fige l'instant
  // une fois par montage, faute de quoi un re-rendu recalculerait des dates
  // légèrement différentes à chaque fois.
  const bench = useMemo(() => demoBench(), []);
  const scenarioCount = useMemo(demoScenarioCount, []);
  const curve = bench.history.map((run) => ({ date: run.date, overall: run.overall }));
  const ready = { status: "ready", run: bench.run, previous: bench.previous } as const;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-steel-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <a
            href={HOME_HASH}
            className="font-mono text-lg font-semibold tracking-tight text-ember-500"
          >
            AimForge
          </a>
          <a
            href={AUTH_HASH}
            className="ml-auto rounded-lg border border-steel-700 px-3 py-2 text-xs font-semibold tracking-wide text-steel-200 uppercase transition-colors hover:border-steel-600 hover:text-steel-100"
          >
            Connexion
          </a>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-5xl grow flex-col gap-6 px-4 py-6 sm:px-6 sm:py-10">
        <DemoBanner />

        <div>
          <h1 className="text-lg font-semibold text-steel-100">Tableau de bord</h1>
          <p className="mt-0.5 text-xs leading-relaxed text-steel-500">
            Ce que tu vois est calculé en direct par le moteur d'AimForge, sur une passe d'exemple :
            les mêmes seuils, les mêmes formules, les mêmes écrans qu'avec tes propres scores.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Dernier bench">
            <LastBench bench={ready} kovaaksLinked onRetry={() => {}} />
          </Card>

          <Card title="Sous-catégories les plus faibles">
            <Weaknesses bench={ready} />
          </Card>

          <div className="lg:col-span-2">
            {/* La synthèse du tracker, telle quelle : c'est elle qui porte la
                jauge d'énergie et l'écart au rang suivant. */}
            <SummaryPanel
              benchmarkId={DEMO_BENCHMARK_ID}
              tier={DEMO_TIER}
              computed={bench.run}
              scenarioCount={scenarioCount}
              onTierChange={() => {}}
            />
          </div>

          <div className="lg:col-span-2">
            <Card title="Progression">
              <DemoCurve points={curve} label={demoCurveLabel(bench)} />
              <p className="text-xs leading-relaxed text-steel-500">
                Six semaines d'exemple. Sur ton compte, chaque passe enregistrée ajoute un point —
                et l'écart avec la précédente s'affiche à côté de ton énergie.
              </p>
            </Card>
          </div>
        </div>

        <p className="text-xs leading-relaxed text-steel-500">
          La démo ne montre ni tes parties Valorant ni le coach : les deux dépendent de tes propres
          données, et un exemple de réponse d'IA n'en serait pas un.
        </p>
      </main>

      <LegalFooter />
    </div>
  );
}

/**
 * Le bandeau de démonstration : discret, mais jamais absent.
 *
 * Il est en tête de page et non en pied, et il le dit en une phrase : ces
 * chiffres sont un exemple. Une démo qui ne se signale pas est une capture
 * d'écran déguisée en tableau de bord.
 */
function DemoBanner() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-ember-600/40 bg-ember-600/10 px-4 py-3 sm:flex-row sm:items-center">
      <p className="text-xs leading-relaxed text-ember-200">
        <span className="font-semibold uppercase">Démo</span> — les chiffres sont un exemple. Crée
        un compte pour suivre les tiens.
      </p>
      <a
        href={AUTH_HASH}
        className="shrink-0 rounded-lg bg-brand-fill px-4 py-2 text-center text-xs font-semibold text-white transition-colors hover:bg-brand-fill-hover sm:ml-auto"
      >
        Créer un compte
      </a>
    </div>
  );
}
