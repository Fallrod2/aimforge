/**
 * Page « Administration » (SPEC §5 quater) : la configuration de la plateforme,
 * en quatre blocs.
 *
 * Ce que cet écran **n'est pas** : une protection. Il n'est atteignable que par
 * un lien affiché aux administrateurs, mais son adresse est publique comme
 * toutes les autres, et c'est très bien ainsi — la vérification qui compte est
 * faite dans chaque endpoint, côté serveur, qui répond 404 à tout le reste.
 * Un non-administrateur qui ouvre `#/administration` ne voit donc pas un refus
 * de l'interface : il voit la même page « rien à voir ici » que le serveur lui
 * sert, et c'est exactement le message qu'on veut donner.
 *
 * La page charge deux choses en parallèle, et les traite différemment : les
 * **réglages** sont indispensables (sans eux, il n'y a rien à afficher), les
 * **agrégats** ne le sont pas — un tableau d'usage en panne ne doit pas empêcher
 * de corriger un quota, qui est précisément le geste qu'on vient faire quand
 * quelque chose ne va pas.
 */

import { useCallback, useEffect, useState } from "react";
import type { AdminSettings, AdminUsage } from "../../shared/admin-contract";
import { Notice } from "../components/Notice";
import { getAdminSettings, getAdminUsage } from "../data";
import { HenrikKeyPanel } from "./HenrikKeyPanel";
import { PlatformAiPanel } from "./PlatformAiPanel";
import { QuotasPanel } from "./QuotasPanel";
import { UsagePanel } from "./UsagePanel";

type Load =
  | { readonly status: "loading" }
  | { readonly status: "denied" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready" };

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/** Le 404 du serveur veut dire « rien à voir ici », pas « fonction absente ». */
function isDenied(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "status" in cause && cause.status === 404;
}

export function AdminView() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [usage, setUsage] = useState<AdminUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const loadUsage = useCallback(async () => {
    setUsageError(null);
    try {
      setUsage(await getAdminUsage());
    } catch (cause) {
      setUsage(null);
      setUsageError(message(cause, "Les agrégats d'usage n'ont pas pu être lus."));
    }
  }, []);

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      setSettings(await getAdminSettings());
      setLoad({ status: "ready" });
    } catch (cause) {
      setLoad(
        isDenied(cause)
          ? { status: "denied" }
          : { status: "error", message: message(cause, "L'administration n'a pas pu être lue.") },
      );
      return;
    }
    await loadUsage();
  }, [loadUsage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (load.status === "denied") {
    // Le même écran que pour une adresse qui n'existe pas : cette page ne
    // confirme à personne qu'il y a une administration derrière.
    return (
      <Notice tone="empty" title="Rien à voir ici.">
        Cette adresse ne correspond à aucune page de ton compte.
      </Notice>
    );
  }

  if (load.status !== "ready" || settings === null) {
    return load.status === "error" ? (
      <Notice
        tone="error"
        title="L'administration n'a pas pu être chargée."
        onRetry={() => void reload()}
      >
        {load.message}
      </Notice>
    ) : (
      <Notice tone="loading" title="Chargement de l'administration…" />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-xl font-semibold text-steel-100 sm:text-2xl">Administration</h1>
        <p className="mt-1 text-sm text-steel-400">
          Ce qui se réglait par variables d'environnement se règle ici, en direct. Les deux clés
          sont stockées côté serveur et ne sont jamais réaffichées — pas même sur cet écran.
        </p>
      </header>

      <PlatformAiPanel settings={settings} onSaved={setSettings} />
      <HenrikKeyPanel settings={settings} onSaved={setSettings} />
      <QuotasPanel settings={settings} onSaved={setSettings} />

      {usage === null ? (
        <Notice
          tone="error"
          title="Les agrégats d'usage n'ont pas pu être lus."
          onRetry={() => void loadUsage()}
        >
          {usageError ?? "Les réglages ci-dessus restent modifiables."}
        </Notice>
      ) : (
        <UsagePanel
          settings={settings}
          usage={usage}
          onSaved={setSettings}
          onReload={() => void loadUsage()}
        />
      )}
    </div>
  );
}
