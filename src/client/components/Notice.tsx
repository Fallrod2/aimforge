/**
 * Encart d'état : chargement, erreur réseau, liste vide. Un seul composant
 * pour les trois, afin que les trois se ressemblent d'une vue à l'autre.
 */

import type { ReactNode } from "react";

type NoticeTone = "loading" | "error" | "empty";

interface NoticeProps {
  readonly tone: NoticeTone;
  readonly title: string;
  readonly children?: ReactNode;
  /** Action de reprise (« Réessayer »), pour le ton `error`. */
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
}

const TONE_CLASSES: Readonly<Record<NoticeTone, string>> = {
  loading: "border-steel-800 bg-steel-900/60 text-steel-400",
  error: "border-ember-600/60 bg-ember-600/10 text-ember-400",
  empty: "border-steel-800 border-dashed bg-steel-900/40 text-steel-400",
};

export function Notice({ tone, title, children, onRetry, retryLabel = "Réessayer" }: NoticeProps) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border p-5 text-sm ${TONE_CLASSES[tone]}`}
    >
      <p className="flex items-center gap-2 font-medium">
        {tone === "loading" ? <Spinner /> : null}
        {title}
      </p>
      {children ? <div className="mt-1.5 text-xs text-steel-400">{children}</div> : null}
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-200 transition-colors hover:border-steel-600 hover:text-steel-100"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3.5 animate-spin rounded-full border-2 border-steel-700 border-t-ember-500"
    />
  );
}
