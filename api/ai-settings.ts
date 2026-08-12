/**
 * `GET|POST|DELETE /api/ai-settings` — les réglages IA de l'utilisateur
 * (SPEC §5 ter).
 *
 * Trois verbes, une règle de fer : **la clé entre, elle ne ressort jamais.**
 * Aucune réponse de ce fichier ne porte `api_key` ; `GET` ne rend qu'un
 * `hasKey` booléen. Ce n'est pas une politesse de conception — c'est la moitié
 * applicative du verrou posé en base (migration 0008, privilèges de colonne),
 * et les deux moitiés doivent rester d'accord.
 *
 * Contrairement à `api/coach` et `api/routine`, cette fonction n'a **pas
 * besoin de la service key** : elle écrit avec le JWT de l'appelant, et c'est
 * la RLS plus les privilèges de colonne qui l'encadrent. Deux conséquences
 * heureuses : l'écran de réglages fonctionne même si `SUPABASE_SERVICE_ROLE_KEY`
 * n'est pas posée, et le secret le plus large du projet n'est pas convoqué
 * pour un formulaire.
 *
 * `POST` fait quatre choses selon `action` :
 *
 * - `test` : un mini-appel au fournisseur avec la configuration **fournie**,
 *   sans rien enregistrer. C'est le seul moyen honnête de dire « ta clé
 *   marche » — la valider par sa forme ne prouverait rien ;
 * - `save` : validation Zod, normalisation de l'URL de base, puis écriture ;
 * - `link_start` et `link_poll` : la **liaison de compte** de ChatGPT
 *   (abonnement), qui ne prend pas de clé mais une autorisation (SPEC §5 ter).
 *   Le premier ouvre la demande chez OpenAI et rend le code à saisir ; le
 *   second attend l'autorisation, échange le code contre des jetons **côté
 *   serveur**, et les enregistre. Aucun jeton ne revient au navigateur : la
 *   réponse ne porte qu'un état (en attente / lié / expiré / refusé).
 *
 * Une nuance de configuration, depuis cette liaison : la clé de service reste
 * **facultative** pour tout ce qui touche aux clés collées et pour la liaison
 * elle-même (l'utilisateur pose son propre secret, ce que les privilèges de
 * colonne autorisent). Elle devient nécessaire pour *tester* une liaison
 * existante — il faut relire des jetons que seul `service_role` peut lire. Sans
 * elle, le test le dit franchement au lieu d'échouer en 42501.
 *
 * `GET` joint en outre **l'état des quotas du jour** (Vague 3.4). Ce n'est pas
 * un mélange de genres : « le quota est-il levé ? » n'est rien d'autre que
 * « une configuration personnelle est-elle en place ? » (SPEC §5 ter), et cette
 * fonction vient de répondre. Le reste — compteur du jour, limite réellement
 * appliquée, heure de réinitialisation — ne peut venir que du serveur, parce
 * que `platform_settings` n'est lisible que sous service role et que l'écran
 * recopiait jusqu'ici une constante compilée qui pouvait démentir le serveur.
 * La clé de service y reste facultative : sans elle, les limites servies sont
 * les constantes des contrats, c'est-à-dire celles qui seront appliquées.
 *
 * Les trois verbes sont exportés nommément (`GET`, `POST`, `DELETE`) : c'est
 * la forme que le runtime Node de Vercel reconnaît comme gestionnaire web. Les
 * autres méthodes n'ont pas d'export, la plateforme y répond 405 toute seule.
 */

import {
  type AskDeps,
  checkBaseUrl,
  createAsk,
  linkSecret,
  ModelError,
  modelTestMessage,
  pollLink,
  startLink,
  storedBaseUrl,
  toPublicSettings,
} from "../src/server/ai/index.js";
import type { AiQuotaResponse } from "../src/shared/ai-quota-contract.js";
import {
  type AiLinkPollResponse,
  type AiLinkStartResponse,
  type AiSettingsInput,
  type AiSettingsResponse,
  type AiSettingsView,
  type AiTestResponse,
  aiSettingsRequestSchema,
  isLinkProvider,
  providerSchema,
  providerSpec,
} from "../src/shared/ai-settings-contract.js";
import { aiQuotaLimits, readAiQuotas } from "./_lib/ai-quota.js";
import {
  deleteSettings,
  linkChatGptSettings,
  loadAiSettingsWith,
  type PublicRow,
  persistChatGptTokensWith,
  readSettings,
  saveSettings,
} from "./_lib/ai-settings.js";
import { loadPlatformSettings } from "./_lib/platform-settings.js";
import { type Authenticated, authenticate, fail, json, readBody } from "./_lib/request.js";
import { serviceClient } from "./_lib/service.js";

