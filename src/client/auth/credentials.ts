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
