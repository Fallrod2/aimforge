/**
 * La régularité, en deux nombres et rien d'autre (V4-C §4.6).
 *
 * Module **pur**, jumeau de `./today.ts` : il ne connaît ni React, ni Supabase.
 * Il se calcule depuis la liste de routines **déjà chargée** par l'écran — pas
 * une requête de plus, pas une table de plus. C'est ce qui permet au tableau de
 * bord de l'afficher plus tard sans rien réécrire : il a la même liste.
 *
 * Ce qui est mesuré, et pourquoi c'est exactement ça :
 *
 * - **la série** : les jours consécutifs avec au moins une routine *faite*.
 *   Générer n'est pas s'entraîner — seul « Marquer comme faite » compte ;
 * - **les séances des sept derniers jours glissants** : le nombre de routines
 *   faites, pas de jours. Deux séances dans la même journée, c'est deux séances.
 *
 * Deux décisions qui se paient, et qu'il vaut mieux lire ici que déduire :
 *
 * 1. **la série survit à la journée en cours.** Si rien n'est encore fait
 *    aujourd'hui mais qu'hier l'était, la série compte depuis hier. Remettre le
 *    compteur à zéro à minuit annoncerait une série perdue à quelqu'un qui a
 *    toute sa journée pour s'entraîner ;
 * 2. **le jour est le jour local**, comme dans `./today.ts` et pour la même
 *    raison — une séance de 23 h à Paris appartient à la journée du joueur, pas
 *    à celle d'UTC. Le passage par `Date.UTC` des composantes *locales* donne un
 *    numéro de jour contigu qui traverse les changements d'heure sans faute :
 *    un jour d'octobre dure 25 h, et « il y a un jour » n'est pas « il y a
 *    24 heures ».
 *
 * Aucun XP, aucun badge, aucun palier : deux nombres, et l'écran décide s'il y
 * a matière à les dire.
 */

/** Le strict nécessaire d'une routine pour cette mesure. */
export interface DoneRoutine {
  /** Horodatage ISO 8601, tel que la base le rend. */
  readonly date: string;
  readonly done: boolean;
}

export interface RoutineStreak {
  /** Jours consécutifs avec au moins une routine faite ; `0` si la série est rompue. */
  readonly days: number;
  /** Routines faites sur les sept derniers jours glissants, aujourd'hui compris. */
  readonly sessions: number;
}

/** La fenêtre glissante annoncée à l'écran : aujourd'hui et les six jours d'avant. */
const WINDOW_DAYS = 7;

const MS_PER_DAY = 86_400_000;

/**
 * Le numéro du jour **local** d'un instant : contigu, et insensible aux
 * changements d'heure puisqu'il ne compte pas d'heures.
 */
function localDayIndex(instant: Date): number {
  return Math.floor(
    Date.UTC(instant.getFullYear(), instant.getMonth(), instant.getDate()) / MS_PER_DAY,
  );
}

/**
 * La série en cours et les séances de la semaine glissante.
 *
 * @param routines La liste déjà chargée ; l'ordre n'est pas supposé.
 * @param now L'instant de référence, injecté pour que les bordures de jour
 *   soient testables sans horloge système.
 */
export function computeStreak(
  routines: readonly DoneRoutine[],
  now: Date = new Date(),
): RoutineStreak {
  const today = localDayIndex(now);
  /** Les jours ayant au moins une séance faite. */
  const activeDays = new Set<number>();
  let sessions = 0;

  for (const routine of routines) {
    if (!routine.done) continue;

    const time = Date.parse(routine.date);

    if (Number.isNaN(time)) continue;

    const day = localDayIndex(new Date(time));

    // Une routine datée de demain vient d'une horloge de travers, pas d'un
    // entraînement : elle ne gonfle ni la série ni le compteur.
    if (day > today) continue;
    activeDays.add(day);
    if (day > today - WINDOW_DAYS) sessions += 1;
  }

  return { days: countStreak(activeDays, today), sessions };
}

/** Les jours consécutifs, depuis aujourd'hui ou depuis hier (cf. décision 1). */
function countStreak(activeDays: ReadonlySet<number>, today: number): number {
  let day = activeDays.has(today) ? today : today - 1;

  if (!activeDays.has(day)) return 0;

  let days = 0;

  while (activeDays.has(day)) {
    days += 1;
    day -= 1;
  }
  return days;
}

/**
 * La phrase à afficher, ou `null` quand il n'y a rien à dire.
 *
 * Le silence est la règle par défaut : « Série : 0 » ou « 1 séance sur 7 jours »
 * ne récompensent rien et transforment une zone d'entraînement en tableau de
 * score. Les deux seuils étant à 2, aucune des deux branches ne peut produire de
 * singulier — c'est pourquoi il n'y a pas d'accord à gérer ici.
 */
export function formatStreak(streak: RoutineStreak): string | null {
  if (streak.days >= 2) {
    return `Série : ${streak.days} jours · ${streak.sessions} séances sur ${WINDOW_DAYS} jours`;
  }
  if (streak.sessions >= 2) return `${streak.sessions} séances sur ${WINDOW_DAYS} jours`;
  return null;
}
