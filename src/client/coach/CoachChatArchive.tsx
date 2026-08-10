/**
 * L'**archive** d'une conversation attachée à un debrief (SPEC §5 ter bis,
 * archivée par §5 sexies).
 *
 * Le coach a désormais un fil unique et continu ; les conversations tenues sous
 * un debrief avant ce changement restent **lisibles** — la migration 0014 ne
 * touche pas à `coach_messages` — mais on n'y écrit plus. Ce composant est donc
 * l'ancien `CoachChat` amputé de sa zone de saisie, plus un bandeau qui dit où
 * la conversation continue.
 *
 * Il ne rend **rien** quand le debrief n'a jamais eu de conversation, ce qui est
 * le cas de tous les debriefs générés depuis : un bandeau sous chaque debrief
 * pour annoncer l'absence d'une fonctionnalité disparue serait du bruit.
 *
 * Le chargement se fait au montage, sans mise en cache : le composant n'est
 * monté que par un debrief déplié, donc une page d'historique à vingt debriefs
 * ne déclenche pas vingt requêtes.
 */

import { useCallback, useEffect, useState } from "react";
import type { ChatMessage } from "../../shared/coach-chat-contract";
import { Notice } from "../components/Notice";
import { listCoachMessages } from "../data";

type History =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly messages: readonly ChatMessage[] };

export function CoachChatArchive({ debriefId }: { readonly debriefId: number }) {
  const [history, setHistory] = useState<History>({ status: "loading" });

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

  // Ni pendant le chargement, ni pour un debrief sans conversation : dans les
  // deux cas il n'y a rien à montrer, et un encart de chargement qui
  // disparaîtrait presque toujours pour ne rien laisser ferait clignoter la
  // carte.
  if (history.status === "loading") return null;

  if (history.status === "error") {
    return (
      <section className="mt-5 border-t border-steel-800 pt-4">
        <Notice
          tone="error"
          title="La conversation archivée n'a pas pu être chargée."
          onRetry={() => void load()}
        >
          {history.message}
        </Notice>
      </section>
    );
  }

  if (history.messages.length === 0) return null;

  return (
    <section className="mt-5 border-t border-steel-800 pt-4">
      <h4 className="mb-2 text-[11px] font-medium tracking-[0.18em] text-steel-400 uppercase">
        Conversation archivée
      </h4>

      <p className="mb-3 rounded-lg border border-steel-800 bg-steel-950/60 px-3 py-2 text-xs leading-relaxed text-steel-400">
        Ces messages datent d'avant le fil du coach. Ils restent lisibles, mais la conversation
        continue désormais dans le fil, en haut de cette page.
      </p>

      <ul className="flex flex-col gap-2.5">
        {history.messages.map((message) => (
          <Bubble key={message.id} message={message} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Un message archivé. Le texte du coach est rendu tel quel, retours à la ligne
 * compris (`whitespace-pre-line`) : le prompt lui demandait du texte simple, pas
 * du markdown.
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
