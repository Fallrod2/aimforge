/**
 * Routes `/api/profile` : le profil est un **singleton** (une seule ligne,
 * `id = 1`).
 *
 * Choix assumés :
 * - `GET` sur une base vierge rend **200 + un profil à champs nuls** (et non
 *   404) : l'UI affiche toujours le même formulaire, sans cas particulier ;
 * - `PUT` **fusionne** : un champ absent garde sa valeur, un champ à `null`
 *   l'efface. Le premier `PUT` crée la ligne.
 */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDatabase } from "../db/client";
import { PROFILE_ID, profile } from "../db/schema";
import { badRequest, jsonOut, readJsonBody } from "./http";
import {
  type Profile,
  profileSchema,
  type UpdateProfileInput,
  updateProfileSchema,
} from "./schemas";

const PROFILE_FIELDS = [
  "pseudo",
  "currentRank",
  "peakRank",
  "mainAgent",
  "goal",
  "weakMapsNotes",
] as const satisfies readonly (keyof Profile)[];

const EMPTY_PROFILE: Profile = {
  pseudo: null,
  currentRank: null,
  peakRank: null,
  mainAgent: null,
  goal: null,
  weakMapsNotes: null,
};

function readProfile(db: AppDatabase): Profile {
  const [row] = db
    .select({
      pseudo: profile.pseudo,
      currentRank: profile.currentRank,
      peakRank: profile.peakRank,
      mainAgent: profile.mainAgent,
      goal: profile.goal,
      weakMapsNotes: profile.weakMapsNotes,
    })
    .from(profile)
    .where(eq(profile.id, PROFILE_ID))
    .all();

  return row ?? EMPTY_PROFILE;
}

function mergeProfile(current: Profile, patch: UpdateProfileInput): Profile {
  const merged: Profile = { ...current };

  for (const field of PROFILE_FIELDS) {
    const value = patch[field];

    if (value !== undefined) merged[field] = value;
  }
  return merged;
}

export function profileRoutes(db: AppDatabase): Hono {
  const routes = new Hono();

  routes.get("/", (c) => jsonOut(c, profileSchema, readProfile(db)));

  routes.put("/", async (c) => {
    const body = await readJsonBody(c);

    if (!body.ok) return badRequest(c, "Corps JSON invalide");

    const parsed = updateProfileSchema.safeParse(body.value);

    if (!parsed.success) return badRequest(c, "Payload invalide", parsed.error);

    const merged = mergeProfile(readProfile(db), parsed.data);

    db.insert(profile)
      .values({ id: PROFILE_ID, ...merged })
      .onConflictDoUpdate({ target: profile.id, set: merged })
      .run();

    return jsonOut(c, profileSchema, merged);
  });

  return routes;
}
