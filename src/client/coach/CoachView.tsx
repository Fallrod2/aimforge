/**
 * Vue Coach post-game : coller les stats d'une partie, obtenir un debrief
 * structuré, relire les précédents.
 *
 * Une seule zone de saisie, libre : les tableaux de stats de Valorant n'ont pas
 * de format stable (client de jeu, Tracker.gg, capture recopiée), donc découper
 * la saisie en champs reviendrait à imposer au joueur un travail que le modèle
 * fait mieux. Le compteur de caractères est là parce que la fonction refuse
 * au-delà de 8 000 : mieux vaut le savoir avant d'envoyer.
 *
 * La génération passe par `api/coach` (seul détenteur de la clé Anthropic), qui
 * enregistre lui-même le debrief. Le nouveau debrief est donc simplement placé
 * en tête de l'historique — sans rechargement, il est déjà à jour.
 *
 * La zone de saisie peut être **pré-remplie de l'extérieur** (SPEC §5 bis :
 * débriefer un match importé) par deux chemins, dans cet ordre de priorité :
 * la prop `initialStats`, puis la boîte à lettres de `./prefill` que
 * l'appelant remplit juste avant de naviguer vers `#/coach`. Les deux ne
 * fournissent qu'une valeur *initiale* : une fois la vue montée, le texte
 * appartient au joueur, et rien ne vient le réécrire sous ses doigts.
 */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  COACH_DAILY_QUOTA,
  MAX_STATS_LENGTH,
  type StoredDebrief,
} from "../../shared/coach-contract";
import { Notice } from "../components/Notice";
import { deleteDebrief, listDebriefs } from "../data";
import { CoachError, requestDebrief } from "./coach-api";
import { DebriefCard } from "./DebriefCard";
import { takeCoachPrefill } from "./prefill";

type History =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly debriefs: readonly StoredDebrief[] };

/** Un échec de génération : quota atteint et panne ne se disent pas pareil. */
interface Failure {
  readonly message: string;
  readonly quota: boolean;
}

const PLACEHOLDER = `Colle ici le tableau de stats de ta partie. Par exemple :

Ascent — Défaite 11-13
Jett — 18/14/5 — ADR 152 — HS 21 %
1er sang : 4 — Clutchs : 1/3
Achats : 3 éco perdues, force-buy en 9`;

function failureOf(cause: unknown): Failure {
  if (cause instanceof CoachError) return { message: cause.message, quota: cause.quotaReached };
  return {
    message: cause instanceof Error ? cause.message : "La génération a échoué.",
    quota: false,
  };
}

interface CoachViewProps {
  /**
   * Texte à placer dans la zone de saisie au montage. Ignoré ensuite : pour
   * pré-remplir une vue déjà montée, il faut la remonter (`key`) ou passer par
   * `setCoachPrefill` avant de naviguer.
   */
  readonly initialStats?: string;
}

