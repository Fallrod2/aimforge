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
 *
 * ## L'attente (V4-C §4.9)
 *
 * L'état de la génération ne vit **pas** ici : il est dans un magasin de module
 * (`./generation.ts`), au-dessus de la vue. C'est ce qui rend l'application
 * navigable pendant les quinze secondes d'une génération — ouvrir Perfs et
 * revenir ne perd plus rien, et la séance s'affiche à son retour. La vue ne
 * fait que trois choses avec ce magasin : lancer, montrer l'attente, et
 * **relever** le résultat quand il est là (`settle`).
 *
 * L'écran d'attente lui-même est un squelette d'étapes datées
 * (`../coach/GenerationProgress`), pas un texte qui coule : la raison — et le
 * refus assumé du streaming — est écrite dans `../coach/progress.ts`.
 */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import { DUREE_PRESETS, MAX_FOCUS_LENGTH, type StoredRoutine } from "../../shared/routine-contract";
import { GenerationProgress } from "../coach/GenerationProgress";
import { upsertById, useGeneration } from "../coach/generation-store";
import { ROUTINE_EXPECTATION, ROUTINE_STEPS } from "../coach/progress";
import { UndoToast } from "../components/Destructive";
import { Notice } from "../components/Notice";
import { QuotaNote } from "../components/QuotaNote";
import { useConfirm, usePendingUndo } from "../components/useConfirm";
import { deleteRoutine, listRoutines, setRoutineDone } from "../data";
import { formatDuration, normalizeFocus, parseDuration } from "./duration";
import { routineGeneration } from "./generation";
import { RoutineCard } from "./RoutineCard";
import { computeStreak, formatStreak } from "./streak";
import { latestOfLocalDay } from "./today";

type History =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly routines: readonly StoredRoutine[] };

/** La durée choisie : un preset, ou la saisie libre. */
type DureeChoice =
  | { readonly kind: "preset"; readonly minutes: number }
  | { readonly kind: "libre" };

const DEFAULT_MINUTES = 45;

