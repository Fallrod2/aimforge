/**
 * Le stockage local des **préférences d'écran** du tracker (objectif de rang,
 * bandeau d'accueil refermé).
 *
 * Pourquoi le navigateur et pas la base. Ces deux réglages ne décrivent rien du
 * joueur : ils décrivent l'état d'un écran devant lui. Les mettre en base
 * demanderait une migration et une colonne par préférence d'affichage, pour un
 * bénéfice — les retrouver sur un second appareil — dont on ne sait pas encore
 * s'il compte. La règle assumée est donc : **préférence locale, à promouvoir en
 * base si le besoin multi-appareil se confirme.** Rien de ce qui est stocké ici
 * n'est une donnée métier ; tout ce qui est stocké ici peut disparaître sans
 * qu'aucun chiffre ne soit perdu.
 *
 * Le stockage est **injecté** partout où il sert, comme pour le marqueur de
 * réinitialisation (`auth/recovery.ts`) : c'est ce qui rend les décisions
 * testables sans DOM. Le type n'est pas importé de là — un module du tracker n'a
 * pas à dépendre de l'authentification pour connaître la forme de
 * `localStorage`.
 */

/** Le minimum qu'on attend d'un stockage : celui de `localStorage`. */
export interface KeyValueStore {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Le préfixe de toutes les clés posées par l'application. */
export const PREF_PREFIX = "aimforge";

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
 * (mode privé strict, stockage désactivé, rendu serveur).
 *
 * Le repli ne perd rien d'important : une préférence d'affichage non retenue
 * fait réapparaître un bandeau, pas disparaître une passe.
 */
export function browserStore(): KeyValueStore {
  try {
    const probe = `${PREF_PREFIX}.probe`;

    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return createMemoryStore();
  }
}