/**
 * Un test de connexion appelle un fournisseur inconnu, potentiellement lent à
 * démarrer (un serveur auto-hébergé sort parfois de veille). 30 s couvre ce
 * cas ; l'appel lui-même est borné plus bas, avec de la marge pour rédiger la
 * réponse plutôt que se faire couper par la plateforme.
 */
export const maxDuration = 30;

/** Le mini-appel de test : quelques jetons, pas une génération. */
const TEST_TIMEOUT_MS = 20_000;
const TEST_MAX_TOKENS = 64;

const TEST_SYSTEM =
  "Tu es un test de connexion. Réponds exactement par le mot ok, en minuscules, sans ponctuation ni explication.";

const STORE_FAILED = "Les réglages IA n'ont pas pu être lus. Réessaie dans un instant.";

const SAVE_FAILED =
  "Les réglages IA n'ont pas pu être enregistrés. Réessaie ; si cela persiste, recharge la page.";

/**
 * Le refus d'un geste qui suppose une liaison encore absente. Le message nomme
 * le geste manquant plutôt que l'état interne : « lie ton compte », pas
 * « aucune ligne à modifier ».
 */
const NOT_LINKED =
  "Lie d'abord ton compte ChatGPT : sans liaison, il n'y a ni configuration à enregistrer ni abonnement à tester.";

/**
 * La ligne telle qu'elle sort d'ici : jamais la clé, seulement `hasKey`.
 *
 * `null` a deux sens, et l'appelant les traite pareil parce qu'ils appellent
 * le même geste (« configure ») : aucune ligne, ou une ligne devenue illisible
 * (`toPublicSettings` refuse un fournisseur hors contrat).
 */
function present(row: PublicRow | null): AiSettingsResponse {
  return { settings: row === null ? null : toPublicSettings(row) };
}

/* ------------------------------------------------------------------ */
/* Normalisation                                                       */
/* ------------------------------------------------------------------ */

type Normalized =
  | { readonly ok: true; readonly input: AiSettingsInput }
  | { readonly ok: false; readonly reason: string };

/**
 * Range l'URL de base et refuse celles qui n'ont pas de sens.
 *
 * Le refus le plus important n'est pas cosmétique : cette URL est appelée
 * **par le serveur**, donc une adresse de réseau interne ferait de la fonction
 * un relais vers l'intérieur de l'infrastructure (`base-url.ts` détaille).
 */
function normalize(input: AiSettingsInput): Normalized {
  if (!providerSpec(input.provider).needsBaseUrl) {
    return { ok: true, input: { ...input, base_url: null } };
  }

  const checked = checkBaseUrl(input.base_url ?? "");

  if (!checked.ok) return { ok: false, reason: checked.reason };
  return { ok: true, input: { ...input, base_url: storedBaseUrl(checked.url) } };
}

/* ------------------------------------------------------------------ */
/* Verbes                                                              */
/* ------------------------------------------------------------------ */

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const read = await readSettings(auth.client, auth.userId);

  if (!read.ok) {
    console.error("[ai-settings] lecture en échec", read.reason);
    return fail(STORE_FAILED, 503);
  }

  const settings = present(read.value);

  return json(
    {
      ...settings,
      quota: await quotaOf(auth, settings.settings !== null),
    } satisfies AiSettingsView,
    200,
  );
}

/**
 * L'état des quotas du jour, joint à la lecture des réglages.
 *
 * `lifted` ne se relit pas : il **est** le verdict qu'on vient d'établir —
 * une configuration personnelle exploitable, donc rien à compter chez nous
 * (SPEC §5 ter). `present` a déjà écarté les lignes hors contrat, qui font de
 * toute façon échouer la génération en 409 plutôt que de lever un quota.
 *
 * Les limites viennent de `platform_settings`, donc de la clé de service —
 * absente ou illisible, `loadPlatformSettings` retombe sur les constantes des
 * contrats, exactement comme les fonctions de génération. La limite affichée
 * est ainsi toujours celle qui sera appliquée, y compris quand rien n'est
 * configuré.
 *
 * Les compteurs sont lus même sur un quota levé : ils ne coûtent qu'une
 * requête, et ils redeviennent la vérité à la seconde où l'utilisateur retire
 * sa clé — sans qu'il ait à recharger l'écran du coach.
 */
