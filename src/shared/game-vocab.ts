/**
 * Le vocabulaire d'un jeu — et rien d'autre (DECISIONS.md D7).
 *
 * `profiles.game` ne pilote aucune logique : ni écran, ni calcul, ni seuil. Il
 * pilote des **mots**. Un joueur d'Apex n'a pas d'« agent principal », il a une
 * légende ; un coach qui lui parle « de Valorant » perd sa crédibilité à la
 * première phrase. Tout ce que le jeu change tient donc dans ce module : les
 * libellés et les exemples du formulaire de profil, et la phrase d'identité des
 * cinq prompts serveur.
 *
 * Deux règles qui expliquent la forme du fichier :
 *
 * 1. **Les colonnes de la base ne bougent pas.** `rang_valorant`, `main_agent`
 *    et `notes_maps` gardent leurs noms : ce sont des champs libres, et les
 *    renommer coûterait une migration pour un gain nul. Seul le vocabulaire
 *    *affiché* change (cf. `ProfileView`, `formatProfile`).
 * 2. **Aucune échelle de rang n'est inventée.** Les exemples ci-dessous sont
 *    pris sur les échelles publiques de chaque jeu. Là où l'échelle est
 *    incertaine ou n'a pas de forme courte évidente, l'exemple est neutre
 *    (« Ton rang actuel ») plutôt que faux.
 *
 * Module partagé client/serveur, pur : ni React, ni Supabase, ni Zod (la
 * validation de la valeur venue de la base vit à la frontière, `toGameId`).
 */

/**
 * Les jeux connus — miroir exact du `check` de `profiles.game`
 * (migration `0019`). Un ajout ici demande la migration correspondante.
 */
export const GAME_IDS = ["valorant", "cs2", "apex", "overwatch", "other"] as const;

export type GameId = (typeof GAME_IDS)[number];

/** Le jeu par défaut, comme le `default` de la colonne. */
export const DEFAULT_GAME: GameId = "valorant";

/** Ce qu'un champ libre du profil dit de lui-même, selon le jeu. */
export interface FieldVocab {
  readonly label: string;
  readonly hint: string;
  readonly placeholder: string;
}

/** Tout ce qu'un jeu change dans les mots de l'application. */
export interface GameVocab {
  readonly id: GameId;
  /** L'option du sélecteur de jeu (« Autre » pour `other`). */
  readonly label: string;
  /**
   * Le sujet de la phrase d'identité des prompts : « joueurs de Valorant »,
   * « joueurs d'Apex Legends ». La préposition fait partie de la chaîne — la
   * calculer demanderait une règle d'élision, et une règle d'élision se trompe.
   */
  readonly players: string;
  /**
   * Le complément du périmètre du coach : « Tu ne parles que de visée,
   * d'entraînement, {topic} et de la progression de ce joueur. »
   */
  readonly topic: string;
  readonly rank: FieldVocab;
  readonly peak: FieldVocab;
  /** Agent / légende / héros / rôle : le personnage joué, quel que soit son nom. */
  readonly main: FieldVocab;
  /** Le libellé du rang dans le bloc `<profil>` des prompts. */
  readonly promptRankLabel: string;
  /** Le libellé du personnage dans le bloc `<profil>` des prompts. */
  readonly promptMainLabel: string;
}

const VALORANT: GameVocab = {
  id: "valorant",
  label: "Valorant",
  players: "joueurs de Valorant",
  topic: "de Valorant",
  rank: {
    label: "Rang actuel",
    hint: "Ton classement compétitif du moment.",
    placeholder: "Ascendant 2",
  },
  peak: {
    label: "Peak",
    hint: "Le plus haut rang atteint, toutes saisons confondues.",
    placeholder: "Immortel 1",
  },
  main: {
    label: "Agent principal",
    hint: "Celui que tu joues le plus — il oriente les debriefs.",
    placeholder: "Jett",
  },
  promptRankLabel: "Rang Valorant actuel",
  promptMainLabel: "Agent principal",
};

