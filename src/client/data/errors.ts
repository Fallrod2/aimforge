/**
 * Erreurs de la couche données, avec un message affichable tel quel.
 *
 * Les vues affichent `error.message` sans le retoucher (`Notice`, bandeau du
 * tracker…). Un `PostgrestError` brut y arriverait en anglais et en jargon
 * (« JSON object requested, multiple (or no) rows returned ») : cette
 * traduction est donc la frontière où un échec technique devient une phrase.
 *
 * Module pur : il ne connaît que la *forme* d'une erreur Supabase, pas le
 * client — d'où sa testabilité sans réseau.
 */

/** Échec d'un accès aux données, porteur d'un message destiné à l'écran. */
export class DataError extends Error {
  override readonly name = "DataError";

  /** `cause` porte l'erreur d'origine (console, débogage) — jamais affichée. */
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
  }
}

/** La forme minimale d'un `PostgrestError` (code + message). */
export interface QueryFailure {
  readonly message: string;
  readonly code?: string;
  readonly details?: string | null;
}

/**
 * Codes Postgres/PostgREST qu'on sait nommer. Le reste retombe sur le message
 * générique de l'appelant : mieux vaut « L'enregistrement a échoué » qu'une
 * chaîne anglaise sortie d'un moteur SQL.
 */
const KNOWN_CODES: Readonly<Record<string, string>> = {
  // RLS : la ligne existe peut-être, mais elle n'est pas à cet utilisateur.
  "42501": "Accès refusé : cette donnée n'appartient pas à ton compte.",
  // `.single()` sans ligne — pour nous, un identifiant qui ne mène nulle part.
  PGRST116: "Passe introuvable : elle a peut-être été supprimée.",
  // Contrainte d'unicité.
  "23505": "Cette donnée existe déjà.",
  // Contrainte `check` (tier hors des trois paliers, score négatif…).
  "23514": "Donnée refusée par la base : une valeur est hors des bornes admises.",
  // Clé étrangère : la passe visée n'existe plus.
  "23503": "La passe visée n'existe plus.",
};

/**
 * Traduit un échec de requête en `DataError`. `fallback` porte le contexte
 * métier (« La suppression a échoué. ») ; il est utilisé dès que le code
 * renvoyé n'a pas de traduction dédiée.
 */
export function queryError(failure: QueryFailure | null, fallback: string): DataError {
  const known = failure?.code === undefined ? undefined : KNOWN_CODES[failure.code];

  return new DataError(known ?? fallback, failure);
}

/** Message unique de la perte de session : la même phrase partout. */
export const NO_SESSION_MESSAGE = "Session expirée. Reconnecte-toi pour accéder à tes données.";
