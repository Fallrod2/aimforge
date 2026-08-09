/**
 * Le port du modèle, commun à tous les fournisseurs (SPEC §5 ter).
 *
 * `api/coach` et `api/routine` avaient déjà chacun leur type `AskModel` — une
 * conversation entre, du texte sort. Ce module ne les remplace pas : il donne
 * la forme **unique** que les adaptateurs implémentent, et dont les deux
 * `AskModel` existants sont des vues (structurellement compatibles : mêmes
 * rôles, même contenu). C'est ce qui permet de brancher cinq fournisseurs sans
 * toucher à `generateDebrief` ni à `generateRoutine`.
 *
 * Module pur : ni SDK, ni `fetch`, ni Supabase. Les adaptateurs, eux, ont le
 * droit de connaître le réseau ; ce fichier ne connaît que le vocabulaire.
 */

import type { ProviderId } from "../../shared/ai-settings-contract.js";

/** Un message de la conversation, sans dépendance à aucun SDK. */
export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Ce qui ne change pas d'un appel à l'autre pour une même fonctionnalité. */
export interface ModelRequest {
  readonly system: string;
  readonly maxTokens: number;
}

/**
 * Un appel au modèle, borné dans le temps.
 *
 * Le délai est un **paramètre**, pas un réglage de l'adaptateur : la routine
 * partage un budget décroissant entre ses deux tentatives (`budget.ts`), et un
 * adaptateur qui déciderait seul de son délai casserait ce calcul.
 */
export type Ask = (messages: readonly ModelMessage[], timeoutMs: number) => Promise<string>;

/**
 * La configuration effective d'un appel, une fois la résolution faite.
 *
 * `source` n'est pas décoratif : il décide du quota (`platform` seul le
 * consomme) **et** de la rédaction des erreurs — « ta configuration est
 * refusée » et « notre service est en peine » ne demandent pas le même geste à
 * l'utilisateur.
 */
export interface ProviderConfig {
  readonly source: "platform" | "user";
  readonly provider: ProviderId;
  readonly model: string;
  readonly baseUrl: string | null;
  readonly apiKey: string;
}

/* ------------------------------------------------------------------ */
/* Erreurs                                                             */
/* ------------------------------------------------------------------ */

export type ModelErrorKind =
  /** Clé refusée, expirée, ou droits insuffisants. */
  | "auth"
  /** Le fournisseur a dit « trop vite » ou « plus de crédit ». */
  | "rate_limit"
  /** La requête n'a pas abouti dans le temps imparti. */
  | "timeout"
  /** Injoignable, ou en panne de son côté. */
  | "unreachable"
  /** Requête refusée pour une raison de configuration (modèle inconnu, paramètre). */
  | "request"
  /**
   * Le fournisseur a répondu par une redirection, et on ne la suit pas.
   *
   * Ce n'est pas de la rigidité : l'URL de base est vérifiée avant l'appel
   * (`base-url.ts`), et suivre une redirection ferait porter cette
   * vérification sur la première URL d'une chaîne dont le serveur distant
   * choisit la suite. Un point d'entrée légitime d'API ne redirige pas.
   */
  | "redirect"
  /** Réponse reçue, mais pas de la forme attendue. */
  | "malformed";

/**
 * Un échec d'appel au modèle, traduit **une fois** par l'adaptateur.
 *
 * Au-dessus, personne ne relit un statut HTTP de fournisseur : les handlers ne
 * distinguent plus que la nature du problème et à qui il appartient.
 */
export class ModelError extends Error {
  override readonly name = "ModelError";
  readonly kind: ModelErrorKind;
  readonly provider: ProviderId;
  /** Vrai quand l'appel utilisait la configuration personnelle de l'utilisateur. */
  readonly custom: boolean;
  /** Statut HTTP du fournisseur, quand il y en a un. Pour les logs. */
  readonly status: number | null;

  constructor(
    kind: ModelErrorKind,
    config: Pick<ProviderConfig, "provider" | "source">,
    detail: string,
    status: number | null = null,
    cause?: unknown,
  ) {
    super(`[${config.provider}/${kind}] ${detail}`, { cause });
    this.kind = kind;
    this.provider = config.provider;
    this.custom = config.source === "user";
    this.status = status;
  }
}

/**
 * La phrase à afficher pour un échec d'appel.
 *
 * Le point important est la **désignation du responsable**. Quand l'appel
 * partait sur la configuration personnelle de l'utilisateur, l'erreur doit le
 * dire : sans cela, une clé expirée ressemble à une panne d'AimForge, et
 * l'utilisateur attend au lieu d'aller réparer ce que lui seul peut réparer.
 *
 * Fonction pure : c'est elle qu'on teste, pas les `catch` des handlers.
 */
