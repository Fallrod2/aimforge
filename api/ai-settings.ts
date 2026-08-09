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
 * `POST` fait deux choses selon `action` :
 *
 * - `test` : un mini-appel au fournisseur avec la configuration **fournie**,
 *   sans rien enregistrer. C'est le seul moyen honnête de dire « ta clé
 *   marche » — la valider par sa forme ne prouverait rien ;
 * - `save` : validation Zod, normalisation de l'URL de base, puis écriture.
 *
 * Les trois verbes sont exportés nommément (`GET`, `POST`, `DELETE`) : c'est
 * la forme que le runtime Node de Vercel reconnaît comme gestionnaire web. Les
 * autres méthodes n'ont pas d'export, la plateforme y répond 405 toute seule.
 */

import {
  checkBaseUrl,
  createAsk,
  ModelError,
  modelTestMessage,
  storedBaseUrl,
  toPublicSettings,
} from "../src/server/ai/index.js";
import {
  type AiSettingsInput,
  type AiSettingsResponse,
  type AiTestResponse,
  aiSettingsRequestSchema,
  providerSpec,
} from "../src/shared/ai-settings-contract.js";
import { deleteSettings, type PublicRow, readSettings, saveSettings } from "./_lib/ai-settings.js";
import { authenticate, fail, json, readBody } from "./_lib/request.js";

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
  return json(present(read.value), 200);
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

  const normalized = normalize(body.value.settings);

  if (!normalized.ok) return fail(normalized.reason, 400);

  if (body.value.action === "test") {
    return json(await runTest(normalized.input), 200);
  }

  const saved = await saveSettings(auth.client, auth.userId, normalized.input);

  if (!saved.ok) {
    console.error("[ai-settings] enregistrement en échec", saved.reason);
    return fail(SAVE_FAILED, 503);
  }
  return json(present(saved.value), 200);
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
async function runTest(input: AiSettingsInput): Promise<AiTestResponse> {
  const spec = providerSpec(input.provider);

  try {
    // `createAsk` peut déjà refuser ici (URL de base inutilisable) : le même
    // `catch` traite le refus d'avant l'appel et celui d'après.
    const ask = createAsk(
      {
        source: "user",
        provider: input.provider,
        model: input.model,
        baseUrl: input.base_url ?? null,
        apiKey: input.api_key,
      },
      { system: TEST_SYSTEM, maxTokens: TEST_MAX_TOKENS },
    );
    const answer = await ask([{ role: "user", content: "ok" }], TEST_TIMEOUT_MS);

    return {
      ok: true,
      message: `Connexion réussie : ${spec.label} a répondu avec « ${input.model} » (${answer.slice(0, 40)}).`,
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
