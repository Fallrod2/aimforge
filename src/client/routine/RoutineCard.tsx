/**
 * Une routine à l'écran : ligne repliée (date, durée, titre, badge « faite ») et
 * contenu déplié (blocs minutés, items cochables, objectif en game, conseil,
 * « marquer comme faite », suppression).
 *
 * Même composant pour la routine qui vient d'être générée et pour celles de
 * l'historique — comme `DebriefCard` : ce qui sort de la fonction et ce qui est
 * relu en base sont la même chose, les afficher différemment inviterait à
 * croire le contraire.
 *
 * **Les cases cochées ne sont pas persistées.** Décision assumée : cocher
 * pendant la séance est un fil d'Ariane, pas une donnée. La ligne d'une routine
 * ne porte qu'un `done` (SPEC §3), et ajouter un état par item demanderait une
 * migration pour un gain nul — un joueur qui recharge sa page au milieu d'un
 * scénario le sait très bien, où il en est. Ce qui doit survivre survit :
 * « marquer comme faite », lui, part en base. Les cases retombent donc à zéro
 * au rechargement, et c'est la seule chose que ce composant oublie.
 */

import { useState } from "react";
import type { StoredRoutine } from "../../shared/routine-contract";
import { formatRunDate } from "../format";
import { formatDuration } from "./duration";

interface RoutineCardProps {
  readonly routine: StoredRoutine;
  /** Met en avant la routine qui vient d'être générée. */
  readonly fresh?: boolean;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  /** `null` pendant que la bascule « faite » est en vol. */
  readonly toggling: boolean;
  readonly onToggleDone: () => void;
  readonly confirming: boolean;
  readonly deleting: boolean;
  readonly onAskDelete: () => void;
  readonly onCancelDelete: () => void;
  readonly onConfirmDelete: () => void;
}

/** Identifiant stable d'un item dans une routine : bloc + position. */
function itemKey(blocIndex: number, itemIndex: number): string {
  return `${blocIndex}-${itemIndex}`;
}

export function RoutineCard({
  routine,
  fresh = false,
  expanded,
  onToggle,
  toggling,
  onToggleDone,
  confirming,
  deleting,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: RoutineCardProps) {
  const panelId = `routine-${routine.id}-detail`;
  /** Cases cochées, en mémoire de vue uniquement (voir l'en-tête du module). */
  const [checked, setChecked] = useState<ReadonlySet<string>>(() => new Set());

  function toggleItem(key: string): void {
    setChecked((current) => {
      const next = new Set(current);

      if (!next.delete(key)) next.add(key);
      return next;
    });
  }

  const totalItems = routine.blocs.reduce((sum, bloc) => sum + bloc.items.length, 0);

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
            <span className="text-sm text-steel-100">{formatRunDate(routine.date)}</span>
            <span className="font-mono text-xs tabular-nums text-steel-500">
              {formatDuration(routine.duree_minutes)}
            </span>
            {routine.done ? (
              <span className="rounded-full bg-steel-700/60 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-steel-300 uppercase">
                Faite
              </span>
            ) : null}
            {fresh ? (
              <span className="rounded-full bg-ember-500/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ember-400 uppercase">
                Nouveau
              </span>
            ) : null}
          </span>
          <span className="mt-1 block truncate text-xs text-steel-500">{routine.titre}</span>
        </span>
        <Chevron open={expanded} />
      </button>

      {expanded ? (
        <div id={panelId} className="border-t border-steel-800 px-4 py-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h4 className="text-sm font-semibold text-steel-100">{routine.titre}</h4>
            <p className="font-mono text-xs tabular-nums text-steel-500">
              {formatDuration(routine.duree_totale)} · {totalItems} exercice
              {totalItems > 1 ? "s" : ""}
            </p>
            {routine.focus === null ? null : (
              <p className="text-xs text-steel-500">Focus demandé : {routine.focus}</p>
            )}
          </div>

          <ol className="mt-4 flex flex-col gap-3">
            {routine.blocs.map((bloc, blocIndex) => (
              <li
                // biome-ignore lint/suspicious/noArrayIndexKey: liste statique jamais réordonnée, deux blocs peuvent partager un nom — l'index évite la collision de clés.
                key={`${blocIndex}-${bloc.nom}`}
                className="rounded-lg bg-steel-950/60 px-3 py-3"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-semibold text-steel-200">{bloc.nom}</p>
                  <p className="shrink-0 font-mono text-xs tabular-nums text-steel-500">
                    {formatDuration(bloc.duree)}
                  </p>
                </div>

                <ul className="mt-2 flex flex-col gap-2">
                  {bloc.items.map((item, itemIndex) => {
                    const key = itemKey(blocIndex, itemIndex);
                    const isChecked = checked.has(key);

                    return (
                      // `key` est la position (bloc, item) : la liste n'est
                      // jamais réordonnée, et deux items peuvent partager un
                      // texte — c'est la seule clé qui ne collisionne pas.
                      <li key={key}>
                        <label className="flex cursor-pointer items-start gap-2.5">
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleItem(key)}
                            className="mt-0.5 size-4 shrink-0 accent-ember-500"
                          />
                          <span className="min-w-0">
                            <span
                              className={`block text-sm ${
                                isChecked ? "text-steel-500 line-through" : "text-steel-100"
                              }`}
                            >
                              {item.texte}
                            </span>
                            <span className="mt-0.5 block text-xs leading-relaxed text-steel-400">
                              {item.detail}
                            </span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ol>

          <Section title="Objectif en game">
            <p className="rounded-lg border border-ember-600/40 bg-ember-600/10 px-3 py-2.5 text-sm text-ember-300">
              {routine.objectif_game}
            </p>
          </Section>

          <Section title="Conseil">
            <p className="text-sm leading-relaxed text-steel-300">{routine.conseil}</p>
          </Section>

          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-steel-800 pt-4">
            <button
              type="button"
              onClick={onToggleDone}
              disabled={toggling}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${
                routine.done
                  ? "border border-steel-700 text-steel-300 hover:text-steel-100"
                  : "bg-ember-500 text-steel-950 hover:bg-ember-400"
              }`}
            >
              {toggling
                ? "Enregistrement…"
                : routine.done
                  ? "Marquer comme non faite"
                  : "Marquer comme faite"}
            </button>

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
                Supprimer
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
