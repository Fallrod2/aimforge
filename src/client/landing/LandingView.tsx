/**
 * Landing publique : ce que fait AimForge, en trois blocs, et une porte
 * d'entrée. Rien d'autre — c'est un vestibule, pas une page marketing.
 *
 * Elle s'affiche à la place de l'application pour tout visiteur sans session
 * (cf. `requiresSession` dans `route.ts`).
 */

import { AUTH_ROUTE, routeHash } from "../route";

const AUTH_HASH = routeHash(AUTH_ROUTE);

interface Module {
  readonly title: string;
  readonly pitch: string;
  readonly detail: string;
}

const MODULES: readonly Module[] = [
  {
    title: "Tracker Voltaic",
    pitch: "Tes 18 scénarios S5, l'énergie calculée en direct.",
    detail:
      "Seuils officiels du barème Voltaic Season 5 : énergie par scénario, par sous-catégorie, overall, rang atteint et badge Complete. Historique et courbe de progression.",
  },
  {
    title: "Coach post-game",
    pitch: "Colle tes stats de partie, récupère un debrief structuré.",
    detail:
      "Ce qui a marché, les axes de travail concrets, un focus pour la prochaine session. Pas de baratin : des points actionnables.",
  },
  {
    title: "Routine du jour",
    pitch: "Une session ciblée, générée sur tes vraies faiblesses.",
    detail:
      "Le temps dont tu disposes, les sous-catégories basses de ton dernier bench et les axes de tes derniers debriefs donnent la routine à faire aujourd'hui.",
  },
];

export function LandingView() {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-steel-800">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
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

      <main className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <section className="max-w-2xl">
          <p className="text-[11px] font-medium tracking-[0.18em] text-ember-500 uppercase">
            Entraînement Valorant · Voltaic S5
          </p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-steel-100 sm:text-4xl">
            Mesure ton aim, comprends tes parties, sache quoi travailler demain.
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-steel-400 sm:text-base">
            Trois outils qui partagent les mêmes données : le bench dit où tu en es, les debriefs
            disent ce qui coince en partie, la routine du jour en tire la séance à faire.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a
              href={AUTH_HASH}
              className="rounded-lg bg-ember-600 px-5 py-3 text-sm font-semibold text-steel-100 transition-colors hover:bg-ember-500"
            >
              Créer un compte
            </a>
            <a
              href={AUTH_HASH}
              className="rounded-lg border border-steel-700 px-5 py-3 text-sm font-medium text-steel-200 transition-colors hover:border-steel-600 hover:text-steel-100"
            >
              J'ai déjà un compte
            </a>
          </div>
        </section>

        <section className="mt-14 grid gap-4 lg:grid-cols-3">
          {MODULES.map((module, index) => (
            <article
              key={module.title}
              className="flex flex-col gap-2 rounded-xl border border-steel-800 bg-steel-900/60 p-5"
            >
              <span className="font-mono text-xs text-ember-500">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2 className="text-base font-semibold text-steel-100">{module.title}</h2>
              <p className="text-sm text-steel-300">{module.pitch}</p>
              <p className="text-xs leading-relaxed text-steel-500">{module.detail}</p>
            </article>
          ))}
        </section>

        <p className="mt-12 text-xs text-steel-600">
          Tes données t'appartiennent : chaque compte ne lit et n'écrit que ses propres lignes.
        </p>
      </main>
    </div>
  );
}
