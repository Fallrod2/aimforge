/**
 * Bloc « Clé HenrikDev » (SPEC §5 quater) : la source des données Valorant,
 * tournée sans redéploiement.
 *
 * Un seul champ, et le même contrat que partout ailleurs dans ce projet — la
 * clé entre, elle ne ressort jamais. « Enregistrée » en indication de champ
 * n'est pas un masquage cosmétique : la base refuse de relire la colonne, même
 * à l'administrateur (privilèges de colonne, migration 0009).
 *
 * L'effacement est offert explicitement parce qu'il a un sens précis, et un
 * seul : revenir à `HENRIKDEV_API_KEY`. Ce n'est pas « supprimer la clé », c'est
 * « rendre la main à l'environnement ».
 */

import { type FormEvent, useState } from "react";
import { CONTROL_CLASSES, GHOST_BUTTON, PRIMARY_BUTTON } from "../components/controls";
import { Badge, Feedback, type PanelProps, Section, useSave } from "./panel";

export function HenrikKeyPanel({ settings, onSaved }: PanelProps) {
  const [key, setKey] = useState("");
  const { action, save, reset } = useSave(onSaved);

  const busy = action.kind === "saving";

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    await save(
      { henrikdevApiKey: key.trim() },
      "Clé HenrikDev enregistrée. Elle prend effet au prochain appel, sans redéploiement.",
    );
    setKey("");
  }

  async function clear(): Promise<void> {
    await save(
      { henrikdevApiKey: null },
      "Clé effacée : la plateforme retombe sur HENRIKDEV_API_KEY.",
    );
    setKey("");
  }

  return (
    <Section
      title="Clé HenrikDev"
      hint="Sert la liaison des comptes Riot et le rafraîchissement du rang. Sans elle, ces deux écrans se dégradent — le reste de l'application n'est pas touché."
      badge={<KeyBadge source={settings.henrikKeySource} />}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-henrik-key" className="text-xs font-medium text-steel-200">
            Clé d'API
          </label>
          <input
            id="admin-henrik-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={key}
            disabled={busy}
            placeholder={settings.hasHenrikKey ? "Enregistrée" : "Colle la clé HenrikDev"}
            aria-describedby="admin-henrik-key-hint"
            onChange={(event) => {
              reset();
              setKey(event.target.value);
            }}
            className={CONTROL_CLASSES}
          />
          <p id="admin-henrik-key-hint" className="text-[11px] text-steel-500">
            Depuis le portail développeur HenrikDev. Stockée côté serveur et jamais réaffichée :
            pour la changer, colle la nouvelle.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
          <button type="submit" disabled={busy || key.trim() === ""} className={PRIMARY_BUTTON}>
            {busy ? "Enregistrement…" : "Enregistrer"}
          </button>
          {settings.hasHenrikKey ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void clear()}
              className={GHOST_BUTTON}
            >
              Effacer et revenir à l'environnement
            </button>
          ) : null}
        </div>

        <Feedback action={action} />
      </form>
    </Section>
  );
}

function KeyBadge({ source }: { readonly source: PanelProps["settings"]["henrikKeySource"] }) {
  if (source === "database") return <Badge tone="ok">Configurée en base</Badge>;
  if (source === "environment") return <Badge tone="muted">Repli sur HENRIKDEV_API_KEY</Badge>;
  return <Badge tone="warn">Aucune clé : import Valorant hors service</Badge>;
}
