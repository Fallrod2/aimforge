/**
 * La mise en page commune aux trois documents légaux : un titre, une date de
 * mise à jour, et du texte en colonne étroite.
 *
 * Elle ne porte aucun contenu — chaque page apporte le sien. Ce qui vit ici
 * est ce qui doit rester identique d'un document à l'autre : la largeur de
 * lecture (une soixantaine de caractères), la hiérarchie des titres, et la
 * date, qui vient d'une constante partagée plutôt que d'une saisie par page.
 */

import type { ReactNode } from "react";
import type { LegalViewId } from "../route";
import { LEGAL_CONTACT_EMAIL, LEGAL_TITLES, LEGAL_UPDATED_AT, legalHash } from "./documents";

interface LegalDocumentProps {
  readonly view: LegalViewId;
  readonly children: ReactNode;
}

export function LegalDocument({ view, children }: LegalDocumentProps) {
  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-8 text-sm leading-relaxed text-steel-300">
      <header className="border-b border-steel-800 pb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-steel-100 sm:text-3xl">
          {LEGAL_TITLES[view]}
        </h1>
        <p className="mt-2 text-xs text-steel-500">Dernière mise à jour : {LEGAL_UPDATED_AT}</p>
      </header>
      {children}
    </article>
  );
}

interface LegalSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}

/** Une section numérotée par le navigateur, pas par nous : un titre, du texte. */
export function LegalSection({ title, children }: LegalSectionProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold tracking-tight text-steel-100">{title}</h2>
      {children}
    </section>
  );
}

/** Une liste à puces, au style unique des trois documents. */
export function LegalList({ children }: { readonly children: ReactNode }) {
  return <ul className="flex list-disc flex-col gap-2 pl-5 marker:text-steel-500">{children}</ul>;
}

/** L'allure d'un lien dans un document légal : souligné, jamais coloré en accent. */
const LINK_CLASS =
  "text-steel-200 underline underline-offset-4 transition-colors hover:text-ember-400";

/** Un lien externe : toujours nouvel onglet, toujours `noreferrer`. */
export function LegalLink({
  href,
  children,
}: {
  readonly href: string;
  readonly children: ReactNode;
}) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  );
}

/** Un lien vers un autre document légal : même onglet, c'est la même lecture. */
export function LegalPageLink({
  view,
  children,
}: {
  readonly view: LegalViewId;
  readonly children: ReactNode;
}) {
  return (
    <a href={legalHash(view)} className={LINK_CLASS}>
      {children}
    </a>
  );
}

/**
 * L'adresse de contact de l'éditeur, en lien `mailto`.
 *
 * Un composant plutôt qu'une chaîne recopiée : les trois documents la citent
 * six fois au total, et une adresse à moitié corrigée est une adresse fausse.
 */
export function LegalMail() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className={LINK_CLASS}>
      {LEGAL_CONTACT_EMAIL}
    </a>
  );
}

/** Un terme mis en avant dans une énumération : le sujet de la puce. */
export function LegalTerm({ children }: { readonly children: ReactNode }) {
  return <strong className="font-medium text-steel-200">{children}</strong>;
}
