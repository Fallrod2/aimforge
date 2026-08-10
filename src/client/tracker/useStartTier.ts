/**
 * Le chargement du palier de départ : une lecture de l'historique, une fois,
 * à l'ouverture du tracker.
 *
 * L'état « pas encore su » est explicite parce qu'il commande deux choses : le
 * squelette de saisie, et surtout le pull automatique, qui attend de connaître
 * le palier pour ne pas importer Novice avant de découvrir qu'on joue
 * Intermediate (cf. `auto-import.ts`).
 *
 * Un historique illisible ne bloque pas le tracker : on retombe sur Novice et
 * on laisse l'utilisateur choisir. Il vient ici pour saisir des scores, pas
 * pour lire ses passes — l'échec a son écran, c'est l'historique.
 */

import { useEffect, useState } from "react";
import type { TierId } from "../../lib/energy";
import { listBenchRuns } from "../data";
import { startTier } from "./start-tier";

export type StartTierState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly tier: TierId };

export function useStartTier(): StartTierState {
  const [state, setState] = useState<StartTierState>({ status: "loading" });

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const runs = await listBenchRuns();

        if (alive) setState({ status: "ready", tier: startTier(runs) });
      } catch {
        if (alive) setState({ status: "ready", tier: startTier([]) });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}
