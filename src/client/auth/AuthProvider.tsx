/**
 * Session Supabase partagée par toute l'application.
 *
 * Une seule source de vérité : `onAuthStateChange`. `getSession()` ne sert
 * qu'à ne pas afficher la landing pendant la milliseconde où la session
 * stockée n'est pas encore relue — d'où l'état `loading`, qui n'affiche rien
 * plutôt que de faire clignoter la page de connexion sous un utilisateur déjà
 * connecté.
 */

import type { Session, User } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase/client";
import { browserRecoveryStore, clearRecoveryPending, trackRecovery } from "./recovery";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthState {
  readonly status: AuthStatus;
  readonly session: Session | null;
  readonly user: User | null;
  /**
   * L'utilisateur arrive d'un lien « mot de passe oublié ». Il a une session,
   * mais la seule chose à lui montrer est le choix d'un nouveau mot de passe :
   * un lien de réinitialisation qui ouvrirait le dashboard sans rien demander
   * laisserait le compte accessible à qui a lu l'email.
   *
   * L'état est **persisté** (cf. `recovery.ts`) : `PASSWORD_RECOVERY` n'est
   * émis qu'une fois, à l'échange du `?code=`. Un simple état React retombait
   * à `false` au premier rechargement d'onglet alors que la session, elle,
   * restait — ce qui rouvrait l'application en grand.
   */
  readonly recovering: boolean;
  readonly signOut: () => Promise<void>;
  /** Sortie du mode réinitialisation : uniquement après un changement réussi. */
  readonly endRecovery: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Le stockage du marqueur, résolu une seule fois au chargement du module :
 * c'est le même `localStorage` que celui où Supabase écrit la session, donc
 * les deux apparaissent et disparaissent ensemble.
 */
const recoveryStore = browserRecoveryStore();

export function AuthProvider({ children }: { readonly children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<Session | null>(null);
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    let active = true;
    // Le premier des deux chemins qui répond fixe l'état ; l'autre ne doit pas
    // revenir en arrière (`getSession` résolu après une déconnexion immédiate
    // remettrait une session périmée).
    let settled = false;

    /**
     * `event` sert à `trackRecovery` : c'est lui qui décide si le marqueur se
     * pose, se lève ou se relit. Le chemin `getSession` passe donc
     * `INITIAL_SESSION`, exactement comme le ferait l'abonnement — une session
     * restaurée est relue, jamais réinterprétée.
     */
    const apply = (event: string, next: Session | null) => {
      if (!active) return;
      settled = true;
      setSession(next);
      setStatus(next === null ? "anonymous" : "authenticated");
      setRecovering(trackRecovery(recoveryStore, event, next?.user.id ?? null));
    };

    // `onAuthStateChange` émet déjà l'état initial, mais seulement après avoir
    // terminé son initialisation (dont l'échange du `?code=` d'un retour
    // OAuth) : `getSession` couvre le cas où cet abonnement arrive après.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!settled) apply("INITIAL_SESSION", data.session);
      })
      .catch(() => {
        if (active && !settled) setStatus("anonymous");
      });

    const { data } = supabase.auth.onAuthStateChange((event, next) => {
      // Le rappel s'exécute dans le verrou interne de la librairie : on n'y
      // fait que poser de l'état et écrire le marqueur, jamais un autre appel
      // `supabase.auth.*`.
      apply(event, next);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status,
      session,
      user: session?.user ?? null,
      recovering,
      signOut: async () => {
        // Le marqueur tombe **avant** l'appel réseau : une déconnexion qui
        // échoue côté serveur ne doit pas laisser un marqueur orphelin
        // derrière elle. `SIGNED_OUT` le nettoiera de nouveau, sans effet.
        clearRecoveryPending(recoveryStore);
        setRecovering(false);
        await supabase.auth.signOut();
      },
      endRecovery: () => {
        clearRecoveryPending(recoveryStore);
        setRecovering(false);
      },
    }),
    [status, session, recovering],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** La session courante. Lève hors de `AuthProvider` : c'est un bug de montage. */
export function useAuth(): AuthState {
  const value = useContext(AuthContext);

  if (value === null) throw new Error("useAuth doit être utilisé dans un <AuthProvider>");
  return value;
}
