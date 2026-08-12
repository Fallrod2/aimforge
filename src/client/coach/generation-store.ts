/**
 * Une génération IA en cours, **au-dessus de la vue** (V4-C §4.9).
 *
 * ## Le problème, tel qu'il se vit
 *
 * Une routine met une quinzaine de secondes à venir. Tant que l'état de la
 * génération vivait dans un `useState` de `RoutinePanel`, ces quinze secondes
 * étaient une assignation à résidence : ouvrir Perfs démontait la vue, donc
 * perdait l'attente — et le résultat arrivait dans le vide, alors même que la
 * fonction serverless, elle, allait au bout et écrivait la routine en base. Le
 * joueur payait son quota pour un écran qui avait oublié sa demande.
 *
 * ## La forme retenue : un magasin de module, pas un provider
 *
 * L'état vit ici, dans un module, et les vues s'y abonnent par
 * `useSyncExternalStore`. C'est le même principe que le provider du benchmark
 * actif (`../app/active-benchmark.tsx`) — un état au-dessus des vues — sans son
 * coût : rien à monter dans `App.tsx`, donc rien qui dépende de l'endroit où le
 * composant se trouve dans l'arbre. Un magasin de module survit au démontage
 * par construction, là où un contexte n'y survit que si son provider est monté
 * assez haut.
 *
 * ## Le cycle, et pourquoi il a quatre états et non trois
 *
 * `idle → running → done | failed`, puis retour à `idle` par `settle()`.
 *
 * `done` est un état à part entière parce que **le résultat attend d'être
 * relevé** : la vue qui revient le consomme (elle l'insère dans sa liste, ouvre
 * la carte, met à jour le quota) puis appelle `settle()`. Sans cet état, un
 * résultat arrivé pendant qu'on regardait ailleurs serait perdu.
 *
 * `failed` garde la **demande**, et c'est tout l'intérêt : « Réessayer » rejoue
 * exactement les mêmes réglages, sans re-saisie.
 *
 * ## Ce que le magasin ne fait pas
 *
 * Il n'annule pas la requête HTTP en cours et n'en lance jamais deux à la fois :
 * un appel au modèle est décompté du quota, il ne se double pas par accident.
 * `reset()` abandonne le *résultat* d'une génération en vol (jeton périmé), pas
 * la génération elle-même — la fonction serverless ira au bout et écrira ce
 * qu'elle avait à écrire, ce qui est précisément le comportement voulu : rien
 * n'est perdu, la vue le retrouvera à son prochain chargement.
 */

import { useSyncExternalStore } from "react";

/** Ce qu'un échec laisse à l'écran, déjà rédigé pour être affiché tel quel. */
export interface GenerationFailure {
  /** Le message du serveur quand il en a donné un — c'est lui qu'on affiche. */
  readonly message: string;
  /** Quota du jour épuisé : ce n'est pas une panne, et réessayer n'y changerait rien. */
  readonly quota: boolean;
  /** Le restant annoncé par le serveur (après remboursement), ou `null`. */
  readonly remaining: number | null;
}

export type GenerationState<Req, Res> =
  | { readonly status: "idle" }
  | { readonly status: "running"; readonly request: Req; readonly startedAt: number }
  | { readonly status: "done"; readonly request: Req; readonly result: Res }
  | { readonly status: "failed"; readonly request: Req; readonly failure: GenerationFailure };

export interface GenerationStore<Req, Res> {
  /** L'instantané courant. Stable en identité tant que rien ne change. */
  readonly getSnapshot: () => GenerationState<Req, Res>;
  readonly subscribe: (listener: () => void) => () => void;
  /** Lance une génération. Sans effet si une autre est déjà en vol. */
  readonly start: (request: Req) => void;
  /** Rejoue la demande qui a échoué. Sans effet dans les autres états. */
  readonly retry: () => void;
  /** Le résultat (ou l'échec) a été pris en charge par la vue : place nette. */
  readonly settle: () => void;
  /** Abandonne l'attente et le résultat à venir. La requête, elle, va au bout. */
  readonly reset: () => void;
}

export interface GenerationDeps<Req, Res> {
  readonly run: (request: Req) => Promise<Res>;
  /** Traduit une exception en phrase affichable — la vue n'interprète rien. */
  readonly failureOf: (cause: unknown) => GenerationFailure;
  /** L'horloge, injectée pour les tests. */
  readonly now?: () => number;
}

const IDLE = { status: "idle" } as const;

export function createGenerationStore<Req, Res>(
  deps: GenerationDeps<Req, Res>,
): GenerationStore<Req, Res> {
  const clock = deps.now ?? Date.now;
  const listeners = new Set<() => void>();
  let state: GenerationState<Req, Res> = IDLE;
  /**
   * Le jeton de la génération en vol. Il périme à chaque `start` et à chaque
   * `reset` : une réponse tardive dont le jeton n'est plus le bon est jetée,
   * plutôt que d'écraser ce que l'écran affiche depuis.
   */
  let token = 0;

  function publish(next: GenerationState<Req, Res>): void {
    state = next;
    for (const listener of listeners) listener();
  }

  function launch(request: Req): void {
    token += 1;
    const mine = token;

    publish({ status: "running", request, startedAt: clock() });
    deps.run(request).then(
      (result) => {
        if (mine === token) publish({ status: "done", request, result });
      },
      (cause: unknown) => {
        if (mine === token) publish({ status: "failed", request, failure: deps.failureOf(cause) });
      },
    );
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: (request) => {
      if (state.status === "running") return;
      launch(request);
    },
    retry: () => {
      if (state.status !== "failed") return;
      launch(state.request);
    },
    settle: () => {
      // Une génération en cours n'est pas « réglée » : un rendu maladroit
      // effacerait l'attente qu'il est en train d'afficher.
      if (state.status === "running" || state.status === "idle") return;
      publish(IDLE);
    },
    reset: () => {
      token += 1;
      if (state.status !== "idle") publish(IDLE);
    },
  };
}

/** L'état d'une génération, abonné pour la durée de vie du composant. */
export function useGeneration<Req, Res>(
  store: GenerationStore<Req, Res>,
): GenerationState<Req, Res> {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

/**
 * Une liste déjà chargée, avec l'élément généré remis à sa place.
 *
 * Le doublon n'est pas théorique et vient précisément de ce module : la
 * génération se termine pendant qu'on est sur un autre écran, on revient, la
 * vue **recharge** sa liste depuis la base — qui contient déjà l'élément — puis
 * relève le résultat du magasin. Sans déduplication sur l'identifiant de la
 * base, la même routine s'afficherait deux fois.
 */
export function upsertById<T extends { readonly id: number }>(
  list: readonly T[],
  item: T,
): readonly T[] {
  const known = list.some((entry) => entry.id === item.id);

  if (!known) return [item, ...list];
  return list.map((entry) => (entry.id === item.id ? item : entry));
}
