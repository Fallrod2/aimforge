/**
 * Cache des détails de passes (`GET /api/bench-runs/:id`).
 *
 * Le résumé renvoyé par la liste ne porte ni les 18 scores ni les 9
 * sous-catégories : il faut le détail pour ouvrir une passe **et** pour tracer
 * la courbe d'une sous-catégorie. On charge donc à la demande, une seule fois
 * par passe, et on garde le résultat (une passe enregistrée est immuable).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { type BenchRunDetail, getBenchRun } from "../api";

export interface RunDetails {
  readonly byId: ReadonlyMap<number, BenchRunDetail>;
  readonly loading: boolean;
  readonly error: string | null;
  /** Oublie une passe supprimée, pour que le cache ne la ressuscite pas. */
  readonly forget: (id: number) => void;
}

function failureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Chargement du détail impossible.";
}

/**
 * Garantit le chargement des passes demandées. `ids` peut changer à chaque
 * rendu : c'est sa valeur sérialisée qui pilote l'effet, pas son identité.
 */
export function useRunDetails(ids: readonly number[]): RunDetails {
  // Le cache est un état **remplacé**, jamais muté : c'est le changement
  // d'identité de la Map qui invalide les `useMemo` des consommateurs (courbe
  // du graphe). Une Map mutée en place les laisserait sur des données périmées.
  const [byId, setById] = useState<ReadonlyMap<number, BenchRunDetail>>(() => new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // L'effet ne doit dépendre que des identifiants demandés : le cache est lu
  // par référence pour qu'un chargement ne se redéclenche pas lui-même.
  const byIdRef = useRef(byId);
  byIdRef.current = byId;

  const key = ids.join(",");

  useEffect(() => {
    const missing = (key === "" ? [] : key.split(",").map(Number)).filter(
      (id) => !byIdRef.current.has(id),
    );

    if (missing.length === 0) return;

    let cancelled = false;

    setLoading(true);
    setError(null);
    Promise.all(missing.map(async (id) => [id, await getBenchRun(id)] as const))
      .then((entries) => {
        if (cancelled) return;
        setById((current) => new Map([...current, ...entries]));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(failureMessage(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [key]);

  const forget = useCallback((id: number) => {
    setById((current) => {
      if (!current.has(id)) return current;

      const next = new Map(current);

      next.delete(id);
      return next;
    });
  }, []);

  return { byId, loading, error, forget };
}
