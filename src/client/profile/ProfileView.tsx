/**
 * Page Profil : le contexte joueur que le coach et la routine réutilisent, et
 * les deux préférences qui décident du vocabulaire et des seuils.
 *
 * Un formulaire, pas une fiche : rien n'est enregistré tant que le bouton n'a
 * pas été pressé. Les champs sont libres (aucune liste de rangs figée) parce
 * que le classement change de nom entre les saisons — et, depuis la couche jeu
 * (DECISIONS.md D7), parce qu'ils doivent accueillir cinq échelles différentes.
 *
 * Un champ vidé s'efface en base (`null`) : l'enregistrement remplace, il ne
 * fusionne pas. C'est la seule règle qui rende l'écran prévisible — ce qui est
 * affiché est ce qui sera stocké.
 *
 * Deux choses ne suivent pas cette règle, et c'est délibéré :
 *
 * - **le jeu** fait partie du formulaire (il change les libellés des autres
 *   champs, donc il se relit avec eux) mais ne change **aucune** colonne :
 *   `rang_valorant`, `main_agent` et `notes_maps` gardent leurs noms, seuls les
 *   mots affichés viennent de `game-vocab.ts` ;
 * - **le benchmark actif** s'écrit à part, au clic, via le provider
 *   (`useActiveBenchmark`) : c'est une préférence que tout l'écran suit en
 *   direct, pas une valeur qu'on enregistre en bloc avec un pseudo.
 */

import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { type GameId, gameVocab, listGameVocabs, toGameId } from "../../shared/game-vocab";
import { useAuth } from "../auth/AuthProvider";
import { Notice } from "../components/Notice";
import { getProfile, type Profile, type ProfileInput, updateProfile } from "../data";
import { LinkedAccountsPanel } from "../linked/LinkedAccountsPanel";
import { useLinkedAccounts } from "../linked/useLinkedAccounts";
import { AiSettingsPanel } from "../settings/AiSettingsPanel";
import { BenchmarkSection } from "./BenchmarkSection";

/** Le formulaire manipule des chaînes ; `null` et `""` n'y sont pas distincts. */
type TextField = "pseudo" | "rangValorant" | "peak" | "mainAgent" | "objectif" | "notesMaps";

interface ProfileForm extends Readonly<Record<TextField, string>> {
  readonly game: GameId;
}

interface FieldSpec {
  readonly name: TextField;
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
  readonly multiline?: boolean;
}

const TEXT_FIELDS: readonly TextField[] = [
  "pseudo",
  "rangValorant",
  "peak",
  "mainAgent",
  "objectif",
  "notesMaps",
];

/**
 * Les six champs libres, **dits dans les mots du jeu choisi**.
 *
 * Ce ne sont donc plus une constante de module : « Agent principal » n'a aucun
 * sens pour un joueur d'Apex, et l'exemple « Ascendant 2 » lui apprendrait une
 * graduation qui n'existe pas chez lui.
 */
export function fieldsFor(game: GameId): readonly FieldSpec[] {
  const vocab = gameVocab(game);

  return [
    {
      name: "pseudo",
      label: "Pseudo",
      hint: "Le nom sous lequel tu joues.",
      placeholder: "Ton identifiant en jeu",
    },
    { name: "rangValorant", ...vocab.rank },
    { name: "peak", ...vocab.peak },
    { name: "mainAgent", ...vocab.main },
    {
      name: "objectif",
      label: "Objectif de saison",
      hint: "Ce que tu veux atteindre : le coach s'y réfère.",
      placeholder: "Monter d'un rang avant la fin de l'acte",
      multiline: true,
    },
    {
      name: "notesMaps",
      label: "Notes de maps",
      hint: "Maps ou situations qui te posent problème.",
      placeholder: "Prises de duel longue distance, entrées en site…",
      multiline: true,
    },
  ];
}

const EMPTY_FORM: ProfileForm = {
  pseudo: "",
  rangValorant: "",
  peak: "",
  mainAgent: "",
  objectif: "",
  notesMaps: "",
  game: "valorant",
};

