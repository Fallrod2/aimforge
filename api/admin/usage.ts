/**
 * `GET /api/admin/usage` — le tableau de consommation de la plateforme
 * (SPEC §5 quater).
 *
 * Même garde que `api/admin/settings` : `requireAdmin` d'abord, 404 pour tout
 * le reste. Ce que cette fonction rend n'est pas anodin — c'est le rythme
 * d'activité de tous les utilisateurs — et la surface elle-même ne doit pas
 * s'annoncer.
 *
 * Ce qu'elle expose, et ce qu'elle n'expose pas : des **compteurs**, jamais des
 * identités. Les `user_id` servent à compter des utilisateurs distincts et
 * s'arrêtent là ; aucun ne sort d'ici, aucun pseudo n'est joint, aucun contenu
 * de debrief n'est lu. « Sans données personnelles au-delà du nécessaire »
 * (SPEC §5 quater) veut dire exactement cela : le nécessaire est un cardinal.
 *
 * Toutes les lectures passent par la **service key** : elles traversent les
 * lignes de tous les utilisateurs, ce qu'aucune policy n'autorise et ne doit
 * autoriser. L'agrégation, elle, est faite par un module pur
 * (`src/server/platform/usage.ts`) — les jours vides et le découpage UTC s'y
 * testent sans base.
 */

import {
  type AiUsageRow,
  aggregateUsage,
  type ImportUsageRow,
  type StoredRow,
  utcDay,
} from "../../src/server/platform/usage.js";
import { type AdminUsageResponse, USAGE_WINDOW_DAYS } from "../../src/shared/admin-contract.js";
import { requireAdmin } from "../_lib/admin.js";
import { loadPlatformSettings } from "../_lib/platform-settings.js";
import { fail, json } from "../_lib/request.js";
import type { ServiceClient } from "../_lib/service.js";

/** Cinq lectures menées de front, aucun appel sortant : 15 s est large. */
export const maxDuration = 15;

/**
 * Plafond de lignes par lecture.
 *
 * PostgREST tronque de toute façon au-delà de son propre maximum ; le dire ici
 * rend la troncature visible (log) plutôt que silencieuse. Les deux compteurs
 * (`ai_usage`, `import_usage`) tiennent une ligne par utilisateur et par jour —
 * ils ne s'en approchent pas. Les debriefs et routines stockés, eux, peuvent y
 * arriver sur une plateforme très active : leurs totaux seraient alors
 * minorés, tandis que les colonnes « plateforme », qui viennent des compteurs,
 * resteraient exactes.
 */
const ROW_CAP = 5000;

const READ_FAILED = "Les agrégats d'usage n'ont pas pu être lus. Réessaie dans un instant.";

/** Le premier jour de la fenêtre, en journée UTC. */
function windowStart(today: Date, days: number): string {
  return utcDay(new Date(today.getTime() - (days - 1) * 86_400_000));
}

function truncated(label: string, rows: readonly unknown[]): void {
  if (rows.length >= ROW_CAP) {
    console.warn(`[admin] lecture d'usage tronquée à ${ROW_CAP} lignes`, label);
  }
}

export async function GET(request: Request): Promise<Response> {
  const admin = await requireAdmin(request);

  if (!admin.ok) return admin.response;

  const now = new Date();
  const today = utcDay(now);
  const since = windowStart(now, USAGE_WINDOW_DAYS);
  // Les debriefs et les routines portent un horodatage complet : la borne doit
  // être le début de la journée UTC, pas l'instant courant décalé.
  const sinceInstant = `${since}T00:00:00.000Z`;

  const service: ServiceClient = admin.service;

  const [aiUsage, importUsage, debriefs, routines, personal, settings] = await Promise.all([
    service
      .from("ai_usage")
      .select("user_id, day, coach_count, routine_count")
      .gte("day", since)
      .limit(ROW_CAP),
    service
      .from("import_usage")
      .select("user_id, day, kovaaks_count, riot_link_count")
      .gte("day", since)
      .limit(ROW_CAP),
    service.from("debriefs").select("user_id, date").gte("date", sinceInstant).limit(ROW_CAP),
    service.from("routines").select("user_id, date").gte("date", sinceInstant).limit(ROW_CAP),
    service.from("ai_settings").select("user_id", { count: "exact", head: true }),
    loadPlatformSettings(service),
  ]);

  const failed =
    aiUsage.error ?? importUsage.error ?? debriefs.error ?? routines.error ?? personal.error;

  if (failed !== null) {
    // Un tableau partiellement faux serait pire qu'un tableau absent : il
    // servirait à décider. On refuse en bloc, et l'écran propose de réessayer.
    console.error("[admin] lecture des agrégats en échec", failed.message);
    return fail(READ_FAILED, 503);
  }

  const aiRows: readonly AiUsageRow[] = aiUsage.data ?? [];
  const importRows: readonly ImportUsageRow[] = importUsage.data ?? [];
  const debriefRows: readonly StoredRow[] = debriefs.data ?? [];
  const routineRows: readonly StoredRow[] = routines.data ?? [];

  truncated("ai_usage", aiRows);
  truncated("import_usage", importRows);
  truncated("debriefs", debriefRows);
  truncated("routines", routineRows);

  const usage = aggregateUsage({
    today,
    days: USAGE_WINDOW_DAYS,
    aiUsage: aiRows,
    importUsage: importRows,
    debriefs: debriefRows,
    routines: routineRows,
    personalConfigs: personal.count ?? 0,
    aiGlobalDailyLimit: settings.aiGlobalDailyLimit,
  });

  return json({ usage } satisfies AdminUsageResponse, 200);
}
