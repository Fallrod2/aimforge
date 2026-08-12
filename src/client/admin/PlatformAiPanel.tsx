/**
 * Bloc « Fournisseur IA de la plateforme » (SPEC §5 quater).
 *
 * C'est le jumeau de `AiSettingsPanel` — mêmes cartes de fournisseur, même
 * champ de modèle libre, même clé write-only — avec une différence qui change
 * tout : **cette configuration sert tout le monde**. Celui qui n'a pas apporté
 * sa clé passe par celle-ci, et son quota la mesure. D'où deux règles propres à
 * cet écran :
 *
 * - **changer de fournisseur exige sa clé.** Celle qui est enregistrée
 *   appartient au fournisseur précédent, et personne ne peut la relire pour
 *   s'en apercevoir. Le serveur refuse aussi (400), mais l'écran doit le dire
 *   avant le clic plutôt qu'après ;
 * - **l'état de repli se voit.** Tant que rien n'est posé ici, la plateforme
 *   tourne sur `ANTHROPIC_API_KEY`. Ce n'est pas une panne, mais ce n'est pas
 *   non plus la même chose que « configuré » — et si la variable n'est pas
 *   posée non plus, le coach et la routine ne répondent à personne. L'écran
 *   nomme les trois états.
 */

import { type FormEvent, useState } from "react";
import { KEY_PROVIDERS, type ProviderId, providerSpec } from "../../shared/ai-settings-contract";
import { CONTROL_CLASSES, PRIMARY_BUTTON } from "../components/controls";
import { ProviderCard } from "../components/ProviderCard";
import { Badge, Feedback, type PanelProps, Section, useSave } from "./panel";

interface Form {
  readonly provider: ProviderId;
  readonly model: string;
  readonly baseUrl: string;
  readonly apiKey: string;
}

function initial(settings: PanelProps["settings"]): Form {
  const ai = settings.ai;

  return {
    provider: ai?.provider ?? "anthropic",
    model: ai?.model ?? providerSpec(ai?.provider ?? "anthropic").defaultModel,
    baseUrl: ai?.baseUrl ?? "",
    // Jamais rendue par le serveur : le champ repart vide, et son indication dit
    // qu'une clé est en place.
    apiKey: "",
  };
}

