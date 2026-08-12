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
 *
 * Depuis V5 (SPEC §5 sexies), la carte porte aussi **l'ancrage** de la séance :
 *
 * - un **bandeau** quand la routine a été bâtie sur le seul bench, avec le
 *   nombre de parties classées qui manquent pour un plan complet. Il est dans
 *   la carte et non dans le formulaire parce que le mode appartient à *cette*
 *   routine-là : une séance d'hier générée sans parties doit continuer à le
 *   dire dans l'historique ;
 * - les **sources** : les chiffres que le modèle a cités et que le serveur a
 *   vérifiés (`src/server/routine/citations.ts`). Les marqueurs eux-mêmes ont
 *   été retirés du texte avant enregistrement — une séance se lit comme une
 *   séance, pas comme un article annoté — et les chiffres sont rendus en puces
 *   sous la routine. Le choix est assumé : on garde la preuve (« sur quoi
 *   est-ce que ça se fonde ? ») sans hacher les phrases qui la portent.
 *
 * Les deux sont facultatifs dans le contrat : une routine d'avant V5 n'a ni
 * mode ni sources, et n'affiche donc ni bandeau ni puces.
 */

import { useState } from "react";
import {
  ROUTINE_MIN_RECENT_MATCHES,
  type RoutineSource,
  type StoredRoutine,
} from "../../shared/routine-contract";
import { ConfirmButton } from "../components/Destructive";
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
  /** Le bouton attend sa confirmation (`../components/confirm.ts`). */
  readonly deleteArmed: boolean;
  /** Les deux appuis passent par le même rappel : la machine les distingue. */
  readonly onPressDelete: () => void;
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
  deleteArmed,
  onPressDelete,
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
          <BenchOnlyBanner routine={routine} />

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

          <RoutineSources sources={routine.sources ?? []} />

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

            {/* Un seul bouton, qui devient sa propre question (V5-A §5.4) : le
                panneau de confirmation d'avant déplaçait « Marquer comme
                faite » au moment où l'on visait « Annuler ». */}
            <ConfirmButton
              label="Supprimer"
              question="Supprimer définitivement ?"
              armed={deleteArmed}
              onPress={onPressDelete}
              className="ml-auto"
            />
          </div>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Le bandeau du mode « bench seul ».
 *
 * `missing` est recalculé ici à partir du seuil du contrat plutôt que stocké :
 * le compte de parties, lui, est un fait daté (« il y en avait 2 ce jour-là »),
 * alors que le seuil est une règle du produit qui peut bouger. Recalculer garde
 * la phrase cohérente avec la règle du moment.
 */
function BenchOnlyBanner({ routine }: { readonly routine: StoredRoutine }) {
  if (routine.mode !== "bench_only") return null;

  const missing = Math.max(1, ROUTINE_MIN_RECENT_MATCHES - (routine.matchesUsed ?? 0));

  return (
    <p className="mb-4 rounded-lg border border-steel-700 bg-steel-950/60 px-3 py-2.5 text-xs leading-relaxed text-steel-300">
      Routine basée sur ton bench seul — joue {missing} partie{missing > 1 ? "s" : ""} classée
      {missing > 1 ? "s" : ""} pour un plan complet.
    </p>
  );
}

/**
 * Les chiffres cités par le modèle, vérifiés par le serveur.
 *
 * Rendus en puces plutôt que laissés dans le texte : la phrase reste lisible, et
 * la donnée reste vérifiable. Rien à afficher quand la liste est vide — une
 * routine sans source n'a rien à prouver, elle n'a rien avancé.
 *
 * Exporté depuis V4-B : la landing montre ce bloc sur une routine d'exemple,
 * parce que c'est lui qui porte la promesse (« chaque chiffre est vérifié »).
 * Le montrer avec un autre composant reviendrait à montrer autre chose.
 */
export function RoutineSources({ sources }: { readonly sources: readonly RoutineSource[] }) {
  if (sources.length === 0) return null;

  return (
    <Section title="Sources">
      <ul className="flex flex-col gap-1">
        {sources.map((source) => (
          <li key={source.label} className="flex items-baseline gap-2 text-xs text-steel-400">
            <span className="min-w-0 flex-1 truncate">{source.label}</span>
            <span className="shrink-0 font-mono tabular-nums text-steel-200">{source.value}</span>
          </li>
        ))}
      </ul>
    </Section>
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