export function RoutinePanel() {
  const [choice, setChoice] = useState<DureeChoice>({ kind: "preset", minutes: DEFAULT_MINUTES });
  const [libre, setLibre] = useState("");
  const [focus, setFocus] = useState("");
  /** La génération en cours, où qu'on soit passé entre-temps (`./generation`). */
  const generation = useGeneration(routineGeneration);
  const generating = generation.status === "running";
  /**
   * Ce que la dernière réponse de `/api/routine` a dit du restant : `undefined`
   * tant qu'il n'y en a pas eu, `null` quand elle n'a rien compté (SPEC §5 ter).
   * La limite et l'heure de réinitialisation appartiennent à `QuotaNote`, qui
   * les tient du serveur — l'écran n'a pas à les connaître.
   */
  const [remaining, setRemaining] = useState<number | null | undefined>(undefined);
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [freshId, setFreshId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  /** La confirmation en deux appuis, partagée par la carte du jour et les passées. */
  const confirm = useConfirm();
  /**
   * La routine supprimée qui attend son « Annuler » (V5-A §5.4).
   *
   * Elle est **cachée** de la liste plutôt qu'enlevée : l'annulation n'a alors
   * rien à réinsérer, et la routine du jour retrouve sa place — y compris son
   * statut de routine du jour, que `latestOfLocalDay` recalcule tout seul.
   */
  const removed = usePendingUndo<StoredRoutine>((routine) => void commitDelete(routine));
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

  /**
   * On relève ce que le magasin a fini de produire, puis on lui rend la place.
   *
   * C'est ici — et pas dans `submit` — parce que la génération a pu se terminer
   * pendant que cette vue était démontée : au retour, c'est le premier rendu qui
   * découvre le résultat. `upsertById` est ce qui rend l'opération sûre dans les
   * deux cas, puisque le rechargement de la liste a très bien pu ramener la
   * routine avant qu'on la relève.
   *
   * L'échec, lui, n'est **pas** relevé : il reste dans le magasin, c'est lui qui
   * porte la demande à rejouer. Seul le quota qu'il annonce est repris.
   */
  useEffect(() => {
    if (generation.status === "failed") {
      if (generation.failure.remaining !== null) setRemaining(generation.failure.remaining);
      return;
    }
    if (generation.status !== "done") return;

    const { routine, remaining: left } = generation.result;

    setHistory((current) =>
      current.status === "ready"
        ? { status: "ready", routines: upsertById(current.routines, routine) }
        : { status: "ready", routines: [routine] },
    );
    setFreshId(routine.id);
    setExpandedId(routine.id);
    setRemaining(left);
    routineGeneration.settle();
  }, [generation]);

  const parsed =
    choice.kind === "preset"
      ? { ok: true as const, minutes: choice.minutes }
      : parseDuration(libre);
  const durationError = parsed.ok ? null : parsed.message;
  // Un champ libre encore vide n'est pas une faute : il n'a juste pas encore
  // été rempli. On désactive le bouton sans afficher de rouge.
  const showDurationError = durationError !== null && libre.trim() !== "";
  const canSubmit = parsed.ok && !generating;

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!parsed.ok || generating) return;

    setRowError(null);
    // La demande part au magasin, qui la mènera à son terme même si cette vue
    // disparaît entre-temps. Elle est retenue telle quelle : c'est elle que
    // « Réessayer » rejouera, sans re-saisie.
    routineGeneration.start({ minutes: parsed.minutes, focus: normalizeFocus(focus) });
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

  /** L'appel réel, cinq secondes après le geste — s'il n'a pas été annulé. */
  async function commitDelete(routine: StoredRoutine): Promise<void> {
    setRowError(null);
    try {
      await deleteRoutine(routine.id);
      setHistory((current) =>
        current.status === "ready"
          ? {
              status: "ready",
              routines: current.routines.filter((entry) => entry.id !== routine.id),
            }
          : current,
      );
    } catch (cause) {
      // Rien n'avait été retiré de la liste : la routine réapparaît d'elle-même,
      // et le message dit pourquoi.
      setRowError(cause instanceof Error ? cause.message : "La suppression a échoué.");
    }
  }

  function askDelete(routine: StoredRoutine): void {
    if (!confirm.press(`routine-${routine.id}`)) return;
    if (freshId === routine.id) setFreshId(null);
    if (expandedId === routine.id) setExpandedId(null);
    removed.schedule(routine);
  }

  const hiddenId = removed.pending?.id ?? null;
  const routines = (history.status === "ready" ? history.routines : []).filter(
    (routine) => routine.id !== hiddenId,
  );
  const today = latestOfLocalDay(routines);
  const past = routines.filter((routine) => routine.id !== today?.id);
  // La régularité se lit dans la liste déjà chargée : aucune requête de plus.
  // `formatStreak` rend `null` quand il n'y a rien à annoncer — c'est lui qui
  // décide du silence, pas cette vue (cf. `./streak.ts`).
  const streak = formatStreak(computeStreak(routines));
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
        confirm.cancel();
        setExpandedId(expandedId === routine.id ? null : routine.id);
      },
      toggling: togglingId === routine.id,
      onToggleDone: () => void toggleDone(routine),
      deleteArmed: confirm.armed(`routine-${routine.id}`),
      onPressDelete: () => askDelete(routine),
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
        {/* La régularité, en une ligne et sans médaille : elle n'apparaît que
            lorsqu'il y a quelque chose à constater (V4-C §4.6). */}
        {streak === null ? null : (
          <p className="mt-2 font-mono text-[11px] tabular-nums text-steel-400">{streak}</p>
        )}
      </div>

      {rowError !== null ? (
        <Notice tone="error" title="Action impossible.">
          {rowError}
        </Notice>
      ) : null}

      {/* L'attente et l'échec vivent **hors du formulaire** : la génération leur
          survit, et le formulaire peut très bien être replié (routine du jour
          déjà là) quand on revient d'un autre écran. */}
      {generation.status === "running" ? (
        <GenerationProgress
          title="La séance se construit…"
          steps={ROUTINE_STEPS}
          expectation={ROUTINE_EXPECTATION}
          startedAt={generation.startedAt}
        />
      ) : null}

      {generation.status === "failed" ? (
        generation.failure.quota ? (
          <Notice tone="empty" title="Quota du jour atteint.">
            {generation.failure.message}
          </Notice>
        ) : (
          <Notice
            tone="error"
            title="La routine n'a pas pu être générée."
            onRetry={() => routineGeneration.retry()}
          >
            <p>{generation.failure.message}</p>
            <p className="mt-1">
              « Réessayer » relance la même demande — {formatDuration(generation.request.minutes)}
              {generation.request.focus === null ? "" : `, focus « ${generation.request.focus} »`} —
              sans rien resaisir.
            </p>
          </Notice>
        )
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
        <form onSubmit={submit} className="flex flex-col gap-4">
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
                  className="w-full max-w-56 rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 font-mono text-sm text-steel-100 transition-colors placeholder:text-steel-400 hover:border-steel-600 focus:border-ember-500"
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
              className="w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-400 hover:border-steel-600 focus:border-ember-500 disabled:opacity-60"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={!canSubmit}
              className="rounded-lg bg-brand-fill px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
            >
              {generating ? "Génération…" : "Générer ma routine"}
            </button>

            <QuotaNote kind="routine" remaining={remaining} className="ml-auto text-xs" />
          </div>

          {/* L'attente et l'échec sont affichés en tête de zone, hors de ce
              formulaire : ils survivent à sa fermeture comme au démontage. */}

          {history.status === "ready" && routines.length === 0 && !generating ? (
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

      {removed.pending === null ? null : (
        <UndoToast message="Routine supprimée." onUndo={removed.undo} />
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