function toForm(profile: Profile): ProfileForm {
  return {
    pseudo: profile.pseudo ?? "",
    rangValorant: profile.rangValorant ?? "",
    peak: profile.peak ?? "",
    mainAgent: profile.mainAgent ?? "",
    objectif: profile.objectif ?? "",
    notesMaps: profile.notesMaps ?? "",
    game: profile.game,
  };
}

/** Une chaîne vide vaut « pas renseigné » : on écrit `null`, pas `""`. */
function blankToNull(value: string): string | null {
  const trimmed = value.trim();

  return trimmed === "" ? null : trimmed;
}

function toProfileInput(form: ProfileForm): ProfileInput {
  return {
    pseudo: blankToNull(form.pseudo),
    rangValorant: blankToNull(form.rangValorant),
    peak: blankToNull(form.peak),
    mainAgent: blankToNull(form.mainAgent),
    objectif: blankToNull(form.objectif),
    notesMaps: blankToNull(form.notesMaps),
    game: form.game,
  };
}

type Load =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready" };

function failureMessage(cause: unknown, fallback: string): string {
  return cause instanceof Error ? cause.message : fallback;
}

export function ProfileView() {
  const { user } = useAuth();
  // Les comptes liés se chargent en parallèle du profil : l'un ne doit pas
  // retarder l'autre, et une base injoignable ne doit pas vider les deux.
  const linked = useLinkedAccounts();
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [form, setForm] = useState<ProfileForm>(EMPTY_FORM);
  /** La dernière version connue de la base : sert à détecter les modifications. */
  const [stored, setStored] = useState<ProfileForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const fields = useMemo(() => fieldsFor(form.game), [form.game]);

  const reload = useCallback(async () => {
    setLoad({ status: "loading" });
    setSaveError(null);
    setSaved(false);
    try {
      const next = toForm(await getProfile());

      setForm(next);
      setStored(next);
      setLoad({ status: "ready" });
    } catch (cause) {
      setLoad({
        status: "error",
        message: failureMessage(cause, "Le profil n'a pas pu être chargé."),
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty =
    form.game !== stored.game || TEXT_FIELDS.some((name) => form[name] !== stored[name]);

  function change(name: TextField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setSaved(false);
      setForm((current) => ({ ...current, [name]: event.target.value }));
    };
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      // On repart de la ligne relue par la base, pas du formulaire : ce qui
      // s'affiche après l'enregistrement est ce qui est réellement stocké
      // (une valeur nettoyée par `blankToNull` se voit tout de suite).
      const next = toForm(await updateProfile(toProfileInput(form)));

      setForm(next);
      setStored(next);
      setSaved(true);
    } catch (cause) {
      setSaveError(failureMessage(cause, "L'enregistrement a échoué."));
    } finally {
      setSaving(false);
    }
  }

  // Le profil et les comptes liés sont deux blocs indépendants de la même page :
  // un profil qui ne charge pas ne doit pas emporter la gestion des comptes,
  // qui est justement ce qu'on vient faire ici la première fois.
  if (load.status !== "ready") {
    return (
      <div className="flex max-w-2xl flex-col gap-8">
        {load.status === "loading" ? (
          <Notice tone="loading" title="Chargement du profil…" />
        ) : (
          <Notice
            tone="error"
            title="Le profil n'a pas pu être chargé."
            onRetry={() => void reload()}
          >
            {load.message}
          </Notice>
        )}
        <BenchmarkSection />
        <LinkedAccountsPanel state={linked.state} reload={linked.reload} />
        <AiSettingsPanel />
      </div>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8">
      <section className="flex flex-col gap-6">
        <div>
          <h2 className="text-lg font-semibold text-steel-100">Profil</h2>
          <p className="mt-1 text-xs text-steel-500">
            {user?.email ?? "Compte connecté"} · ce contexte alimentera le coach et la routine.
          </p>
        </div>

        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-5">
          <div className="grid gap-5 sm:grid-cols-2">
            <GameField
              value={form.game}
              disabled={saving}
              onChange={(game) => {
                setSaved(false);
                setForm((current) => ({ ...current, game }));
              }}
            />
            {fields.map((field) => (
              <Field
                key={field.name}
                spec={field}
                value={form[field.name]}
                disabled={saving}
                onChange={change(field.name)}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-steel-800 pt-4">
            <button
              type="submit"
              disabled={saving || !dirty}
              className="rounded-lg bg-brand-fill px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-fill-hover disabled:cursor-not-allowed disabled:bg-steel-800 disabled:text-steel-500"
            >
              {saving ? "Enregistrement…" : "Enregistrer"}
            </button>
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => {
                setForm(stored);
                setSaved(false);
                setSaveError(null);
              }}
              className="rounded-lg border border-steel-700 px-4 py-2.5 text-xs font-medium text-steel-300 transition-colors hover:border-steel-600 hover:text-steel-100 disabled:cursor-not-allowed disabled:text-steel-500"
            >
              Annuler les modifications
            </button>

            <p aria-live="polite" className="text-xs">
              {saveError !== null ? (
                <span className="text-ember-400">{saveError}</span>
              ) : saved ? (
                <span className="text-steel-400">Profil enregistré.</span>
              ) : null}
            </p>
          </div>
        </form>
      </section>

      <BenchmarkSection />
      <LinkedAccountsPanel state={linked.state} reload={linked.reload} />
      <AiSettingsPanel />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Champs                                                              */
/* ------------------------------------------------------------------ */

interface GameFieldProps {
  readonly value: GameId;
  readonly disabled: boolean;
  readonly onChange: (game: GameId) => void;
}

/**
 * Le jeu principal.
 *
 * Il ne pilote que du vocabulaire (DECISIONS.md D7) : les libellés et les
 * exemples des champs voisins, et la phrase d'identité des prompts du coach.
 * Aucune colonne, aucun écran, aucun calcul n'en dépend — d'où sa place dans le
 * formulaire ordinaire plutôt que dans une section à part.
 */
function GameField({ value, disabled, onChange }: GameFieldProps) {
  const vocabs = listGameVocabs();

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="profile-game" className="text-xs font-medium text-steel-200">
        Jeu principal
      </label>
      <select
        id="profile-game"
        value={value}
        disabled={disabled}
        aria-describedby="profile-game-hint"
        onChange={(event) => onChange(toGameId(event.target.value))}
        className={CONTROL_CLASSES}
      >
        {vocabs.map((vocab) => (
          <option key={vocab.id} value={vocab.id}>
            {vocab.label}
          </option>
        ))}
      </select>
      <p id="profile-game-hint" className="text-[11px] text-steel-500">
        Il choisit les mots : les libellés ci-dessous et la façon dont le coach te parle.
      </p>
    </div>
  );
}

interface FieldProps {
  readonly spec: FieldSpec;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
}

const CONTROL_CLASSES =
  "w-full rounded-md border border-steel-700 bg-steel-800 px-3 py-2.5 text-sm text-steel-100 transition-colors placeholder:text-steel-400 hover:border-steel-600 focus:border-ember-500 disabled:opacity-60";

function Field({ spec, value, disabled, onChange }: FieldProps) {
  const id = `profile-${spec.name}`;
  const hintId = `${id}-hint`;

  return (
    <div className={`flex flex-col gap-1.5 ${spec.multiline ? "sm:col-span-2" : ""}`}>
      <label htmlFor={id} className="text-xs font-medium text-steel-200">
        {spec.label}
      </label>
      {spec.multiline ? (
        <textarea
          id={id}
          rows={3}
          value={value}
          disabled={disabled}
          placeholder={spec.placeholder}
          aria-describedby={hintId}
          onChange={onChange}
          className={`${CONTROL_CLASSES} resize-y`}
        />
      ) : (
        <input
          id={id}
          type="text"
          autoComplete="off"
          value={value}
          disabled={disabled}
          placeholder={spec.placeholder}
          aria-describedby={hintId}
          onChange={onChange}
          className={CONTROL_CLASSES}
        />
      )}
      <p id={hintId} className="text-[11px] text-steel-500">
        {spec.hint}
      </p>
    </div>
  );
}
