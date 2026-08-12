/**
 * Section « Réglages IA » du profil (SPEC §5 ter) : choisir son fournisseur,
 * son modèle, poser sa clé — ou lier son compte.
 *
 * Quatre décisions d'écran, et elles portent toute la fonctionnalité :
 *
 * - **la clé n'est jamais réaffichée.** Le champ est vide au chargement, avec
 *   « Enregistrée » en indication quand il y en a une. Ce n'est pas une
 *   restriction d'affichage : la base refuse de la relire (privilèges de
 *   colonne, migration 0008). L'écran dit donc la vérité, au lieu de mimer une
 *   valeur masquée qui n'existe pas de ce côté ;
 * - **ChatGPT (abonnement) ne demande pas de clé.** Ce fournisseur s'autorise
 *   par **liaison de compte** : un bouton, un code à recopier chez OpenAI, et
 *   des jetons qui restent côté serveur. Le champ de clé est donc remplacé par
 *   le flux, et non « désactivé » — proposer un champ qu'aucune valeur ne peut
 *   remplir serait une invitation à se tromper ;
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
  type AiLinkStart,
  type AiSettings,
  type AiSettingsInput,
  PROVIDERS,
  type ProviderId,
  providerSpec,
} from "../../shared/ai-settings-contract";
import { CONTROL_CLASSES, GHOST_BUTTON, PRIMARY_BUTTON } from "../components/controls";
import { Notice } from "../components/Notice";
import { ProviderCard } from "../components/ProviderCard";
import {
  deleteAiSettings,
  getAiSettings,
  pollChatGptLink,
  saveAiSettings,
  startChatGptLink,
  testAiSettings,
} from "../data";

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
  const sameProvider = settings !== null && settings.provider === form.provider;
  /** Le compte est-il déjà lié pour ce fournisseur ? (liaison seulement) */
  const linked = spec.auth === "account_link" && sameProvider && settings?.hasKey === true;
  /**
   * De quoi tester ou enregistrer : une clé saisie pour un fournisseur à clé,
   * une liaison en place pour un fournisseur à liaison. Sans cela, les deux
   * boutons enverraient une requête dont on connaît déjà le refus.
   */
  const ready = spec.auth === "key" ? form.apiKey.trim() !== "" : linked;

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

  /**
   * Sur un fournisseur à liaison, `api_key` est **absente** et non vide : c'est
   * la forme que le contrat exige, et elle dit la vérité — le navigateur n'a
   * aucun secret à envoyer, les jetons vivent côté serveur.
   */
  function toInput(): AiSettingsInput {
    return {
      provider: form.provider,
      model: form.model.trim(),
      base_url: spec.needsBaseUrl ? form.baseUrl.trim() : null,
      ...(spec.auth === "key" ? { api_key: form.apiKey.trim() } : {}),
    };
  }

  /** La liaison vient d'aboutir : on adopte la configuration réellement écrite. */
  const adopt = useCallback((linkedSettings: AiSettings | null): void => {
    if (linkedSettings === null) {
      setAction({
        kind: "error",
        message: "Compte lié, mais les réglages n'ont pas pu être relus.",
      });
      return;
    }
    setSettings(linkedSettings);
    setForm(toForm(linkedSettings));
    setAction({
      kind: "verdict",
      ok: true,
      message: "Compte ChatGPT lié. Le quota AimForge ne s'applique plus à ton compte.",
    });
  }, []);

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
            {spec.auth === "key" ? (
              <>
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
              </>
            ) : (
              <ChatGptLink
                hint={spec.linkHint}
                linked={linked}
                busy={busy}
                replaces={settings !== null && settings.provider !== form.provider}
                onLinked={adopt}
                onUnlink={() => void remove()}
              />
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
          <button type="submit" disabled={busy || !ready} className={PRIMARY_BUTTON}>
            {action.kind === "saving" ? "Enregistrement…" : "Enregistrer"}
          </button>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={() => void test()}
            className={GHOST_BUTTON}
          >
            {action.kind === "testing" ? "Test en cours…" : "Tester la connexion"}
          </button>
          {/* Sur un compte lié, « Délier » fait déjà exactement cela : deux
              boutons pour un même geste ne feraient qu'une hésitation de plus. */}
          {settings !== null && !linked ? (
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

        {!ready ? (
          <p className="text-[11px] text-steel-500">
            {spec.auth === "account_link"
              ? "Lie ton compte ChatGPT pour activer les boutons."
              : settings === null
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

/** Le rythme de l'attente : assez vif pour ne pas faire patienter, assez lent
 * pour ne pas marteler OpenAI pendant quinze minutes. */
const POLL_INTERVAL_MS = 4_000;

interface ChatGptLinkProps {
  readonly hint: string;
  readonly linked: boolean;
  readonly busy: boolean;
  /** Une autre configuration est en place : lier la remplacera. */
  readonly replaces: boolean;
  readonly onLinked: (settings: AiSettings | null) => void;
  readonly onUnlink: () => void;
}

/**
 * La liaison de compte ChatGPT, en trois états et pas un de plus :
 *
 * - **lié** : un badge et un bouton pour délier ;
 * - **en attente** : le code à recopier, la page à ouvrir, et une attente qui
 *   se termine toute seule — l'utilisateur autorise dans un autre onglet, il
 *   n'a rien à revenir cliquer ici ;
 * - **rien** : le bouton qui lance tout.
 *
 * L'attente interroge le serveur toutes les quatre secondes et s'arrête d'
 * elle-même à l'échéance de la demande. Un aller-retour manqué (réseau, veille
 * de l'onglet) n'interrompt rien : il est signalé et la prochaine tentative
 * repart — l'autorisation, elle, a très bien pu aboutir entre-temps.
 */
function ChatGptLink({ hint, linked, busy, replaces, onLinked, onUnlink }: ChatGptLinkProps) {
  const [session, setSession] = useState<AiLinkStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shaky, setShaky] = useState(false);

  useEffect(() => {
    if (session === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + session.expiresIn * 1000;

    async function tick(handle: string): Promise<void> {
      try {
        const result = await pollChatGptLink(handle);

        if (cancelled) return;
        setShaky(false);

        if (result.status === "linked") {
          setSession(null);
          onLinked(result.settings);
          return;
        }
        if (result.status === "denied") {
          setSession(null);
          setError("OpenAI a refusé l'autorisation. Relance la liaison et accepte la demande.");
          return;
        }
        if (result.status === "expired") {
          setSession(null);
          setError("La demande a expiré. Relance la liaison pour obtenir un nouveau code.");
          return;
        }
      } catch {
        // Un aller-retour manqué n'est pas un refus : on le dit et on repart.
        if (cancelled) return;
        setShaky(true);
      }

      if (Date.now() >= deadline) {
        setSession(null);
        setError("La demande a expiré. Relance la liaison pour obtenir un nouveau code.");
        return;
      }
      timer = setTimeout(() => void tick(handle), POLL_INTERVAL_MS);
    }

    timer = setTimeout(() => void tick(session.handle), POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [session, onLinked]);

  async function start(): Promise<void> {
    setError(null);
    setShaky(false);
    setStarting(true);
    try {
      setSession(await startChatGptLink());
    } catch (cause) {
      setError(message(cause, "La liaison n'a pas pu être lancée. Réessaie dans un instant."));
    } finally {
      setStarting(false);
    }
  }

  if (linked) {
    return (
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium text-steel-200">Compte ChatGPT</span>
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
            Compte lié
          </span>
          <button type="button" disabled={busy} onClick={onUnlink} className={GHOST_BUTTON}>
            Délier mon compte
          </button>
        </div>
        <p className="text-[11px] text-steel-500">
          Les jetons de la liaison restent côté serveur et se renouvellent tout seuls ; ils ne sont
          jamais réaffichés. Délier retire aussi cette configuration IA : le coach et la routine
          repassent au fournisseur d'AimForge et à son quota.
        </p>
      </div>
    );
  }

  if (session !== null) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-steel-700 bg-steel-900 p-4">
        <p className="text-xs text-steel-300">
          Ouvre la page d'OpenAI, connecte-toi à ton compte ChatGPT, puis saisis ce code :
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <code className="rounded-md border border-steel-700 bg-steel-800 px-3 py-2 font-mono text-lg tracking-[0.3em] text-steel-100">
            {session.userCode}
          </code>
          <a
            href={session.verificationUri}
            target="_blank"
            rel="noreferrer"
            className="text-xs font-medium text-ember-400 underline underline-offset-2 hover:text-ember-300"
          >
            Ouvrir la page d'autorisation
          </a>
        </div>
        <p aria-live="polite" className="text-[11px] text-steel-500">
          {shaky
            ? "Attente perturbée (réseau) — on continue d'essayer. Si tu viens d'autoriser, laisse cette page ouverte."
            : "En attente de ton autorisation… Cette page se met à jour toute seule."}
        </p>
        <button
          type="button"
          onClick={() => {
            setSession(null);
            setError(null);
          }}
          className={GHOST_BUTTON}
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-steel-200">Compte ChatGPT</span>
      <div>
        <button
          type="button"
          disabled={busy || starting}
          onClick={() => void start()}
          className={PRIMARY_BUTTON}
        >
          {starting ? "Ouverture…" : "Lier mon compte ChatGPT"}
        </button>
      </div>
      <p className="text-[11px] text-steel-500">
        {hint}
        {replaces
          ? " Lier remplacera ta configuration IA actuelle : la clé du fournisseur précédent n'est pas relisible, il faudrait la recoller pour y revenir."
          : ""}
      </p>
      {error !== null ? <p className="text-[11px] text-ember-400">{error}</p> : null}
    </div>
  );
}

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
      {/*
        Aucun chiffre ici, et c'est délibéré : les limites se règlent en base
        (`platform_settings`), donc une phrase qui en annonce un promet ce que
        le serveur n'applique pas forcément. Les compteurs exacts — utilisé,
        limite, heure de réinitialisation — sont affichés là où ils se
        dépensent, à côté de chaque bouton de génération (`QuotaNote`).
      */}
      <p className="mt-1 text-xs text-steel-500">
        {active
          ? "Le coach, la routine et le fil passent par ton fournisseur : tu paies tes jetons, et les quotas journaliers d'AimForge ne s'appliquent plus."
          : "Par défaut, le coach, la routine et le fil utilisent le fournisseur d'AimForge, chacun avec son quota journalier — affiché à côté du bouton qui le dépense. Apporte ta clé pour lever ces limites."}
      </p>
    </div>
  );
}
