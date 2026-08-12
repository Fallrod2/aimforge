/**
 * Validation du formulaire de connexion, côté client.
 *
 * Elle ne remplace pas celle de Supabase (qui fait autorité) : elle évite un
 * aller-retour réseau — et un compteur de limitation de débit consommé — pour
 * des saisies manifestement incomplètes. Module pur, sans DOM.
 */

/** Les trois usages du même formulaire. */
export type AuthMode = "signin" | "signup" | "reset";

/**
 * Longueur minimale du mot de passe.
 *
 * C'est le défaut de Supabase Auth (`GOTRUE_PASSWORD_MIN_LENGTH`) : la valeur
 * est reprise ici pour refuser tout de suite ce que la base refuserait, pas
 * pour imposer une règle maison. Si le projet la durcit, cette constante suit.
 */
export const MIN_PASSWORD_LENGTH = 6;

/**
 * Forme d'email volontairement permissive : `a@b.c`. Le seul juge d'un email
 * valide est le mail de confirmation qui arrive (ou non) ; une expression
 * régulière plus stricte ne ferait que rejeter des adresses légitimes.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Le mode « oubli de mot de passe » n'a pas de champ mot de passe. */
export function needsPassword(mode: AuthMode): boolean {
  return mode !== "reset";
}

/**
 * Le consentement aux documents légaux n'est demandé qu'à la **création** du
 * compte : c'est là que le contrat se forme. Se reconnecter ou demander un
 * lien de réinitialisation n'engage rien de nouveau, et redemander la case à
 * chaque connexion la transformerait en réflexe — c'est-à-dire en rien.
 */
export function needsConsent(mode: AuthMode): boolean {
  return mode === "signup";
}

/** Ce que dit le formulaire quand la case n'est pas cochée. */
export const CONSENT_REQUIRED =
  "Pour créer un compte, accepte la politique de confidentialité et les CGU.";

/**
 * Le premier problème bloquant de la saisie, prêt à afficher, ou `null` si
 * elle peut partir au serveur.
 */
export function validateCredentials(
  mode: AuthMode,
  email: string,
  password: string,
): string | null {
  if (email.trim() === "") return "Renseigne ton adresse email.";
  if (!EMAIL_SHAPE.test(email.trim())) return "Cette adresse email ne ressemble pas à une adresse.";

  if (!needsPassword(mode)) return null;
  if (password === "") return "Renseigne ton mot de passe.";
  if (mode === "signup" && password.length < MIN_PASSWORD_LENGTH) {
    return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
  }
  return null;
}
