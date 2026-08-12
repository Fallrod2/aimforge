/**
 * Les délais des générations IA, en un seul endroit (V4-C §4.9).
 *
 * Trois horloges courent sur la même requête, et elles doivent rester dans cet
 * ordre — sinon l'une coupe l'autre et l'utilisateur lit un message faux :
 *
 * ```
 *   budget des appels au modèle   <   maxDuration de la fonction   <   délai du client
 *            48 s                            60 s                          70 s
 * ```
 *
 * - **le budget** borne les appels au modèle (deux au plus : la génération et
 *   sa relance corrective) et laisse de quoi écrire en base et rédiger la
 *   réponse. C'est lui qui garantit un 504 **rédigé, avec remboursement du
 *   quota**, plutôt qu'une coupure de plateforme ;
 * - **le `maxDuration`** est la limite de la plateforme. Au-delà, la fonction
 *   est tuée : pas de réponse JSON, pas de remboursement, un quota décompté
 *   pour rien. C'est exactement ce qu'il faut ne jamais atteindre ;
 * - **le délai du client** attend plus longtemps que le serveur, marge réseau
 *   comprise. Un client qui abandonnerait le premier laisserait la fonction
 *   finir dans le vide : la routine serait écrite en base sans que l'écran le
 *   sache, et le joueur croirait avoir perdu son quota.
 *
 * `AI_MAX_DURATION_S` est un **miroir** : Vercel lit `export const maxDuration`
 * dans chaque fonction par analyse statique, la valeur y reste donc littérale.
 * Le test de ce module relit les fichiers `api/` et refuse la dérive — c'est la
 * seule façon d'avoir une vérité unique sans risquer la lecture de la
 * plateforme.
 */

/**
 * Le `maxDuration` des fonctions IA, en secondes.
 *
 * 60 s est le plafond du plan Hobby avec Fluid Compute : on s'y tient, et c'est
 * la raison pour laquelle le budget ci-dessous est ce qu'il est.
 */
export const AI_MAX_DURATION_S = 60;

/** Les fonctions dont le `maxDuration` doit valoir `AI_MAX_DURATION_S`. */
export const AI_FUNCTIONS = [
  "api/routine.ts",
  "api/coach.ts",
  "api/coach-thread.ts",
  "api/coach-chat.ts",
] as const;

/**
 * Budget total des appels au modèle, sous le `maxDuration`.
 *
 * Les 12 s de marge couvrent l'authentification, la lecture du contexte,
 * l'écriture en base et le remboursement du quota en cas d'échec.
 */
export const AI_MODEL_BUDGET_MS = 48_000;

/**
 * Plafond d'un appel unique : un premier appel lent ne doit pas avaler tout le
 * budget et laisser la relance corrective sans rien.
 */
export const AI_MODEL_CALL_CAP_MS = 38_000;

/**
 * Plancher sous lequel on ne tente plus rien : mieux vaut un 504 rédigé et
 * remboursé qu'une tentative qui n'a aucune chance d'aboutir.
 */
export const AI_MODEL_CALL_FLOOR_MS = 8_000;

/**
 * Le délai du navigateur : le `maxDuration` du serveur, plus la marge réseau.
 *
 * Il existe pour qu'un socket muet finisse par rendre la main avec un message
 * juste, pas pour arbitrer la génération — il ne doit jamais se déclencher
 * avant le serveur.
 */
export const AI_CLIENT_TIMEOUT_MS = AI_MAX_DURATION_S * 1_000 + 10_000;
