/**
 * « Discuter avec le coach » : la conversation attachée à un debrief
 * (SPEC §5 ter bis).
 *
 * Le composant est monté **par le debrief déplié** et démonté avec lui : la
 * conversation n'est chargée que si quelqu'un l'ouvre, et une page d'historique
 * à vingt debriefs ne déclenche pas vingt requêtes. C'est aussi pourquoi
 * l'historique se lit au montage sans mise en cache — on revient rarement deux
 * fois sur le même fil dans la même minute.
 *
 * Un message envoyé n'est **pas** affiché de façon optimiste. La fonction ne
 * persiste rien quand la génération échoue (pas de conversation trouée), donc
 * un message ajouté localement puis conservé après une panne serait un mensonge
 * durable : au rechargement il aurait disparu. On préfère le laisser dans la
 * zone de saisie, où l'utilisateur peut le renvoyer.
 */

import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  CHAT_DAILY_QUOTA,
  CHAT_MESSAGE_MAX,
  type ChatMessage,
} from "../../shared/coach-chat-contract";
import { Notice } from "../components/Notice";
import { listCoachMessages } from "../data";
import { ChatError, requestCoachChat } from "./chat-api";

type History =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly messages: readonly ChatMessage[] };

/** Un échec d'envoi : quota atteint et panne ne se disent pas pareil. */
interface Failure {
  readonly message: string;
  readonly quota: boolean;
}

/**
 * Ce que l'écran sait du quota du jour. Trois états et non un `number | null` :
 * `null` voudrait dire à la fois « pas encore demandé » et « il n'y a plus rien
 * à compter » (configuration IA personnelle, SPEC §5 ter).
 */
type Quota =
  | { readonly status: "unknown" }
  | { readonly status: "lifted" }
  | { readonly status: "counted"; readonly remaining: number };

const PLACEHOLDER = "Explique-moi quoi faire exactement pour l'axe 2…";

function failureOf(cause: unknown): Failure {
  if (cause instanceof ChatError) return { message: cause.message, quota: cause.quotaReached };
  return {
    message: cause instanceof Error ? cause.message : "L'envoi a échoué.",
    quota: false,
  };
}

