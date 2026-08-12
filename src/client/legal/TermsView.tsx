/**
 * Conditions générales d'utilisation.
 *
 * Deux choses les gouvernent : le service est **gratuit et en bêta**, et il
 * s'appuie sur des modèles de langage. La première commande le régime de
 * responsabilité et de disponibilité, la seconde impose de dire clairement ce
 * que valent — et ce que ne valent pas — les textes produits par le coach.
 */

import { LEGAL_PUBLISHER } from "./documents";
import {
  LegalDocument,
  LegalList,
  LegalMail,
  LegalPageLink,
  LegalSection,
  LegalTerm,
} from "./LegalDocument";

export function TermsView() {
  return (
    <LegalDocument view="terms">
      {/* À faire relire par un juriste */}

      <p>
        Créer un compte sur AimForge vaut acceptation des présentes conditions. Elles décrivent ce
        que le service propose, ce qu'il attend de toi, et ce qu'il ne garantit pas. Elles se lisent
        avec la <LegalPageLink view="privacy">politique de confidentialité</LegalPageLink>, qui en
        fait partie intégrante.
      </p>

      <LegalSection title="1. Objet">
        <p>
          AimForge est un outil d'entraînement à la visée pour les jeux de tir compétitifs. Il
          permet d'enregistrer des scores de benchmark et d'en calculer l'énergie et le rang,
          d'importer des parties, et d'obtenir d'un modèle de langage des debriefs, des analyses de
          partie et des routines d'entraînement. Il est édité par {LEGAL_PUBLISHER}, personne
          physique, joignable à l'adresse <LegalMail />.
        </p>
      </LegalSection>

      <LegalSection title="2. Un service gratuit, en bêta">
        <p>
          L'accès est gratuit et sans contrepartie : ni abonnement, ni publicité, ni revente de
          données. Le service est en phase de bêta, ce qui n'est pas une formule de style — des
          fonctionnalités apparaissent, changent ou disparaissent, des barèmes sont ajustés, des
          erreurs sont possibles. L'éditeur peut faire évoluer, suspendre ou arrêter le service ; en
          cas d'arrêt définitif, il en informe les utilisateurs dans un délai raisonnable pour leur
          permettre de récupérer leurs données.
        </p>
      </LegalSection>

      <LegalSection title="3. Ton compte">
        <LegalList>
          <li>
            Un compte par personne, avec une adresse email valide dont tu disposes réellement.
          </li>
          <li>
            Les identifiants sont personnels : leur confidentialité t'incombe, et toute action
            réalisée depuis ton compte est réputée être la tienne. Préviens l'éditeur si tu penses
            qu'il est compromis.
          </li>
          <li>Le service n'est pas destiné aux personnes de moins de 15 ans.</li>
          <li>
            Les comptes de jeu que tu relies (Riot ID, pseudo KovaaK's) doivent être les tiens. Y
            rattacher le compte d'un tiers pour consulter ses parties n'est pas un usage prévu.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="4. Usage raisonnable des fonctions IA">
        <p>
          Chaque appel au coach, à l'analyse de partie ou au générateur de routine a un coût réel,
          payé par l'éditeur. Ces fonctions sont donc encadrées par des{" "}
          <LegalTerm>quotas journaliers</LegalTerm>, affichés dans l'application, dont l'éditeur
          ajuste la valeur selon la charge et le budget disponible. Les imports de parties sont
          limités de la même façon, l'API qui les fournit étant elle aussi partagée.
        </p>
        <p>
          Configurer ta propre clé d'API dans les réglages lève le quota AimForge : les appels
          partent alors chez ton fournisseur, à tes frais, sous ton propre contrat avec lui. Il te
          revient de garder cette clé valide et d'en surveiller la consommation.
        </p>
        <p>Est en revanche interdit, et peut justifier une suspension immédiate :</p>
        <LegalList>
          <li>
            contourner les quotas, par multiplication de comptes, automatisation des requêtes ou
            tout autre moyen ;
          </li>
          <li>
            utiliser le service comme passerelle vers un modèle de langage pour des usages étrangers
            à l'entraînement au jeu ;
          </li>
          <li>
            soumettre des contenus illicites, injurieux, ou des données personnelles de tiers ;
          </li>
          <li>
            tenter d'accéder aux données d'un autre compte, sonder l'infrastructure, ou dégrader la
            disponibilité du service.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection title="5. Ce que produit le coach">
        <p>
          Les debriefs, analyses et routines sont générés par un modèle de langage à partir de ce
          que tu fournis. Ils peuvent être approximatifs, incomplets ou tout simplement faux. Ce
          sont des suggestions d'entraînement, jamais des instructions : le jugement final
          t'appartient. Aucun résultat, aucune progression et aucun rang ne sont garantis.
        </p>
        <p>
          Ces contenus ne constituent ni un avis médical, ni un conseil de santé. L'entraînement à
          la visée sollicite le poignet, l'épaule et les yeux : en cas de douleur, arrête et
          consulte un professionnel de santé — pas un modèle de langage.
        </p>
      </LegalSection>

      <LegalSection title="6. Tes contenus, et ceux du service">
        <p>
          Tes scores, tes textes et tes données d'entraînement restent les tiens. Tu accordes
          simplement à l'éditeur le droit de les stocker et de les traiter dans la seule mesure
          nécessaire au fonctionnement des fonctionnalités que tu utilises, conformément à la{" "}
          <LegalPageLink view="privacy">politique de confidentialité</LegalPageLink>.
        </p>
        <p>
          Le code, l'interface, les textes et l'identité visuelle d'AimForge appartiennent à
          l'éditeur. Les barèmes de benchmark affichés proviennent de leurs auteurs respectifs et
          sont cités en tant que tels ; les marques mentionnées appartiennent à leurs titulaires,
          comme le rappellent les <LegalPageLink view="legal">mentions légales</LegalPageLink>.
        </p>
      </LegalSection>

      <LegalSection title="7. Disponibilité et responsabilité">
        <p>
          Le service est fourni « en l'état », sans garantie de disponibilité, de continuité,
          d'absence d'erreur ni d'intégrité des données. Il dépend de prestataires tiers
          (hébergement, base de données, fournisseurs d'IA, API de données de jeu) dont les
          interruptions lui échappent, et une perte de données reste possible malgré le soin apporté
          : conserve une copie de ce à quoi tu tiens.
        </p>
        <p>
          Le service étant gratuit, la responsabilité de l'éditeur est limitée, dans les conditions
          permises par la loi, aux dommages directs résultant d'une faute prouvée. Sont exclus les
          dommages indirects, notamment la perte de données, de temps de jeu ou de classement. Rien
          ici n'écarte la responsabilité qui ne peut pas l'être en droit français, notamment en cas
          de dol ou de faute lourde.
        </p>
      </LegalSection>

      <LegalSection title="8. Fin de la relation">
        <p>
          Tu peux cesser d'utiliser le service à tout moment et demander la suppression de ton
          compte, qui entraîne celle de toutes tes données. L'éditeur peut suspendre ou supprimer un
          compte en cas de manquement aux présentes conditions, après information de l'intéressé
          sauf urgence ou illicéité manifeste.
        </p>
      </LegalSection>

      <LegalSection title="9. Modification des conditions">
        <p>
          Ces conditions peuvent être modifiées, notamment pour suivre l'évolution du service. La
          date de mise à jour en tête de page fait foi. En cas de changement substantiel,
          l'information est portée à ta connaissance dans l'application ; continuer à utiliser le
          service après cette information vaut acceptation.
        </p>
      </LegalSection>

      <LegalSection title="10. Droit applicable et litiges">
        <p>
          Les présentes conditions sont soumises au droit français. En cas de difficulté, écris
          d'abord à <LegalMail /> : la très grande majorité des différends se règle ainsi. À défaut
          d'accord amiable, le litige relève des juridictions françaises compétentes, sans préjudice
          des règles protectrices dont tu bénéficies en tant que consommateur, qui te permettent de
          saisir la juridiction de ton lieu de résidence.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
