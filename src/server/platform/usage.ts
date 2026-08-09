/**
 * Le tableau d'usage de l'administration (SPEC §5 quater) : ce que la
 * plateforme a consommé aujourd'hui, et sur les quatorze derniers jours.
 *
 * Module **pur** : il reçoit quatre paquets de lignes brutes et rend des
 * agrégats. Aucune requête, aucune horloge implicite — la date du jour est un
 * argument. C'est ce qui rend testables les deux choses qui se trompent
 * toujours dans un tableau de ce genre : les **jours vides** (un jour sans
 * activité doit apparaître à zéro, pas disparaître, sinon la courbe ment) et le
 * **découpage en journées UTC** (les compteurs sont datés en UTC depuis la
 * migration 0003 ; les debriefs et les routines, eux, portent un horodatage
 * complet et doivent être rangés dans la même grille).
 *
 * Ce que ce module ne prétend pas savoir : la part exacte payée par les
 * utilisateurs sur leur propre clé. `ai_usage` ne compte que les appels passés
 * sur la clé de la plateforme (SPEC §5 ter) ; les debriefs et routines stockés
 * comptent tout ce qui existe encore. La différence entre les deux est donc la
 * part personnelle **minorée par les suppressions** — l'écran l'annonce comme
 * telle plutôt que de présenter une estimation pour un décompte.
 */

import type { AdminUsage, AdminUsageDay } from "../../shared/admin-contract.js";

/** Une ligne de `public.ai_usage`. `day` est déjà une journée UTC (`date`). */
export interface AiUsageRow {
  readonly user_id: string;
  readonly day: string;
  readonly coach_count: number;
  readonly routine_count: number;
}

/** Une ligne de `public.import_usage`, même grille de jours. */
export interface ImportUsageRow {
  readonly user_id: string;
  readonly day: string;
  readonly kovaaks_count: number;
  readonly riot_link_count: number;
}

/**
 * Une ligne datée de `public.debriefs` ou `public.routines` : un horodatage
 * complet, qu'il faut ramener à sa journée UTC pour rejoindre la grille.
 */
export interface StoredRow {
  readonly user_id: string;
  readonly date: string;
}

export interface UsageInput {
  /** La journée UTC courante, `YYYY-MM-DD`. Argument, jamais `new Date()` ici. */
  readonly today: string;
  /** Profondeur de la fenêtre, aujourd'hui compris. */
  readonly days: number;
  readonly aiUsage: readonly AiUsageRow[];
  readonly importUsage: readonly ImportUsageRow[];
  readonly debriefs: readonly StoredRow[];
  readonly routines: readonly StoredRow[];
  /** Utilisateurs ayant apporté leur propre clé (lignes de `ai_settings`). */
  readonly personalConfigs: number;
  readonly aiGlobalDailyLimit: number | null;
}

/** La journée UTC d'un instant, dans la grille des compteurs. */
export function utcDay(at: Date): string {
  return at.toISOString().slice(0, 10);
}

/**
 * Les journées de la fenêtre, du plus ancien au plus récent, `today` inclus.
 *
 * Le calcul passe par `Date.UTC` plutôt que par une soustraction de
 * millisecondes sur une date locale : c'est la seule façon d'obtenir la même
 * grille que Postgres, quel que soit le fuseau de la machine qui exécute.
 */
export function windowDays(today: string, count: number): readonly string[] {
  const end = Date.parse(`${today}T00:00:00.000Z`);

  if (Number.isNaN(end) || count <= 0) return [];

  const days: string[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    days.push(utcDay(new Date(end - offset * 86_400_000)));
  }
  return days;
}

/** Les compteurs d'une journée, en cours d'accumulation. */
interface Bucket {
  coachPlatform: number;
  routinePlatform: number;
  kovaaksImports: number;
  riotLinks: number;
  debriefsStored: number;
  routinesStored: number;
  readonly users: Set<string>;
}

function emptyBucket(): Bucket {
  return {
    coachPlatform: 0,
    routinePlatform: 0,
    kovaaksImports: 0,
    riotLinks: 0,
    debriefsStored: 0,
    routinesStored: 0,
    users: new Set<string>(),
  };
}

