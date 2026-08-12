/**
 * Page de connexion / inscription / mot de passe oublié.
 *
 * Un seul formulaire pour les trois : les champs sont les mêmes, seuls le
 * bouton et le traitement changent. Trois écrans séparés auraient trois fois
 * la même gestion d'erreur.
 */

import { type FormEvent, useState } from "react";
import { Notice } from "../components/Notice";
import { Segmented } from "../components/Segmented";
import { legalHash } from "../legal/documents";
import { DEFAULT_ROUTE, routeHash } from "../route";
import { supabase } from "../supabase/client";
import { authErrorMessage } from "./auth-errors";
import {
  type AuthMode,
  CONSENT_REQUIRED,
  needsConsent,
  needsPassword,
  validateCredentials,
} from "./credentials";
import { OAUTH_PROVIDERS, type OAuthProvider, startOAuth } from "./oauth";

type Feedback =
  | { readonly tone: "error"; readonly text: string }
  | { readonly tone: "info"; readonly title: string; readonly text: string };

const MODE_OPTIONS = [
  { value: "signin" as const, label: "Connexion" },
  { value: "signup" as const, label: "Inscription" },
];

const SUBMIT_LABEL: Readonly<Record<AuthMode, string>> = {
  signin: "Se connecter",
  signup: "Créer mon compte",
  reset: "Envoyer le lien",
};

/**
 * Sans session, tout ce qui n'est pas `#/connexion` affiche la landing : les
 * deux liens de sortie de cet écran pointent donc simplement vers la route par
 * défaut de l'application.
 */
const LANDING_HASH = routeHash(DEFAULT_ROUTE);

