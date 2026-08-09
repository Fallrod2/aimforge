/**
 * Bloc « Usage et plafond global » (SPEC §5 quater).
 *
 * Trois choses, dans cet ordre, parce que c'est l'ordre des questions qu'on se
 * pose devant : où en est-on aujourd'hui, à quoi ça ressemble depuis deux
 * semaines, et jusqu'où on laisse aller.
 *
 * Le point délicat n'est pas l'affichage, c'est **l'honnêteté des chiffres**.
 * `ai_usage` ne compte que les appels passés sur la clé de la plateforme (SPEC
 * §5 ter) ; les debriefs et routines stockés comptent tout ce qui existe
 * encore. La différence donne la part payée par les utilisateurs sur leur
 * propre clé — mais **minorée** par ce qu'ils ont supprimé depuis. L'écran
 * affiche donc les deux nombres bruts et nomme l'écart pour ce qu'il est : une
 * borne basse, pas un décompte.
 *
 * Aucune identité nulle part : la fonction n'en renvoie aucune, et « nombre
 * d'utilisateurs actifs » est le seul angle sous lequel les personnes
 * apparaissent.
 */

import { type FormEvent, useState } from "react";
import {
  type AdminUsage,
  type AdminUsageDay,
  GLOBAL_LIMIT_MAX,
  GLOBAL_LIMIT_MIN,
  USAGE_WINDOW_DAYS,
} from "../../shared/admin-contract";
import { CONTROL_CLASSES, GHOST_BUTTON, PRIMARY_BUTTON } from "../components/controls";
import { Badge, Feedback, type PanelProps, Section, useSave } from "./panel";

interface UsagePanelProps extends PanelProps {
  readonly usage: AdminUsage;
  /** Recharge les agrégats après un changement de plafond, ou à la demande. */
  readonly onReload: () => void;
}

/** `2026-08-09` → `09/08`. Le tableau est dense : l'année n'y aide personne. */
function shortDay(day: string): string {
  const [, month = "", date = ""] = day.split("-");

  return `${date}/${month}`;
}

