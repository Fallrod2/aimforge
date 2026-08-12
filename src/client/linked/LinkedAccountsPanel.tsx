/**
 * Section « Comptes liés » du profil : le seul endroit où l'on ajoute et
 * retire des comptes (SPEC §5 bis).
 *
 * Le principe produit est que la donnée rentre toute seule ; cet écran est donc
 * le point d'entrée de tout le reste, et il doit être lisible sans mode
 * d'emploi. Trois choix en découlent :
 *
 * - **la liaison est vérifiée avant d'être enregistrée**, jamais après. Un
 *   pseudo mal tapé se dit tout de suite, pas au premier import raté ;
 * - **« non configuré » n'est pas une erreur**. Tant que la clé de la source
 *   Valorant n'est pas posée, la section Riot l'explique posément et le reste
 *   de l'application continue de fonctionner — l'utilisateur n'a rien à
 *   corriger, et une bannière rouge lui ferait croire le contraire ;
 * - **le compte principal se voit et se change d'un clic** : c'est lui que le
 *   dashboard affiche, et rien d'autre ne le dit à l'utilisateur.
 */

import { type FormEvent, useState } from "react";
import { Notice } from "../components/Notice";
import {
  accountsOf,
  displayName,
  type LinkedAccount,
  LinkedAccountError,
  linkKovaaksAccount,
  linkRiotAccount,
  parseRiotId,
  setPrimaryAccount,
  unlinkAccount,
} from "../data";
import { routeHash } from "../route";
import type { LinkedAccountsHandle } from "./useLinkedAccounts";

const CONTROL_CLASSES =
  "w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-400 hover:border-steel-600 focus:border-ember-500 disabled:opacity-60";

const PRIMARY_BUTTON =
  "rounded-lg bg-ember-500 px-4 py-2.5 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500";

/**
 * « Délier » et « Définir principal » sont des actions rares mais destructrices
 * ou structurantes : elles doivent rester attrapables au pouce. `min-h-8`
 * (32 px) est le plancher — en dessous, la cible passait à ~25 px de haut, et
 * un doigt qui vise « Délier » sur un téléphone n'a pas droit à l'erreur.
 * `inline-flex` recentre le libellé dans la hauteur ainsi imposée.
 */
const GHOST_BUTTON =
  "inline-flex min-h-8 items-center rounded-lg border border-steel-700 px-3 py-2 text-[11px] font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-500";

function message(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

/**
 * Le repli, en dur, quand la liaison KovaaK's n'aboutit pas.
 *
 * Les messages du serveur disent déjà « saisis tes scores à la main » quand ils
 * viennent de la source (`api/_lib/kovaaks.ts`), mais pas quand ils viennent de
 * chez nous — compteur d'imports indisponible, frein quotidien, service non
 * configuré. Or c'est exactement là que l'utilisateur risque de croire qu'il n'y
 * a plus de chemin : le lien ci-dessous en montre un, quelle que soit la cause.
 */
const TRACKER_HASH = routeHash({ view: "perfs", tab: "saisie" });

/** Ce qu'un formulaire de liaison est en train de vivre. */
type LinkStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "checking" }
  | { readonly kind: "error"; readonly message: string }
  /**
   * Ni faute, ni panne : la fonctionnalité n'est pas configurée côté serveur,
   * ou le frein quotidien est atteint. Dans les deux cas il n'y a rien à
   * corriger, et réessayer tout de suite échouerait pareil.
   */
  | { readonly kind: "unavailable"; readonly message: string };

function statusOf(cause: unknown, fallback: string): LinkStatus {
  if (cause instanceof LinkedAccountError && (cause.notConfigured || cause.rateLimited)) {
    return { kind: "unavailable", message: cause.message };
  }
  return { kind: "error", message: message(cause, fallback) };
}

