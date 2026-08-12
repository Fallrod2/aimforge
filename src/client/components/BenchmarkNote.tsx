/**
 * Le statut du barème en une ligne : « Barème Voltaic S5 · BETA · version du
 * 8 août 2026 ».
 *
 * Elle remplace les mentions « seuils officiels » écrites en dur dans l'app.
 * La différence n'est pas cosmétique : « officiel » ne dit ni **quel** barème,
 * ni dans quel état son éditeur le publie, ni de quand datent les seuils. Or les
 * trois comptent — Voltaic publie sa Season 5 en BETA, et un joueur qui voit ses
 * énergies bouger a le droit de savoir si c'est lui qui a changé ou le barème.
 *
 * Tout vient du registre (`listBenchmarks`/`getBenchmark`) : aucun de ces mots
 * n'est écrit deux fois dans le code.
 */

import type { BenchmarkDefinition } from "../../lib/energy";
import { formatDataVersion } from "../format";

interface BenchmarkNoteProps {
  readonly benchmark: BenchmarkDefinition;
  /** Ajoute le lien vers le document source de l'éditeur. */
  readonly withSource?: boolean;
}

/** Le badge d'état, affiché seulement quand l'état mérite d'être signalé. */
export function BenchmarkStatusBadge({ benchmark }: { readonly benchmark: BenchmarkDefinition }) {
  // `stable` ne s'affiche pas : un badge sur tous les benchmarks ne distingue
  // plus rien. `incomplete` n'arrive jamais ici (la lib ne le propose pas), mais
  // s'il arrivait, le dire vaut mieux que de le taire.
  if (benchmark.status === "stable") return null;

  return (
    <span className="shrink-0 rounded-full border border-quench-500/50 bg-quench-500/10 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-quench-500 uppercase">
      {benchmark.status === "beta" ? "Beta" : "Incomplet"}
    </span>
  );
}

export function BenchmarkNote({ benchmark, withSource = false }: BenchmarkNoteProps) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-steel-500">
      <span>Barème {benchmark.name}</span>
      <BenchmarkStatusBadge benchmark={benchmark} />
      <span>· version du {formatDataVersion(benchmark.dataVersion)}</span>
      {withSource ? (
        <a
          href={benchmark.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
          className="underline underline-offset-2 transition-colors hover:text-steel-300"
        >
          · source {benchmark.publisher}
        </a>
      ) : null}
    </p>
  );
}
