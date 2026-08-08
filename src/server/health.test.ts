import { describe, expect, it } from "vitest";
import { app } from "./app";

describe("GET /api/health", () => {
  it("répond 200 avec { ok: true }", async () => {
    const res = await app.request("/api/health");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("répond 404 sur une route inconnue", async () => {
    const res = await app.request("/api/nope");

    expect(res.status).toBe(404);
  });
});
