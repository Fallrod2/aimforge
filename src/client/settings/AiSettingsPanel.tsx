/**
 * Section « Réglages IA » du profil (SPEC §5 ter) : choisir son fournisseur,
 * son modèle, poser sa clé.
 *
 * Trois décisions d'écran, et elles portent toute la fonctionnalité :
 *
 * - **la clé n'est jamais réaffichée.** Le champ est vide au chargement, avec
 *   « Enregistrée » en indication quand il y en a une. Ce n'est pas une
 *   restriction d'affichage : la base refuse de la relire (privilèges de
 *   colonne, migration 0008). L'écran dit donc la vérité, au lieu de mimer une
 *   valeur masquée qui n'existe pas de ce côté ;
 * - **le quota levé se voit.** Sans badge, l'utilisateur qui a payé sa clé
 *   n'aurait aucun moyen de savoir que la limite des 5/jour ne le concerne
 *   plus — c'est précisément ce qu'il a acheté ;
 * - **l'expérimental s'annonce avant le clic.** ChatGPT (abonnement) dépend de
 *   la tolérance d'OpenAI ; l'avertissement s'affiche à la sélection du
 *   fournisseur, pas après le premier échec.
 *
 * « Tester » n'enregistre rien. C'est délibéré : on ne fait pas essayer une
 * configuration en la posant d'abord — l'utilisateur pourrait repartir avec une
 * clé cassée enregistrée et un quota levé pour rien.
 */

import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  type AiSettings,
  type AiSettingsInput,
  PROVIDERS,
  type ProviderId,
  providerSpec,
} from "../../shared/ai-settings-contract";
import { CONTROL_CLASSES, GHOST_BUTTON, PRIMARY_BUTTON } from "../components/controls";
import { Notice } from "../components/Notice";
import { ProviderCard } from "../components/ProviderCard";
import { deleteAiSettings, getAiSettings, saveAiSettings, testAiSettings } from "../data";

