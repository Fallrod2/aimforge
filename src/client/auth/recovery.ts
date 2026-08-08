/**
 * Marqueur « réinitialisation de mot de passe en cours ».
 *
 * Un lien « mot de passe oublié » ouvre une **vraie** session Supabase, écrite
 * dans le stockage du navigateur et rafraîchie automatiquement. Si le seul
 * garde-fou est un état React, il disparaît au premier rechargement d'onglet :
 * la session, elle, reste — et quiconque a lu l'email obtient un accès complet
 * et durable sans jamais changer le mot de passe.
 *
 * Le marqueur est donc persisté à côté de la session, et n'est levé que par un
 * changement de mot de passe réussi ou une déconnexion.
 *
 * Module pur : le stockage est injecté, aucune référence à `window`. Toute la
 * logique du cycle (pose, relecture après rechargement, levée) est ici, pour
 * qu'elle soit testable sans DOM ni serveur.
 */

/** Le minimum qu'on attend d'un stockage : celui de `localStorage`. */
export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/**
 * Clé du marqueur. Elle porte l'identifiant du compte concerné : un marqueur
 * laissé par un autre utilisateur du même navigateur ne doit pas bloquer
 * celui qui se connecte ensuite.
 */
export const RECOVERY_KEY = "aimforge.recovery-pending";

/** Ouvre une réinitialisation pour ce compte. */
export function markRecoveryPending(store: KeyValueStore, userId: string): void {
  store.setItem(RECOVERY_KEY, userId);
}

/** Ferme la réinitialisation : mot de passe changé, ou déconnexion. */
export function clearRecoveryPending(store: KeyValueStore): void {
  store.removeItem(RECOVERY_KEY);
}

/**
 * Cette session doit-elle être bloquée sur le choix d'un nouveau mot de passe ?
 *
 * Un marqueur qui ne correspond à personne (aucune session) ou à un autre
 * compte est effacé au passage : il ne sert plus à rien et bloquerait le
 * compte suivant sans raison.
 */
export function isRecoveryPending(store: KeyValueStore, userId: string | null): boolean {
  const pending = store.getItem(RECOVERY_KEY);

  if (pending === null) return false;
  if (userId === null || pending !== userId) {
    clearRecoveryPending(store);
    return false;
  }
  return true;
}

/**
 * Applique un événement d'authentification au marqueur, et rend l'état
 * « réinitialisation en cours » qui en découle.
 *
 * C'est la machine d'état complète du cycle, appelée telle quelle par
 * `AuthProvider` :
 * - `PASSWORD_RECOVERY` (émis une seule fois, à l'échange du `?code=`) pose le
 *   marqueur ;
 * - tout autre événement, y compris l'`INITIAL_SESSION` d'un rechargement, se
 *   contente de **relire** le marqueur — c'est ce qui le fait survivre ;
 * - `SIGNED_OUT` le lève.
 */
export function trackRecovery(store: KeyValueStore, event: string, userId: string | null): boolean {
  if (event === "PASSWORD_RECOVERY" && userId !== null) markRecoveryPending(store, userId);
  if (event === "SIGNED_OUT") clearRecoveryPending(store);
  return isRecoveryPending(store, userId);
}

/** Stockage en mémoire : repli du navigateur, et double des tests. */
export function createMemoryStore(): KeyValueStore {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

/**
 * Le stockage du navigateur, ou un repli en mémoire s'il est indisponible
 * (mode privé strict, stockage désactivé).
 *
 * Le repli ne rouvre aucune brèche : sans `localStorage`, Supabase ne persiste
 * pas non plus la session, donc il n'y a rien à protéger d'un rechargement.
 */
export function browserRecoveryStore(): KeyValueStore {
  try {
    const probe = `${RECOVERY_KEY}.probe`;

    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return createMemoryStore();
  }
}
