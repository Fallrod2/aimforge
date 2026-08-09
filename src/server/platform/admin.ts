/**
 * La décision d'habilitation du panneau d'administration (SPEC §5 quater).
 *
 * Module **pur**, du même genre que `src/server/coach/quota.ts` et
 * `src/server/linked/rate-limit.ts` : la fonction serverless apporte les faits
 * (y a-t-il un jeton valide, la service key est-elle posée, que dit
 * `platform_admins`), ce module dit oui ou non. La règle se teste donc sans
 * réseau, sans base et sans environnement Vercel — ce qui compte, parce qu'un
 * contrôle d'accès qu'on ne sait pas tester est un contrôle d'accès qu'on
 * espère.
 *
 * Deux règles, et les deux sont contre-intuitives la première fois :
 *
 * 1. **Le refus est toujours 404**, jamais 401 ni 403. « 403 » répond « cette
 *    surface existe, tu n'y as pas droit » — et cette phrase est une
 *    information : elle dit qu'il y a un panneau d'administration, donc des
 *    clés de plateforme derrière, donc une cible. Le même corps et le même
 *    statut qu'une route inexistante ne disent rien. Un administrateur
 *    légitime, lui, ne rencontre jamais ce cas ;
 * 2. **on referme sur l'inconnu.** Si la service key manque, l'habilitation
 *    n'est pas vérifiable — et une habilitation qu'on ne sait pas établir n'en
 *    est pas une. C'est l'inverse exact du repli des réglages
 *    (`settings.ts`), qui lui reste permissif : là on protège la disponibilité
 *    d'un service, ici on protège un accès.
 */

/** Le corps servi à tous les non-administrateurs, quelle qu'en soit la raison. */
export const ADMIN_NOT_FOUND = "Ressource introuvable.";

export type AdminVerdict =
  | { readonly ok: true }
  /** `reason` ne sort jamais vers le client : elle est faite pour le journal. */
  | { readonly ok: false; readonly status: 404; readonly message: string; readonly reason: string };

export interface AdminCheck {
  /** Le jeton a-t-il été vérifié par Supabase Auth ? */
  readonly authenticated: boolean;
  /** La service key est-elle posée dans l'environnement de la fonction ? */
  readonly serviceAvailable: boolean;
  /**
   * Le passage dans `platform_admins`, sous service role. Rend `false` aussi
   * quand la lecture échoue : voir la règle 2 de l'en-tête.
   */
  readonly lookup: () => Promise<boolean>;
}

/**
 * L'appelant est-il administrateur ?
 *
 * L'ordre des vérifications est délibéré : identité d'abord, comme partout
 * ailleurs dans le projet. Un appel sans jeton ne déclenche **aucune** lecture
 * en base — inutile d'interroger `platform_admins` pour quelqu'un qu'on n'a
 * pas identifié, et un point d'entrée qui travaille avant de vérifier
 * l'identité est un point d'entrée qu'on peut faire travailler gratuitement.
 */
export async function adminVerdict(check: AdminCheck): Promise<AdminVerdict> {
  if (!check.authenticated) return refuse("jeton absent ou invalide");
  if (!check.serviceAvailable) return refuse("service key absente : habilitation invérifiable");
  if (!(await check.lookup())) return refuse("compte non administrateur");

  return { ok: true };
}

function refuse(reason: string): AdminVerdict {
  return { ok: false, status: 404, message: ADMIN_NOT_FOUND, reason };
}
