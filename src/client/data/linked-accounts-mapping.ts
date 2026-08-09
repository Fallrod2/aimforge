/**
 * Traduction des lignes `linked_accounts` en objets d'UI. Module **pur** : ni
 * Supabase, ni React, ni `fetch` — c'est le seul endroit où une ligne brute
 * devient un `LinkedAccount`, et les deux côtés (navigateur et fonctions
 * serverless) passent par lui.
 *
 * Un seul écart entre la base et l'UI est traité ici : `provider` est un `text`
 * côté Postgres (le `check` le restreint aux deux valeurs, mais le type généré
 * ne le sait pas). Une valeur hors des deux est une dérive de schéma, pas une
 * saisie : on lève plutôt que de deviner.
 */

import { DataError } from "./errors.js";
import {
  type LinkedAccount,
  mmrSummarySchema,
  PROVIDERS,
  type Provider,
} from "./linked-accounts-contract.js";

/** Les colonnes de `linked_accounts` que le client et les fonctions lisent. */
export const LINKED_ACCOUNT_COLUMNS =
  "id, provider, external_id, riot_puuid, riot_region, label, is_primary, created_at, last_refreshed_at, riot_mmr";

export interface LinkedAccountRow {
  readonly id: number;
  readonly provider: string;
  readonly external_id: string;
  readonly riot_puuid: string | null;
  readonly riot_region: string | null;
  readonly label: string | null;
  readonly is_primary: boolean;
  readonly created_at: string;
  readonly last_refreshed_at: string | null;
  /** `jsonb` : sa forme est vérifiée à la lecture, pas garantie par le type. */
  readonly riot_mmr: unknown;
}

function toProvider(value: string): Provider {
  const provider = PROVIDERS.find((id) => id === value);

  if (provider === undefined) {
    throw new DataError(`Fournisseur inconnu en base : « ${value} ».`);
  }
  return provider;
}

function toIsoDate(value: string, column: string): string {
  const time = Date.parse(value);

  if (Number.isNaN(time)) {
    throw new DataError(`Date illisible en base (${column}) : « ${value} ».`);
  }
  return new Date(time).toISOString();
}

export function toLinkedAccount(row: LinkedAccountRow): LinkedAccount {
  return {
    id: row.id,
    provider: toProvider(row.provider),
    externalId: row.external_id,
    riotPuuid: row.riot_puuid,
    riotRegion: row.riot_region,
    label: row.label,
    isPrimary: row.is_primary,
    createdAt: toIsoDate(row.created_at, "created_at"),
    lastRefreshedAt:
      row.last_refreshed_at === null ? null : toIsoDate(row.last_refreshed_at, "last_refreshed_at"),
    // Un rang stocké hors contrat (écrit par une version antérieure, schéma
    // modifié) est ignoré : mieux vaut ne rien afficher qu'afficher faux, et
    // le prochain rafraîchissement le réécrira.
    riotMmr: mmrSummarySchema.safeParse(row.riot_mmr).data ?? null,
  };
}

export function toLinkedAccounts(rows: readonly LinkedAccountRow[]): readonly LinkedAccount[] {
  return rows.map(toLinkedAccount);
}

/* ------------------------------------------------------------------ */
/* Riot ID                                                             */
/* ------------------------------------------------------------------ */

export interface RiotId {
  readonly name: string;
  readonly tag: string;
}

/**
 * Lit un Riot ID saisi à la main.
 *
 * Le `#` est le seul séparateur : un nom peut contenir des espaces, un tag non.
 * On accepte le collage depuis le client Valorant (« Nom #TAG », casse
 * quelconque) mais on refuse tout ce qui n'a pas exactement un `#` — deviner
 * lierait le mauvais compte, et l'erreur ne se verrait qu'au premier
 * rafraîchissement vide.
 */
export function parseRiotId(raw: string): RiotId | null {
  const parts = raw.trim().split("#");

  if (parts.length !== 2) return null;

  const name = (parts[0] ?? "").trim();
  const tag = (parts[1] ?? "").trim();

  if (name === "" || tag === "") return null;
  if (/\s/.test(tag)) return null;
  return { name, tag };
}

/** La forme canonique affichée et stockée dans `external_id`. */
export function formatRiotId(id: RiotId): string {
  return `${id.name}#${id.tag}`;
}
