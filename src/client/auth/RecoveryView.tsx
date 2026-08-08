/**
 * Choix d'un nouveau mot de passe, après ouverture d'un lien « oublié ».
 *
 * Supabase pose une session valide dès l'ouverture du lien : c'est cet écran,
 * et lui seul, qui doit s'afficher tant que le mot de passe n'a pas été
 * remplacé — sinon le lien tiendrait lieu de connexion permanente.
 */

import { type FormEvent, useState } from "react";
import { Notice } from "../components/Notice";
import { supabase } from "../supabase/client";
import { useAuth } from "./AuthProvider";
import { authErrorMessage } from "./auth-errors";
import { MIN_PASSWORD_LENGTH } from "./credentials";

export function RecoveryView() {
  const { user, endRecovery, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const { error: failure } = await supabase.auth.updateUser({ password });

      if (failure !== null) setError(authErrorMessage(failure));
      else endRecovery();
    } catch (cause) {
      setError(authErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-6 px-4 py-10">
      <div className="text-center">
        <span className="font-mono text-xl font-semibold tracking-tight text-ember-500">
          AimForge
        </span>
        <p className="mt-1 text-xs tracking-[0.18em] text-steel-500 uppercase">
          Nouveau mot de passe
        </p>
      </div>

      <form
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4 rounded-2xl border border-steel-800 bg-steel-900/60 p-5 sm:p-6"
      >
        <p className="text-sm text-steel-300">
          Choisis un nouveau mot de passe pour{" "}
          <span className="font-mono text-steel-100">{user?.email ?? "ton compte"}</span>.
        </p>

        <label htmlFor="new-password" className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
            Mot de passe
          </span>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="rounded-lg border border-steel-700 bg-steel-950 px-3 py-3 text-sm text-steel-100 transition-colors hover:border-steel-600 focus:border-ember-500"
          />
        </label>

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-ember-600 px-4 py-3 text-sm font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:opacity-50"
        >
          {busy ? "Enregistrement…" : "Enregistrer"}
        </button>

        {error === null ? null : <Notice tone="error" title={error} />}

        <button
          type="button"
          onClick={() => void signOut()}
          className="self-start text-xs text-steel-400 underline underline-offset-4 transition-colors hover:text-steel-200"
        >
          Annuler et se déconnecter
        </button>
      </form>
    </div>
  );
}
