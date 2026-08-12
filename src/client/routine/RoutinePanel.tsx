/**
 * La routine, devenue **une zone de l'espace Coach** et non plus un écran (V6).
 *
 * Rien de sa mécanique n'a bougé — génération avec quota, cases à cocher par
 * exercice, « Marquer comme faite », bloc SOURCES, suppression : c'est le même
 * code, avec la même `RoutineCard`. Ce qui a changé est ce qu'on voit en
 * arrivant, et c'est tout l'objet de la fusion :
 *
 * - **la routine du jour d'abord, dépliée.** C'est ce qu'on vient chercher. Elle
 *   reste affichée une fois cochée (`latestOfLocalDay`, faite ou non) : un
 *   « Marquer comme faite » qui escamoterait la carte punirait le geste ;
 * - **le formulaire ensuite, et seulement s'il sert.** Sans routine
 *   aujourd'hui, c'est lui l'écran ; avec une routine du jour, il se replie
 *   derrière « Générer une autre routine » — un appel au modèle se déclenche sur
 *   décision du joueur, jamais parce qu'il a ouvert son coach ;
 * - **les précédentes en repli.** Elles restent accessibles, entières (cases,
 *   sources, suppression), sans encombrer la zone.
 *
 * Le formulaire tient en deux champs parce que la routine se nourrit du reste
 * toute seule : les faiblesses viennent du dernier bench, les axes des derniers
 * debriefs. Le seul arbitrage qui appartient vraiment au joueur est le temps
 * qu'il a devant lui. Les presets couvrent la quasi-totalité des cas
 * (30/45/60/90) ; la saisie libre est validée ici, avec les bornes du contrat,
 * plutôt qu'en laissant la fonction serverless répondre 400.
 *
 * La génération passe par `api/routine` (seul détenteur de la clé Anthropic),
 * qui enregistre lui-même la routine. La nouvelle est donc simplement placée en
 * tête de la liste — sans rechargement, elle est déjà à jour.
 */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  DUREE_PRESETS,
  MAX_FOCUS_LENGTH,
  ROUTINE_DAILY_QUOTA,
  type StoredRoutine,
} from "../../shared/routine-contract";
import { Notice } from "../components/Notice";
import { deleteRoutine, listRoutines, setRoutineDone } from "../data";
import { formatDuration, normalizeFocus, parseDuration } from "./duration";
import { RoutineCard } from "./RoutineCard";
import { RoutineApiError, requestRoutine } from "./routine-api";
import { latestOfLocalDay } from "./today";

type History =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly routines: readonly StoredRoutine[] };

/** Un échec de génération : quota atteint et panne ne se disent pas pareil. */
interface Failure {
  readonly message: string;
  readonly quota: boolean;
}

/** La durée choisie : un preset, ou la saisie libre. */
type DureeChoice =
  | { readonly kind: "preset"; readonly minutes: number }
  | { readonly kind: "libre" };

const DEFAULT_MINUTES = 45;

function failureOf(cause: unknown): Failure {
  if (cause instanceof RoutineApiError) {
    return { message: cause.message, quota: cause.quotaReached };
  }
  return {
    message: cause instanceof Error ? cause.message : "La génération a échoué.",
    quota: false,
  };
}

/**
 * Ce que l'écran sait du quota du jour.
 *
 * Trois états et non un `number | null`, parce que `null` voudrait dire deux
 * choses opposées : « pas encore demandé » et « il n'y a plus rien à compter »
 * (SPEC §5 ter — l'utilisateur a configuré son propre fournisseur). Les
 * confondre afficherait « 5 routines par jour » à quelqu'un qui n'a plus de
 * limite.
 */
type Quota =
  | { readonly status: "unknown" }
  | { readonly status: "lifted" }
  | { readonly status: "counted"; readonly remaining: number };