const CS2: GameVocab = {
  id: "cs2",
  label: "Counter-Strike 2",
  players: "joueurs de Counter-Strike 2",
  topic: "de Counter-Strike 2",
  rank: {
    label: "Rang actuel",
    // Le Premier affiche un CS Rating à quatre ou cinq chiffres ; c'est le
    // classement que les joueurs citent entre eux depuis la sortie de CS2.
    hint: "Ton CS Rating en Premier, ou ton skill group en compétitif.",
    placeholder: "15 000",
  },
  peak: {
    label: "Peak",
    hint: "Le plus haut classement atteint, toutes saisons confondues.",
    placeholder: "18 200",
  },
  main: {
    label: "Rôle principal",
    hint: "Le poste que tu tiens le plus souvent — il oriente les debriefs.",
    placeholder: "AWP",
  },
  promptRankLabel: "Rang CS2 actuel",
  promptMainLabel: "Rôle principal",
};

const APEX: GameVocab = {
  id: "apex",
  label: "Apex Legends",
  players: "joueurs d'Apex Legends",
  topic: "d'Apex Legends",
  rank: {
    label: "Rang actuel",
    hint: "Ton classement compétitif du moment.",
    placeholder: "Platine 2",
  },
  peak: {
    label: "Peak",
    hint: "Le plus haut rang atteint, toutes saisons confondues.",
    placeholder: "Diamant 4",
  },
  main: {
    label: "Légende principale",
    hint: "Celle que tu joues le plus — elle oriente les debriefs.",
    placeholder: "Wraith",
  },
  promptRankLabel: "Rang Apex actuel",
  promptMainLabel: "Légende principale",
};

const OVERWATCH: GameVocab = {
  id: "overwatch",
  label: "Overwatch 2",
  players: "joueurs d'Overwatch 2",
  topic: "d'Overwatch 2",
  rank: {
    label: "Rang actuel",
    hint: "Ton classement compétitif du moment.",
    placeholder: "Diamant 3",
  },
  peak: {
    label: "Peak",
    hint: "Le plus haut rang atteint, toutes saisons confondues.",
    placeholder: "Maître 5",
  },
  main: {
    label: "Héros principal",
    hint: "Celui que tu joues le plus — il oriente les debriefs.",
    placeholder: "Ana",
  },
  promptRankLabel: "Rang Overwatch actuel",
  promptMainLabel: "Héros principal",
};

/**
 * Le repli : un jeu qu'on ne connaît pas.
 *
 * Aucun exemple de rang, aucun nom de personnage — on ne sait pas à quoi
 * ressemble l'échelle de ce jeu, et un exemple inventé apprendrait au joueur
 * une graduation qui n'existe pas. Le placeholder redit donc la question.
 */
const OTHER: GameVocab = {
  id: "other",
  label: "Autre",
  players: "joueurs de FPS",
  topic: "de ton jeu",
  rank: {
    label: "Rang actuel",
    hint: "Ton classement compétitif du moment, tel que ton jeu le nomme.",
    placeholder: "Ton rang actuel",
  },
  peak: {
    label: "Peak",
    hint: "Le plus haut rang atteint, toutes saisons confondues.",
    placeholder: "Ton meilleur rang",
  },
  main: {
    label: "Perso ou rôle principal",
    hint: "Ce que tu joues le plus — il oriente les debriefs.",
    placeholder: "Ton personnage ou ton rôle",
  },
  promptRankLabel: "Rang actuel",
  promptMainLabel: "Perso ou rôle principal",
};

const VOCABS: Readonly<Record<GameId, GameVocab>> = {
  valorant: VALORANT,
  cs2: CS2,
  apex: APEX,
  overwatch: OVERWATCH,
  other: OTHER,
};

/** Le vocabulaire d'un jeu. Total : `GameId` est une union fermée. */
export function gameVocab(game: GameId): GameVocab {
  return VOCABS[game];
}

/** Les vocabulaires, dans l'ordre du sélecteur (« Autre » en dernier). */
export function listGameVocabs(): readonly GameVocab[] {
  return GAME_IDS.map(gameVocab);
}

export function isGameId(value: string): value is GameId {
  return (GAME_IDS as readonly string[]).includes(value);
}

/**
 * Une valeur brute (colonne `profiles.game`) → un `GameId`.
 *
 * Repli sur le défaut plutôt que levée : le jeu ne décide que de mots. Un
 * profil qui refuserait de s'afficher parce que la colonne porte une valeur
 * inattendue coûterait bien plus cher que des libellés Valorant sur un joueur
 * de CS2.
 */
export function toGameId(value: string | null | undefined): GameId {
  return value !== null && value !== undefined && isGameId(value) ? value : DEFAULT_GAME;
}
