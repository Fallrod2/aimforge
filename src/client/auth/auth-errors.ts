/**
 * Traduction des échecs d'authentification en messages affichables.
 *
 * Les messages de Supabase Auth sont en anglais et parfois techniques
 * (« Invalid login credentials »). On les remplace sur les cas qu'un
 * utilisateur peut réellement rencontrer, en s'appuyant sur `code` — stable,
 * documenté — plutôt que sur le texte, qui change d'une version à l'autre.
 *
 * Module pur : il prend un objet quelconque (erreur de la lib ou corps JSON
 * d'une réponse d'API) et rend une phrase française.
 */

/** Ce qu'on sait lire d'un échec, quelle que soit sa provenance. */
export interface AuthFailure {
  /** Code stable de Supabase Auth (`error.code`, ou `error_code` en JSON). */
  readonly code?: string | undefined;
  /** Message brut (`error.message`, ou `msg` en JSON). */
  readonly message?: string | undefined;
}

const BY_CODE: Readonly<Record<string, string>> = {
  invalid_credentials: "Email ou mot de passe incorrect.",
  email_not_confirmed:
    "Ce compte n'est pas encore confirmé. Ouvre le lien reçu par email avant de te connecter.",
  user_already_exists: "Un compte existe déjà avec cette adresse. Connecte-toi plutôt.",
  email_exists: "Un compte existe déjà avec cette adresse. Connecte-toi plutôt.",
  weak_password: "Mot de passe trop faible : allonge-le ou varie les caractères.",
  same_password: "Ce mot de passe est déjà le tien. Choisis-en un autre.",
  signup_disabled: "Les inscriptions sont fermées pour le moment.",
  over_email_send_rate_limit:
    "Trop d'emails demandés coup sur coup. Patiente une minute avant de réessayer.",
  over_request_rate_limit: "Trop de tentatives. Patiente une minute avant de réessayer.",
  email_address_invalid: "Cette adresse email est refusée par le serveur.",
  provider_disabled: "Ce mode de connexion n'est pas encore activé.",
  validation_failed: "La demande a été refusée par le serveur d'authentification.",
};

/** Reconnaît un provider OAuth désactivé, dont le code générique ne dit rien. */
function isProviderDisabled(failure: AuthFailure): boolean {
  if (failure.code === "provider_disabled") return true;

  return (failure.message ?? "").toLowerCase().includes("provider is not enabled");
}

/** Lit un échec dans n'importe quelle valeur : erreur de lib, corps JSON, `null`. */
export function toAuthFailure(cause: unknown): AuthFailure {
  if (typeof cause !== "object" || cause === null) return {};

  const raw = cause as Record<string, unknown>;
  const code = raw.code ?? raw.error_code ?? raw.error;
  const message = raw.message ?? raw.msg ?? raw.error_description;

  return {
    code: typeof code === "string" ? code : undefined,
    message: typeof message === "string" ? message : undefined,
  };
}

/**
 * Le message à afficher pour un échec d'authentification.
 *
 * `providerLabel` nomme le bouton OAuth pressé, pour que « Discord n'est pas
 * encore activé » soit plus utile que « provider is not enabled ».
 */
export function authErrorMessage(cause: unknown, providerLabel?: string): string {
  const failure = toAuthFailure(cause);

  if (isProviderDisabled(failure)) {
    const who = providerLabel ?? "Ce mode de connexion";

    return `${who} n'est pas encore activé sur AimForge. Utilise l'email et le mot de passe en attendant.`;
  }

  const known = failure.code === undefined ? undefined : BY_CODE[failure.code];

  if (known !== undefined) return known;
  if (failure.message !== undefined && failure.message !== "") return failure.message;
  return "L'authentification a échoué. Réessaie dans un instant.";
}
