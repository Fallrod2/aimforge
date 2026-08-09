/**
 * Les comptes liés de l'utilisateur, partagés par les trois écrans qui en
 * dépendent : le profil (qui les gère), le tracker (qui importe) et le
 * dashboard (qui affiche le rang).
 *
 * Un seul chargement décrit ici plutôt que trois copies dans trois vues : les
 * trois doivent parler du même état, y compris de l'état « pas encore chargé »,
 * sans quoi le tracker proposerait un import pendant deux cents millisecondes
 * avant de découvrir qu'aucun compte n'est lié.
 */

import { useCallback, useEffect, useState } from "react";
import { type LinkedAccount, listLinkedAccounts } from "../data";

export type LinkedAccountsState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly accounts: readonly LinkedAccount[] };

export interface LinkedAccountsHandle {
  readonly state: LinkedAccountsState;
  /** Relit la liste. À appeler après toute liaison ou déliaison. */
  readonly reload: () => void;
}

export function useLinkedAccounts(): LinkedAccountsHandle {
  const [state, setState] = useState<LinkedAccountsState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      setState({ status: "ready", accounts: await listLinkedAccounts() });
    } catch (cause) {
      setState({
        status: "error",
        message: cause instanceof Error ? cause.message : "Comptes liés indisponibles.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, reload: useCallback(() => void load(), [load]) };
}
