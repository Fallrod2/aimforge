/**
 * Le benchmark **actif** de l'utilisateur, pour toute l'application authentifiée
 * (DECISIONS.md D6).
 *
 * Pourquoi un provider plutôt qu'une lecture par écran : le benchmark actif est
 * une préférence durable (`profiles.active_benchmark`), et trois écrans au moins
 * en dépendent en même temps — le tracker y saisit, l'historique y filtre, le
 * profil le change. Une lecture par écran ferait trois requêtes et, surtout,
 * laisserait un écran affiché sur l'ancien benchmark après un changement fait
 * sur un autre.
 *
 * **Le point qui n'est pas évident : la lib d'énergie a son propre pointeur.**
 * `src/lib/energy` sert deux surfaces (cf. son `index.ts`) — les fonctions
 * `…For(benchmarkId, …)`, qui nomment leur benchmark, et les fonctions sans
 * benchmark, qui parlent du « présent » et résolvent le *benchmark courant* du
 * module. Tout ce qui se rapporte au présent passe par les secondes : la saisie
 * du tracker (`computeBenchRun`, `listScenarios`), l'aperçu live, les rails
 * d'énergie (`energy-view.ts`), les libellés de scénarios (`format.ts`), la
 * saisie par palier (`draft.ts`). Aucune de ces fonctions n'est un composant :
 * elles ne peuvent pas lire un contexte React. Le provider aligne donc le
 * pointeur de la lib (`syncCurrentBenchmark`) **avant** de publier le nouvel
 * état, pour qu'aucun rendu ne voie un écran sur un benchmark et un calcul sur
 * un autre.
 *
 * Le changement est **optimiste** : l'écran suit tout de suite, l'écriture part
 * derrière, et un échec remet l'ancien benchmark plutôt que de laisser croire
 * qu'une préférence est enregistrée alors qu'elle ne l'est pas.
 */

import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import {
  type BenchmarkDefinition,
  type BenchmarkId,
  DEFAULT_BENCHMARK_ID,
  getBenchmark,
  syncCurrentBenchmark,
} from "../../lib/energy";
import { getActiveBenchmark, setActiveBenchmark } from "../data";

export interface ActiveBenchmark {
  readonly benchmarkId: BenchmarkId;
  /** La définition du benchmark actif : nom, éditeur, statut, date de version. */
  readonly benchmark: BenchmarkDefinition;
  /** Change le benchmark actif : contexte d'abord, base ensuite. */
  readonly setBenchmarkId: (next: BenchmarkId) => void;
  /** Une écriture est en vol : le sélecteur se désactive le temps qu'elle passe. */
  readonly saving: boolean;
  /** Le dernier échec d'écriture, à afficher à côté du sélecteur. */
  readonly error: string | null;
}

/**
 * Le contexte par défaut, pour un arbre monté sans provider.
 *
 * Il rend le benchmark par défaut plutôt que de lever : la valeur par défaut est
 * exactement ce que la lib a déjà en tête, donc un composant testé hors provider
 * se comporte comme un utilisateur qui n'a rien changé. `setBenchmarkId` n'y
 * fait rien — il n'y a pas de base derrière.
 */
const FALLBACK: ActiveBenchmark = {
  benchmarkId: DEFAULT_BENCHMARK_ID,
  benchmark: getBenchmark(DEFAULT_BENCHMARK_ID),
  setBenchmarkId: () => {},
  saving: false,
  error: null,
};

const ActiveBenchmarkContext = createContext<ActiveBenchmark>(FALLBACK);

const SAVE_FAILED = "Le benchmark n'a pas pu être changé : la préférence n'est pas enregistrée.";

/**
 * Aligne le pointeur de la lib puis rend l'identifiant.
 *
 * Extrait pour être appelé aux deux endroits qui changent le benchmark actif —
 * le chargement du profil et le sélecteur — sans que l'un des deux puisse
 * oublier l'alignement.
 */
export function adoptBenchmark(benchmarkId: BenchmarkId): BenchmarkId {
  syncCurrentBenchmark(benchmarkId);
  return benchmarkId;
}

export function ActiveBenchmarkProvider({ children }: { readonly children: ReactNode }) {
  const [benchmarkId, setState] = useState<BenchmarkId>(DEFAULT_BENCHMARK_ID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Le benchmark actif est lu une fois, à l'ouverture de session. Un échec de
  // lecture n'est pas une panne d'écran : on reste sur le benchmark par défaut,
  // qui est celui de la colonne, et l'utilisateur peut toujours en changer.
  useEffect(() => {
    let alive = true;

    void getActiveBenchmark()
      .then((loaded) => {
        if (alive) setState(adoptBenchmark(loaded));
      })
      .catch((cause: unknown) => {
        console.warn("[benchmark actif] lecture du profil en échec", cause);
      });
    return () => {
      alive = false;
    };
  }, []);

  const setBenchmarkId = useCallback(
    (next: BenchmarkId) => {
      if (next === benchmarkId) return;

      const previous = benchmarkId;

      setError(null);
      setSaving(true);
      // L'optimisme : l'écran et la lib basculent tout de suite.
      setState(adoptBenchmark(next));

      void setActiveBenchmark(next)
        .then((stored) => {
          // La base a le dernier mot : elle peut rendre autre chose que ce qu'on
          // lui a demandé (benchmark retiré du registre entre-temps).
          setState(adoptBenchmark(stored));
        })
        .catch((cause: unknown) => {
          // L'optimisme s'annule : garder l'écran sur un benchmark que la base
          // ignore ferait estampiller les passes suivantes avec une préférence
          // que personne n'a enregistrée.
          setState(adoptBenchmark(previous));
          setError(cause instanceof Error ? cause.message : SAVE_FAILED);
        })
        .finally(() => setSaving(false));
    },
    [benchmarkId],
  );

  return (
    <ActiveBenchmarkContext.Provider
      value={{
        benchmarkId,
        benchmark: getBenchmark(benchmarkId),
        setBenchmarkId,
        saving,
        error,
      }}
    >
      {children}
    </ActiveBenchmarkContext.Provider>
  );
}

/** Le benchmark actif et de quoi le changer. */
export function useActiveBenchmark(): ActiveBenchmark {
  return useContext(ActiveBenchmarkContext);
}