/** L'état du formulaire : des chaînes, comme tout formulaire. */
interface Form {
  readonly provider: ProviderId;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

type Load =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready" };

/** Ce que le panneau est en train de faire, et ce qu'il a à dire. */
type Action =
  | { readonly kind: "idle" }
  | { readonly kind: "testing" }
  | { readonly kind: "saving" }
  | { readonly kind: "deleting" }
  | { readonly kind: "verdict"; readonly ok: boolean; readonly message: string }
  | { readonly kind: "error"; readonly message: string };

function emptyForm(provider: ProviderId): Form {
  return { provider, model: providerSpec(provider).defaultModel, baseUrl: "", apiKey: "" };
}

function toForm(settings: AiSettings): Form {
  return {
    provider: settings.provider,
    model: settings.model,
    baseUrl: settings.baseUrl ?? "",
    // Jamais rendue par le serveur : le champ repart vide, et l'indication du
    // champ dit qu'une clé est en place.
    apiKey: "",
  };
}

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function AiSettingsPanel() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [form, setForm] = useState<Form>(emptyForm("anthropic"));
  const [action, setAction] = useState<Action>({ kind: "idle" });

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    setAction({ kind: "idle" });
    try {
      const current = await getAiSettings();

      setSettings(current);
      setForm(current === null ? emptyForm("anthropic") : toForm(current));
      setLoad({ status: "ready" });
    } catch (cause) {
      setLoad({
        status: "error",
        message: message(cause, "Les réglages IA n'ont pas pu être chargés."),
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const spec = providerSpec(form.provider);
  const busy = action.kind === "testing" || action.kind === "saving" || action.kind === "deleting";
  /** Une clé est-elle disponible pour cet envoi ? Saisie, ou déjà en base. */
  const keyReady = form.apiKey.trim() !== "";
  const sameProvider = settings !== null && settings.provider === form.provider;

  function change(patch: Partial<Form>): void {
    setAction({ kind: "idle" });
    setForm((current) => ({ ...current, ...patch }));
  }

  /** Changer de fournisseur remet le modèle par défaut : un identifiant de
   * modèle n'a de sens que chez son fournisseur, et le garder produirait un
   * échec incompréhensible au premier appel. */
  function changeProvider(provider: ProviderId): void {
    setAction({ kind: "idle" });
    setForm((current) => ({
      provider,
      model:
        settings !== null && settings.provider === provider
          ? settings.model
          : providerSpec(provider).defaultModel,
      baseUrl: settings !== null && settings.provider === provider ? (settings.baseUrl ?? "") : "",
      apiKey: current.apiKey,
    }));
  }

  function toInput(): AiSettingsInput {
    return {
      provider: form.provider,
      model: form.model.trim(),
      base_url: spec.needsBaseUrl ? form.baseUrl.trim() : null,
      api_key: form.apiKey.trim(),
    };
  }

  async function test(): Promise<void> {
    setAction({ kind: "testing" });
    try {
      const verdict = await testAiSettings(toInput());

      setAction({ kind: "verdict", ok: verdict.ok, message: verdict.message });
    } catch (cause) {
      setAction({ kind: "error", message: message(cause, "Le test n'a pas pu être lancé.") });
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setAction({ kind: "saving" });
    try {
      const saved = await saveAiSettings(toInput());

      setSettings(saved);
      setForm(saved === null ? emptyForm(form.provider) : toForm(saved));
      setAction({
        kind: "verdict",
        ok: true,
        message: "Configuration enregistrée. Le quota AimForge ne s'applique plus à ton compte.",
      });
    } catch (cause) {
      setAction({ kind: "error", message: message(cause, "L'enregistrement a échoué.") });
    }
  }

  async function remove(): Promise<void> {
    setAction({ kind: "deleting" });
    try {
      await deleteAiSettings();
      setSettings(null);
      setForm(emptyForm("anthropic"));
      setAction({
        kind: "verdict",
        ok: true,
        message: "Configuration supprimée : retour au fournisseur AimForge et à son quota.",
      });
    } catch (cause) {
      setAction({ kind: "error", message: message(cause, "La suppression a échoué.") });
    }
  }

  if (load.status !== "ready") {
    return (
      <section className="flex flex-col gap-4">
        <Header active={false} />
        {load.status === "loading" ? (
          <Notice tone="loading" title="Chargement des réglages IA…" />
        ) : (
          <Notice
            tone="error"
            title="Les réglages IA n'ont pas pu être chargés."
            onRetry={() => void reload()}
          >
            {load.message}
          </Notice>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-5">
      <Header active={settings !== null} />

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-steel-200">Fournisseur</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {PROVIDERS.map((option) => (
              <ProviderCard
                key={option.id}
                id={option.id}
                selected={option.id === form.provider}
                disabled={busy}
                onSelect={() => changeProvider(option.id)}
              />
            ))}
          </div>
        </div>

        {spec.experimental !== undefined ? (
          <p
            role="note"
            className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-200"
          >
            <strong className="font-semibold">Expérimental — à lire avant d'enregistrer.</strong>{" "}
            {spec.experimental}
          </p>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className={`flex flex-col gap-1.5 ${spec.needsBaseUrl ? "" : "sm:col-span-2"}`}>
            <label htmlFor="ai-model" className="text-xs font-medium text-steel-200">
              Modèle
            </label>
            <input
              id="ai-model"
              type="text"
              list="ai-model-suggestions"
              autoComplete="off"
              spellCheck={false}
              value={form.model}
              disabled={busy}
              placeholder={spec.defaultModel}
              aria-describedby="ai-model-hint"
              onChange={(event) => change({ model: event.target.value })}
              className={CONTROL_CLASSES}
            />
            <datalist id="ai-model-suggestions">
              {spec.models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
            <p id="ai-model-hint" className="text-[11px] text-steel-500">
              Écrit exactement comme {spec.label} l'attend. Les suggestions sont indicatives : la
              liste réelle vit chez le fournisseur.
            </p>
          </div>

          {spec.needsBaseUrl ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="ai-base-url" className="text-xs font-medium text-steel-200">
                URL de base
              </label>
              <input
                id="ai-base-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={form.baseUrl}
                disabled={busy}
                placeholder="https://api.openai.com/v1"
                aria-describedby="ai-base-url-hint"
                onChange={(event) => change({ baseUrl: event.target.value })}
                className={CONTROL_CLASSES}
              />
              <p id="ai-base-url-hint" className="text-[11px] text-steel-500">
                Jusqu'à <code>/v1</code> : le chemin <code>/chat/completions</code> est ajouté. Le
                serveur doit être joignable depuis Internet.
              </p>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="ai-key" className="text-xs font-medium text-steel-200">
              {spec.keyLabel}
            </label>
            <input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              disabled={busy}
              placeholder={
                sameProvider && settings?.hasKey === true ? "Enregistrée" : "Colle ta clé"
              }
              aria-describedby="ai-key-hint"
              onChange={(event) => change({ apiKey: event.target.value })}
              className={CONTROL_CLASSES}
            />
            <p id="ai-key-hint" className="text-[11px] text-steel-500">
              {spec.keyHint} Elle est stockée côté serveur et n'est jamais réaffichée : pour la
              changer, colle la nouvelle.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
          <button type="submit" disabled={busy || !keyReady} className={PRIMARY_BUTTON}>
            {action.kind === "saving" ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            disabled={busy || !keyReady}
            onClick={() => void test()}
            className={GHOST_BUTTON}
          >
            {action.kind === "testing" ? "Test en cours…" : "Tester la connexion"}
          </button>
          {settings !== null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove()}
              className={GHOST_BUTTON}
            >
              {action.kind === "deleting" ? "Suppression…" : "Supprimer ma configuration"}
            </button>
          ) : null}
        </div>

        {!keyReady ? (
          <p className="text-[11px] text-steel-500">
            {settings === null
              ? "Colle une clé pour activer les boutons."
              : "Colle à nouveau ta clé pour tester ou réenregistrer : elle n'est pas relisible depuis le navigateur."}
          </p>
        ) : null}

        <p aria-live="polite" className="text-xs">
          {action.kind === "error" ? (
            <span className="text-ember-400">{action.message}</span>
          ) : null}
          {action.kind === "verdict" ? (
            <span className={action.ok ? "text-emerald-400" : "text-ember-400"}>
              {action.message}
            </span>
          ) : null}
        </p>
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Sous-composants                                                     */
/* ------------------------------------------------------------------ */

function Header({ active }: { readonly active: boolean }) {
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold text-steel-100">Réglages IA</h2>
        {active ? (
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            Config personnalisée · quota levé
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-steel-500">
        {active
          ? "Le coach et la routine passent par ton fournisseur : tu paies tes jetons, et la limite de 5 par jour ne s'applique plus."
          : "Par défaut, le coach et la routine utilisent le fournisseur d'AimForge, limité à 5 debriefs et 5 routines par jour. Apporte ta clé pour lever cette limite."}
      </p>
    </div>
  );
}