async function quotaOf(
  auth: Authenticated & { ok: true },
  lifted: boolean,
): Promise<AiQuotaResponse> {
  const platform = await loadPlatformSettings(serviceClient());
  const quotas = await readAiQuotas(
    auth.client,
    auth.userId,
    aiQuotaLimits(platform.limits),
    new Date(),
  );

  // Copie mutable : le contrat décrit ce qui part sur le fil, pas la promesse
  // d'immuabilité que `readAiQuotas` tient de son côté.
  return { lifted, quotas: [...quotas] };
}

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const body = await readBody(
    request,
    aiSettingsRequestSchema,
    "Réglages incomplets : choisis un fournisseur, un modèle, et renseigne une clé.",
  );

  if (!body.ok) return body.response;

  // La liaison de compte n'a ni fournisseur à valider ni URL à normaliser :
  // elle n'a qu'un flux à ouvrir ou à suivre.
  if (body.value.action === "link_start") return linkStart(auth.userId);
  if (body.value.action === "link_poll") {
    return linkPoll(auth.userId, body.value.handle, auth.client);
  }

  const normalized = normalize(body.value.settings);

  if (!normalized.ok) return fail(normalized.reason, 400);

  if (body.value.action === "test") {
    return json(await runTest(normalized.input, auth.userId), 200);
  }

  const saved = await saveSettings(auth.client, auth.userId, normalized.input);

  if (!saved.ok) {
    console.error("[ai-settings] enregistrement en échec", saved.reason);
    return fail(SAVE_FAILED, 503);
  }

  // Rien à modifier et rien à créer : une configuration à liaison qu'on tente
  // d'enregistrer avant d'avoir lié le compte. Le geste manquant est nommé.
  if (saved.value === null) return fail(NOT_LINKED, 409);
  return json(present(saved.value), 200);
}

/* ------------------------------------------------------------------ */
/* Liaison de compte (ChatGPT abonnement)                              */
/* ------------------------------------------------------------------ */

/**
 * Ouvre la demande d'autorisation chez OpenAI.
 *
 * Rien à choisir dans le corps de la requête : ChatGPT (abonnement) est le seul
 * fournisseur à liaison, et un paramètre de plus n'aurait servi qu'à pouvoir se
 * tromper. La réponse ne porte que ce que l'écran doit afficher — jamais un
 * jeton, jamais l'identifiant interne de la demande (il voyage scellé).
 */
async function linkStart(userId: string): Promise<Response> {
  const outcome = await startLink(userId, { secret: linkSecret(process.env) });

  if (!outcome.ok) {
    console.error("[ai-settings] liaison ChatGPT : ouverture refusée", { status: outcome.status });
    return fail(outcome.reason, outcome.status);
  }
  return json({ link: outcome.link } satisfies AiLinkStartResponse, 200);
}

/**
 * Suit la demande, et l'enregistre quand elle aboutit.
 *
 * L'écriture passe par le JWT de l'appelant : poser son propre secret est ce
 * que les privilèges de colonne autorisent (migration 0008). Un échec
 * d'écriture après une autorisation réussie est un vrai problème — on le dit en
 * 503 plutôt que de rendre « lié » sur une liaison qui n'existe nulle part.
 */
async function linkPoll(
  userId: string,
  handle: string,
  client: Parameters<typeof linkChatGptSettings>[0],
): Promise<Response> {
  const outcome = await pollLink(userId, handle, { secret: linkSecret(process.env) });

  if (outcome.status !== "linked") {
    return json({ status: outcome.status, settings: null } satisfies AiLinkPollResponse, 200);
  }

  const saved = await linkChatGptSettings(client, userId, outcome.bundle);

  if (!saved.ok || saved.value === null) {
    console.error(
      "[ai-settings] liaison ChatGPT : enregistrement en échec",
      saved.ok ? "aucune ligne écrite" : saved.reason,
    );
    return fail(
      "Ton compte ChatGPT a bien autorisé AimForge, mais la liaison n'a pas pu être enregistrée. Réessaie.",
      503,
    );
  }
  return json(
    { status: "linked", settings: toPublicSettings(saved.value) } satisfies AiLinkPollResponse,
    200,
  );
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticate(request);

  if (!auth.ok) return auth.response;

  const removed = await deleteSettings(auth.client, auth.userId);

  if (!removed.ok) {
    console.error("[ai-settings] suppression en échec", removed.reason);
    return fail("Les réglages IA n'ont pas pu être supprimés. Réessaie dans un instant.", 503);
  }
  return json({ settings: null } satisfies AiSettingsResponse, 200);
}

