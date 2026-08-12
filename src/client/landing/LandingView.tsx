/**
 * La landing publique : ce que fait AimForge, **montré** plutôt que promis.
 *
 * Elle s'affiche à la place de l'application pour tout visiteur sans session
 * (cf. `requiresSession` dans `route.ts`).
 *
 * ## Ce qui a changé en V4-B, et pourquoi
 *
 * La version d'avant tenait en un écran de texte : trois cartes qui *disaient*
 * ce que fait le produit, aucune qui le montre. Quelqu'un qui arrive ici ne sait
 * pas ce qu'est une « énergie », une « sous-catégorie » ou un « bench » — et
 * demander de créer un compte pour le découvrir, c'est demander un compte à
 * quelqu'un qui n'a aucune raison d'en vouloir un.
 *
 * D'où trois principes :
 *
 * 1. **le bénéfice avant le jargon.** Chaque section dit d'abord ce qu'on y
 *    gagne, et nomme le terme ensuite, une fois qu'il désigne quelque chose ;
 * 2. **des rendus réels, pas des captures.** La synthèse du tracker et le bloc
 *    SOURCES sont les composants de l'application, nourris par la fabrique de
 *    démonstration (`demo/demo-data.ts`) : ce qui est à l'écran est calculé par
 *    le vrai moteur d'énergie, à l'instant du rendu. Une capture serait fausse
 *    au premier changement d'interface ;
 * 3. **aucun chiffre inventé.** Les valeurs citées par la routine d'exemple sont
 *    celles de la passe de démonstration affichée juste au-dessus. C'est la
 *    seule façon honnête de vanter un bloc SOURCES.
 *
 * La courbe est un SVG maison et non Recharts : la vraie courbe vit dans les
 * perfs, en chargement différé, et n'a rien à faire dans le premier
 * téléchargement d'un visiteur (cf. `demo/DemoCurve.tsx`).
 */

import { useMemo } from "react";
import { COACH_DAILY_QUOTA } from "../../shared/coach-contract";
import { ROUTINE_DAILY_QUOTA } from "../../shared/routine-contract";
import { DemoCurve } from "../demo/DemoCurve";
import {
  DEMO_BENCHMARK_ID,
  DEMO_TIER,
  demoBench,
  demoCurveLabel,
  demoRoutine,
  demoScenarioCount,
} from "../demo/demo-data";
import { LegalFooter } from "../legal/LegalFooter";
import { AUTH_ROUTE, DEMO_ROUTE, routeHash } from "../route";
import { formatDuration } from "../routine/duration";
import { RoutineSources } from "../routine/RoutineCard";
import { SummaryPanel } from "../tracker/SummaryPanel";

const AUTH_HASH = routeHash(AUTH_ROUTE);
const DEMO_HASH = routeHash(DEMO_ROUTE);

interface Module {
  readonly benefit: string;
  readonly detail: string;
  /** Le mot du métier, nommé **après** le bénéfice — jamais avant. */
  readonly jargon: string;
}

/**
 * Les trois temps du produit, dans l'ordre où on les vit : savoir où j'en suis,
 * comprendre ce qui s'est passé en partie, décider quoi faire ce soir. Le nom du
 * métier arrive en dernier, en petit : il n'apprend rien à qui découvre.
 */
const MODULES: readonly Module[] = [
  {
    benefit: "Savoir où tu en es, avec un chiffre",
    detail:
      "Tu joues des scénarios d'entraînement dans KovaaK's, tu ramènes tes scores. AimForge les compare au barème public Voltaic et en tire une note unique et un rang — plus besoin de deviner si tu progresses.",
    jargon: "On appelle ça un bench, et la note une énergie.",
  },
  {
    benefit: "Comprendre ce qui a coincé en partie",
    detail:
      "Colle tes statistiques de fin de partie : tu récupères ce qui a marché, deux ou trois axes de travail concrets, et une seule chose à garder en tête la prochaine fois.",
    jargon: "On appelle ça un debrief.",
  },
  {
    benefit: "Savoir quoi faire ce soir, précisément",
    detail:
      "Dis combien de temps tu as. La séance part de tes points faibles mesurés et de tes derniers debriefs : quels scénarios, combien de temps, dans quel ordre, et l'objectif à emporter en partie.",
    jargon: "On appelle ça la routine du jour.",
  },
];

