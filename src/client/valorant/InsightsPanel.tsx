/**
 * Le repli « tendances » du bloc Valorant de l'accueil.
 *
 * Il tient en deux lignes de code et porte pourtant une décision : le bouton et
 * son état vivent **hors** du morceau différé, sinon il faudrait télécharger les
 * courbes pour savoir qu'on peut les demander. Replié, ce fichier ne coûte rien
 * d'autre que lui-même ; déplié, il monte `Insights` — qui charge les agrégats
 * et, derrière un second `lazy`, Recharts.
 */

import { lazy, Suspense, useState } from "react";
import type { LinkedAccount } from "../data";

const ValorantInsights = lazy(async () => ({
  default: (await import("./Insights")).ValorantInsights,
}));

export function ValorantInsightsPanel({ account }: { readonly account: LinkedAccount }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-t border-steel-800 pt-3">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="valorant-insights"
        className="flex w-full items-center gap-2 text-left text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase transition-colors hover:text-steel-200"
      >
        Tendances, ventilations et pont bench
        <Chevron open={open} />
      </button>

      {/* Monté seulement à l'ouverture : replié, il ne charge rien. */}
      {open ? (
        <div id="valorant-insights" className="mt-4">
          <Suspense fallback={<div aria-busy="true" className="min-h-40" />}>
            <ValorantInsights account={account} />
          </Suspense>
        </div>
      ) : null}
    </div>
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