function toDay(day: string, bucket: Bucket): AdminUsageDay {
  return {
    day,
    coachPlatform: bucket.coachPlatform,
    routinePlatform: bucket.routinePlatform,
    kovaaksImports: bucket.kovaaksImports,
    riotLinks: bucket.riotLinks,
    debriefsStored: bucket.debriefsStored,
    routinesStored: bucket.routinesStored,
    activeUsers: bucket.users.size,
  };
}

/** Un entier de compteur exploitable, ou zéro : une base ne rend pas `NaN`, un test si. */
function count(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0;
}

/**
 * La journée UTC d'un horodatage stocké, ou `null` s'il est illisible.
 *
 * Une ligne qu'on ne sait pas dater est **écartée** plutôt que rangée dans la
 * journée courante : un total légèrement bas se remarque et se cherche, une
 * ligne rangée au mauvais jour se lit comme une vérité.
 */
function storedDay(value: string): string | null {
  const time = Date.parse(value);

  return Number.isNaN(time) ? null : utcDay(new Date(time));
}

/**
 * Les agrégats du jour, de la fenêtre, et le cumul.
 *
 * Les lignes hors fenêtre sont ignorées : la fenêtre est ce qui a été demandé,
 * et un cumul qui compterait des jours absents du tableau serait un cumul que
 * personne ne peut vérifier à l'œil.
 */
export function aggregateUsage(input: UsageInput): AdminUsage {
  const days = windowDays(input.today, input.days);
  const buckets = new Map<string, Bucket>(days.map((day) => [day, emptyBucket()]));

  const bucketOf = (day: string | null): Bucket | null =>
    day === null ? null : (buckets.get(day) ?? null);

  for (const row of input.aiUsage) {
    const bucket = bucketOf(row.day);

    if (bucket === null) continue;
    bucket.coachPlatform += count(row.coach_count);
    bucket.routinePlatform += count(row.routine_count);
    if (count(row.coach_count) + count(row.routine_count) > 0) bucket.users.add(row.user_id);
  }

  for (const row of input.importUsage) {
    const bucket = bucketOf(row.day);

    if (bucket === null) continue;
    bucket.kovaaksImports += count(row.kovaaks_count);
    bucket.riotLinks += count(row.riot_link_count);
    if (count(row.kovaaks_count) + count(row.riot_link_count) > 0) bucket.users.add(row.user_id);
  }

  for (const row of input.debriefs) {
    const bucket = bucketOf(storedDay(row.date));

    if (bucket === null) continue;
    bucket.debriefsStored += 1;
    bucket.users.add(row.user_id);
  }

  for (const row of input.routines) {
    const bucket = bucketOf(storedDay(row.date));

    if (bucket === null) continue;
    bucket.routinesStored += 1;
    bucket.users.add(row.user_id);
  }

  const totals = emptyBucket();

  for (const bucket of buckets.values()) {
    totals.coachPlatform += bucket.coachPlatform;
    totals.routinePlatform += bucket.routinePlatform;
    totals.kovaaksImports += bucket.kovaaksImports;
    totals.riotLinks += bucket.riotLinks;
    totals.debriefsStored += bucket.debriefsStored;
    totals.routinesStored += bucket.routinesStored;
    for (const user of bucket.users) totals.users.add(user);
  }

  return {
    today: toDay(input.today, buckets.get(input.today) ?? emptyBucket()),
    days: days.map((day) => toDay(day, buckets.get(day) ?? emptyBucket())),
    // Le cumul porte la fenêtre entière : son `day` est l'étiquette de la
    // période, pas une journée. `activeUsers` y est le nombre d'utilisateurs
    // distincts sur toute la fenêtre — pas la somme des actifs quotidiens, qui
    // compterait la même personne quatorze fois.
    totals: toDay(`${days[0] ?? input.today}/${input.today}`, totals),
    aiGlobalDailyLimit: input.aiGlobalDailyLimit,
    personalConfigs: input.personalConfigs,
  };
}