export function LandingView() {
  // La démonstration est calculée une fois par montage : c'est le vrai moteur
  // d'énergie qui tourne, mais il n'y a aucune raison de le relancer à chaque
  // rendu de la page.
  const bench = useMemo(() => demoBench(), []);
  const routine = useMemo(() => demoRoutine(bench), [bench]);
  const scenarioCount = useMemo(demoScenarioCount, []);
  const curve = bench.history.map((run) => ({ date: run.date, overall: run.overall }));

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-steel-800">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4 sm:px-6">
          <span className="font-mono text-lg font-semibold tracking-tight text-ember-500">
            AimForge
          </span>
          <a
            href={AUTH_HASH}
            className="ml-auto rounded-lg border border-steel-700 px-3 py-2 text-xs font-semibold tracking-wide text-steel-200 uppercase transition-colors hover:border-steel-600 hover:text-steel-100"
          >
            Connexion
          </a>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl grow px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-2xl">
          <p className="text-[11px] font-medium tracking-[0.18em] text-ember-500 uppercase">
            Entraînement aim · FPS compétitifs
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-steel-100 sm:text-4xl">
            Mesure ton aim, comprends tes parties, sache quoi travailler demain.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-steel-400 sm:text-base">
            Trois outils qui partagent les mêmes données : tes scores d'entraînement disent où tu en
            es, tes stats de partie disent ce qui coince, et la séance du jour en découle.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            <a
              href={AUTH_HASH}
              className="rounded-lg bg-brand-fill px-5 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-fill-hover"
            >
              Créer un compte
            </a>
            <a
              href={DEMO_HASH}
              className="rounded-lg border border-steel-700 px-5 py-3 text-center text-sm font-medium text-steel-200 transition-colors hover:border-steel-600 hover:text-steel-100"
            >
              Voir la démo
            </a>
          </div>
          <p className="mt-3 text-xs text-steel-500">
            La démo s'ouvre sans compte : chiffres d'exemple, vrais écrans.
          </p>
        </section>

        <Section
          title="Ton niveau, mesuré — pas ressenti"
          lead="Tes scores d'entraînement deviennent une seule note, comparable d'une semaine à l'autre, et le rang qui va avec. Le barème est celui de Voltaic, public et vérifiable : AimForge n'invente aucun seuil, il applique ceux du tableur officiel."
        >
          {/* Le panneau de synthèse du tracker, sans une ligne de différence :
              c'est le composant de l'application, avec les données de démo. */}
          <SummaryPanel
            benchmarkId={DEMO_BENCHMARK_ID}
            tier={DEMO_TIER}
            computed={bench.run}
            scenarioCount={scenarioCount}
            onTierChange={() => {}}
          />
          <Caption>
            Exemple calculé en direct par le moteur d'AimForge, sur une passe du palier
            Intermediate. Sur ton compte, ce sont tes scores qui entrent ici.
          </Caption>
        </Section>

        <section className="mt-14 grid gap-4 lg:grid-cols-3">
          {MODULES.map((module, index) => (
            <article
              key={module.benefit}
              className="flex flex-col gap-2 rounded-xl border border-steel-800 bg-steel-900/60 p-5"
            >
              <span className="font-mono text-xs text-ember-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h3 className="text-base font-semibold text-steel-100">{module.benefit}</h3>
              <p className="text-sm leading-relaxed text-steel-300">{module.detail}</p>
              <p className="mt-auto pt-1 text-xs text-steel-500">{module.jargon}</p>
            </article>
          ))}
        </section>

        <Section
          title="Une séance qui part de tes chiffres"
          lead="Voltaic découpe l'aim en neuf familles de gestes — les sous-catégories. AimForge repère celles où tu traînes et bâtit la séance dessus. Et chaque chiffre avancé par le coach est confronté à tes données avant de s'afficher : ce qui n'est pas vérifié n'est pas écrit."
        >
          <RoutineExcerpt routine={routine} />
          <Caption>
            Chaque chiffre cité est vérifié contre tes données — le bloc SOURCES le prouve. Ceux-ci
            sont ceux de la passe d'exemple ci-dessus.
          </Caption>
        </Section>

        <Section
          title="Voir si la semaine a servi à quelque chose"
          lead="Chaque passe enregistrée ajoute un point. L'écart avec la précédente s'affiche à côté de ta note : une faiblesse qui progresse et une faiblesse qui stagne ne demandent pas le même entraînement."
        >
          <div className="rounded-xl border border-steel-800 bg-steel-900/60 p-5">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
                Progression
              </h3>
              <ExampleTag />
            </div>
            <div className="mt-4">
              <DemoCurve points={curve} label={demoCurveLabel(bench)} />
            </div>
          </div>
        </Section>

        <Section
          title="Gratuit pendant la bêta"
          lead="Pas de carte bancaire, pas de période d'essai qui se referme."
        >
          <div className="rounded-xl border border-steel-800 bg-steel-900/60 p-5">
            <p className="font-mono text-2xl font-semibold tracking-tight text-steel-100">
              0 €{" "}
              <span className="font-sans text-sm font-normal text-steel-400">pendant la bêta</span>
            </p>
            <ul className="mt-4 flex flex-col gap-2 text-sm text-steel-300">
              <li>Saisie des scores, historique et courbe : sans limite.</li>
              <li>
                Analyses par IA : {ROUTINE_DAILY_QUOTA} routines et {COACH_DAILY_QUOTA} debriefs par
                jour.
              </li>
              <li>Ta propre clé d'API si tu en as une : le plafond ne te concerne plus.</li>
            </ul>
            <a
              href={AUTH_HASH}
              className="mt-5 inline-block rounded-lg bg-brand-fill px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-brand-fill-hover"
            >
              Créer un compte
            </a>
          </div>
        </Section>

        <p className="mt-12 text-xs text-steel-500">
          Tes données t'appartiennent : chaque compte ne lit et n'écrit que ses propres lignes.
        </p>
      </main>

      {/* Les trois documents sont accessibles sans compte : c'est ici, avant
          l'inscription, qu'on doit pouvoir les lire. */}
      <LegalFooter />
    </div>
  );
}

