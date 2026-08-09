/**
 * Le bloc Valorant du tableau de bord : rang courant et dernières parties du
 * compte Riot principal (SPEC §5 bis).
 *
 * Il applique la règle de l'écran d'accueil — **montrer d'abord, rafraîchir
 * ensuite**. Le rang et les matchs déjà connus s'affichent immédiatement,
 * depuis la base ; l'appel à la source part en arrière-plan et corrige. Un
 * dashboard qui attendrait un aller-retour vers une API non officielle avant
 * d'afficher quoi que ce soit serait vide à chaque ouverture, et blanc le jour
 * où cette API tombe.
 *
 * Conséquence assumée : quand la source est injoignable ou pas encore
 * configurée, le bloc reste utile (il montre ce qu'il sait) et dit en petit
 * pourquoi il ne s'est pas mis à jour.
 */

import { useCallback, useEffect, useState } from "react";
import {
  type LinkedAccount,
  LinkedAccountError,
  listImportedMatches,
  type MatchSummary,
  type MmrSummary,
  primaryAccount,
  refreshRiotAccount,
} from "../data";
import { formatRunDate } from "../format";
import { LinkInvite } from "./LinkInvite";
import type { LinkedAccountsState } from "./useLinkedAccounts";

/** Parties affichées : de quoi voir une tendance, pas de quoi scroller. */
const VISIBLE_MATCHES = 4;

const RESULT_LABELS: Readonly<Record<NonNullable<MatchSummary["result"]>, string>> = {
  victoire: "Victoire",
  defaite: "Défaite",
  egalite: "Égalité",
};

export function ValorantPanel({ state }: { readonly state: LinkedAccountsState }) {
  if (state.status === "loading") return <Skeleton />;
  if (state.status === "error") {
    return <Empty headline="Comptes liés indisponibles." detail={state.message} />;
  }

  const account = primaryAccount(state.accounts, "riot");

  if (account === null) {
    return (
      <LinkInvite title="Suis ton rang sans rien saisir">
        Lie ton Riot ID : ton rang, ton RR et tes dernières parties classées apparaîtront ici, et le
        coach pourra débriefer un match sans que tu colles quoi que ce soit.
      </LinkInvite>
    );
  }
  return <Live account={account} />;
}

/* ------------------------------------------------------------------ */
/* Le compte lié, une fois connu                                       */
/* ------------------------------------------------------------------ */

function Live({ account }: { readonly account: LinkedAccount }) {
  // L'état de départ est ce que la base sait déjà : l'écran n'est jamais vide
  // en attendant la source.
  const [mmr, setMmr] = useState<MmrSummary | null>(account.riotMmr);
  const [matches, setMatches] = useState<readonly MatchSummary[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setNotice(null);
    try {
      const result = await refreshRiotAccount(account.id);

      setMmr(result.mmr ?? null);
      setMatches(result.matches);
    } catch (cause) {
      // Un service non configuré n'est pas une panne : on le dit sur le même
      // ton que le reste, et on laisse à l'écran ce qu'on avait déjà.
      setNotice(
        cause instanceof LinkedAccountError
          ? cause.message
          : "Rang et parties n'ont pas pu être mis à jour.",
      );
    } finally {
      setRefreshing(false);
    }
  }, [account.id]);

  useEffect(() => {
    let cancelled = false;

    // Ce qui est déjà en base, tout de suite ; la source ensuite (et le cache
    // de cinq minutes fait que ce second appel ne coûte souvent rien).
    void listImportedMatches(account.id, VISIBLE_MATCHES)
      .then((stored) => {
        if (!cancelled) setMatches(stored);
      })
      .catch(() => {
        /* L'appel de rafraîchissement, juste après, dira ce qui ne va pas. */
      });
    void refresh();

    return () => {
      cancelled = true;
    };
  }, [account.id, refresh]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div>
          <p className="text-2xl leading-none font-semibold text-steel-100">
            {mmr?.tier ?? "Rang inconnu"}
          </p>
          <p className="mt-1.5 text-xs text-steel-500">
            {/* Le Riot ID reste toujours visible : avec plusieurs comptes liés,
                un rang sans nom ne dit pas duquel il parle. */}
            {account.externalId}
            {mmr?.rr === null || mmr?.rr === undefined ? null : ` · ${mmr.rr} RR`}
            {mmr?.lastChange === null || mmr?.lastChange === undefined ? null : (
              <span className={mmr.lastChange >= 0 ? "text-quench-500" : "text-ember-400"}>
                {" "}
                ({mmr.lastChange > 0 ? "+" : ""}
                {mmr.lastChange})
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          disabled={refreshing}
          onClick={() => void refresh()}
          className="ml-auto rounded-lg border border-steel-700 px-3 py-1.5 text-[11px] font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-600"
        >
          {refreshing ? "Mise à jour…" : "Rafraîchir"}
        </button>
      </div>

      {matches.length === 0 ? (
        <Empty
          headline="Aucune partie importée."
          detail="Les dernières parties classées de ce compte s'afficheront ici après un rafraîchissement."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {matches.slice(0, VISIBLE_MATCHES).map((match) => (
            <MatchRow key={match.matchId} match={match} />
          ))}
        </ul>
      )}

      {notice === null ? null : (
        <p aria-live="polite" className="text-[11px] leading-relaxed text-steel-500">
          {notice}
        </p>
      )}
    </div>
  );
}

function MatchRow({ match }: { readonly match: MatchSummary }) {
  const kda =
    match.kills === null || match.deaths === null || match.assists === null
      ? null
      : `${match.kills}/${match.deaths}/${match.assists}`;
  const rounds =
    match.roundsWon === null || match.roundsLost === null
      ? null
      : `${match.roundsWon}–${match.roundsLost}`;

  return (
    <li className="flex items-baseline justify-between gap-3 rounded-lg bg-steel-950/60 px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm text-steel-200">
          {match.map ?? "Map inconnue"}
          {match.agent === null ? null : <span className="text-steel-500"> · {match.agent}</span>}
        </p>
        <p className="mt-0.5 text-[11px] text-steel-500">
          {match.result === null ? "Résultat inconnu" : RESULT_LABELS[match.result]}
          {rounds === null ? null : ` ${rounds}`}
          {match.playedAt === null ? null : ` · ${formatRunDate(match.playedAt)}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-mono text-sm tabular-nums text-steel-200">{kda ?? "—"}</p>
        <p className="mt-0.5 font-mono text-[11px] tabular-nums text-steel-500">
          {match.adr === null ? "—" : `${match.adr} ADR`}
          {match.headshotPercent === null ? null : ` · ${match.headshotPercent} % HS`}
        </p>
      </div>
    </li>
  );
}

function Empty({ headline, detail }: { readonly headline: string; readonly detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-steel-800 bg-steel-950/40 p-4">
      <p className="text-sm text-steel-300">{headline}</p>
      <p className="mt-1 text-xs leading-relaxed text-steel-500">{detail}</p>
    </div>
  );
}

function Skeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      <div className="h-7 w-36 rounded bg-steel-800/70" />
      <div className="h-3 w-24 rounded bg-steel-800/50" />
    </div>
  );
}
