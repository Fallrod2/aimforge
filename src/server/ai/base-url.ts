/**
 * Validation et normalisation de l'URL de base d'un serveur OpenAI-compatible.
 *
 * Module **pur** : il ne fait aucun appel, il décide seulement si une URL est
 * utilisable et à quoi elle ressemble une fois rangée.
 *
 * Ce n'est pas de la cosmétique. Cette URL est saisie par l'utilisateur et
 * appelée **par la fonction serverless**, c'est-à-dire depuis l'intérieur de
 * l'infrastructure : c'est la définition d'une SSRF. Un `base_url` pointant
 * sur `169.254.169.254` (métadonnées d'instance) ou sur `127.0.0.1` ferait
 * émettre à notre serveur une requête que l'utilisateur ne peut pas émettre
 * lui-même. Le projet est mono-utilisateur, ce qui réduit le risque sans le
 * supprimer — et le coût du refus est nul : personne n'héberge un modèle sur
 * le loopback d'un serveur Vercel.
 *
 * On refuse donc les cibles qui n'ont de sens que depuis l'intérieur, on exige
 * http(s), et on laisse tout le reste passer — y compris une IP publique en
 * clair, parce que « mon vLLM sur ma machine » est un cas d'usage annoncé par
 * SPEC §5 ter.
 */

/** Le chemin qu'attend un serveur OpenAI-compatible. */
const CHAT_PATH = "/chat/completions";

export type BaseUrlCheck =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: string };

/**
 * Hôtes qui ne désignent jamais un serveur de modèle joignable depuis une
 * fonction serverless — mais désignent très bien quelque chose d'intéressant
 * pour qui voudrait se servir de notre serveur comme d'un relais.
 *
 * **Toute IPv6 littérale est refusée**, y compris publique, et c'est un choix
 * assumé plutôt qu'une paresse. Une liste de préfixes interdits a toujours une
 * forme de retard : `::ffff:127.0.0.1` (IPv4 mappée) est normalisée par `URL`
 * en `[::ffff:7f00:1]`, qui ne ressemble ni à `::1` ni à `fe80:`/`fc`/`fd` —
 * elle passait donc le filtre et atteignait bel et bien le loopback (vérifié).
 * Restent les formes compatibles, NAT64 (`64:ff9b::`), les identifiants de
 * portée, les écritures compressées différemment… autant d'occasions de se
 * tromper à nouveau. Aucun cas d'usage annoncé par SPEC §5 ter — « mon vLLM
 * chez moi », Ollama distant, OpenAI — n'exige une IPv6 **littérale** : un nom
 * de domaine résout parfaitement vers une adresse IPv6. Le coût du refus est
 * donc nul, et la règle tient en une ligne qu'on n'a plus à maintenir.
 */
function isForbiddenHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  // `URL` conserve les crochets sur `hostname` pour une IPv6 littérale : ce
  // crochet est la signature de la forme, avant toute interprétation.
  if (host.startsWith("[")) return true;

  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".internal") || host.endsWith(".local")) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);

  if (ipv4 === null) return false;

  const octets = ipv4.slice(1).map((part) => Number.parseInt(part, 10));
  const [a = -1, b = -1] = octets;

  if (octets.some((octet) => octet > 255)) return true;
  if (a === 0 || a === 127) return true;
  if (a === 10) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

/**
 * Vérifie l'URL de base et rend l'URL **complète** du point d'entrée.
 *
 * La normalisation accepte les trois formes qu'on écrit naturellement, parce
 * que se tromper de suffixe est l'erreur la plus fréquente et la plus pénible
 * à diagnostiquer (elle ne se voit qu'au premier appel, en 404) :
 *
 * - `https://api.exemple.com/v1` → on ajoute `/chat/completions` ;
 * - `https://api.exemple.com/v1/` → idem, sans double barre ;
 * - `https://api.exemple.com/v1/chat/completions` → laissé tel quel.
 */
export function checkBaseUrl(raw: string): BaseUrlCheck {
  const trimmed = raw.trim();

  if (trimmed === "") return { ok: false, reason: "L'URL de base est vide." };

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      ok: false,
      reason: "URL de base illisible. Exemple attendu : https://api.exemple.com/v1",
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { ok: false, reason: "L'URL de base doit commencer par https:// (ou http://)." };
  }
  if (parsed.hostname.startsWith("[")) {
    return {
      ok: false,
      reason:
        "Les adresses IPv6 écrites en clair ne sont pas acceptées : utilise un nom de domaine (il peut parfaitement pointer vers une IPv6).",
    };
  }
  if (isForbiddenHost(parsed.hostname)) {
    return {
      ok: false,
      reason:
        "Cette adresse désigne le réseau interne du serveur, pas ton serveur de modèle. Utilise une adresse joignable depuis Internet.",
    };
  }
  if (parsed.search !== "" || parsed.hash !== "") {
    return { ok: false, reason: "L'URL de base ne doit porter ni paramètre ni ancre." };
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  const full = path.endsWith(CHAT_PATH) ? path : `${path}${CHAT_PATH}`;

  return { ok: true, url: `${parsed.origin}${full}` };
}

/** L'URL de base telle qu'on la **stocke** : sans le chemin `/chat/completions`. */
export function storedBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");

  return trimmed.endsWith(CHAT_PATH) ? trimmed.slice(0, -CHAT_PATH.length) : trimmed;
}
