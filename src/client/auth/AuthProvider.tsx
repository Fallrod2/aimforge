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
import { syncCurrentBenchmark } from "../../lib/energy";
import { supabase } from "../supabase/client";
import { browserRecoveryStore, clearRecoveryPending, trackRecovery } from "./recovery";
import { type AuthStatus, sessionEffect } from "./session-effect";

export type { AuthStatus };

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

/**
 * Retire à `src/lib/energy` le benchmark du compte qui s'en va (cause racine
 * relevée en revue V4-B, élargie en revue V5-A).
 *
 * La lib garde son benchmark dans un **pointeur de module**, hors de React :
 * `ActiveBenchmarkProvider` l'aligne à l'ouverture de session, mais rien ne le
 * remettait en place à la fermeture. Un compte réglé sur Viscose laissait donc
 * ce pointeur derrière lui, et l'écran suivant — landing, démo publique, ou une
 * autre session ouverte dans le même onglet — calculait des énergies avec les
 * seuils d'un barème que personne n'avait choisi.
 *
 * Deux appelants, une seule décision (`sessionEffect`) : le rappel de session,
 * qui couvre **toutes** les déconnexions y compris celles que personne n'a
 * demandées, et `signOut`, qui la joue en plus avant son appel réseau.
 */
function releaseBenchmark(): void {
  const { benchmarkReset } = sessionEffect(false);

  if (benchmarkReset !== null) syncCurrentBenchmark(benchmarkReset);
}

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

      /**
       * Toute la conséquence d'un changement de session passe par ici, y
       * compris les déconnexions que personne n'a demandées — jeton expiré,
       * session révoquée ailleurs (`./session-effect.ts`). C'est le seul point
       * que tous les chemins traversent : `signOut` en fait aussi partie, via
       * le `SIGNED_OUT` qu'il déclenche.
       */
      const effect = sessionEffect(next !== null);

      setSession(next);
      setStatus(effect.status);
      if (effect.benchmarkReset !== null) syncCurrentBenchmark(effect.benchmarkReset);
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
        if (!active || settled) return;
        // Une session illisible est une session absente : mêmes conséquences,
        // pointeur de benchmark compris. Le marqueur de récupération, lui,
        // n'est pas touché — on ne sait rien, on ne conclut rien à son sujet.
        setStatus(sessionEffect(false).status);
        releaseBenchmark();
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
        // Comme le marqueur : **avant** l'appel réseau. `apply` le refera au
        // `SIGNED_OUT`, sans effet — mais une déconnexion qui échoue côté
        // serveur ne doit pas laisser derrière elle le barème du compte.
        releaseBenchmark();
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
