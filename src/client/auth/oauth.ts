/**
 * Connexion via un fournisseur externe (Discord, Google).
 *
 * `signInWithOAuth` construit l'URL d'autorisation **côté client** : si le
 * provider n'est pas encore activé dans le tableau de bord Supabase, la lib ne
 * s'en rend pas compte et le navigateur part afficher une page JSON d'erreur
 * en anglais, hors de l'application. Ici on demande l'URL sans redirection
 * (`skipBrowserRedirect`), on la sonde, et on ne navigue que si le serveur
 * accepte — sinon l'échec se raconte dans la page de connexion.
 */

import type { Provider } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";
import { authErrorMessage } from "./auth-errors";

export interface OAuthProvider {
  readonly id: Extract<Provider, "discord" | "google">;
  readonly label: string;
}

/** Les fournisseurs proposés, dans l'ordre d'affichage. */
export const OAUTH_PROVIDERS: readonly OAuthProvider[] = [
  { id: "discord", label: "Discord" },
  { id: "google", label: "Google" },
];

/**
 * Lance la connexion externe. Rend `null` si le navigateur part vers le
 * fournisseur, ou le message d'erreur à afficher si rien ne s'est passé.
 */
export async function startOAuth(provider: OAuthProvider): Promise<string | null> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: provider.id,
    options: {
      // Retour sur l'origine courante : l'app est la même en local et en
      // production, seule l'origine change. (Cette origine doit figurer dans
      // les « Redirect URLs » du projet Supabase.)
      redirectTo: window.location.origin,
      skipBrowserRedirect: true,
    },
  });

  if (error !== null) return authErrorMessage(error, provider.label);
  if (!data.url) return authErrorMessage(null, provider.label);

  const refusal = await probe(data.url, provider);

  if (refusal !== null) return refusal;

  // Le vérificateur PKCE a été stocké par `signInWithOAuth` avant de rendre
  // l'URL : naviguer à la main est équivalent à la redirection automatique.
  window.location.assign(data.url);
  return null;
}

/**
 * Interroge l'URL d'autorisation. `null` = le serveur redirige vers le
 * fournisseur (tout va bien) ; sinon le message d'erreur à afficher.
 *
 * `redirect: "manual"` transforme la redirection attendue en réponse opaque
 * (`type` « opaqueredirect », statut 0) sans la suivre — on ne consomme donc
 * rien du fournisseur. Un refus de Supabase, lui, revient en JSON lisible :
 * `/auth/v1/*` autorise la lecture cross-origin.
 */
async function probe(url: string, provider: OAuthProvider): Promise<string | null> {
  let response: Response;

  try {
    response = await fetch(url, { method: "GET", redirect: "manual" });
  } catch {
    // Sondage impossible (réseau, politique du navigateur) : on ne bloque pas
    // un parcours peut-être valide, la redirection normale reprend la main.
    return null;
  }

  if (response.type === "opaqueredirect" || response.ok) return null;

  try {
    return authErrorMessage(await response.json(), provider.label);
  } catch {
    return `${provider.label} n'est pas disponible pour le moment (erreur ${response.status}).`;
  }
}