export function modelErrorMessage(error: ModelError, feature: "coach" | "routine"): string {
  const what = feature === "coach" ? "Le coach" : "La routine";

  if (!error.custom) {
    switch (error.kind) {
      case "rate_limit":
        return `${what} est saturé pour le moment. Réessaie dans quelques minutes.`;
      case "timeout":
        return `${what} a mis trop de temps à répondre. Réessaie : c'est en général plus rapide.`;
      default:
        return `${what} est injoignable pour le moment. Réessaie dans un instant.`;
    }
  }

  const prefix = "Ta configuration IA personnelle";

  // ChatGPT (abonnement) ne se répare pas en corrigeant une clé : il n'y en a
  // pas. Un refus d'autorisation veut dire une seule chose, et le message doit
  // demander exactement ce geste — relier le compte.
  if (error.kind === "auth" && error.provider === "chatgpt_subscription") {
    return `Liaison expirée : relie ton compte ChatGPT dans Réglages IA. ${what} n'a pas pu passer par ton abonnement.`;
  }

  switch (error.kind) {
    case "auth":
      return `${prefix} a été refusée : la clé est invalide, expirée, ou n'a pas accès à ce modèle. Corrige-la dans Réglages IA (le quota AimForge reste levé tant qu'une configuration est enregistrée).`;
    case "redirect":
      return `${prefix} pointe vers une adresse qui répond par une redirection — refusée par sécurité. Vérifie l'URL de base dans Réglages IA : elle doit désigner directement le point d'entrée de l'API.`;
    case "rate_limit":
      return `${prefix} a atteint sa limite chez le fournisseur (débit ou crédit épuisé). Réessaie plus tard, ou change de modèle dans Réglages IA.`;
    case "request":
      return `${prefix} a été refusée par le fournisseur : le modèle « ${error.provider} » n'accepte pas cette requête. Vérifie l'identifiant du modèle dans Réglages IA.`;
    case "timeout":
      return `${prefix} n'a pas répondu à temps. Réessaie, ou choisis un modèle plus rapide dans Réglages IA.`;
    case "malformed":
      return `${prefix} a renvoyé une réponse illisible. Ce modèle ne convient peut-être pas : essaie-en un autre dans Réglages IA.`;
    default:
      return `${prefix} est injoignable : le fournisseur ne répond pas. Vérifie l'URL de base et le fournisseur dans Réglages IA.`;
  }
}

/**
 * La phrase d'un **test de connexion** raté.
 *
 * Ce n'est pas la même que ci-dessus, et la nuance est le tout de l'écran de
 * réglages : là, l'utilisateur vient d'appuyer sur « Tester » et attend un
 * verdict sur ce qu'il vient de saisir. Le renvoyer vers « Réglages IA » n'a
 * aucun sens — il y est. Ce qu'il lui faut, c'est le champ à corriger.
 */
export function modelTestMessage(error: ModelError): string {
  // Même nuance qu'au-dessus : sur une liaison de compte, il n'y a pas de champ
  // à corriger — il y a un compte à relier.
  if (error.kind === "auth" && error.provider === "chatgpt_subscription") {
    return "Liaison expirée : relie ton compte ChatGPT.";
  }

  switch (error.kind) {
    case "auth":
      return "Refusé : la clé est invalide, expirée, ou n'a pas accès à ce modèle.";
    case "request":
      return "Refusé : le fournisseur n'a pas accepté la requête. Vérifie l'identifiant du modèle — il doit être écrit exactement comme le fournisseur l'attend.";
    case "redirect":
      return "Le fournisseur a répondu par une redirection — refusée par sécurité. Vérifie l'URL de base : elle doit désigner directement le point d'entrée de l'API.";
    case "rate_limit":
      return "La clé est acceptée, mais la limite du fournisseur est atteinte (débit ou crédit épuisé). Réessaie plus tard.";
    case "timeout":
      return "Pas de réponse dans le temps imparti. Le serveur est peut-être lent à démarrer : réessaie une fois.";
    case "malformed":
      return "Le fournisseur a répondu, mais pas de manière exploitable. Ce modèle ne convient probablement pas.";
    default:
      return "Injoignable : vérifie le fournisseur et, pour un serveur OpenAI-compatible, l'URL de base.";
  }
}

/** Le statut HTTP que la fonction serverless doit rendre pour cet échec. */
export function modelErrorStatus(error: ModelError): number {
  if (error.kind === "timeout") return 504;
  // Une configuration personnelle fautive n'est pas une panne de passerelle :
  // c'est une requête que l'utilisateur doit corriger, et le 409 le dit sans
  // se confondre avec le 401 de session ni le 429 de quota.
  if (
    error.custom &&
    (error.kind === "auth" || error.kind === "request" || error.kind === "redirect")
  ) {
    return 409;
  }
  if (error.kind === "rate_limit") return 503;
  return 502;
}