interface SectionProps {
  readonly title: string;
  /** La phrase de bénéfice, avant tout jargon et avant tout visuel. */
  readonly lead: string;
  readonly children: React.ReactNode;
}

/** Un temps de la page : un titre, une promesse, puis la preuve. */
function Section({ title, lead, children }: SectionProps) {
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold tracking-tight text-steel-100 sm:text-2xl">{title}</h2>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-steel-400">{lead}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}

function Caption({ children }: { readonly children: React.ReactNode }) {
  return <p className="mt-3 text-xs leading-relaxed text-steel-500">{children}</p>;
}

/** L'étiquette qui empêche de lire un exemple comme une mesure. */
function ExampleTag() {
  return (
    <span className="shrink-0 rounded-full border border-steel-700 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-steel-400 uppercase">
      Exemple
    </span>
  );
}

/**
 * L'extrait de routine : la structure réelle d'une séance (titre, blocs minutés,
 * exercices, objectif en game) et son bloc SOURCES.
 *
 * C'est un **extrait**, pas la carte de l'application : celle-ci porte des cases
 * à cocher, un bouton « marquer comme faite » et une suppression — des gestes
 * qui n'ont aucun sens sur une page publique, et qui feraient de la
 * démonstration un piège à clics. Le bloc SOURCES, lui, est le composant réel
 * (`RoutineSources`) : c'est lui que la section promet de montrer.
 */
function RoutineExcerpt({ routine }: { readonly routine: ReturnType<typeof demoRoutine> }) {
  return (
    <article className="rounded-xl border border-steel-800 bg-steel-900/60 p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold text-steel-100">{routine.titre}</h3>
        <ExampleTag />
      </div>
      <p className="mt-1 font-mono text-xs tabular-nums text-steel-500">
        {formatDuration(routine.duree_totale)}
      </p>

      <ol className="mt-4 flex flex-col gap-3">
        {routine.blocs.map((bloc, index) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, deux blocs peuvent partager un nom — l'index évite la collision de clés.
            key={`${index}-${bloc.nom}`}
            className="rounded-lg bg-steel-950/60 px-3 py-3"
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-sm font-semibold text-steel-200">{bloc.nom}</p>
              <p className="shrink-0 font-mono text-xs tabular-nums text-steel-500">
                {formatDuration(bloc.duree)}
              </p>
            </div>
            <ul className="mt-2 flex flex-col gap-1">
              {bloc.items.map((item, itemIndex) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, deux exercices peuvent partager un texte — la position (bloc, item) est la seule clé sans collision, comme dans `RoutineCard`.
                  key={`${index}-${itemIndex}`}
                  className="text-xs leading-relaxed text-steel-400"
                >
                  {item.texte}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      <p className="mt-4 rounded-lg border border-ember-600/40 bg-ember-600/10 px-3 py-2.5 text-sm leading-relaxed text-ember-300">
        {routine.objectif_game}
      </p>

      <RoutineSources sources={routine.sources ?? []} />
    </article>
  );
}
