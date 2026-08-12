/**
 * La génération qui survit à la navigation.
 *
 * Ce qui est vérifié ici, c'est exactement ce qu'un `useState` dans la vue ne
 * savait pas faire : la demande continue quand personne ne regarde, son
 * résultat attend qu'on revienne, l'échec garde de quoi être rejoué, et rien
 * n'est livré deux fois.
 *
 * Aucun React : le magasin est un module, et c'est ce qui le rend testable
 * comme une fonction.
 */

import { describe, expect, it, vi } from "vitest";
import { createGenerationStore, type GenerationFailure, upsertById } from "./generation-store";

const FAILURE: GenerationFailure = { message: "Panne.", quota: false, remaining: null };

/** Une promesse dont le test décide de la fin. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((ok, ko) => {
    resolve = ok;
    reject = ko;
  });

  return { promise, resolve, reject };
}

/** Un magasin dont chaque `run` est piloté à la main par le test. */
function harness() {
  const calls: string[] = [];
  const pending: ReturnType<typeof deferred<string>>[] = [];
  const store = createGenerationStore<string, string>({
    run: (request) => {
      calls.push(request);
      const next = deferred<string>();

      pending.push(next);
      return next.promise;
    },
    failureOf: () => FAILURE,
    now: () => 1_000,
  });

  return { store, calls, pending };
}

describe("createGenerationStore", () => {
  it("ouvre au repos", () => {
    expect(harness().store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("passe en cours et retient la demande, avec son heure de départ", () => {
    const { store, calls } = harness();

    store.start("routine 45");
    expect(calls).toEqual(["routine 45"]);
    expect(store.getSnapshot()).toEqual({
      status: "running",
      request: "routine 45",
      startedAt: 1_000,
    });
  });

  it("ignore une seconde demande pendant qu'une génération est en vol", () => {
    const { store, calls } = harness();

    store.start("première");
    store.start("seconde");
    // Un second appel au modèle serait un second décompte de quota, pour un
    // écran qui n'en montrerait qu'un.
    expect(calls).toEqual(["première"]);
  });

  it("garde le résultat quand il arrive, même si plus personne n'écoute", async () => {
    const { store, pending } = harness();

    store.start("routine 45");
    pending[0]?.resolve("la routine");
    await Promise.resolve();

    expect(store.getSnapshot()).toEqual({
      status: "done",
      request: "routine 45",
      result: "la routine",
    });
  });

  it("rend l'échec rédigé, et la demande avec — c'est elle qu'on rejoue", async () => {
    const { store, pending } = harness();

    store.start("routine 45");
    pending[0]?.reject(new Error("réseau"));
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot()).toEqual({
      status: "failed",
      request: "routine 45",
      failure: FAILURE,
    });
  });

  it("rejoue la MÊME demande sur « Réessayer », sans re-saisie", async () => {
    const { store, calls, pending } = harness();

    store.start("routine 45 · tracking");
    pending[0]?.reject(new Error("réseau"));
    await Promise.resolve();
    await Promise.resolve();

    store.retry();
    expect(calls).toEqual(["routine 45 · tracking", "routine 45 · tracking"]);
    expect(store.getSnapshot().status).toBe("running");
  });

  it("ne rejoue rien depuis un état qui n'a pas échoué", () => {
    const { store, calls } = harness();

    store.retry();
    store.start("routine 45");
    store.retry();
    expect(calls).toEqual(["routine 45"]);
  });

  it("ne livre le résultat qu'une fois : `settle` rend la place", async () => {
    const { store, pending } = harness();

    store.start("routine 45");
    pending[0]?.resolve("la routine");
    await Promise.resolve();

    store.settle();
    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("laisse `settle` sans effet sur une génération en cours", () => {
    const { store } = harness();

    store.start("routine 45");
    store.settle();
    // Sinon un rendu maladroit effacerait l'attente qu'il est en train d'afficher.
    expect(store.getSnapshot().status).toBe("running");
  });

  it("abandonne un résultat arrivé après `reset` plutôt que de le ressusciter", async () => {
    const { store, pending } = harness();

    store.start("routine 45");
    store.reset();
    pending[0]?.resolve("la routine");
    await Promise.resolve();

    expect(store.getSnapshot()).toEqual({ status: "idle" });
  });

  it("permet une nouvelle demande après un abandon, et ne garde que la sienne", async () => {
    const { store, calls, pending } = harness();

    store.start("première");
    store.reset();
    store.start("seconde");
    // La première finit en retard : elle ne doit pas écraser la seconde.
    pending[0]?.resolve("résultat de la première");
    await Promise.resolve();
    expect(store.getSnapshot().status).toBe("running");

    pending[1]?.resolve("résultat de la seconde");
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ status: "done", result: "résultat de la seconde" });
    expect(calls).toEqual(["première", "seconde"]);
  });

  it("prévient ses abonnés à chaque transition, et les oublie au désabonnement", async () => {
    const { store, pending } = harness();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.start("routine 45");
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    pending[0]?.resolve("la routine");
    await Promise.resolve();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("rend un instantané stable tant que rien ne bouge", () => {
    const { store } = harness();

    // `useSyncExternalStore` boucle à l'infini si l'instantané change d'identité
    // à chaque lecture : c'est la contrainte du hook, pas un détail de style.
    expect(store.getSnapshot()).toBe(store.getSnapshot());
    store.start("routine 45");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe("upsertById", () => {
  it("place la nouveauté en tête", () => {
    expect(upsertById([{ id: 1 }], { id: 2 })).toEqual([{ id: 2 }, { id: 1 }]);
  });

  it("remplace sur place ce que la liste connaît déjà, sans le dupliquer", () => {
    // Le cas réel : la génération se termine pendant qu'on est ailleurs, on
    // revient, la vue recharge la liste (qui contient déjà la routine), puis
    // relève le résultat du magasin.
    const list = [{ id: 2, done: false }, { id: 1 }];

    expect(upsertById(list, { id: 2, done: true })).toEqual([{ id: 2, done: true }, { id: 1 }]);
  });
});
