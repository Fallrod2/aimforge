/**
 * Les deux formes visibles du geste destructif (V5-A §5.4) : le bouton qui
 * demande confirmation, et le toast qui laisse revenir en arrière.
 *
 * Aucune modale, et c'est le point. Une boîte de dialogue vole le focus, coupe
 * le geste en deux, et finit par se cliquer sans être lue. Ici, le bouton se
 * transforme en question pendant quatre secondes : ne rien faire suffit à
 * renoncer, et rien n'a été déplacé à l'écran.
 *
 * La logique — armer, expirer, déclencher — n'est pas ici : elle est dans
 * `./confirm.ts`, en fonctions pures, et testée. Ces composants n'en sont que
 * la forme.
 */

import type { ReactNode } from "react";
import { CONFIRM_MARKER } from "./useConfirm";

interface ConfirmButtonProps {
  /** Ce qui est écrit au repos : « Supprimer cette passe », « Effacer le fil ». */
  readonly label: string;
  /** La question posée une fois armé. « Confirmer ? » par défaut. */
  readonly question?: string;
  /** Ce qui s'affiche pendant que l'action part. */
  readonly busyLabel?: string;
  readonly armed: boolean;
  readonly busy?: boolean;
  readonly disabled?: boolean;
  /** Un seul rappel pour les deux appuis : c'est la machine qui les distingue. */
  readonly onPress: () => void;
  /**
   * Le gabarit : largeur et espacements. **Remplacé**, jamais complété — deux
   * `px-*` dans la même liste se départagent par l'ordre de la feuille de style
   * et non par celui des classes, ce qui donne un résultat qu'on ne lit pas
   * dans le code.
   */
  readonly sizeClasses?: string;
  /** Placement laissé à l'hôte (`ml-auto`, `self-start`…). */
  readonly className?: string;
}

export function ConfirmButton({
  label,
  question = "Confirmer ?",
  busyLabel,
  armed,
  busy = false,
  disabled = false,
  onPress,
  sizeClasses = "px-3 py-1.5",
  className = "",
}: ConfirmButtonProps) {
  const text = busy && busyLabel !== undefined ? busyLabel : armed ? question : label;

  return (
    <button
      type="button"
      // Le marqueur du clic-ailleurs : sans lui, le désarmement global
      // arriverait avant ce clic-ci et la confirmation serait impossible à
      // donner (cf. `useConfirm`).
      {...{ [CONFIRM_MARKER]: "" }}
      onClick={onPress}
      disabled={disabled || busy}
      // Le libellé visible devient une question ; le nom accessible, lui, garde
      // ce sur quoi porte la question — « Confirmer ? » seul ne dirait rien à
      // qui n'a que la voix du lecteur d'écran.
      aria-label={armed ? `${question} ${label}` : undefined}
      // `opacity-70` et non `opacity-50` : à 50 %, le libellé désactivé tombe à
      // 2,20:1 sur une carte, sous le plancher de 3:1 des états inactifs. À
      // 70 % il tient 3,17:1 au repos et 3,94:1 pendant l'envoi, tout en se
      // lisant encore comme éteint.
      className={`rounded-lg text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${sizeClasses} ${
        armed
          ? // `brand-fill` + blanc pur : le seul couple plein qui tienne AA (5,06:1).
            "bg-brand-fill font-semibold text-white hover:bg-brand-fill-hover"
          : "border border-border text-steel-400 hover:border-ember-600 hover:text-ember-400"
      } ${className}`}
    >
      {text}
    </button>
  );
}

interface UndoToastProps {
  /** Ce qui vient d'être fait, au passé : « Passe supprimée ». */
  readonly message: string;
  readonly onUndo: () => void;
  /** Une précision facultative, sur la ligne du dessous. */
  readonly children?: ReactNode;
}

/**
 * Le toast d'annulation.
 *
 * Il n'annonce jamais une suppression qui n'est pas encore partie comme un
 * échec ou une attente : de l'extérieur, la donnée a disparu. C'est
 * l'implémentation qui retient l'appel cinq secondes (`usePendingUndo`), et
 * c'est ce qui rend « Annuler » instantané et sans risque.
 *
 * `role="status"` et non `alert` : c'est une confirmation, pas une urgence — un
 * lecteur d'écran l'annonce sans couper ce qu'il était en train de dire.
 */
export function UndoToast({ message, onUndo, children }: UndoToastProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      // Au-dessus de la barre du pouce sur téléphone, en bas d'écran ailleurs.
      className="fixed inset-x-0 bottom-20 z-30 flex justify-center px-4 lg:bottom-6"
    >
      <div className="flex max-w-full items-center gap-3 rounded-xl border border-border bg-surface-overlay px-4 py-2.5 shadow-[var(--shadow-overlay)]">
        <p className="min-w-0 text-xs text-steel-200">
          {message}
          {children === undefined ? null : (
            <span className="mt-0.5 block text-[11px] text-steel-400">{children}</span>
          )}
        </p>
        <button
          type="button"
          onClick={onUndo}
          className="shrink-0 rounded-lg border border-border-strong px-3 py-1.5 text-xs font-semibold text-steel-100 transition-colors hover:border-ember-500 hover:text-ember-400"
        >
          Annuler
        </button>
      </div>
    </div>
  );
}
