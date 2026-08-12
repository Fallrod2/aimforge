/**
 * La ligne de quota affichée à côté d'un bouton qui dépense un appel IA :
 * « 3/5 aujourd'hui — se réinitialise à 02:00 ».
 *
 * Elle remplace quatre lignes écrites séparément — « 20 messages par jour »
 * dans le fil, « 5 routines par jour » dans la routine, « 5 debriefs par jour »
 * dans l'historique, « Il te reste 3 messages de coach aujourd'hui » sur une
 * partie — qui disaient quatre choses différentes, ne montraient pas l'heure de
 * réinitialisation, et recopiaient une limite que `platform_settings` peut
 * changer sans redéploiement.
 *
 * Elle **va chercher la vérité elle-même** (`getAiQuota`, qui la lit dans la
 * réponse de `GET /api/ai-settings` — la seule qui connaisse à la fois la
 * limite réglée en base et l'heure de réinitialisation dérivée du jour UTC de
 * `ai_usage`) plutôt que de la recevoir de son écran : c'est ce qui garantit
 * que tous les endroits affichent la même chose sans qu'aucun composant ait à
 * s'en souvenir. Ce que l'écran lui passe, c'est seulement ce qu'il vient
 * d'apprendre d'une
 * génération (`remaining`), qu'elle retraduit avec la limite et l'heure lues au
 * montage — aucun aller-retour de plus par génération.
 *
 * Un chargement en échec n'est pas un incident : le composant retombe sur la
 * formulation par défaut, qui est ce que l'écran affichait avant. Le bouton
 * d'à côté, lui, continue de marcher.
 */

import { useEffect, useState } from "react";
import {
  type AiQuota,
  type AiQuotaDisplay,
  type AiQuotaKind,
  aiQuotaLabel,
  aiQuotaWithRemaining,
  findAiQuota,
} from "../../shared/ai-quota-contract";
import { getAiQuota } from "../data";

interface QuotaNoteProps {
  readonly kind: AiQuotaKind;
  /**
   * Ce que la dernière réponse de l'API a dit du restant :
   *
   * - `undefined` : rien de neuf, on affiche ce qui a été lu au montage ;
   * - `null` : la fonction n'a rien compté — l'utilisateur a sa propre
   *   configuration IA, le quota est levé ;
   * - un nombre : le restant après cet appel (chemin heureux, 429, ou échec
   *   remboursé).
   */
  readonly remaining?: number | null;
  /** Classes de position et de taille ; la couleur reste celle du composant. */
  readonly className?: string;
}

/** Ce que le composant a lu au montage, avant toute génération. */
export type LoadedQuota =
  | { readonly status: "unknown" }
  | { readonly status: "lifted" }
  | { readonly status: "counted"; readonly quota: AiQuota };

/**
 * L'état à afficher : ce que la génération vient de dire l'emporte sur ce qui a
 * été lu au montage, parce qu'il est plus récent.
 *
 * Deux cas demandent de la précision, et ce sont eux qui justifient une
 * fonction plutôt qu'un ternaire dans le rendu :
 *
 * 1. un restant connu **sans** compteur lu (chargement en échec, fonction non
 *    servie) : la limite est inconnue, donc « 3/? » n'existe pas. On garde la
 *    formulation par défaut plutôt que d'inventer un dénominateur ;
 * 2. un restant chiffré alors que le montage avait lu « quota levé » : la
 *    configuration IA a changé depuis, et l'ancienne lecture est fausse. On
 *    revient à la formulation par défaut, pas à une phrase qu'on sait périmée.
 */
export function quotaDisplay(
  loaded: LoadedQuota,
  remaining: number | null | undefined,
  now: Date,
): AiQuotaDisplay {
  if (remaining === null) return { status: "lifted" };
  if (remaining === undefined) return loaded;
  if (loaded.status !== "counted") return { status: "unknown" };
  return { status: "counted", quota: aiQuotaWithRemaining(loaded.quota, remaining, now) };
}

export function QuotaNote({ kind, remaining, className = "" }: QuotaNoteProps) {
  const [loaded, setLoaded] = useState<LoadedQuota>({ status: "unknown" });

  useEffect(() => {
    let alive = true;

    void getAiQuota().then((state) => {
      if (!alive || state === null) return;
      if (state.lifted) {
        setLoaded({ status: "lifted" });
        return;
      }

      const quota = findAiQuota(state, kind);

      if (quota !== null) setLoaded({ status: "counted", quota });
    });

    return () => {
      alive = false;
    };
  }, [kind]);

  return (
    <p className={`text-steel-500 ${className}`}>
      {aiQuotaLabel(kind, quotaDisplay(loaded, remaining, new Date()))}
    </p>
  );
}