export function CoachChat({ debriefId }: { readonly debriefId: number }) {
  const [history, setHistory] = useState<History>({ status: "loading" });
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [quota, setQuota] = useState<Quota>({ status: "unknown" });
  const endRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    setHistory({ status: "loading" });
    try {
      setHistory({ status: "ready", messages: await listCoachMessages(debriefId) });
    } catch (cause) {
      setHistory({
        status: "error",
        message: cause instanceof Error ? cause.message : "Chargement impossible.",
      });
    }
  }, [debriefId]);

  useEffect(() => {
    void load();
  }, [load]);

  const messages = history.status === "ready" ? history.messages : [];
  const count = messages.length;

  // Le fil grandit par le bas : après un aller-retour, c'est la réponse qu'on
  // veut voir, pas le haut de la conversation. Rien au premier rendu — faire
  // sauter la page à l'ouverture d'un debrief serait désagréable.
  const firstRender = useRef(true);

  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (count === 0) return;
    endRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count]);

  const trimmed = draft.trim();
  const tooLong = draft.length > CHAT_MESSAGE_MAX;
  const canSend = trimmed !== "" && !tooLong && !sending;

  async function send(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!canSend) return;

    setSending(true);
    setFailure(null);
    try {
      const { question, answer, remaining } = await requestCoachChat(debriefId, trimmed);

      setHistory((current) =>
        current.status === "ready"
          ? { status: "ready", messages: [...current.messages, question, answer] }
          : { status: "ready", messages: [question, answer] },
      );
      setQuota(remaining === null ? { status: "lifted" } : { status: "counted", remaining });
      setDraft("");
    } catch (cause) {
      setFailure(failureOf(cause));
      if (cause instanceof ChatError && cause.remaining !== null) {
        setQuota({ status: "counted", remaining: cause.remaining });
      }
    } finally {
      setSending(false);
    }
  }

  const fieldId = `coach-chat-${debriefId}`;

  return (
    <section className="mt-5 border-t border-steel-800 pt-4">
      <h4 className="mb-2 text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        Discuter avec le coach
      </h4>

      {history.status === "loading" ? (
        <Notice tone="loading" title="Chargement de la conversation…" />
      ) : history.status === "error" ? (
        <Notice
          tone="error"
          title="La conversation n'a pas pu être chargée."
          onRetry={() => void load()}
        >
          {history.message}
        </Notice>
      ) : messages.length === 0 ? (
        <p className="text-xs leading-relaxed text-steel-500">
          Pose une question sur ce debrief : le coach a le contexte de ta partie, de ton dernier
          bench et de ton profil.
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {messages.map((message) => (
            <Bubble key={message.id} message={message} />
          ))}
        </ul>
      )}
      <div ref={endRef} />

      <form onSubmit={(event) => void send(event)} className="mt-3 flex flex-col gap-2">
        <label htmlFor={fieldId} className="sr-only">
          Message au coach
        </label>
        <textarea
          id={fieldId}
          rows={3}
          value={draft}
          disabled={sending}
          placeholder={PLACEHOLDER}
          aria-describedby={`${fieldId}-count`}
          onChange={(event) => setDraft(event.target.value)}
          className="w-full resize-y rounded-md border border-steel-700 bg-steel-800 px-3 py-2 text-sm leading-relaxed text-steel-100 transition-colors placeholder:text-steel-600 hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60"
        />

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="submit"
            disabled={!canSend}
            className="rounded-lg bg-ember-600 px-3 py-2 text-xs font-semibold text-steel-100 transition-colors hover:bg-ember-500 disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
          >
            {sending ? "Le coach répond…" : "Envoyer"}
          </button>

          <p
            id={`${fieldId}-count`}
            className={`font-mono text-[11px] tabular-nums ${tooLong ? "text-ember-400" : "text-steel-500"}`}
          >
            {draft.length} / {CHAT_MESSAGE_MAX}
            {tooLong ? " · trop long" : ""}
          </p>

          <p className="ml-auto text-[11px] text-steel-500">
            {quota.status === "unknown"
              ? `${CHAT_DAILY_QUOTA} messages par jour`
              : quota.status === "lifted"
                ? "Quota levé · ta configuration IA"
                : `${quota.remaining} message${quota.remaining > 1 ? "s" : ""} restant${quota.remaining > 1 ? "s" : ""}`}
          </p>
        </div>

        {failure !== null ? (
          failure.quota ? (
            <Notice tone="empty" title="Quota du jour atteint.">
              {failure.message}
            </Notice>
          ) : (
            <Notice tone="error" title="Le message n'a pas pu être envoyé.">
              <p>{failure.message}</p>
              {/* Le brouillon n'est pas effacé sur un échec : le dire évite de
                  le retaper par réflexe. */}
              <p className="mt-1">Ton texte est resté dans la zone de saisie.</p>
            </Notice>
          )
        ) : null}
      </form>
    </section>
  );
}

/**
 * Un message. Le texte du coach est rendu tel quel, retours à la ligne compris
 * (`whitespace-pre-line`) : le prompt lui demande du texte simple, pas du
 * markdown, et interpréter des astérisques ici donnerait un rendu incohérent le
 * jour où il en écrirait quand même.
 */
function Bubble({ message }: { readonly message: ChatMessage }) {
  const mine = message.role === "user";

  return (
    <li className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[90%] rounded-lg px-3 py-2 text-sm leading-relaxed whitespace-pre-line sm:max-w-[80%] ${
          mine ? "bg-steel-800 text-steel-200" : "bg-steel-950/60 text-steel-300"
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