/* ------------------------------------------------------------------ */
/* Test de connexion                                                   */
/* ------------------------------------------------------------------ */

/**
 * Un aller-retour minimal avec la configuration proposée — **jamais
 * enregistrée**. On demande le mot « ok » : ce qui compte n'est pas la
 * réponse, c'est qu'il y en ait une, et que le fournisseur ne l'ait pas
 * refusée.
 *
 * Le verdict sort en 200 même quand il est négatif : la fonction a fait son
 * travail. Un code d'erreur HTTP aurait mélangé « ta clé est refusée » avec
 * « notre service est cassé », et l'écran aurait affiché le mauvais message
 * pour le mauvais responsable.
 */
async function runTest(input: AiSettingsInput, userId: string): Promise<AiTestResponse> {
  const spec = providerSpec(input.provider);
  // Sur un fournisseur à liaison, la clé n'est pas dans la requête — elle est en
  // base, et seule la clé de service peut la relire.
  const credentials = isLinkProvider(input.provider)
    ? await linkedCredentials(userId)
    : { ok: true as const, apiKey: input.api_key ?? "", deps: {} as AskDeps };

  if (!credentials.ok) return { ok: false, message: credentials.message };

  try {
    // `createAsk` peut déjà refuser ici (URL de base inutilisable) : le même
    // `catch` traite le refus d'avant l'appel et celui d'après.
    const ask = createAsk(
      {
        source: "user",
        provider: input.provider,
        model: input.model,
        baseUrl: input.base_url ?? null,
        apiKey: credentials.apiKey,
      },
      { system: TEST_SYSTEM, maxTokens: TEST_MAX_TOKENS },
      credentials.deps,
    );
    const answer = await ask([{ role: "user", content: "ok" }], TEST_TIMEOUT_MS);

    // Un test de connexion ne juge pas la sortie : qu'elle ait été coupée au
    // plafond prouve justement que le modèle répond.
    return {
      ok: true,
      message: `Connexion réussie : ${spec.label} a répondu avec « ${input.model} » (${answer.text.slice(0, 40)}).`,
    };
  } catch (cause) {
    if (cause instanceof ModelError) {
      // Le détail technique reste dans les logs de la fonction.
      console.error("[ai-settings] test en échec", cause.message);
      return { ok: false, message: modelTestMessage(cause) };
    }
    console.error("[ai-settings] test en échec (inattendu)", cause);
    return {
      ok: false,
      message: "Le test n'a pas pu aboutir. Réessaie dans un instant.",
    };
  }
}

type Credentials =
  | { readonly ok: true; readonly apiKey: string; readonly deps: AskDeps }
  | { readonly ok: false; readonly message: string };

/**
 * Les jetons d'une liaison enregistrée, pour la durée d'un test.
 *
 * C'est le seul chemin de ce fichier qui convoque la clé de service, et il ne
 * peut pas faire autrement : les privilèges de colonne (migration 0008)
 * réservent la lecture de `api_key` à `service_role`. Le `persist` accompagne
 * les jetons parce qu'un test peut déclencher un rafraîchissement — le perdre
 * ferait rafraîchir à chaque test, et la rotation finirait par casser la
 * liaison.
 */
async function linkedCredentials(userId: string): Promise<Credentials> {
  const service = serviceClient();

  if (service === null) {
    return {
      ok: false,
      message:
        "Test indisponible ici : le serveur n'est pas configuré pour relire ta liaison (clé de service absente). La liaison, elle, reste enregistrée.",
    };
  }

  let stored: Awaited<ReturnType<ReturnType<typeof loadAiSettingsWith>>>;

  try {
    stored = await loadAiSettingsWith(service)(userId);
  } catch (cause) {
    console.error("[ai-settings] lecture de la liaison en échec", cause);
    return { ok: false, message: "Ta liaison n'a pas pu être lue. Réessaie dans un instant." };
  }

  const provider = providerSchema.safeParse(stored?.provider);

  if (stored === null || !provider.success || !isLinkProvider(provider.data)) {
    return { ok: false, message: NOT_LINKED };
  }
  return {
    ok: true,
    apiKey: stored.api_key,
    deps: { persist: persistChatGptTokensWith(service, userId) },
  };
}
