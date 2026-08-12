/**
 * Mentions légales.
 *
 * Le fichier s'appelle `LegalNoticeView` et non `NoticeView` : `Notice` est
 * déjà le composant d'encart de `components/`, et deux « Notice » dans le même
 * projet finiraient par se croiser dans un import.
 *
 * Les coordonnées postales des hébergeurs ne sont volontairement pas recopiées
 * ici : elles changent, et une adresse fausse vaut moins qu'un renvoi exact au
 * site de l'hébergeur. À trancher à la relecture juridique.
 */

import { LEGAL_PUBLISHER } from "./documents";
import {
  LegalDocument,
  LegalLink,
  LegalList,
  LegalMail,
  LegalPageLink,
  LegalSection,
  LegalTerm,
} from "./LegalDocument";

export function LegalNoticeView() {
  return (
    <LegalDocument view="legal">
      {/* À faire relire par un juriste */}

      <LegalSection title="Éditeur">
        <p>
          AimForge est édité à titre personnel et non professionnel par {LEGAL_PUBLISHER}, personne
          physique résidant en France, également directeur de la publication. Contact :{" "}
          <LegalMail />.
        </p>
        <p>
          L'adresse postale n'est pas publiée sur ce site : l'éditeur est un particulier, et la loi
          pour la confiance dans l'économie numérique lui permet de la réserver. Elle est détenue
          par l'hébergeur et communiquée sur demande légitime, notamment à une autorité ou dans le
          cadre d'une procédure.
        </p>
      </LegalSection>

      <LegalSection title="Hébergement">
        <LegalList>
          <li>
            <LegalTerm>Site et fonctions serveur</LegalTerm> — Vercel Inc., États-Unis,{" "}
            <LegalLink href="https://vercel.com">vercel.com</LegalLink>.
          </li>
          <li>
            <LegalTerm>Base de données et authentification</LegalTerm> — Supabase, Inc., États-Unis,{" "}
            <LegalLink href="https://supabase.com">supabase.com</LegalLink>.
          </li>
        </LegalList>
        <p>
          Les coordonnées complètes de ces sociétés figurent sur leurs sites respectifs. Le
          traitement des données personnelles qu'implique cet hébergement est décrit dans la{" "}
          <LegalPageLink view="privacy">politique de confidentialité</LegalPageLink>.
        </p>
      </LegalSection>

      <LegalSection title="Marques et contenus de tiers">
        <p>
          AimForge est un projet indépendant. Il n'est affilié, sponsorisé, approuvé ni soutenu par
          aucun des éditeurs, studios ou organisations cités ci-dessous, qui restent seuls
          titulaires de leurs marques et de leurs contenus.
        </p>
        <LegalList>
          <li>
            <LegalTerm>KovaaK's</LegalTerm> — marque de son éditeur. Les noms de scénarios sont
            cités pour permettre de retrouver l'exercice correspondant dans le jeu.
          </li>
          <li>
            <LegalTerm>Voltaic</LegalTerm> — les benchmarks Voltaic, leurs seuils et leurs noms de
            rangs sont l'œuvre de Voltaic. AimForge les affiche tels que leur auteur les publie, en
            citant la version et sa date, et n'en modifie aucune valeur.
          </li>
          <li>
            <LegalTerm>Viscose</LegalTerm> — de la même façon, pour les benchmarks Viscose.
          </li>
          <li>
            <LegalTerm>Valorant</LegalTerm> et <LegalTerm>Riot Games</LegalTerm> — Valorant © Riot
            Games, Inc. AimForge n'est pas approuvé par Riot Games et ne reflète pas les opinions ou
            les positions de Riot Games ni de quiconque participe officiellement à la production ou
            à la gestion des propriétés de Riot Games.
          </li>
          <li>
            <LegalTerm>HenrikDev</LegalTerm> — les données de parties Valorant proviennent d'une API
            communautaire, non officielle et indépendante de Riot Games.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="Propriété intellectuelle">
        <p>
          Hors éléments appartenant à des tiers, le code, l'interface, les textes et l'identité
          visuelle d'AimForge sont la propriété de l'éditeur. Toute reproduction ou réutilisation
          sans autorisation est interdite. Les données que tu saisis, elles, restent les tiennes.
        </p>
      </LegalSection>

      <LegalSection title="Signalement">
        <p>
          Un contenu te semble illicite, une marque mal citée, une donnée personnelle indûment
          publiée ? Écris à <LegalMail /> en décrivant le contenu et son emplacement : le
          signalement sera traité dans les meilleurs délais.
        </p>
      </LegalSection>

      <LegalSection title="Documents liés">
        <p>
          <LegalPageLink view="privacy">Politique de confidentialité</LegalPageLink> ·{" "}
          <LegalPageLink view="terms">Conditions générales d'utilisation</LegalPageLink>
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
