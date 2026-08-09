/**
 * Bloc « Quotas journaliers » (SPEC §5 quater) : les quatre limites qui étaient
 * des constantes du code deviennent des réglages.
 *
 * Deux choses que l'écran doit dire, et qu'un formulaire nu ne dirait pas :
 *
 * - **ce que chaque quota mesure.** Les deux premiers comptent des appels sur
 *   la clé de la plateforme — un utilisateur qui a apporté la sienne n'est pas
 *   concerné. Les deux derniers protègent des tiers (kovaaks.com, HenrikDev) qui
 *   peuvent nous bannir, et s'appliquent donc à tout le monde ;
 * - **que zéro est un réglage.** Mettre 0 ferme la fonctionnalité pour tous, du
 *   jour au lendemain, sans déploiement. C'est utile ; ce n'est pas une erreur
 *   de saisie, et l'écran ne doit pas le refuser en douce.
 *
 * Les quatre champs voyagent ensemble dans un seul enregistrement : le contrat
 * les demande d'un bloc, et un envoi partiel laisserait croire qu'on peut
 * régler l'un sans confirmer les autres.
 */

import { type FormEvent, useState } from "react";
import { type AdminLimits, QUOTA_MAX, QUOTA_MIN } from "../../shared/admin-contract";
import { CONTROL_CLASSES, PRIMARY_BUTTON } from "../components/controls";
import { Feedback, type PanelProps, Section, useSave } from "./panel";

interface QuotaField {
  readonly name: keyof AdminLimits;
  readonly label: string;
  readonly hint: string;
}

const FIELDS: readonly QuotaField[] = [
  {
    name: "coachDaily",
    label: "Debriefs / jour",
    hint: "Sur la clé de la plateforme. Les clés personnelles ne sont pas comptées.",
  },
  {
    name: "routineDaily",
    label: "Routines / jour",
    hint: "Même règle que les debriefs.",
  },
  {
    name: "kovaaksImportDaily",
    label: "Imports KovaaK's / jour",
    hint: "Protège kovaaks.com d'un martèlement depuis notre IP. S'applique à tout le monde.",
  },
  {
    name: "riotLinkDaily",
    label: "Liaisons Riot / jour",
    hint: "Protège le quota HenrikDev. S'applique à tout le monde.",
  },
];

/** Le formulaire manipule des chaînes ; un champ vidé n'est pas un zéro. */
type Form = Readonly<Record<keyof AdminLimits, string>>;

function toForm(limits: AdminLimits): Form {
  return {
    coachDaily: String(limits.coachDaily),
    routineDaily: String(limits.routineDaily),
    kovaaksImportDaily: String(limits.kovaaksImportDaily),
    riotLinkDaily: String(limits.riotLinkDaily),
  };
}

/** Un entier dans les bornes, ou `null` — auquel cas on n'enregistre pas. */
function parseQuota(raw: string): number | null {
  const value = Number(raw.trim());

  if (raw.trim() === "" || !Number.isInteger(value)) return null;
  return value >= QUOTA_MIN && value <= QUOTA_MAX ? value : null;
}

export function QuotasPanel({ settings, onSaved }: PanelProps) {
  const [form, setForm] = useState<Form>(() => toForm(settings.limits));
  const { action, save, reset } = useSave(onSaved);

  const busy = action.kind === "saving";
  const parsed = {
    coachDaily: parseQuota(form.coachDaily),
    routineDaily: parseQuota(form.routineDaily),
    kovaaksImportDaily: parseQuota(form.kovaaksImportDaily),
    riotLinkDaily: parseQuota(form.riotLinkDaily),
  };
  const complete = Object.values(parsed).every((value) => value !== null);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!complete) return;

    await save(
      { limits: parsed as AdminLimits },
      "Quotas enregistrés. Ils s'appliquent au prochain appel de chaque utilisateur.",
    );
  }

  return (
    <Section
      title="Quotas journaliers"
      hint={`Les compteurs repartent chaque jour à minuit UTC. Zéro ferme la fonctionnalité pour tout le monde ; ${QUOTA_MAX} est le maximum accepté.`}
    >
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map((field) => {
            const invalid = parseQuota(form[field.name]) === null;

            return (
              <div key={field.name} className="flex flex-col gap-1.5">
                <label
                  htmlFor={`admin-quota-${field.name}`}
                  className="text-xs font-medium text-steel-200"
                >
                  {field.label}
                </label>
                <input
                  id={`admin-quota-${field.name}`}
                  type="number"
                  inputMode="numeric"
                  min={QUOTA_MIN}
                  max={QUOTA_MAX}
                  step={1}
                  value={form[field.name]}
                  disabled={busy}
                  aria-invalid={invalid}
                  aria-describedby={`admin-quota-${field.name}-hint`}
                  onChange={(event) => {
                    reset();
                    setForm((current) => ({ ...current, [field.name]: event.target.value }));
                  }}
                  className={CONTROL_CLASSES}
                />
                <p id={`admin-quota-${field.name}-hint`} className="text-[11px] text-steel-500">
                  {field.hint}
                </p>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
          <button type="submit" disabled={busy || !complete} className={PRIMARY_BUTTON}>
            {busy ? "Enregistrement…" : "Enregistrer les quotas"}
          </button>
          {!complete ? (
            <span className="text-[11px] text-steel-500">
              Quatre entiers entre {QUOTA_MIN} et {QUOTA_MAX} sont attendus.
            </span>
          ) : null}
        </div>

        <Feedback action={action} />
      </form>
    </Section>
  );
}
