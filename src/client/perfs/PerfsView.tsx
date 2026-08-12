/**
 * Perfs : la section qui a repris le Tracker et l'Historique (V6).
 *
 * Les deux écrans n'ont pas été réécrits, ils ont été **remis à leur place** :
 * saisir une passe et relire ses passes sont deux moments du même geste, et
 * c'était un accident de navigation qu'ils soient deux onglets. `TrackerView` et
 * `HistoryView` sont ici tels quels, avec leur logique et leurs états ; cette
 * vue ne fait que choisir lequel montrer.
 *
 * Trois décisions :
 *
 * 1. **la sous-vue vit dans l'adresse** (`#/perfs?vue=historique`), pas dans un
 *    `useState`. Une passe ouverte se partage en lien et survit au
 *    rechargement — c'est ce que faisait déjà `#/historique?run=12`, et le perdre
 *    en fusionnant les deux écrans aurait été une régression silencieuse ;
 * 2. **l'historique reste chargé à la demande.** Ses courbes tirent Recharts,
 *    donc d3 et un store Redux : l'application ouvre sur l'accueil, elle n'a
 *    aucune raison de les télécharger. Le `Suspense` est ici et non dans `App`
 *    pour que l'en-tête et le sélecteur restent à l'écran pendant le
 *    téléchargement — sinon la page entière clignote ;
 * 3. **le tracker survit à un aller-retour vers l'historique.** Sa saisie n'est
 *    pas persistée (c'est un choix, cf. `tracker/draft.ts`) : le démonter parce
 *    qu'on est allé regarder une courbe jetterait dix-huit scores tapés à la
 *    main. Il est donc caché, pas démonté — mais seulement une fois qu'il a
 *    servi : arriver directement sur `#/perfs?vue=historique` ne doit pas
 *    déclencher l'import KovaaK's d'un écran que personne ne regarde.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { Segmented } from "../components/Segmented";
import type { PerfsTab } from "../route";
import { TrackerView } from "../tracker/TrackerView";

/**
 * `HistoryView` est un export nommé, `lazy` attend un export par défaut : on
 * fait la conversion ici plutôt que d'ajouter un `export default` au module,
 * qui n'aurait de sens que pour ce chargeur.
 */
const HistoryView = lazy(async () => ({
  default: (await import("../history/HistoryView")).HistoryView,
}));

const TAB_OPTIONS: readonly { readonly value: PerfsTab; readonly label: string }[] = [
  { value: "saisie", label: "Saisie" },
  { value: "historique", label: "Historique" },
];

interface PerfsViewProps {
  readonly tab: PerfsTab;
  /** Passe dépliée dans l'historique, portée par la route ; `null` = aucune. */
  readonly focusRunId: number | null;
  readonly onTabChange: (tab: PerfsTab) => void;
  readonly onFocusRun: (runId: number | null) => void;
}

export function PerfsView({ tab, focusRunId, onTabChange, onFocusRun }: PerfsViewProps) {
  const showTracker = tab === "saisie";
  // Le tracker n'est monté qu'à partir du moment où il a été demandé une fois ;
  // ensuite il ne redescend plus (cf. l'en-tête du module).
  const [trackerMounted, setTrackerMounted] = useState(showTracker);

  useEffect(() => {
    if (showTracker) setTrackerMounted(true);
  }, [showTracker]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-steel-100">Perfs</h1>
          <p className="mt-0.5 text-xs text-steel-500">
            Saisis une passe, puis regarde ce qu'elle change.
          </p>
        </div>
        <Segmented
          label="Sous-vue des perfs"
          options={TAB_OPTIONS}
          value={tab}
          onChange={onTabChange}
        />
      </div>

      {trackerMounted ? (
        <div className={showTracker ? undefined : "hidden"}>
          <TrackerView onSaved={(run) => onFocusRun(run.id)} />
        </div>
      ) : null}

      {showTracker ? null : (
        // Un cadre muet le temps du téléchargement, pas un écran de chargement :
        // l'en-tête et le sélecteur, eux, restent en place.
        <Suspense fallback={<div className="min-h-[50dvh]" aria-busy="true" />}>
          <HistoryView focusRunId={focusRunId} onFocusRun={onFocusRun} />
        </Suspense>
      )}
    </div>
  );
}