export function PlatformAiPanel({ settings, onSaved }: PanelProps) {
  const [form, setForm] = useState<Form>(() => initial(settings));
  const { action, save, reset } = useSave(onSaved);

  const spec = providerSpec(form.provider);
  const busy = action.kind === "saving";
  const sameProvider = settings.ai?.provider === form.provider;
  /** La clé enregistrée sert-elle encore ? Seulement pour le même fournisseur. */
  const keptKey = sameProvider && settings.hasAiKey;
  const keyReady = form.apiKey.trim() !== "" || keptKey;

  function change(patch: Partial<Form>): void {
    reset();
    setForm((current) => ({ ...current, ...patch }));
  }

  function changeProvider(provider: ProviderId): void {
    reset();
    setForm((current) => ({
      provider,
      model:
        settings.ai?.provider === provider
          ? settings.ai.model
          : providerSpec(provider).defaultModel,
      baseUrl: settings.ai?.provider === provider ? (settings.ai.baseUrl ?? "") : "",
      apiKey: current.apiKey,
    }));
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const key = form.apiKey.trim();

    await save(
      {
        ai: {
          provider: form.provider,
          model: form.model.trim(),
          base_url: spec.needsBaseUrl ? form.baseUrl.trim() : null,
          // Omise volontairement quand le champ est vide et que la clé du même
          // fournisseur est déjà là : le serveur la garde (contrat partagé).
          ...(key === "" ? {} : { api_key: key }),
        },
      },
      "Fournisseur de la plateforme enregistré. Les utilisateurs sans clé personnelle passent désormais par lui.",
    );
  }

  async function clear(): Promise<void> {
    await save(
      { ai: null },
      "Configuration effacée : la plateforme retombe sur ANTHROPIC_API_KEY.",
    );
    setForm(initial({ ...settings, ai: null, hasAiKey: false }));
  }

  return (
    <Section
      title="Fournisseur IA de la plateforme"
      hint="Sert le coach et la routine de tous les utilisateurs qui n'ont pas posé leur propre clé. Ceux qui en ont une ne sont pas concernés."
      badge={<KeyBadge settings={settings} />}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium text-steel-200">Fournisseur</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {/* Seuls les fournisseurs à clé : une liaison de compte (ChatGPT
                abonnement) appartient à une personne, et la plateforme n'en a
                pas à lier au nom de tout le monde. */}
            {KEY_PROVIDERS.map((option) => (
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
            {spec.experimental} Posé ici, ce risque devient celui de{" "}
            <strong className="font-semibold">tous</strong> les utilisateurs sans clé personnelle.
          </p>
        ) : null}

        <div className="grid gap-5 sm:grid-cols-2">
          <div className={`flex flex-col gap-1.5 ${spec.needsBaseUrl ? "" : "sm:col-span-2"}`}>
            <label htmlFor="admin-ai-model" className="text-xs font-medium text-steel-200">
              Modèle
            </label>
            <input
              id="admin-ai-model"
              type="text"
              list="admin-ai-models"
              autoComplete="off"
              spellCheck={false}
              value={form.model}
              disabled={busy}
              placeholder={spec.defaultModel}
              onChange={(event) => change({ model: event.target.value })}
              className={CONTROL_CLASSES}
            />
            <datalist id="admin-ai-models">
              {spec.models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </div>

          {spec.needsBaseUrl ? (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="admin-ai-base-url" className="text-xs font-medium text-steel-200">
                URL de base
              </label>
              <input
                id="admin-ai-base-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                value={form.baseUrl}
                disabled={busy}
                placeholder="https://api.openai.com/v1"
                onChange={(event) => change({ baseUrl: event.target.value })}
                className={CONTROL_CLASSES}
              />
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <label htmlFor="admin-ai-key" className="text-xs font-medium text-steel-200">
              {spec.auth === "key" ? spec.keyLabel : "Clé d'API"}
            </label>
            <input
              id="admin-ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={form.apiKey}
              disabled={busy}
              placeholder={keptKey ? "Enregistrée" : "Colle la clé de la plateforme"}
              aria-describedby="admin-ai-key-hint"
              onChange={(event) => change({ apiKey: event.target.value })}
              className={CONTROL_CLASSES}
            />
            <p id="admin-ai-key-hint" className="text-[11px] text-steel-500">
              {spec.auth === "key" ? spec.keyHint : ""} Stockée côté serveur et jamais réaffichée,
              même ici : pour la changer, colle la nouvelle.
              {!keptKey && settings.hasAiKey
                ? " Changer de fournisseur demande sa clé — celle qui est enregistrée appartient au précédent."
                : null}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
          <button type="submit" disabled={busy || !keyReady} className={PRIMARY_BUTTON}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          {settings.ai !== null ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className="inline-flex min-h-10 items-center rounded-lg border border-steel-700 px-3 py-2 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-500"
            >
              Effacer et revenir à l'environnement
            </button>
          ) : null}
        </div>

        <Feedback action={action} />
      </form>
    </Section>
  );
}

/** Les trois états possibles, nommés — configuré, repli, rien nulle part. */
function KeyBadge({ settings }: { readonly settings: PanelProps["settings"] }) {
  if (settings.aiKeySource === "database") return <Badge tone="ok">Configuré en base</Badge>;
  if (settings.aiKeySource === "environment") {
    return <Badge tone="muted">Repli sur ANTHROPIC_API_KEY</Badge>;
  }
  return <Badge tone="warn">Aucune clé : coach et routine hors service</Badge>;
}