export function LinkedAccountsPanel({ state, reload }: LinkedAccountsHandle) {
  if (state.status === "loading") {
    return <Notice tone="loading" title="Chargement des comptes liés…" />;
  }
  if (state.status === "error") {
    return (
      <Notice tone="error" title="Comptes liés indisponibles." onRetry={reload}>
        {state.message}
      </Notice>
    );
  }

  return (
    <section className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold text-steel-100">Comptes liés</h2>
        <p className="mt-1 text-xs leading-relaxed text-steel-500">
          Lie tes comptes une fois : la saisie se pré-remplit depuis tes scores KovaaK's, et le
          tableau de bord suit ton rang Valorant. Les deux données viennent de services tiers —
          quand l'un ne répond pas, l'écran le dit et la saisie manuelle prend le relais.
        </p>
      </div>

      <KovaaksSection accounts={state.accounts} onChanged={reload} />
      <RiotSection accounts={state.accounts} onChanged={reload} />
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* KovaaK's                                                            */
/* ------------------------------------------------------------------ */

interface SectionProps {
  readonly accounts: readonly LinkedAccount[];
  readonly onChanged: () => void;
}

function KovaaksSection({ accounts, onChanged }: SectionProps) {
  const linked = accountsOf(accounts, "kovaaks");
  const [username, setUsername] = useState("");
  const [status, setStatus] = useState<LinkStatus>({ kind: "idle" });

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setStatus({ kind: "checking" });
    try {
      await linkKovaaksAccount(username);
      setUsername("");
      setStatus({ kind: "idle" });
      onChanged();
    } catch (cause) {
      setStatus(statusOf(cause, "La liaison a échoué."));
    }
  }

  const busy = status.kind === "checking";

  return (
    <Block
      title="KovaaK's"
      hint="Ton pseudo sur kovaaks.com (celui du site, pas le nom du compte Steam). Il sert à retrouver tes scores de benchmark Voltaic."
    >
      {linked.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          showPrimary={false}
          onChanged={onChanged}
          detail="Le tracker peut importer tes scores."
        />
      ))}

      {linked.length > 0 ? null : (
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="text"
              autoComplete="off"
              aria-label="Pseudo KovaaK's"
              placeholder="Victard"
              value={username}
              disabled={busy}
              onChange={(event) => setUsername(event.target.value)}
              className={CONTROL_CLASSES}
            />
            <button
              type="submit"
              disabled={busy || username.trim() === ""}
              className={`${PRIMARY_BUTTON} shrink-0`}
            >
              {busy ? "Vérification…" : "Lier"}
            </button>
          </div>
          <StatusLine status={status} />
          {status.kind === "error" || status.kind === "unavailable" ? (
            <p className="text-[11px] leading-relaxed text-steel-500">
              Sans compte lié, rien n'est perdu :{" "}
              <a
                href={TRACKER_HASH}
                className="text-steel-300 underline-offset-2 transition-colors hover:text-steel-100 hover:underline"
              >
                saisis tes scores à la main
              </a>{" "}
              et le bench se calcule pareil.
            </p>
          ) : null}
        </form>
      )}
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/* Riot                                                                */
/* ------------------------------------------------------------------ */

function RiotSection({ accounts, onChanged }: SectionProps) {
  const linked = accountsOf(accounts, "riot");
  const [riotId, setRiotId] = useState("");
  const [status, setStatus] = useState<LinkStatus>({ kind: "idle" });

  const parsed = parseRiotId(riotId);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (parsed === null) {
      setStatus({ kind: "error", message: "Riot ID attendu sous la forme « Nom#TAG »." });
      return;
    }
    setStatus({ kind: "checking" });
    try {
      await linkRiotAccount(parsed);
      setRiotId("");
      setStatus({ kind: "idle" });
      onChanged();
    } catch (cause) {
      setStatus(statusOf(cause, "La liaison a échoué."));
    }
  }

  const busy = status.kind === "checking";

  return (
    <Block
      title="Valorant (Riot)"
      hint="Ton Riot ID complet, tag compris. Tu peux en lier plusieurs (compte principal et alts) ; le tableau de bord suit celui marqué « principal »."
    >
      {linked.map((account) => (
        <AccountRow
          key={account.id}
          account={account}
          showPrimary={linked.length > 1}
          onChanged={onChanged}
          detail={account.riotRegion === null ? null : `Région ${account.riotRegion.toUpperCase()}`}
        />
      ))}

      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-2">
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="text"
            autoComplete="off"
            aria-label="Riot ID"
            placeholder="Nom#TAG"
            value={riotId}
            disabled={busy}
            onChange={(event) => setRiotId(event.target.value)}
            className={CONTROL_CLASSES}
          />
          <button
            type="submit"
            disabled={busy || riotId.trim() === ""}
            className={`${PRIMARY_BUTTON} shrink-0`}
          >
            {busy ? "Vérification…" : linked.length === 0 ? "Lier" : "Ajouter"}
          </button>
        </div>
        <StatusLine status={status} />
      </form>
    </Block>
  );
}

/* ------------------------------------------------------------------ */
/* Briques communes                                                    */
/* ------------------------------------------------------------------ */

function Block({
  title,
  hint,
  children,
}: {
  readonly title: string;
  readonly hint: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-steel-800 bg-steel-900/60 p-4">
      <div>
        <h3 className="text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
          {title}
        </h3>
        <p className="mt-1.5 text-[11px] leading-relaxed text-steel-500">{hint}</p>
      </div>
      {children}
    </div>
  );
}

interface AccountRowProps {
  readonly account: LinkedAccount;
  readonly showPrimary: boolean;
  readonly detail: string | null;
  readonly onChanged: () => void;
}

function AccountRow({ account, showPrimary, detail, onChanged }: AccountRowProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>, fallback: string): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      onChanged();
    } catch (cause) {
      setError(message(cause, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg bg-steel-950/60 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 truncate text-sm text-steel-100">{displayName(account)}</p>

        {account.isPrimary && showPrimary ? (
          <span className="shrink-0 rounded-full border border-ember-500/50 bg-ember-500/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-ember-400 uppercase">
            Principal
          </span>
        ) : null}

        {!account.isPrimary && showPrimary ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => setPrimaryAccount(account), "Changement impossible.")}
            className={GHOST_BUTTON}
          >
            Définir principal
          </button>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void run(() => unlinkAccount(account), "Déliaison impossible.")}
          className={GHOST_BUTTON}
        >
          {busy ? "…" : "Délier"}
        </button>
      </div>

      {detail === null ? null : <p className="mt-1 text-[11px] text-steel-500">{detail}</p>}
      {error === null ? null : <p className="mt-1 text-[11px] text-ember-400">{error}</p>}
    </div>
  );
}

/**
 * La ligne d'état sous un formulaire.
 *
 * « Non configuré » se distingue d'une erreur par le ton *et* par le fond : on
 * dit ce qui reste possible, plutôt que d'inviter à réessayer quelque chose qui
 * échouera pareil.
 */
function StatusLine({ status }: { readonly status: LinkStatus }) {
  if (status.kind === "idle") return null;
  if (status.kind === "checking") {
    return (
      <p aria-live="polite" className="text-[11px] text-steel-400">
        Vérification du compte…
      </p>
    );
  }
  if (status.kind === "unavailable") {
    return (
      <p
        aria-live="polite"
        className="rounded-lg border border-steel-700 bg-steel-950/60 px-3 py-2 text-[11px] leading-relaxed text-steel-400"
      >
        {status.message}
      </p>
    );
  }
  return (
    <p aria-live="polite" className="text-[11px] text-ember-400">
      {status.message}
    </p>
  );
}