export function AuthView() {
  const [mode, setMode] = useState<AuthMode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  /**
   * Le consentement aux documents légaux, à l'inscription.
   *
   * Il n'est **pas enregistré** en base, et c'est un choix : la preuve du
   * consentement est la date de création du compte, puisqu'on ne peut pas
   * créer de compte sans cocher la case et que les documents portent leur
   * propre date de version. Une colonne `consented_at` recopierait
   * `created_at` en prétendant dire autre chose. Le jour où les documents
   * changeront de façon substantielle, c'est une acceptation *dans
   * l'application* qu'il faudra tracer — et elle, elle aura sa table.
   */
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<"form" | OAuthProvider["id"] | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const consentMissing = needsConsent(mode) && !consent;

  function changeMode(next: AuthMode): void {
    setMode(next);
    setFeedback(null);
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    // Le bouton est déjà désactivé dans ce cas : la garde est ici pour que
    // l'inscription ne parte pas si un chemin détourné (soumission implicite,
    // extension, `form.requestSubmit()`) contournait le bouton.
    if (consentMissing) {
      setFeedback({ tone: "error", text: CONSENT_REQUIRED });
      return;
    }

    const problem = validateCredentials(mode, email, password);

    if (problem !== null) {
      setFeedback({ tone: "error", text: problem });
      return;
    }

    setBusy("form");
    setFeedback(null);
    try {
      setFeedback(await run(mode, email.trim(), password));
    } catch (cause) {
      setFeedback({ tone: "error", text: authErrorMessage(cause) });
    } finally {
      setBusy(null);
    }
  }

  async function externalSignIn(provider: OAuthProvider): Promise<void> {
    setBusy(provider.id);
    setFeedback(null);
    try {
      const refusal = await startOAuth(provider);

      if (refusal !== null) setFeedback({ tone: "error", text: refusal });
    } catch (cause) {
      setFeedback({ tone: "error", text: authErrorMessage(cause, provider.label) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <a
          href={LANDING_HASH}
          className="font-mono text-xl font-semibold tracking-tight text-ember-500"
        >
          AimForge
        </a>
        <p className="mt-1 text-xs tracking-[0.18em] text-steel-500 uppercase">
          {mode === "reset" ? "Mot de passe oublié" : "Bench · Coach · Routine"}
        </p>
      </div>

      <div className="flex flex-col gap-5 rounded-2xl border border-steel-800 bg-steel-900/60 p-5 sm:p-6">
        {mode === "reset" ? null : (
          <Segmented
            label="Connexion ou inscription"
            options={MODE_OPTIONS}
            value={mode === "signup" ? "signup" : "signin"}
            onChange={changeMode}
          />
        )}

        <div className="flex flex-col gap-2">
          {OAUTH_PROVIDERS.map((provider) => (
            <button
              key={provider.id}
              type="button"
              disabled={busy !== null}
              onClick={() => void externalSignIn(provider)}
              className="rounded-lg border border-steel-700 bg-steel-800/60 px-4 py-3 text-sm font-medium text-steel-100 transition-colors hover:border-steel-600 hover:bg-steel-800 disabled:opacity-50"
            >
              {busy === provider.id ? "Ouverture…" : `Continuer avec ${provider.label}`}
            </button>
          ))}
          {/* Pour l'OAuth, pas de case à cocher : le geste d'inscription est le
              clic lui-même, et il n'y a pas de bouton distinct à désactiver.
              La mention précède donc l'action, comme le veut l'usage. */}
          <p className="text-[11px] leading-relaxed text-steel-500">
            En continuant, tu acceptes la <PrivacyLink /> et les <TermsLink />.
          </p>
        </div>

        <div className="flex items-center gap-3 text-[11px] tracking-[0.18em] text-steel-600 uppercase">
          <span className="h-px flex-1 bg-steel-800" />
          ou
          <span className="h-px flex-1 bg-steel-800" />
        </div>

        {/* `noValidate` : la validation native afficherait une bulle du
            navigateur, en anglais et hors de la page, à la place de nos
            messages. `validateCredentials` couvre les mêmes cas, en français. */}
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <Field
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={setEmail}
          />

          {needsPassword(mode) ? (
            <Field
              id="password"
              label="Mot de passe"
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={setPassword}
            />
          ) : null}

          {needsConsent(mode) ? (
            <label htmlFor="consent" className="flex items-start gap-3 text-xs text-steel-400">
              <input
                id="consent"
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5 size-4 shrink-0 accent-ember-600"
              />
              <span className="leading-relaxed">
                J'ai lu et j'accepte la <PrivacyLink /> et les <TermsLink />.
              </span>
            </label>
          ) : null}

          <button
            type="submit"
            disabled={busy !== null || consentMissing}
            className="rounded-lg bg-ember-600 px-4 py-3 text-sm font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:opacity-50"
          >
            {busy === "form" ? "Un instant…" : SUBMIT_LABEL[mode]}
          </button>
        </form>

        {feedback === null ? null : feedback.tone === "error" ? (
          <Notice tone="error" title={feedback.text} />
        ) : (
          <Notice tone="empty" title={feedback.title}>
            {feedback.text}
          </Notice>
        )}

        <button
          type="button"
          onClick={() => changeMode(mode === "reset" ? "signin" : "reset")}
          className="self-start text-xs text-steel-400 underline underline-offset-4 transition-colors hover:text-steel-200"
        >
          {mode === "reset" ? "Revenir à la connexion" : "Mot de passe oublié ?"}
        </button>
      </div>

      <a
        href={LANDING_HASH}
        className="text-center text-xs text-steel-500 transition-colors hover:text-steel-300"
      >
        ← Retour à la présentation
      </a>
    </div>
  );
}

/** L'appel Supabase du mode courant, et le retour à afficher. */
async function run(mode: AuthMode, email: string, password: string): Promise<Feedback> {
  const origin = window.location.origin;

  if (mode === "signin") {
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error !== null) return { tone: "error", text: authErrorMessage(error) };
    // Succès : `onAuthStateChange` bascule l'app, cet écran disparaît.
    return { tone: "info", title: "Connexion en cours…", text: "" };
  }

  if (mode === "signup") {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: origin },
    });

    if (error !== null) return { tone: "error", text: authErrorMessage(error) };
    if (data.session !== null) return { tone: "info", title: "Compte créé.", text: "" };
    return {
      tone: "info",
      title: "Vérifie ta boîte mail.",
      text: `Un lien de confirmation vient de partir vers ${email}. Ouvre-le pour activer le compte, puis reviens te connecter.`,
    };
  }

  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: origin });

  if (error !== null) return { tone: "error", text: authErrorMessage(error) };
  return {
    tone: "info",
    title: "Lien envoyé.",
    // Formulation volontairement neutre : confirmer l'existence du compte
    // transformerait ce formulaire en détecteur d'adresses inscrites.
    text: `Si un compte existe pour ${email}, un lien de réinitialisation vient d'y être envoyé.`,
  };
}

/**
 * Les deux liens légaux du formulaire : même allure, deux composants, pour que
 * l'adresse vienne du routeur (`legalHash`) et non d'un `#/cgu` recopié.
 *
 * **Nouvel onglet**, à la différence des liens du pied de page : ouvrir un
 * document dans l'onglet courant démonterait ce formulaire, et l'email, le mot
 * de passe et la case cochée partiraient avec lui. Aller lire ce qu'on accepte
 * ne doit pas coûter la saisie en cours.
 */
const LEGAL_LINK_CLASS =
  "text-steel-300 underline underline-offset-2 transition-colors hover:text-ember-400";

function PrivacyLink() {
  return (
    <a href={legalHash("privacy")} target="_blank" rel="noreferrer" className={LEGAL_LINK_CLASS}>
      politique de confidentialité
    </a>
  );
}

function TermsLink() {
  return (
    <a href={legalHash("terms")} target="_blank" rel="noreferrer" className={LEGAL_LINK_CLASS}>
      CGU
    </a>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly type: "email" | "password";
  readonly autoComplete: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
}

function Field({ id, label, type, autoComplete, value, onChange }: FieldProps) {
  return (
    <label htmlFor={id} className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        {label}
      </span>
      <input
        id={id}
        type={type}
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-steel-700 bg-steel-950 px-3 py-3 text-sm text-steel-100 transition-colors hover:border-steel-600 focus:border-ember-500"
      />
    </label>
  );
}