export function RoutinePanel() {
  const [choice, setChoice] = useState<DureeChoice>({ kind: "preset", minutes: DEFAULT_MINUTES });
  const [libre, setLibre] = useState("");
  const [focus, setFocus] = useState("");
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [quota, setQuota] = useState<Quota>({ status: "unknown" });
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [freshId, setFreshId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  /** Le formulaire, quand une routine du jour existe déjà : replié par défaut. */
  const [formOpen, setFormOpen] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);

  const load = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      const routines = await listRoutines();

      setHistory({ status: "ready", routines });
      // La routine du jour est dépliée d'office : c'est ce qu'on vient chercher
      // en ouvrant le coach. À défaut, la plus récente.
      setExpandedId(
        (current) => current ?? latestOfLocalDay(routines)?.id ?? routines[0]?.id ?? null,
      );
    } catch (cause) {
      setHistory({
        status: "error",
        message: cause instanceof Error ? cause.message : "Chargement impossible.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const parsed =
    choice.kind === "preset"
      ? { ok: true as const, minutes: choice.minutes }
      : parseDuration(libre);
  const durationError = parsed.ok ? null : parsed.message;
  // Un champ libre encore vide n'est pas une faute : il n'a juste pas encore
  // été rempli. On désactive le bouton sans afficher de rouge.
  const showDurationError = durationError !== null && libre.trim() !== "";
  const canSubmit = parsed.ok && !generating;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!parsed.ok || generating) return;

    setGenerating(true);
    setFailure(null);
    setRowError(null);
    try {
      const { routine, remaining: left } = await requestRoutine(
        parsed.minutes,
        normalizeFocus(focus),
      );

      setHistory((current) =>
        current.status === "ready"
          ? { status: "ready", routines: [routine, ...current.routines] }
          : { status: "ready", routines: [routine] },
      );
      setFreshId(routine.id);
      setExpandedId(routine.id);
      setQuota(left === null ? { status: "lifted" } : { status: "counted", remaining: left });
    } catch (cause) {
      const next = failureOf(cause);

      setFailure(next);
      if (cause instanceof RoutineApiError && cause.remaining !== null) {
        setQuota({ status: "counted", remaining: cause.remaining });
      }
    } finally {
      setGenerating(false);
    }
  }

  async function toggleDone(routine: StoredRoutine): Promise<void> {
    setTogglingId(routine.id);
    setRowError(null);
    try {
      const updated = await setRoutineDone(routine.id, !routine.done);

      setHistory((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              routines: current.routines.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            }
          : current,
      );
    } catch (cause) {
      setRowError(cause instanceof Error ? cause.message : "La mise à jour a échoué.");
    } finally {
      setTogglingId(null);
    }
  }

  async function confirmDelete(id: number): Promise<void> {
    setDeletingId(id);
    setRowError(null);
    try {
      await deleteRoutine(id);
      setHistory((current) =>
        current.status === "ready"
          ? { status: "ready", routines: current.routines.filter((entry) => entry.id !== id) }
          : current,
      );
      setConfirmingId(null);
      if (freshId === id) setFreshId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (cause) {
      setRowError(cause instanceof Error ? cause.message : "La suppression a échoué.");
    } finally {
      setDeletingId(null);
    }
  }

  const routines = history.status === "ready" ? history.routines : [];
  const today = latestOfLocalDay(routines);
  const past = routines.filter((routine) => routine.id !== today?.id);
  // Le formulaire n'attend pas la lecture de la liste : l'afficher puis le
  // remplacer par la carte du jour ferait sauter la zone sous l'utilisateur.
  const showForm = history.status !== "loading" && (today === null || formOpen);

  /** Les propriétés communes à toutes les cartes : une seule vérité par ligne. */
  function cardProps(routine: StoredRoutine) {
    return {
      routine,
      fresh: routine.id === freshId,
      expanded: routine.id === expandedId,
      onToggle: () => {
        setConfirmingId(null);
        setExpandedId(expandedId === routine.id ? null : routine.id);
      },
      toggling: togglingId === routine.id,
      onToggleDone: () => void toggleDone(routine),
      confirming: confirmingId === routine.id,
      deleting: deletingId === routine.id,
      onAskDelete: () => setConfirmingId(routine.id),
      onCancelDelete: () => setConfirmingId(null),
      onConfirmDelete: () => void confirmDelete(routine.id),
    };
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5">
      <div>
        <h2 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Routine du jour
        </h2>
        <p className="mt-1 text-xs leading-relaxed text-steel-500">
          Dis combien de temps tu as : la séance part des sous-catégories basses de ton dernier
          bench et des axes de tes derniers debriefs.
        </p>
      </div>

      {rowError !== null ? (
        <Notice tone="error" title="Action impossible.">
          {rowError}
        </Notice>
      ) : null}

      {history.status === "loading" ? (
        <Notice tone="loading" title="Chargement de la routine…" />
      ) : history.status === "error" ? (
        <Notice
          tone="error"
          title="Les routines n'ont pas pu être chargées."
          onRetry={() => void load()}
        >
          {history.message}
        </Notice>
      ) : today === null ? null : (
        <ul className="flex flex-col gap-2">
          <RoutineCard key={today.id} {...cardProps(today)} />
        </ul>
      )}

      {showForm ? (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2" disabled={generating}>
            <legend className="mb-2 text-xs font-medium text-steel-200">Temps disponible</legend>
            <div className="flex flex-wrap gap-2">
              {DUREE_PRESETS.map((minutes) => {
                const active = choice.kind === "preset" && choice.minutes === minutes;

                return (
                  <button
                    key={minutes}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setChoice({ kind: "preset", minutes })}
                    className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? "bg-ember-500/15 text-ember-400 shadow-[inset_0_0_0_1px_var(--color-ember-500)]"
                        : "border border-steel-700 text-steel-300 hover:border-steel-600 hover:text-steel-100"
                    }`}
                  >
                    {formatDuration(minutes)}
                  </button>
                );
              })}

              <button
                type="button"
                aria-pressed={choice.kind === "libre"}
                onClick={() => setChoice({ kind: "libre" })}
                className={`rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                  choice.kind === "libre"
                    ? "bg-ember-500/15 text-ember-400 shadow-[inset_0_0_0_1px_var(--color-ember-500)]"
                    : "border border-steel-700 text-steel-300 hover:border-steel-600 hover:text-steel-100"
                }`}
              >
                Autre
              </button>
            </div>

            {choice.kind === "libre" ? (
              <div className="mt-1 flex flex-col gap-1">
                <label htmlFor="routine-duree" className="sr-only">
                  Durée en minutes
                </label>
                <input
                  id="routine-duree"
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  value={libre}
                  placeholder="Durée en minutes (ex. 75)"
                  aria-invalid={showDurationError}
                  aria-describedby={showDurationError ? "routine-duree-error" : undefined}
                  onChange={(event) => setLibre(event.target.value)}
                  className="w-full max-w-56 rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 font-mono text-sm text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none"
                />
                {showDurationError ? (
                  <p id="routine-duree-error" className="text-xs text-ember-400">
                    {durationError}
                  </p>
                ) : null}
              </div>
            ) : null}
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="routine-focus" className="text-xs font-medium text-steel-200">
              Focus <span className="text-steel-500">(optionnel)</span>
            </label>
            <input
              id="routine-focus"
              type="text"
              autoComplete="off"
              maxLength={MAX_FOCUS_LENGTH}
              value={focus}
              disabled={generating}
              placeholder="Ex. tracking, ou entrées sur A"
              onChange={(event) => setFocus(event.target.value)}
              className="w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
            >
              {generating ? "Génération…" : "Générer ma routine"}
            </button>

            <p className="ml-auto text-xs text-steel-500">
              {quota.status === "unknown"
                ? `${ROUTINE_DAILY_QUOTA} routines par jour`
                : quota.status === "lifted"
                  ? "Quota levé · ta configuration IA"
                  : `${quota.remaining} routine${quota.remaining > 1 ? "s" : ""} restante${quota.remaining > 1 ? "s" : ""} aujourd'hui`}
            </p>
          </div>

          {generating ? (
            <Notice tone="loading" title="La séance se construit…">
              La génération prend quelques secondes. Ne recharge pas la page.
            </Notice>
          ) : null}

          {failure !== null ? (
            failure.quota ? (
              <Notice tone="empty" title="Quota du jour atteint.">
                {failure.message}
              </Notice>
            ) : (
              <Notice tone="error" title="La routine n'a pas pu être générée.">
                {failure.message}
              </Notice>
            )
          ) : null}

          {history.status === "ready" && routines.length === 0 ? (
            <Notice tone="empty" title="Aucune routine pour l'instant.">
              Choisis un temps disponible ci-dessus : la première séance apparaîtra ici.
            </Notice>
          ) : null}
        </form>
      ) : today === null ? null : (
        <button
          type="button"
          onClick={() => setFormOpen(true)}
          className="self-start rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-ember-600 hover:text-ember-400"
        >
          Générer une autre routine
        </button>
      )}

      {past.length === 0 ? null : (
        <div className="border-t border-steel-800 pt-4">
          <button
            type="button"
            onClick={() => setPastOpen(!pastOpen)}
            aria-expanded={pastOpen}
            aria-controls="routines-passees"
            className="flex w-full items-center gap-2 text-left text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase transition-colors hover:text-steel-200"
          >
            Routines passées · {past.length}
            <Chevron open={pastOpen} />
          </button>

          {pastOpen ? (
            <ul id="routines-passees" className="mt-3 flex flex-col gap-2">
              {past.map((routine) => (
                <RoutineCard key={routine.id} {...cardProps(routine)} />
              ))}
            </ul>
          ) : null}
        </div>
      )}
    </section>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`size-3 shrink-0 text-steel-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M2 4.5 6 8.5 10 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