export function CoachView({ initialStats }: CoachViewProps = {}) {
  const [stats, setStats] = useState(initialStats ?? "");
  const [generating, setGenerating] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  /** Debriefs restants aujourd'hui ; `null` tant que la fonction ne l'a pas dit. */
  const [remaining, setRemaining] = useState<number | null>(null);
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [freshId, setFreshId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [confirmingId, setConfirmingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      const debriefs = await listDebriefs();

      setHistory({ status: "ready", debriefs });
      // Le dernier debrief est déplié d'office : c'est ce qu'on vient chercher
      // en ouvrant la page, et la liste reste lisible même à vingt entrées.
      setExpandedId((current) => current ?? debriefs[0]?.id ?? null);
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

  // Le pré-remplissage est relevé dans un effet, pas dans l'initialisation de
  // l'état : `useState(takeCoachPrefill())` serait appelé deux fois en
  // développement (StrictMode rejoue le rendu), et le second appel trouverait
  // la boîte déjà vidée par le premier. La boîte est relevée dans tous les cas
  // — même quand `initialStats` gagne — pour qu'un dépôt orphelin ne
  // ressurgisse pas au prochain montage de la vue.
  useEffect(() => {
    const pending = takeCoachPrefill();

    if (pending !== null && initialStats === undefined) setStats(pending);
  }, [initialStats]);

  const trimmed = stats.trim();
  const tooLong = stats.length > MAX_STATS_LENGTH;
  const canSubmit = trimmed !== "" && !tooLong && !generating;

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSubmit) return;

    setGenerating(true);
    setFailure(null);
    setDeleteError(null);
    try {
      const { debrief, remaining: left } = await requestDebrief(trimmed);

      setHistory((current) =>
        current.status === "ready"
          ? { status: "ready", debriefs: [debrief, ...current.debriefs] }
          : { status: "ready", debriefs: [debrief] },
      );
      setFreshId(debrief.id);
      setExpandedId(debrief.id);
      setRemaining(left);
      setStats("");
    } catch (cause) {
      const next = failureOf(cause);

      setFailure(next);
      if (cause instanceof CoachError && cause.remaining !== null) setRemaining(cause.remaining);
    } finally {
      setGenerating(false);
    }
  }

  async function confirmDelete(id: number): Promise<void> {
    setDeletingId(id);
    setDeleteError(null);
    try {
      await deleteDebrief(id);
      setHistory((current) =>
        current.status === "ready"
          ? { status: "ready", debriefs: current.debriefs.filter((entry) => entry.id !== id) }
          : current,
      );
      setConfirmingId(null);
      if (freshId === id) setFreshId(null);
      if (expandedId === id) setExpandedId(null);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : "La suppression a échoué.");
    } finally {
      setDeletingId(null);
    }
  }

  const debriefs = history.status === "ready" ? history.debriefs : [];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-steel-100">Coach post-game</h2>
        <p className="mt-0.5 text-xs text-steel-500">
          Colle les stats d'une partie : le coach en tire ce qui a marché, deux ou trois axes
          concrets et un focus pour la prochaine session.
        </p>
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4 sm:p-5"
      >
        <label htmlFor="coach-stats" className="text-xs font-medium text-steel-200">
          Stats de la partie
        </label>
        <textarea
          id="coach-stats"
          rows={8}
          value={stats}
          disabled={generating}
          placeholder={PLACEHOLDER}
          aria-describedby="coach-stats-count"
          onChange={(event) => setStats(event.target.value)}
          className="w-full resize-y rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 font-mono text-xs leading-relaxed text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
          >
            {generating ? "Génération…" : "Générer le debrief"}
          </button>

          <p
            id="coach-stats-count"
            className={`font-mono text-xs tabular-nums ${tooLong ? "text-ember-400" : "text-steel-500"}`}
          >
            {stats.length} / {MAX_STATS_LENGTH}
            {tooLong ? " · trop long, coupe le texte" : ""}
          </p>

          <p className="ml-auto text-xs text-steel-500">
            {remaining === null
              ? `${COACH_DAILY_QUOTA} debriefs par jour`
              : `${remaining} debrief${remaining > 1 ? "s" : ""} restant${remaining > 1 ? "s" : ""} aujourd'hui`}
          </p>
        </div>

        {generating ? (
          <Notice tone="loading" title="Le coach lit ta partie…">
            La génération prend quelques secondes. Ne recharge pas la page.
          </Notice>
        ) : null}

        {failure !== null ? (
          failure.quota ? (
            <Notice tone="empty" title="Quota du jour atteint.">
              {failure.message}
            </Notice>
          ) : (
            <Notice tone="error" title="Le debrief n'a pas pu être généré.">
              {failure.message}
            </Notice>
          )
        ) : null}
      </form>

      <section className="flex flex-col gap-3">
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          Historique {history.status === "ready" ? `· ${debriefs.length}` : ""}
        </h3>

        {deleteError !== null ? (
          <Notice tone="error" title="Suppression impossible.">
            {deleteError}
          </Notice>
        ) : null}

        {history.status === "loading" ? (
          <Notice tone="loading" title="Chargement des debriefs…" />
        ) : history.status === "error" ? (
          <Notice
            tone="error"
            title="Les debriefs n'ont pas pu être chargés."
            onRetry={() => void load()}
          >
            {history.message}
          </Notice>
        ) : debriefs.length === 0 ? (
          <Notice tone="empty" title="Aucun debrief pour l'instant.">
            Colle les stats de ta dernière partie ci-dessus : le premier debrief apparaîtra ici.
          </Notice>
        ) : (
          <ul className="flex flex-col gap-2">
            {debriefs.map((debrief) => (
              <DebriefCard
                key={debrief.id}
                debrief={debrief}
                fresh={debrief.id === freshId}
                expanded={debrief.id === expandedId}
                onToggle={() => {
                  setConfirmingId(null);
                  setExpandedId(expandedId === debrief.id ? null : debrief.id);
                }}
                confirming={confirmingId === debrief.id}
                deleting={deletingId === debrief.id}
                onAskDelete={() => setConfirmingId(debrief.id)}
                onCancelDelete={() => setConfirmingId(null)}
                onConfirmDelete={() => void confirmDelete(debrief.id)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
