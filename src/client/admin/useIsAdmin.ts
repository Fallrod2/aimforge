/**
 * « Cet utilisateur voit-il l'entrée Administration ? » (SPEC §5 quater)
 *
 * Une lecture, sous RLS, de sa propre ligne de `platform_admins` — au plus une,
 * jamais celle d'un autre (migration 0009).
 *
 * Ce que ce hook **n'est pas** : une sécurité. Il décide d'un affichage, rien
 * de plus. Les endpoints `/api/admin/*` refont la vérification côté serveur, et
 * répondent 404 à qui n'est pas administrateur — que le lien ait été affiché ou
 * non, que l'adresse ait été tapée à la main ou non. Si ce hook se trompait en
 * disant « oui », l'écran s'ouvrirait sur des erreurs 404 et rien ne fuirait.
 *
 * Le repli est `false` : une réponse qu'on n'a pas obtenue n'ajoute pas
 * d'entrée de menu.
 */

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { isPlatformAdmin } from "../data";

export function useIsAdmin(): boolean {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [admin, setAdmin] = useState(false);

  useEffect(() => {
    if (userId === null) {
      setAdmin(false);
      return;
    }

    // `cancelled` évite d'écrire l'état d'un compte qui n'est plus celui de la
    // session : une déconnexion suivie d'une reconnexion pendant la requête
    // laisserait sinon l'entrée d'un autre utilisateur à l'écran.
    let cancelled = false;

    void isPlatformAdmin(userId).then((result) => {
      if (!cancelled) setAdmin(result);
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  return admin;
}
