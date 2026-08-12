/**
 * Le chargement des records personnels du palier affiché (SPEC V4-A §4.3).
 *
 * Une lecture par palier et par benchmark, à l'ouverture et à chaque
 * changement de palier — **jamais par frappe**. C'est tout l'intérêt de séparer
 * le record (une donnée de la base, stable pendant la saisie) de sa
 * comparaison (un calcul de rendu, qui suit chaque caractère tapé).
 *
 * Un échec est silencieux, et c'est délibéré : le record est un confort posé à
 * côté d'un champ de saisie. Faire porter au tracker un bandeau d'erreur parce
 * qu'un « PB 820 » n'a pas pu être lu détournerait l'attention de la seule
 * chose qui compte ici — enregistrer sa passe.
 */

import { useEffect, useState } from "react";
import type { BenchmarkId, TierId } from "../../lib/energy";
import { listPersonalBests, type PersonalBests } from "../data";

const NO_BESTS: PersonalBests = new Map();

export function usePersonalBests(benchmarkId: BenchmarkId, tier: TierId): PersonalBests {
  const [bests, setBests] = useState<PersonalBests>(NO_BESTS);

  useEffect(() => {
    let alive = true;

    // Les records du palier qu'on quitte ne doivent pas s'afficher sous les
    // champs du palier qu'on ouvre, même une fraction de seconde.
    setBests(NO_BESTS);
    void (async () => {
      try {
        const loaded = await listPersonalBests(benchmarkId, tier);

        if (alive) setBests(loaded);
      } catch {
        if (alive) setBests(NO_BESTS);
      }
    })();

    return () => {
      alive = false;
    };
  }, [benchmarkId, tier]);

  return bests;
}
