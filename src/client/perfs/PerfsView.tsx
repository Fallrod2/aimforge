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
 * 3. **les deux sous-vues survivent à un aller-retour.** Leur saisie et leur
 *    attente ne sont pas persistées : les démonter jetterait dix-huit scores
 *    tapés à la main d'un côté, la fenêtre d'annulation d'une suppression de
 *    l'autre. Elles sont donc cachées, pas démontées — mais seulement une fois
 *    qu'elles ont servi : arriver directement sur `#/perfs?vue=historique` ne
 *    doit pas déclencher l'import KovaaK's d'un écran que personne ne regarde.
 *    La règle vit dans `./mounted.ts`, où elle se teste.
 *
 * La symétrie est arrivée en revue V5-A : seul le tracker était protégé, et
 * l'historique, lui, portait depuis les cinq secondes d'annulation d'une
 * suppression (`components/useConfirm.ts`). Le démonter exécute l'attente
 * sur-le-champ — c'est ce qu'il doit faire, un geste confirmé ne s'évapore pas
 * — et emporte le toast « Annuler ». Toucher l'onglet « Saisie » refermait donc
 * la fenêtre sans rien dire, à un clic du bouton.
 *
 * **Ce que garder l'historique monté coûte, et comment c'est payé.** Il ne se
 * rechargeait plus en revenant dessus, alors qu'une passe enregistrée à la
 * saisie y navigue justement (`onSaved` → `onFocusRun`) : la liste aurait été
 * en retard d'une passe, exactement au moment où l'on vient la voir. D'où la
 * prop `visible` : l'historique relit sa liste quand il **redevient** visible,
 * ce que son démontage faisait gratuitement jusqu'ici. Même nombre de requêtes
 * qu'avant, sans perdre l'attente en cours.
 */

import { lazy, Suspense, useEffect, useState } from "react";
import { Segmented } from "../components/Segmented";
import type { PerfsTab } from "../route";
import { TrackerView } from "../tracker/TrackerView";
import { isMounted, type MountedTabs, NOTHING_MOUNTED, visit } from "./mounted";

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
  // Une sous-vue est montée à partir du moment où elle a été demandée une fois ;
  // ensuite elle ne redescend plus (cf. l'en-tête du module et `./mounted.ts`).
  const [mounted, setMounted] = useState<MountedTabs>(() => visit(NOTHING_MOUNTED, tab));

  useEffect(() => {
    setMounted((current) => visit(current, tab));
  }, [tab]);

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

      {isMounted(mounted, "saisie") ? (
        <div className={showTracker ? undefined : "hidden"}>
          <TrackerView onSaved={(run) => onFocusRun(run.id)} />
        </div>
      ) : null}

      {isMounted(mounted, "historique") ? (
        <div className={showTracker ? "hidden" : undefined}>
          {/* Un cadre muet le temps du téléchargement, pas un écran de
              chargement : l'en-tête et le sélecteur, eux, restent en place. */}
          <Suspense fallback={<div className="min-h-[50dvh]" aria-busy="true" />}>
            <HistoryView
              focusRunId={focusRunId}
              onFocusRun={onFocusRun}
              // C'est cette prop, et non le montage, qui décide des lectures :
              // l'historique relit sa liste chaque fois qu'il redevient visible.
              visible={!showTracker}
            />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
