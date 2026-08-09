/**
 * Les pièces communes aux quatre blocs du panneau d'administration
 * (SPEC §5 quater).
 *
 * Les quatre font le même geste — modifier un réglage, l'enregistrer, dire ce
 * qui s'est passé — et l'enregistrement est **partiel** : chaque bloc n'envoie
 * que ce qu'il touche. C'est ce qui permet de corriger un quota sans risquer
 * d'effacer une clé qu'on ne peut pas relire pour la remettre.
 */

import { type ReactNode, useState } from "react";
import type { AdminSettings, AdminSettingsSave } from "../../shared/admin-contract";
import { saveAdminSettings } from "../data";

/** Ce qu'un bloc est en train de faire, et ce qu'il a à dire. */
export type Action =
  | { readonly kind: "idle" }
  | { readonly kind: "saving" }
  | { readonly kind: "done"; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

export interface PanelProps {
  readonly settings: AdminSettings;
  /** Remonte l'état complet renvoyé par le serveur après enregistrement. */
  readonly onSaved: (settings: AdminSettings) => void;
}

/**
 * L'enregistrement d'un bloc : un état, et une fonction qui le fait avancer.
 *
 * Le message de succès est fourni par l'appelant parce qu'il n'est pas
 * décoratif — « Clé enregistrée » et « Quotas enregistrés » ne se vérifient pas
 * de la même façon, et l'administrateur doit savoir ce qui vient de bouger.
 */
export function useSave(onSaved: (settings: AdminSettings) => void) {
  const [action, setAction] = useState<Action>({ kind: "idle" });

  async function save(patch: AdminSettingsSave, done: string): Promise<void> {
    setAction({ kind: "saving" });
    try {
      onSaved(await saveAdminSettings(patch));
      setAction({ kind: "done", message: done });
    } catch (cause) {
      setAction({
        kind: "error",
        message: cause instanceof Error ? cause.message : "L'enregistrement a échoué.",
      });
    }
  }

  return { action, save, reset: () => setAction({ kind: "idle" }) };
}

interface SectionProps {
  readonly title: string;
  readonly hint: string;
  /** Un état à afficher à côté du titre : « Enregistrée », « Repli env »… */
  readonly badge?: ReactNode;
  readonly children: ReactNode;
}

export function Section({ title, hint, badge, children }: SectionProps) {
  return (
    <section className="flex flex-col gap-5 rounded-xl border border-steel-800 bg-steel-900/40 p-4 sm:p-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-steel-100 sm:text-lg">{title}</h2>
          {badge}
        </div>
        <p className="mt-1 text-xs text-steel-500">{hint}</p>
      </div>
      {children}
    </section>
  );
}

type BadgeTone = "ok" | "warn" | "muted";

const BADGE_CLASSES: Readonly<Record<BadgeTone, string>> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  muted: "border-steel-700 bg-steel-800 text-steel-400",
};

export function Badge({
  tone,
  children,
}: {
  readonly tone: BadgeTone;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${BADGE_CLASSES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * La ligne de retour, sous les boutons.
 *
 * `aria-live="polite"` : l'enregistrement n'a aucun effet visible ailleurs sur
 * l'écran (les clés ne se réaffichent pas, les quotas restent tels quels), donc
 * cette phrase est la **seule** confirmation qu'il a eu lieu. Elle doit être
 * annoncée, pas seulement peinte.
 */
export function Feedback({ action }: { readonly action: Action }) {
  return (
    <p aria-live="polite" className="min-h-4 text-xs">
      {action.kind === "error" ? <span className="text-ember-400">{action.message}</span> : null}
      {action.kind === "done" ? <span className="text-emerald-400">{action.message}</span> : null}
    </p>
  );
}
