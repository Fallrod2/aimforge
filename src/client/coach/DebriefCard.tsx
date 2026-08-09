/**
 * Un debrief à l'écran : ligne repliée (date, focus en une ligne) et contenu
 * déplié (résumé, points forts, axes, focus, suppression).
 *
 * Même composant pour le debrief qui vient d'être généré et pour ceux de
 * l'historique : ce qui sort du coach et ce qui est relu en base sont la même
 * chose, les afficher différemment inviterait à croire le contraire.
 */

import type { StoredDebrief } from "../../shared/coach-contract";
import { formatRunDate } from "../format";

interface DebriefCardProps {
  readonly debrief: StoredDebrief;
  /** Met en avant le debrief qui vient d'être généré. */
  readonly fresh?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly confirming: boolean;
  readonly deleting: boolean;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

export function DebriefCard({
  debrief,
  fresh = false,
  expanded,
  onToggle,
  confirming,
  deleting,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: DebriefCardProps) {
  const panelId = `debrief-${debrief.id}-detail`;

  return (
    <li
      className={`overflow-hidden rounded-xl border bg-steel-900/60 ${
        fresh ? "border-ember-600/60" : "border-steel-800"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-steel-850"
      >
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-steel-100">{formatRunDate(debrief.date)}</span>
            {fresh ? (
              <span className="rounded-full bg-ember-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ember-400 uppercase">
                Nouveau
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-steel-500">{debrief.focus}</span>
        </span>
        <Chevron open={expanded} />
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-steel-800 px-4 py-4">
          <p className="text-sm leading-relaxed text-steel-200">{debrief.resume}</p>

          <Section title="Ce qui a marché">
            <ul className="flex flex-col gap-1.5">
              {debrief.points_forts.map((point, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, et le contenu peut légitimement se répéter — l'index évite la collision de clés.
                <li key={`${index}-${point}`} className="flex gap-2 text-sm text-steel-300">
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-1.5 shrink-0 rounded-full bg-steel-600"
                  />
                  <span className="min-w-0">{point}</span>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Axes de travail">
            <ul className="flex flex-col gap-3">
              {debrief.axes.map((axe, index) => (
                <li
                  // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, deux axes peuvent partager un titre — l'index évite la collision de clés.
                  key={`${index}-${axe.titre}`}
                  className="rounded-lg bg-steel-950/60 px-3 py-2.5"
                >
                  <p className="text-sm font-semibold text-steel-100">{axe.titre}</p>
                  <p className="mt-1 text-sm leading-relaxed text-steel-400">{axe.detail}</p>
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Focus de la prochaine session">
            <p className="rounded-lg border border-ember-600/40 bg-ember-600/10 px-3 py-2.5 text-sm text-ember-300">
              {debrief.focus}
            </p>
          </Section>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-steel-800 pt-4">
            {confirming ? (
              <>
                <p className="mr-auto text-xs text-steel-400">Supprimer définitivement ?</p>
                <button
                  type="button"
                  onClick={onCancelDelete}
                  disabled={deleting}
                  className="rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-300 transition-colors hover:text-steel-100 disabled:opacity-50"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={onConfirmDelete}
                  disabled={deleting}
                  className="rounded-lg bg-ember-600 px-3 py-1.5 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:opacity-50"
                >
                  {deleting ? "Suppression…" : "Confirmer"}
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={onAskDelete}
                className="ml-auto rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-400 transition-colors hover:border-ember-600 hover:text-ember-400"
              >
                Supprimer ce debrief
              </button>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  children,
}: {
  readonly title: string;
  readonly children: React.ReactNode;
}) {
  return (
    <section className="mt-5">
      <h4 className="mb-2 text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        {title}
      </h4>
      {children}
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
