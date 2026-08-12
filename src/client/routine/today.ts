/**
 * « La routine du jour ». Module **pur** : il ne connaît ni React, ni Supabase —
 * il choisit une routine dans une liste, et il est testable seul.
 *
 * Deux questions, deux fonctions, parce que ce sont deux questions différentes :
 *
 * - **« qu'est-ce que je fais maintenant ? »** → `routineOfToday` : la plus
 *   récente d'aujourd'hui **qui n'est pas encore faite**. C'est celle que le
 *   tableau de bord annonce, et une routine cochée a rempli son office ;
 * - **« qu'est-ce que j'ai fait aujourd'hui ? »** → `latestOfLocalDay` : la plus
 *   récente d'aujourd'hui, faite ou non. C'est celle que l'espace Coach garde
 *   sous les yeux, badge « Faite » compris — un « Marquer comme faite » qui
 *   ferait disparaître la carte qu'on vient de cocher serait une punition.
 *
 * Dans les deux cas, *aujourd'hui* est le jour **local**, pas UTC. Le quota se
 * compte en UTC (SPEC §4) parce que c'est une limite de service ; « ma routine
 * du jour », elle, se compte dans le fuseau du joueur — sinon une séance générée
 * à 23 h à Paris s'afficherait comme celle de demain. Et *la plus récente* :
 * rien n'interdit d'en générer deux, c'est la dernière demandée qui vaut.
 */

export interface DatedRoutine {
  readonly id: number;
  /** Horodatage ISO 8601. */
  readonly date: string;
  readonly done: boolean;
}

/** Deux instants tombent-ils le même jour, dans le fuseau du navigateur ? */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * La routine la plus récente d'aujourd'hui, faite ou non, ou `null`.
 *
 * L'ordre de la liste n'est pas supposé : on relit les dates. À date égale,
 * l'identifiant le plus grand gagne — c'est la dernière enregistrée.
 */
export function latestOfLocalDay<T extends DatedRoutine>(
  routines: readonly T[],
  now: Date = new Date(),
): T | null {
  let best: T | null = null;
  let bestTime = Number.NEGATIVE_INFINITY;

  for (const routine of routines) {
    const time = Date.parse(routine.date);

    if (Number.isNaN(time)) continue;
    if (!isSameLocalDay(new Date(time), now)) continue;
    if (best === null || time > bestTime || (time === bestTime && routine.id > best.id)) {
      best = routine;
      bestTime = time;
    }
  }
  return best;
}

/**
 * La routine du jour **encore à faire**, ou `null` s'il n'y en a pas (aucune
 * aujourd'hui, ou toutes déjà faites).
 */
export function routineOfToday<T extends DatedRoutine>(
  routines: readonly T[],
  now: Date = new Date(),
): T | null {
  return latestOfLocalDay(
    routines.filter((routine) => !routine.done),
    now,
  );
}
