/**
 * Routes `/api/bench-runs` : création, liste, détail, suppression d'une passe.
 *
 * Le client n'envoie que des scores bruts : énergies, overall, rang et badge
 * « Complete » sont calculés côté serveur par `src/lib/energy`.
 */

import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { listSubcategories, type ScoreMap, subcategoryEnergy } from "../../lib/energy";
import type { AppDatabase } from "../db/client";
import { benchRuns, scenarioScores } from "../db/schema";
import { computeBenchRun, scenarioNames } from "./compute";
import { badRequest, jsonOut, notFound, readJsonBody } from "./http";
import {
  benchRunDetailSchema,
  benchRunIdSchema,
  benchRunSummaryListSchema,
  createBenchRunSchema,
  listBenchRunsQuerySchema,
} from "./schemas";

const summaryColumns = {
  id: benchRuns.id,
  date: benchRuns.date,
  tier: benchRuns.tier,
  overall: benchRuns.overall,
  rank: benchRuns.rank,
  complete: benchRuns.complete,
};

/**
 * Le détail d'une passe : les énergies par scénario sont celles figées en base
 * au moment du calcul ; les énergies par sous-catégorie sont dérivées à la
 * lecture (max des 2 scénarios, moteur d'énergie) car elles ne sont pas stockées.
 */
function loadDetail(db: AppDatabase, id: number) {
  const [run] = db.select(summaryColumns).from(benchRuns).where(eq(benchRuns.id, id)).all();

  if (!run) return null;

  const scores = db
    .select({
      scenario: scenarioScores.scenario,
      score: scenarioScores.score,
      energy: scenarioScores.energy,
    })
    .from(scenarioScores)
    .where(eq(scenarioScores.runId, id))
    .all();

  const scoreMap: ScoreMap = Object.fromEntries(scores.map((row) => [row.scenario, row.score]));

  return {
    ...run,
    scores,
    subcategories: listSubcategories(run.tier).map((subcategory) => ({
      name: subcategory.name,
      energy: subcategoryEnergy(run.tier, subcategory.name, scoreMap),
    })),
  };
}

export function benchRunRoutes(db: AppDatabase): Hono {
  const routes = new Hono();

  routes.post("/", async (c) => {
    const body = await readJsonBody(c);

    if (!body.ok) return badRequest(c, "Corps JSON invalide");

    const parsed = createBenchRunSchema.safeParse(body.value);

    if (!parsed.success) return badRequest(c, "Payload invalide", parsed.error);

    const { tier, scores } = parsed.data;
    const known = scenarioNames(tier);

    for (const name of Object.keys(scores)) {
      if (!known.has(name)) {
        return badRequest(c, `Scénario inconnu pour le palier ${tier}: "${name}"`);
      }
    }

    const computed = computeBenchRun(tier, scores);
    const date = new Date(parsed.data.date ?? Date.now()).toISOString();

    const created = db.transaction((tx) => {
      const [run] = tx
        .insert(benchRuns)
        .values({
          date,
          tier,
          overall: computed.overall,
          rank: computed.rank,
          complete: computed.complete,
        })
        .returning(summaryColumns)
        .all();

      if (!run) throw new Error("Insertion du bench run sans ligne retournée");

      tx.insert(scenarioScores)
        .values(
          computed.scores.map((row) => ({
            runId: run.id,
            scenario: row.scenario,
            score: row.score,
            energy: row.energy,
          })),
        )
        .run();

      return run;
    });

    return jsonOut(
      c,
      benchRunDetailSchema,
      { ...created, scores: computed.scores, subcategories: computed.subcategories },
      201,
    );
  });

  routes.get("/", (c) => {
    const query = listBenchRunsQuerySchema.safeParse({ tier: c.req.query("tier") });

    if (!query.success) return badRequest(c, "Filtre invalide", query.error);

    const { tier } = query.data;
    const base = db.select(summaryColumns).from(benchRuns);
    const filtered = tier ? base.where(eq(benchRuns.tier, tier)) : base;

    return jsonOut(
      c,
      benchRunSummaryListSchema,
      filtered.orderBy(desc(benchRuns.date), desc(benchRuns.id)).all(),
    );
  });

  routes.get("/:id", (c) => {
    const id = benchRunIdSchema.safeParse(c.req.param("id"));

    if (!id.success) return badRequest(c, "Identifiant invalide", id.error);

    const detail = loadDetail(db, id.data);

    if (!detail) return notFound(c, `Bench run introuvable: ${id.data}`);
    return jsonOut(c, benchRunDetailSchema, detail);
  });

  routes.delete("/:id", (c) => {
    const id = benchRunIdSchema.safeParse(c.req.param("id"));

    if (!id.success) return badRequest(c, "Identifiant invalide", id.error);

    // Les scenario_scores partent en cascade (PRAGMA foreign_keys activé).
    const deleted = db
      .delete(benchRuns)
      .where(eq(benchRuns.id, id.data))
      .returning({ id: benchRuns.id })
      .all();

    if (deleted.length === 0) return notFound(c, `Bench run introuvable: ${id.data}`);
    return c.body(null, 204);
  });

  return routes;
}
