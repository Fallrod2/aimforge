/**
 * L'onglet Coach : **un fil continu** (SPEC §5 sexies, V3).
 *
 * Ce qui change par rapport à la vue précédente n'est pas cosmétique. Le coach
 * n'est plus une machine à produire des debriefs qu'on relit ensuite : c'est
 * une conversation qui sait où en est le joueur (profil, bench, matchs
 * importés, debriefs passés), et les debriefs structurés deviennent des
 * **cartes générées dans le fil**.
 *
 * Quatre décisions portent l'écran, et chacune se paie :
 *
 * 1. **les chips envoient, elles ne pré-remplissent pas.** Une question
 *    préconstruite qu'il faut ensuite valider fait deux gestes pour une
 *    intention. La contrepartie assumée : un clic consomme un message du quota,
 *    donc les chips sont désactivées pendant un envoi et le compteur reste
 *    visible ;
 * 2. **rien n'est affiché de façon optimiste.** La fonction ne persiste rien
 *    quand la génération échoue (pas de conversation trouée), donc un message
 *    ajouté localement puis conservé après une panne serait un mensonge durable.
 *    Le texte reste dans la zone de saisie, où l'utilisateur peut le renvoyer ;
 * 3. **la suggestion de debrief est un bouton, pas une génération.** Le modèle
 *    peut proposer un debrief ; c'est le clic qui dépense le quota `coach`.
 *    Générer sur la seule décision du modèle serait une double dépense cachée ;
 * 4. **l'historique des debriefs est un repli sous le fil**, monté seulement
 *    quand on l'ouvre. Il garde tout ce qui existait (collage manuel,
 *    suppression, conversations archivées) sans encombrer la conversation, et
 *    sans payer son chargement pour ceux qui ne l'ouvrent pas.
 *
 * ## L'attente (V4-C §4.9)
 *
 * Les deux générations du fil — répondre, et débriefer un match — vivent dans
 * des magasins de module (`./thread-generation.ts`), au-dessus de cette vue.
 * Partir sur Perfs pendant que le coach répond ne perd donc plus la réponse :
 * elle attend d'être relevée au retour. Le squelette d'attente
 * (`./GenerationProgress`) est plus court que celui de la routine, parce qu'un
 * tour de conversation l'est ; le refus du streaming, lui, est le même, et il
 * est expliqué dans `./progress.ts`.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { StoredDebrief } from "../../shared/coach-contract";
import {
  type DebriefSuggestion,
  THREAD_MESSAGE_MAX,
  type ThreadMessage,
} from "../../shared/coach-thread-contract";
import { Notice } from "../components/Notice";
import { QuotaNote } from "../components/QuotaNote";
import { clearThread, listDebriefs, listThreadMessages } from "../data";
import { CoachView } from "./CoachView";
import { DebriefCard } from "./DebriefCard";
import { appendMessages, planDebriefFocus } from "./focus";
import { GenerationProgress } from "./GenerationProgress";
import { upsertById, useGeneration } from "./generation-store";
import { setCoachDebriefFocus, takeCoachDebriefFocus, takeCoachPrefill } from "./prefill";
import { THREAD_EXPECTATION, THREAD_STEPS } from "./progress";
import { threadDebriefGeneration, threadReplyGeneration } from "./thread-generation";

type Thread =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly messages: readonly ThreadMessage[] };

const PLACEHOLDER = "Pose ta question au coach…";

/** Les questions préconstruites, dans l'ordre où elles se posent vraiment. */
const CHIPS = [
  "Pourquoi je stagne ?",
  "Que travailler aujourd'hui ?",
  "Compare mon bench et mes games",
] as const;

/**
 * L'intitulé du chip. Le message qui apparaît dans le fil, lui, est écrit par
 * la fonction (« Analyse ce match. ») : la ligne d'un tour n'est plus rédigée
 * par le navigateur.
 */
const ANALYSE_LAST_MATCH = "Analyse mon dernier match";

const NO_MATCH_TO_DEBRIEF =
  "Aucun match importé en attente de debrief. Rafraîchis le bloc Valorant de l'accueil, ou colle tes stats dans l'historique ci-dessous.";

const CARD_NOT_POSTED =
  "Le debrief est généré, mais sa carte n'a pas pu être posée dans le fil. Il est ouvert dans l'historique, juste en dessous.";

