/**
 * Le sélecteur de benchmark : une section de la page Profil, un select, aucun
 * écran dédié.
 *
 * Il se rend **même quand il n'y a qu'un choix**, désactivé. Un sélecteur absent
 * laisserait croire que l'application *est* Voltaic S5 ; un sélecteur présent et
 * désactivé dit l'inverse — le barème est un choix, il n'y en a simplement qu'un
 * pour l'instant. Il porte aussi ce que le nom seul ne dit pas : l'éditeur,
 * l'état de publication (Voltaic publie sa S5 en BETA), la date des seuils et le
 * lien vers le document source.
 *
 * Les benchmarks `incomplete` n'y figurent pas : `listBenchmarks()` les écarte
 * déjà — ils existent pour être travaillés, pas pour qu'on y enregistre des
 * passes relues avec des seuils partiels.
 *
 * L'écriture ne passe pas par le formulaire du profil : elle part au clic, par
 * le provider (`useActiveBenchmark`), parce que tout l'écran suit ce réglage en
 * direct. Il vit dans son propre module pour être rendu — et vérifié — sans
 * monter la page entière.
 */

import { listBenchmarks, toBenchmarkId } from "../../lib/energy";
import { useActiveBenchmark } from "../app/active-benchmark";
import { BenchmarkStatusBadge } from "../components/BenchmarkNote";
import { formatDataVersion } from "../format";

export function BenchmarkSection() {
  const { benchmarkId, setBenchmarkId, saving, error } = useActiveBenchmark();
  const options = listBenchmarks();
  const alone = options.length <= 1;
  const current = options.find((benchmark) => benchmark.id === benchmarkId) ?? options[0];

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-steel-100">Benchmark</h2>
        <p className="mt-1 text-xs text-steel-500">
          Le barème dans lequel tu saisis, et avec lequel l'historique se relit. Les passes déjà
          enregistrées gardent le leur : en changer ne réécrit aucun chiffre.
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="profile-benchmark" className="text-xs font-medium text-steel-200">
          Barème actif
        </label>
        <select
          id="profile-benchmark"
          value={benchmarkId}
          disabled={alone || saving}
          onChange={(event) => setBenchmarkId(toBenchmarkId(event.target.value))}
          aria-describedby="profile-benchmark-hint"
          className="w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors hover:border-steel-600 focus:border-ember-500 focus:outline-none disabled:opacity-60"
        >
          {options.map((benchmark) => (
            <option key={benchmark.id} value={benchmark.id}>
              {benchmark.name} — {benchmark.publisher}
            </option>
          ))}
        </select>

        {current === undefined ? null : (
          <p
            id="profile-benchmark-hint"
            className="flex flex-wrap items-center gap-1.5 text-[11px] text-steel-500"
          >
            <span>{current.publisher}</span>
            <BenchmarkStatusBadge benchmark={current} />
            <span>· seuils du {formatDataVersion(current.dataVersion)}</span>
            <a
              href={current.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="underline underline-offset-2 transition-colors hover:text-steel-300"
            >
              · document source
            </a>
          </p>
        )}

        {alone ? (
          <p className="text-[11px] text-steel-600">D'autres benchmarks arriveront.</p>
        ) : null}
        {error !== null ? (
          <p aria-live="polite" className="text-[11px] text-ember-400">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
