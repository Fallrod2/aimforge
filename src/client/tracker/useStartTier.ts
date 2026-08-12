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
  | {
      readonly status: "ready";
      readonly tier: TierId;
      /**
       * Le compte a-t-il au moins une passe ? Lu de la **même** requête que le
       * palier de départ : c'est ce qui commande le bandeau d'accueil (§4.1c),
       * et une seconde lecture de l'historique pour compter des lignes déjà
       * chargées serait un appel réseau pour rien.
       *
       * `null` quand la lecture a échoué : on ne sait pas, et un « non »
       * inventé afficherait le bandeau des premiers pas à quelqu'un qui a
       * cinquante passes derrière lui et un réseau capricieux.
       */
      readonly hasRuns: boolean | null;
    };

export function useStartTier(): StartTierState {
  const [state, setState] = useState<StartTierState>({ status: "loading" });

  useEffect(() => {
    let alive = true;

    void (async () => {
      try {
        const runs = await listBenchRuns();

        if (alive) setState({ status: "ready", tier: startTier(runs), hasRuns: runs.length > 0 });
      } catch {
        if (alive) setState({ status: "ready", tier: startTier([]), hasRuns: null });
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return state;
}
