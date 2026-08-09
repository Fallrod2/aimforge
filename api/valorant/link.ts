/**
 * `POST /api/valorant/link` — lier un compte Riot par son Riot ID
 * (SPEC §5 bis, §7-P3b).
 *
 * Pas de login Riot : RSO n'est pas accessible sans approbation, et les données
 * publiques suffisent. Lier un compte, c'est donc **enregistrer une référence**
 * (« Nom#TAG ») après avoir vérifié qu'elle désigne bien quelqu'un — rien de
 * ce qui est stocké ici ne donne accès à quoi que ce soit.
 *
 * Ce que la fonction ajoute à un simple insert, et qui justifie qu'elle
 * existe : le PUUID. Un Riot ID se renomme ; le PUUID, non. C'est lui qui
 * servira à tous les rafraîchissements, et il faut la clé HenrikDev — donc le
 * serveur — pour l'obtenir.
 *
 * L'écriture passe par le JWT de l'appelant : c'est la RLS qui autorise
 * l'insertion, pas la fonction. La service key n'est ni lue ni nécessaire.
 */

import {
  type RiotLinkResponse,
  riotLinkRequestSchema,
} from "../../src/client/data/linked-accounts-contract.js";
import {
  formatRiotId,
  LINKED_ACCOUNT_COLUMNS,
  toLinkedAccount,
} from "../../src/client/data/linked-accounts-mapping.js";
import {
  DEFAULT_REGION,
  HenrikError,
  isConfigured,
  NOT_CONFIGURED,
  resolveAccount,
} from "../_lib/henrikdev.js";
import { authenticate, fail, json, readBody } from "../_lib/request.js";

/** Un aller-retour vers la source, plus deux écritures : 15 s est large. */
export const maxDuration = 15;

const INVALID_BODY = "Riot ID incomplet : un nom et un tag sont attendus.";

const WRITE_FAILED = "Le compte a été trouvé mais n'a pas pu être enregistré. Réessaie.";

export async function POST(request: Request): Promise<Response> {
  // 1. Identité d'abord : un appel anonyme n'apprend rien de l'état de
  //    configuration du service.
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  // 2. Entrée.
  const body = await readBody(request, riotLinkRequestSchema, INVALID_BODY);

  if (!body.ok) return body.response;

  const { name, tag, region, label, isPrimary } = body.value;

  // 3. Configuration. Tant que la clé n'est pas posée dans Vercel, la fonction
  //    le dit franchement plutôt que d'enregistrer un compte non vérifié.
  if (!isConfigured()) return fail(NOT_CONFIGURED, 503);

  // 4. Résolution du Riot ID.
  let account: Awaited<ReturnType<typeof resolveAccount>>;

  try {
    account = await resolveAccount(name, tag);
  } catch (cause) {
    if (cause instanceof HenrikError) {
      console.error("[valorant] résolution du Riot ID en échec", cause);
      return fail(cause.message, cause.status);
    }
    console.error("[valorant] échec inattendu à la résolution", cause);
    return fail("La liaison a échoué. Réessaie dans un instant.", 500);
  }

  const externalId = formatRiotId({ name: account.name ?? name, tag: account.tag ?? tag });
  const resolvedRegion = account.region ?? region ?? DEFAULT_REGION;

  // 5. État actuel des comptes Riot de l'utilisateur : il décide à la fois du
  //    doublon et du compte principal.
  const existing = await auth.client
    .from("linked_accounts")
    .select("id, external_id, is_primary")
    .eq("user_id", auth.userId)
    .eq("provider", "riot");

  if (existing.error !== null) {
    console.error("[valorant] lecture des comptes liés en échec", existing.error);
    return fail(WRITE_FAILED, 500);
  }

  const accounts = existing.data ?? [];

  if (accounts.some((row) => row.external_id === externalId)) {
    return fail(`« ${externalId} » est déjà lié à ton compte.`, 409);
  }

  // Le premier compte lié devient principal sans qu'on ait à le demander :
  // c'est le seul, il n'y a rien à arbitrer.
  const primary = isPrimary ?? accounts.length === 0;

  // Un index unique partiel interdit deux principaux : on libère la place
  // avant d'insérer, sinon la base refuse l'écriture.
  if (primary) {
    const cleared = await auth.client
      .from("linked_accounts")
      .update({ is_primary: false })
      .eq("user_id", auth.userId)
      .eq("provider", "riot")
      .eq("is_primary", true);

    if (cleared.error !== null) {
      console.error("[valorant] bascule du compte principal en échec", cleared.error);
      return fail(WRITE_FAILED, 500);
    }
  }

  const inserted = await auth.client
    .from("linked_accounts")
    .insert({
      user_id: auth.userId,
      provider: "riot",
      external_id: externalId,
      riot_puuid: account.puuid,
      riot_region: resolvedRegion,
      label: label ?? null,
      is_primary: primary,
    })
    .select(LINKED_ACCOUNT_COLUMNS)
    .single();

  if (inserted.error !== null || inserted.data === null) {
    // 23505 : la contrainte d'unicité a parlé plus vite que la lecture du
    // point 5 (deux liaisons simultanées du même compte).
    if (inserted.error?.code === "23505") {
      return fail(`« ${externalId} » est déjà lié à ton compte.`, 409);
    }
    console.error("[valorant] enregistrement du compte lié en échec", inserted.error);
    return fail(WRITE_FAILED, 500);
  }

  const response: RiotLinkResponse = { account: toLinkedAccount(inserted.data) };

  return json(response, 201);
}
