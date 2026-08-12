/**
 * Politique de confidentialité.
 *
 * Le texte décrit ce que le code fait réellement — les tables de `supabase/`,
 * les fonctions de `api/`, les sous-traitants effectivement appelés. Toute
 * modification du traitement (une table, un destinataire, une durée) se
 * répercute ici : un document qui décrit un autre logiciel ne protège personne.
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

export function PrivacyView() {
  return (
    <LegalDocument view="privacy">
      {/* À faire relire par un juriste */}

      <p>
        AimForge est un outil d'entraînement à la visée pour les jeux de tir compétitifs. Ce
        document explique quelles données personnelles le service traite, pourquoi, pendant combien
        de temps, et comment en reprendre le contrôle. Il est écrit pour être lu en entier : il est
        court.
      </p>

      <LegalSection title="1. Qui est responsable du traitement">
        <p>
          {LEGAL_PUBLISHER}, personne physique, éditeur d'AimForge. Contact : <LegalMail />.
          L'adresse postale n'est pas publiée, l'éditeur étant un particulier ; elle est communiquée
          sur demande légitime, notamment à une autorité ou dans le cadre d'une procédure. Aucun
          délégué à la protection des données n'a été désigné : ni la taille du service ni la nature
          des traitements ne l'imposent.
        </p>
      </LegalSection>

      <LegalSection title="2. Les données traitées">
        <LegalList>
          <li>
            <LegalTerm>Compte.</LegalTerm> Adresse email, identifiant technique, date de création.
            Le mot de passe est stocké haché par le service d'authentification et n'est jamais
            lisible, ni par toi ni par l'éditeur. En cas de connexion via Discord ou Google, seuls
            l'adresse email et l'identifiant de compte chez ce fournisseur sont reçus — aucun accès
            à tes contenus chez lui.
          </li>
          <li>
            <LegalTerm>Profil de jeu.</LegalTerm> Pseudo, rang, objectifs et notes que tu saisis,
            benchmark et jeu actifs.
          </li>
          <li>
            <LegalTerm>Comptes liés.</LegalTerm> Riot ID (« Nom#TAG », identifiant interne Riot et
            région) et pseudo KovaaK's, quand tu les relies. Ce sont des références publiques,
            jamais des identifiants de connexion : lier un compte ne donne à AimForge aucun accès à
            ce compte.
          </li>
          <li>
            <LegalTerm>Données d'entraînement.</LegalTerm> Scores de scénarios, passes de benchmark,
            énergie et rang calculés, historique de progression, parties importées et leurs
            statistiques (map, agent, K/D/A, rounds, résultat).
          </li>
          <li>
            <LegalTerm>Échanges avec le coach.</LegalTerm> Les textes que tu envoies (statistiques
            collées, questions), les debriefs, les analyses de partie et les routines produits,
            ainsi que le fil de conversation.
          </li>
          <li>
            <LegalTerm>Configuration IA personnelle.</LegalTerm> Le fournisseur choisi, le modèle,
            l'URL de base éventuelle et ta clé d'API. Cette clé est écrite mais jamais relue par le
            navigateur : la base de données en interdit techniquement la lecture côté client, et
            elle ne sert qu'aux fonctions serveur, pour appeler le fournisseur que tu as désigné.
          </li>
          <li>
            <LegalTerm>Compteurs d'usage.</LegalTerm> Le nombre d'appels IA et d'imports par jour,
            pour faire respecter les quotas.
          </li>
        </LegalList>
        <p>
          Aucun cookie publicitaire, aucun traceur tiers, aucune mesure d'audience. Le seul stockage
          déposé dans ton navigateur est celui de ta session d'authentification, strictement
          nécessaire au fonctionnement du service : il ne requiert pas de consentement préalable.
        </p>
      </LegalSection>

      <LegalSection title="3. Pourquoi, et sur quelle base légale">
        <LegalList>
          <li>
            Créer et tenir ton compte, afficher tes benchmarks, ton historique et tes parties —{" "}
            <em>exécution du contrat</em> formé par l'acceptation des conditions générales
            d'utilisation.
          </li>
          <li>
            Produire les debriefs, les analyses de partie et les routines —{" "}
            <em>exécution du contrat</em>. Cela implique l'envoi du contenu concerné au fournisseur
            d'IA (voir le point 4).
          </li>
          <li>
            Importer tes parties Valorant et tes scores KovaaK's depuis les comptes que tu relies —{" "}
            <em>exécution du contrat</em>.
          </li>
          <li>
            Faire respecter les quotas, prévenir les abus et maintenir la sécurité du service —{" "}
            <em>intérêt légitime</em> de l'éditeur à ce que le service reste disponible et
            supportable financièrement.
          </li>
          <li>
            Répondre à tes demandes, y compris l'exercice de tes droits — <em>intérêt légitime</em>{" "}
            et, le cas échéant, <em>obligation légale</em>.
          </li>
        </LegalList>
        <p>
          Aucune décision produisant des effets juridiques n'est prise de façon automatisée. Les
          suggestions du coach sont des recommandations d'entraînement, rien d'autre.
        </p>
      </LegalSection>

      <LegalSection title="4. Qui d'autre y a accès">
        <p>
          Les données ne sont ni vendues, ni louées, ni cédées, ni exploitées à des fins
          publicitaires. Elles sont traitées par les seuls prestataires nécessaires au
          fonctionnement du service :
        </p>
        <LegalList>
          <li>
            <LegalTerm>Supabase</LegalTerm> — base de données et authentification : c'est là que
            vivent ton compte et tes données (
            <LegalLink href="https://supabase.com/privacy">supabase.com/privacy</LegalLink>).
          </li>
          <li>
            <LegalTerm>Vercel</LegalTerm> — hébergement du site et des fonctions serveur, journaux
            techniques de fonctionnement (
            <LegalLink href="https://vercel.com/legal/privacy-policy">
              vercel.com/legal/privacy-policy
            </LegalLink>
            ).
          </li>
          <li>
            <LegalTerm>Le fournisseur d'IA que tu choisis</LegalTerm> — Anthropic, OpenRouter,
            Mistral ou tout service compatible OpenAI que tu configures. Le contenu envoyé au coach
            (tes statistiques, tes questions, un résumé de tes benchmarks et de tes parties) lui est
            transmis pour produire la réponse, et son traitement relève alors de ses propres
            conditions. Tant que tu n'as configuré aucun fournisseur, le service utilise la
            configuration par défaut de la plateforme.
          </li>
          <li>
            <LegalTerm>HenrikDev</LegalTerm> — API communautaire qui fournit les données de parties
            Valorant. Ton Riot ID lui est transmis pour récupérer tes propres parties.
          </li>
        </LegalList>
        <p>
          Ces prestataires peuvent traiter les données hors de l'Union européenne, notamment aux
          États-Unis. Leurs conditions prévoient les garanties correspondantes, en particulier les
          clauses contractuelles types de la Commission européenne.
        </p>
      </LegalSection>

      <LegalSection title="5. Combien de temps">
        <p>
          Tes données sont conservées tant que ton compte existe : c'est le principe d'un journal de
          progression, dont l'intérêt vient précisément de sa profondeur historique. Tu peux
          supprimer à tout moment une passe de bench, un debrief, une partie importée, un compte lié
          ou ta configuration IA — la suppression est immédiate et définitive.
        </p>
        <p>
          <LegalTerm>Supprimer le compte supprime tout, en cascade.</LegalTerm> Chaque ligne de la
          base est rattachée à ton compte ; quand celui-ci disparaît, elles partent avec lui —
          benchmarks, scores, debriefs, routines, fil du coach, parties importées, comptes liés, clé
          d'API, compteurs d'usage. Il n'y a ni corbeille, ni copie conservée « au cas où ». Seules
          les sauvegardes techniques des hébergeurs peuvent contenir des données résiduelles, le
          temps de leur propre cycle d'expiration.
        </p>
        <p>
          Tant que le bouton correspondant n'existe pas dans l'application, la suppression du compte
          s'obtient sur simple demande à l'adresse de contact. Elle est traitée sans condition et
          sans question.
        </p>
      </LegalSection>

      <LegalSection title="6. Tes droits">
        <p>
          Tu disposes des droits d'accès, de rectification, d'effacement, de limitation et
          d'opposition, ainsi que du droit à la portabilité de tes données et du droit de définir
          des directives sur leur sort après ton décès. Une bonne part s'exerce directement dans
          l'application : la page Profil affiche et corrige tes informations, l'historique se
          supprime ligne par ligne, la configuration IA s'efface d'un bouton.
        </p>
        <p>
          Pour tout le reste, écris à <LegalMail /> : la réponse intervient dans un délai d'un mois.
          Si elle ne te satisfait pas, tu peux adresser une réclamation à la Commission nationale de
          l'informatique et des libertés (CNIL), 3 place de Fontenoy, TSA 80715, 75334 Paris Cedex
          07 — <LegalLink href="https://www.cnil.fr">www.cnil.fr</LegalLink>.
        </p>
      </LegalSection>

      <LegalSection title="7. Sécurité">
        <p>
          L'accès aux données est cloisonné dans la base elle-même : chaque compte ne peut lire et
          écrire que ses propres lignes, y compris si l'on interroge la base directement, sans
          passer par l'application. Les clés serveur ne sont jamais envoyées au navigateur, ta clé
          d'API personnelle n'est jamais réaffichée après sa saisie, et les échanges sont chiffrés
          en transit.
        </p>
        <p>
          Aucun système n'est infaillible. En cas de violation de données susceptible d'engendrer un
          risque pour tes droits, tu en seras informé et la CNIL notifiée, conformément au RGPD.
        </p>
      </LegalSection>

      <LegalSection title="8. Âge minimum">
        <p>
          Le service n'est pas destiné aux moins de 15 ans et ne collecte pas sciemment leurs
          données. Si un compte a été créé par une personne plus jeune, écris à l'adresse de contact
          : il sera supprimé.
        </p>
      </LegalSection>

      <LegalSection title="9. Évolution de ce document">
        <p>
          Ce document peut changer, notamment si le service ajoute une fonctionnalité ou un
          prestataire. La date de mise à jour en tête de page fait foi ; en cas de modification
          substantielle, l'information est portée à ta connaissance dans l'application. Les{" "}
          <LegalPageLink view="terms">conditions générales d'utilisation</LegalPageLink> complètent
          ce texte.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
