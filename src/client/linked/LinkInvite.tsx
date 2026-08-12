/**
 * L'invitation à lier un compte : l'encart qu'on retrouve partout où la donnée
 * pourrait rentrer toute seule mais ne le peut pas encore (SPEC §5 bis).
 *
 * Un seul composant pour le tracker et le dashboard, parce que c'est un seul
 * message : « ça peut se remplir tout seul, voilà où ». Deux encarts rédigés
 * séparément finiraient par promettre deux choses différentes.
 */

import type { ReactNode } from "react";
import { routeHash } from "../route";

const PROFILE_HASH = routeHash({ view: "profile", runId: null });

interface LinkInviteProps {
  readonly title: string;
  readonly children: ReactNode;
  /** Libellé du bouton ; le lien mène toujours au profil, où l'on lie. */
  readonly action?: string;
}

export function LinkInvite({ title, children, action = "Lier un compte" }: LinkInviteProps) {
  return (
    <div className="rounded-xl border border-dashed border-ember-600/50 bg-ember-600/5 p-4">
      <p className="text-sm font-medium text-steel-100">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-steel-400">{children}</p>
      <a
        href={PROFILE_HASH}
        className="mt-3 inline-flex rounded-lg bg-brand-fill px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-fill-hover"
      >
        {action} →
      </a>
    </div>
  );
}