export function UsagePanel({ settings, usage, onSaved, onReload }: UsagePanelProps) {
  const [limit, setLimit] = useState(() =>
    settings.aiGlobalDailyLimit === null ? "" : String(settings.aiGlobalDailyLimit),
  );
  const { action, save, reset } = useSave(onSaved);

  const busy = action.kind === "saving";
  const platformToday = usage.today.coachPlatform + usage.today.routinePlatform;
  const cap = usage.aiGlobalDailyLimit;
  const parsed = parseLimit(limit);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (parsed === "invalid") return;

    await save(
      { aiGlobalDailyLimit: parsed },
      parsed === null
        ? "Plafond retiré : la plateforme n'a plus de limite journalière globale."
        : `Plafond enregistré à ${parsed} appels par jour.`,
    );
    onReload();
  }

  return (
    <Section
      title="Usage et plafond global"
      hint={`Consommation de la plateforme sur ${USAGE_WINDOW_DAYS} jours, en journées UTC. Aucune donnée nominative : seuls des compteurs et un nombre d'utilisateurs actifs.`}
      badge={<CapBadge used={platformToday} cap={cap} />}
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Appels IA plateforme" value={platformToday} hint="aujourd'hui" />
          <Tile
            label="Debriefs enregistrés"
            value={usage.today.debriefsStored}
            hint="aujourd'hui"
          />
          <Tile label="Imports KovaaK's" value={usage.today.kovaaksImports} hint="aujourd'hui" />
          <Tile label="Liaisons Riot" value={usage.today.riotLinks} hint="aujourd'hui" />
        </div>

        <p className="text-[11px] text-steel-500">
          {usage.today.activeUsers} utilisateur{usage.today.activeUsers > 1 ? "s" : ""} actif
          {usage.today.activeUsers > 1 ? "s" : ""} aujourd'hui · {usage.personalConfigs} compte
          {usage.personalConfigs > 1 ? "s" : ""} avec une clé personnelle (hors quota et hors
          plafond). L'écart entre « debriefs enregistrés » et « appels IA plateforme » est la part
          payée par les utilisateurs eux-mêmes — minorée par ce qu'ils ont supprimé depuis.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-xs">
            <caption className="sr-only">
              Consommation quotidienne sur les {USAGE_WINDOW_DAYS} derniers jours
            </caption>
            <thead>
              <tr className="border-b border-steel-800 text-left text-steel-400">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Jour
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Debriefs IA
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Routines IA
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Imports
                </th>
                <th scope="col" className="py-2 pr-3 text-right font-medium">
                  Liaisons
                </th>
                <th scope="col" className="py-2 text-right font-medium">
                  Actifs
                </th>
              </tr>
            </thead>
            <tbody>
              {usage.days.map((day) => (
                <Row key={day.day} day={day} today={day.day === usage.today.day} cap={cap} />
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-steel-800 font-semibold text-steel-200">
                <th scope="row" className="py-2 pr-3 text-left font-semibold">
                  Total
                </th>
                <td className="py-2 pr-3 text-right">{usage.totals.coachPlatform}</td>
                <td className="py-2 pr-3 text-right">{usage.totals.routinePlatform}</td>
                <td className="py-2 pr-3 text-right">{usage.totals.kovaaksImports}</td>
                <td className="py-2 pr-3 text-right">{usage.totals.riotLinks}</td>
                <td className="py-2 text-right">{usage.totals.activeUsers}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="flex flex-col gap-3 border-t border-steel-800 pt-4"
        >
          <div className="flex flex-col gap-1.5 sm:max-w-xs">
            <label htmlFor="admin-global-cap" className="text-xs font-medium text-steel-200">
              Plafond journalier d'appels IA plateforme
            </label>
            <input
              id="admin-global-cap"
              type="number"
              inputMode="numeric"
              min={GLOBAL_LIMIT_MIN}
              max={GLOBAL_LIMIT_MAX}
              step={1}
              value={limit}
              disabled={busy}
              aria-invalid={parsed === "invalid"}
              aria-describedby="admin-global-cap-hint"
              placeholder="Aucun plafond"
              onChange={(event) => {
                reset();
                setLimit(event.target.value);
              }}
              className={CONTROL_CLASSES}
            />
            <p id="admin-global-cap-hint" className="text-[11px] text-steel-500">
              Vide = pas de plafond. Une fois atteint, le coach et la routine répondent un refus
              rédigé à tout le monde jusqu'au lendemain — sauf aux comptes qui ont apporté leur
              propre clé, qui ne consomment rien ici.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={busy || parsed === "invalid"}
              className={PRIMARY_BUTTON}
            >
              {busy ? "Enregistrement…" : "Enregistrer le plafond"}
            </button>
            <button type="button" disabled={busy} onClick={onReload} className={GHOST_BUTTON}>
              Rafraîchir les chiffres
            </button>
          </div>

          <Feedback action={action} />
        </form>
      </div>
    </Section>
  );
}

/** `null` = pas de plafond (champ vide) ; `"invalid"` = on n'enregistre pas. */
function parseLimit(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();

  if (trimmed === "") return null;

  const value = Number(trimmed);

  if (!Number.isInteger(value) || value < GLOBAL_LIMIT_MIN || value > GLOBAL_LIMIT_MAX) {
    return "invalid";
  }
  return value;
}

function CapBadge({ used, cap }: { readonly used: number; readonly cap: number | null }) {
  if (cap === null) return <Badge tone="muted">Aucun plafond</Badge>;
  if (used >= cap)
    return (
      <Badge tone="warn">
        Plafond atteint · {used}/{cap}
      </Badge>
    );
  return (
    <Badge tone="ok">
      {used}/{cap} aujourd'hui
    </Badge>
  );
}

interface TileProps {
  readonly label: string;
  readonly value: number;
  readonly hint: string;
}

function Tile({ label, value, hint }: TileProps) {
  return (
    <div className="rounded-lg border border-steel-800 bg-steel-900 p-3">
      <p className="text-2xl font-semibold text-steel-100 tabular-nums">{value}</p>
      <p className="mt-0.5 text-[11px] leading-tight font-medium text-steel-300">{label}</p>
      <p className="text-[10px] text-steel-500">{hint}</p>
    </div>
  );
}

interface RowProps {
  readonly day: AdminUsageDay;
  readonly today: boolean;
  readonly cap: number | null;
}

function Row({ day, today, cap }: RowProps) {
  const platform = day.coachPlatform + day.routinePlatform;
  const reached = cap !== null && platform >= cap;

  return (
    <tr
      className={`border-b border-steel-800/60 tabular-nums ${
        today ? "text-steel-100" : "text-steel-400"
      }`}
    >
      <th scope="row" className="py-1.5 pr-3 text-left font-normal">
        {shortDay(day.day)}
        {today ? <span className="ml-1 text-[10px] text-ember-400">auj.</span> : null}
      </th>
      <td className={`py-1.5 pr-3 text-right ${reached ? "text-amber-300" : ""}`}>
        {day.coachPlatform}
      </td>
      <td className={`py-1.5 pr-3 text-right ${reached ? "text-amber-300" : ""}`}>
        {day.routinePlatform}
      </td>
      <td className="py-1.5 pr-3 text-right">{day.kovaaksImports}</td>
      <td className="py-1.5 pr-3 text-right">{day.riotLinks}</td>
      <td className="py-1.5 text-right">{day.activeUsers}</td>
    </tr>
  );
}