export function CoachThreadView() {
  const [thread, setThread] = useState<Thread>({ status: "loading" });
  const [debriefs, setDebriefs] = useState<readonly StoredDebrief[]>([]);
  const [draft, setDraft] = useState("");
  /** Les deux générations du fil, où qu'on soit passé (`./thread-generation`). */
  const reply = useGeneration(threadReplyGeneration);
  const debriefing = useGeneration(threadDebriefGeneration);
  const sending = reply.status === "running";
  const generating = debriefing.status === "running";
  // Un état à annoncer sans que ce soit un échec : « rien à débriefer », « la
  // carte n'a pas pu être posée ». Le titre voyage avec le texte parce que les
  // deux cas ne se disent pas pareil.
  const [notice, setNotice] = useState<{ title: string; body: string } | null>(null);
  /**
   * Ce que la dernière réponse du fil a dit du restant : `undefined` tant qu'il
   * n'y en a pas eu, `null` quand elle n'a rien compté (SPEC §5 ter). La limite
   * et l'heure de réinitialisation appartiennent à `QuotaNote`, qui les tient
   * du serveur — l'écran n'a pas à les connaître.
   */
  const [remaining, setRemaining] = useState<number | null | undefined>(undefined);
  const [suggestion, setSuggestion] = useState<DebriefSuggestion | null>(null);
  /** L'échec de l'effacement du fil : le seul qui ne vienne pas d'une génération. */
  const [clearFailure, setClearFailure] = useState<string | null>(null);
  const [expandedCard, setExpandedCard] = useState<number | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scrollToCard, setScrollToCard] = useState<number | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setThread({ status: "loading" });
    try {
      // Les debriefs servent aux **cartes** du fil : un message qui porte une
      // référence est rendu avec le debrief correspondant. Ils sont chargés ici
      // et pas dans chaque carte, sinon un fil qui en contient cinq
      // déclencherait cinq requêtes pour la même liste.
      const [messages, stored] = await Promise.all([listThreadMessages(), listDebriefs()]);

      setThread({ status: "ready", messages });
      setDebriefs(stored);

      // Le pont depuis le dashboard (« Débriefer » sur un match) : la boîte à
      // lettres désigne un debrief, le fil décide quoi en faire. Elle est
      // relevée **ici** et pas dans un effet séparé, parce que la décision a
      // besoin du fil qu'on vient de charger — sans lui, on ne peut pas savoir
      // si la carte y est.
      const plan = planDebriefFocus(messages, takeCoachDebriefFocus());

      if (plan.kind === "card") {
        setExpandedCard(plan.debriefId);
        setScrollToCard(plan.debriefId);
      }
      if (plan.kind === "history") {
        // Pas de carte dans le fil : on **repose** l'identifiant dans la boîte
        // et on ouvre l'historique, qui la relèvera à son montage. Rendre la
        // boîte à celui qui sait l'honorer vaut mieux que dupliquer sa logique.
        setCoachDebriefFocus(plan.debriefId);
        setHistoryOpen(true);
      }
    } catch (cause) {
      setThread({
        status: "error",
        message: cause instanceof Error ? cause.message : "Chargement impossible.",
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Le pont depuis les matchs (`./prefill`) alimente désormais le champ du fil.
  // Il est relevé dans un effet et non à l'initialisation de l'état :
  // `useState(takeCoachPrefill())` serait appelé deux fois en développement
  // (StrictMode rejoue le rendu) et le second appel trouverait la boîte déjà
  // vidée par le premier.
  useEffect(() => {
    const pending = takeCoachPrefill();

    if (pending !== null) setDraft(pending);
  }, []);

  const messages = thread.status === "ready" ? thread.messages : [];
  const count = messages.length;

  // Le fil grandit par le bas : après un aller-retour, c'est la réponse qu'on
  // veut voir. Rien au premier rendu — faire sauter la page à l'ouverture de
  // l'onglet serait désagréable.
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (count === 0) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count]);

  // La carte désignée par le pont : on l'amène à l'écran une fois qu'elle est
  // dépliée. L'ancre est le panneau que `DebriefCard` monte à ce moment-là —
  // viser la carte repliée ferait remonter l'écran avant que son contenu existe.
  useEffect(() => {
    if (scrollToCard === null) return;

    document
      .getElementById(`debrief-${scrollToCard}-detail`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    setScrollToCard(null);
  }, [scrollToCard]);

  /**
   * On relève le tour de conversation quand il est prêt, puis on rend la place.
   *
   * Il a pu se terminer alors que cette vue était démontée (l'utilisateur est
   * parti sur Perfs) : c'est donc le rendu qui découvre la réponse, pas
   * l'appelant. Les messages passent par `appendMessages`, qui déduplique sur
   * l'identifiant de la base — un rechargement du fil peut les avoir déjà
   * ramenés.
   *
   * Le brouillon n'est vidé que s'il **est** le message envoyé : un chip
   * n'efface pas ce que l'utilisateur était en train d'écrire à côté.
   */
  useEffect(() => {
    if (reply.status === "failed") {
      if (reply.failure.remaining !== null) setRemaining(reply.failure.remaining);
      return;
    }
    if (reply.status !== "done") return;

    const { question, answer, suggestion: proposed, remaining: left } = reply.result;

    setThread((current) =>
      current.status === "ready"
        ? { status: "ready", messages: appendMessages(current.messages, [question, answer]) }
        : { status: "ready", messages: [question, answer] },
    );
    setSuggestion(proposed);
    setRemaining(left);
    setDraft((current) => (current.trim() === reply.request ? "" : current));
    threadReplyGeneration.settle();
  }, [reply]);

  /**
   * Idem pour le debrief. Son quota n'est **pas** repris ici : c'est celui du
   * coach, et le compteur affiché sous le fil est celui des messages.
   */
  useEffect(() => {
    if (debriefing.status !== "done") return;

    const outcome = debriefing.result;

    if (outcome.kind === "none") {
      setNotice({ title: "Rien à débriefer.", body: NO_MATCH_TO_DEBRIEF });
      threadDebriefGeneration.settle();
      return;
    }
    setDebriefs((current) => upsertById(current, outcome.debrief));
    setExpandedCard(outcome.debrief.id);
    setSuggestion(null);

    // Carte absente = sa pose a échoué alors que le debrief, lui, est bien
    // enregistré et facturé. On ne perd pas le geste : l'historique l'a.
    if (outcome.thread === undefined) {
      setNotice({ title: "Le fil n'a pas reçu la carte.", body: CARD_NOT_POSTED });
      setCoachDebriefFocus(outcome.debrief.id);
      setHistoryOpen(true);
    } else {
      const posted = outcome.thread;

      setThread((current) =>
        current.status === "ready"
          ? { status: "ready", messages: appendMessages(current.messages, posted) }
          : { status: "ready", messages: posted },
      );
      setScrollToCard(outcome.debrief.id);
    }
    threadDebriefGeneration.settle();
  }, [debriefing]);

  const trimmed = draft.trim();
  const tooLong = draft.length > THREAD_MESSAGE_MAX;
  const busy = sending || generating;
  const canSend = trimmed !== "" && !tooLong && !busy;

  /** Un tour de conversation. Le brouillon n'est vidé qu'en cas de succès. */
  function send(message: string): void {
    setNotice(null);
    setSuggestion(null);
    setClearFailure(null);
    // Le magasin ignore une demande pendant qu'une autre est en vol : c'est lui
    // qui garantit qu'un double clic ne consomme pas deux messages de quota.
    threadReplyGeneration.start(message);
  }

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!canSend) return;
    send(trimmed);
  }

  /**
   * Demande le debrief d'un match, et sa carte dans le fil.
   *
   * `matchId` non fourni = le geste part du chip ; la recherche du dernier match
   * non débriefé fait alors partie de la demande (`./thread-generation`), donc
   * « Réessayer » la rejoue elle aussi. Fourni = il vient de la suggestion du
   * coach, que le serveur a déjà choisie.
   */
  function generateDebrief(matchId: string | null): void {
    setNotice(null);
    setClearFailure(null);
    threadDebriefGeneration.start({ matchId });
  }

  async function confirmClear(): Promise<void> {
    setClearing(true);
    setClearFailure(null);
    try {
      await clearThread();
      setThread({ status: "ready", messages: [] });
      setSuggestion(null);
      setConfirmingClear(false);
    } catch (cause) {
      setClearFailure(cause instanceof Error ? cause.message : "Le fil n'a pas pu être effacé.");
    } finally {
      setClearing(false);
    }
  }

  const byId = new Map(debriefs.map((debrief) => [debrief.id, debrief]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* « Fil du coach » et non « Coach » depuis V6 : le titre de la
              section est porté par `CoachSpace`, qui coiffe aussi la routine du
              jour. Deux « Coach » l'un sous l'autre ne diraient rien de plus. */}
          <h2 className="text-sm font-semibold text-steel-100">Fil du coach</h2>
          <p className="mt-0.5 text-xs text-steel-500">
            Une seule conversation, qui connaît tes matchs, ton dernier bench et ton profil.
          </p>
        </div>

        {count > 0 && !confirmingClear ? (
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="rounded-lg border border-steel-800 px-3 py-1.5 text-xs font-medium text-steel-500 transition-colors hover:border-ember-600 hover:text-ember-400"
          >
            Effacer le fil
          </button>
        ) : null}
      </div>

      {confirmingClear ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-steel-800 bg-steel-900/60 px-4 py-3">
          <p className="mr-auto text-xs text-steel-400">
            Effacer tout le fil ? Tes debriefs, eux, restent dans l'historique.
          </p>
          <button
            type="button"
            onClick={() => setConfirmingClear(false)}
            disabled={clearing}
            className="rounded-lg border border-steel-700 px-3 py-1.5 text-xs font-medium text-steel-300 transition-colors hover:text-steel-100 disabled:opacity-50"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={() => void confirmClear()}
            disabled={clearing}
            className="rounded-lg bg-ember-600 px-3 py-1.5 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:opacity-50"
          >
            {clearing ? "Effacement…" : "Confirmer"}
          </button>
        </div>
      ) : null}

      <section className="flex flex-col gap-3">
        {thread.status === "loading" ? (
          <Notice tone="loading" title="Chargement du fil…" />
        ) : thread.status === "error" ? (
          <Notice tone="error" title="Le fil n'a pas pu être chargé." onRetry={() => void load()}>
            {thread.message}
          </Notice>
        ) : messages.length === 0 ? (
          <Notice tone="empty" title="Le fil est vide.">
            Pose une question, ou lance-toi avec une des propositions ci-dessous : le coach a le
            contexte de tes parties, de ton bench et de ton profil.
          </Notice>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => {
              const debrief = message.debriefId === null ? null : byId.get(message.debriefId);

              return debrief === null || debrief === undefined ? (
                <Bubble key={message.id} message={message} />
              ) : (
                <DebriefCard
                  key={message.id}
                  debrief={debrief}
                  readOnly
                  expanded={expandedCard === debrief.id}
                  onToggle={() => setExpandedCard(expandedCard === debrief.id ? null : debrief.id)}
                />
              );
            })}
          </ul>
        )}
        <div ref={endRef} />

        {reply.status === "running" ? (
          <GenerationProgress
            title="Le coach réfléchit…"
            steps={THREAD_STEPS}
            expectation={THREAD_EXPECTATION}
            startedAt={reply.startedAt}
          />
        ) : null}

        {debriefing.status === "running" ? (
          <GenerationProgress
            title="Le coach analyse ta partie…"
            steps={THREAD_STEPS}
            expectation={THREAD_EXPECTATION}
            startedAt={debriefing.startedAt}
          />
        ) : null}

        {suggestion !== null && !busy ? (
          <div className="rounded-xl border border-ember-600/40 bg-ember-600/10 px-4 py-3">
            {suggestion.matchId === null ? (
              <p className="text-xs leading-relaxed text-steel-400">{NO_MATCH_TO_DEBRIEF}</p>
            ) : (
              <button
                type="button"
                onClick={() => generateDebrief(suggestion.matchId)}
                className="rounded-lg bg-ember-500 px-3 py-2 text-xs font-semibold text-steel-950 transition-colors hover:bg-ember-400"
              >
                Générer le debrief de ce match
              </button>
            )}
          </div>
        ) : null}

        {notice !== null ? (
          <Notice tone="empty" title={notice.title}>
            {notice.body}
          </Notice>
        ) : null}

        {/* Les deux échecs de génération portent chacun leur reprise : elle
            rejoue la même demande, sans que rien soit à ressaisir. */}
        {reply.status === "failed" ? (
          reply.failure.quota ? (
            <Notice tone="empty" title="Quota du jour atteint.">
              {reply.failure.message}
            </Notice>
          ) : (
            <Notice
              tone="error"
              title="Le coach n'a pas pu répondre."
              onRetry={() => threadReplyGeneration.retry()}
            >
              <p>{reply.failure.message}</p>
              <p className="mt-1">
                « Réessayer » renvoie le même message ; ton texte est de toute façon resté dans la
                zone de saisie.
              </p>
            </Notice>
          )
        ) : null}

        {debriefing.status === "failed" ? (
          debriefing.failure.quota ? (
            <Notice tone="empty" title="Quota de debriefs atteint.">
              {debriefing.failure.message}
            </Notice>
          ) : (
            <Notice
              tone="error"
              title="Le debrief n'a pas pu être généré."
              onRetry={() => threadDebriefGeneration.retry()}
            >
              {debriefing.failure.message}
            </Notice>
          )
        ) : null}

        {clearFailure !== null ? (
          <Notice tone="error" title="Le fil n'a pas pu être effacé.">
            {clearFailure}
          </Notice>
        ) : null}
      </section>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <Chip label={ANALYSE_LAST_MATCH} disabled={busy} onClick={() => generateDebrief(null)} />
          {CHIPS.map((chip) => (
            <Chip key={chip} label={chip} disabled={busy} onClick={() => send(chip)} />
          ))}
        </div>

        <label htmlFor="coach-thread-input" className="sr-only">
          Message au coach
        </label>
        <textarea
          id="coach-thread-input"
          rows={3}
          value={draft}
          disabled={busy}
          placeholder={PLACEHOLDER}
          aria-describedby="coach-thread-count"
          onChange={(event) => setDraft(event.target.value)}
          className="w-full resize-y rounded-md border border-steel-700 bg-steel-800 px-3 py-2 text-sm leading-relaxed text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-lg bg-ember-500 px-4 py-2 text-sm font-semibold text-steel-950 transition-colors hover:bg-ember-400 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
          >
            {sending ? "Envoi…" : "Envoyer"}
          </button>

          <p
            id="coach-thread-count"
            className={`font-mono text-[11px] tabular-nums ${tooLong ? "text-ember-400" : "text-steel-500"}`}
          >
            {draft.length} / {THREAD_MESSAGE_MAX}
            {tooLong ? " · trop long" : ""}
          </p>

          <QuotaNote kind="chat" remaining={remaining} className="ml-auto text-[11px]" />
        </div>
      </form>

      <section className="border-t border-steel-800 pt-5">
        <button
          type="button"
          onClick={() => setHistoryOpen(!historyOpen)}
          aria-expanded={historyOpen}
          aria-controls="coach-debriefs"
          className="flex w-full items-center gap-2 text-left text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase transition-colors hover:text-steel-200"
        >
          Historique des debriefs
          <Chevron open={historyOpen} />
        </button>

        {/* Monté seulement à l'ouverture : replié, il ne charge rien. */}
        {historyOpen ? (
          <div id="coach-debriefs" className="mt-4">
            <CoachView />
          </div>
        ) : null}
      </section>
    </div>
  );
}

function Chip({
  label,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-full border border-steel-700 bg-steel-900/60 px-3 py-1.5 text-xs text-steel-300 transition-colors hover:border-ember-600 hover:text-ember-300 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {label}
    </button>
  );
}

/**
 * Un message. Le texte du coach est rendu tel quel, retours à la ligne compris
 * (`whitespace-pre-line`) : le prompt lui demande du texte simple, pas du
 * markdown, et interpréter des astérisques ici donnerait un rendu incohérent le
 * jour où il en écrirait quand même.
 */
function Bubble({ message }: { readonly message: ThreadMessage }) {
  const mine = message.role === "user";

  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-line sm:max-w-[80%] ${
          mine ? "bg-steel-800 text-steel-200" : "bg-steel-900/60 text-steel-300"
        }`}
      >
        <span className="mb-0.5 block text-[10px] font-semibold tracking-wide text-steel-500 uppercase">
          {mine ? "Toi" : "Coach"}
        </span>
        {message.content}
      </div>
    </li>
  );
}

function Chevron({ open }: { readonly open: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 12 12"
      className={`size-3 shrink-0 text-steel-500 transition-transform ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M2 4.5 6 8.5 10 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
