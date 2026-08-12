# Templates d’email Supabase Auth — AimForge

Emails transactionnels d’authentification en français, aux couleurs AimForge.
Un fichier `.html` par template Supabase Auth, autonome (HTML complet, styles en
ligne, aucune police réseau, aucune image distante, aucune mention de fournisseur).

| Fichier | Template Supabase | Sujet recommandé |
| --- | --- | --- |
| `confirmation.html` | Confirm signup | `Confirme ton adresse — AimForge` |
| `recovery.html` | Reset password | `Réinitialise ton mot de passe — AimForge` |
| `magic_link.html` | Magic Link | `Ton lien de connexion — AimForge` |
| `email_change.html` | Change Email Address | `Confirme ta nouvelle adresse — AimForge` |
| `invite.html` | Invite user | `Ton invitation à AimForge` |

## Variables utilisées

Uniquement des variables Go documentées par Supabase
(<https://supabase.com/docs/guides/auth/auth-email-templates>) :

- `{{ .ConfirmationURL }}` — dans les cinq fichiers (bouton + lien en clair) ;
- `{{ .Email }}` — adresse du compte, dans les cinq fichiers ;
- `{{ .NewEmail }}` — **`email_change.html` uniquement** (variable documentée pour
  ce template seul ; elle est vide ailleurs, ne la recopie pas dans un autre fichier).

`{{ .SiteURL }}` n’est pas utilisée : le pied de page affiche le domaine en clair
plutôt qu’un lien dépendant de la configuration.

## Appliquer les templates — Dashboard (voie normale)

1. Ouvre <https://supabase.com/dashboard>, sélectionne le projet AimForge.
2. **Authentication** → **Emails** → onglet **Templates**.
3. Sélectionne le template à modifier (`Confirm signup`, `Invite user`,
   `Magic Link`, `Change Email Address`, `Reset Password`).
4. Renseigne **Subject heading** avec le sujet du tableau ci-dessus.
5. Dans **Message body**, remplace *tout* le contenu par celui du fichier
   correspondant (document HTML complet, `<!DOCTYPE html>` inclus — l’éditeur
   l’accepte tel quel).
6. **Save**. Recommence pour chacun des cinq templates.
7. Vérifie sur un vrai envoi (voir « Vérifier » plus bas).

Le SMTP par défaut de Supabase est fortement limité en volume et destiné aux
tests. Pour de l’envoi réel, configure un SMTP applicatif dans
**Authentication → Emails → SMTP Settings** ; les templates ci-dessous sont
indépendants du transport.

## Appliquer les templates — API de gestion (voie scriptable)

`PATCH https://api.supabase.com/v1/projects/{ref}/config/auth`, en-tête
`Authorization: Bearer $SUPABASE_ACCESS_TOKEN` (jeton d’accès personnel, créé
depuis **Account → Access Tokens** ; ce n’est ni l’anon key ni la service role key).

Champs concernés :

| Fichier | Champ contenu | Champ sujet |
| --- | --- | --- |
| `confirmation.html` | `mailer_templates_confirmation_content` | `mailer_subjects_confirmation` |
| `recovery.html` | `mailer_templates_recovery_content` | `mailer_subjects_recovery` |
| `magic_link.html` | `mailer_templates_magic_link_content` | `mailer_subjects_magic_link` |
| `email_change.html` | `mailer_templates_email_change_content` | `mailer_subjects_email_change` |
| `invite.html` | `mailer_templates_invite_content` | `mailer_subjects_invite` |

Exemple (un seul template, depuis la racine du dépôt) :

```sh
curl -sS -X PATCH "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  --data "$(jq -n \
    --arg subject 'Confirme ton adresse — AimForge' \
    --rawfile content supabase/templates/confirmation.html \
    '{mailer_subjects_confirmation: $subject, mailer_templates_confirmation_content: $content}')"
```

Les cinq peuvent partir dans un seul `PATCH` : construis un objet contenant les
dix champs. `jq` sert ici uniquement à échapper correctement le HTML en JSON.

Ne mets jamais le jeton d’accès dans un fichier du dépôt : il reste dans
l’environnement du shell.

## Vérifier

Il n’y a pas de test automatisé sur ces fichiers : la vérification est manuelle.

1. Après application, déclenche un vrai envoi :
   - inscription avec une adresse jetable → `confirmation.html` ;
   - « mot de passe oublié » → `recovery.html` ;
   - connexion par lien magique → `magic_link.html` ;
   - changement d’adresse depuis le profil → `email_change.html` ;
   - **Authentication → Users → Invite user** → `invite.html`.
2. Contrôle dans le message reçu : accents et apostrophes corrects, wordmark
   « AimForge » en monospace, bouton orange lisible, lien en clair cliquable et
   identique à celui du bouton, pied de page présent, aucune mention Supabase.
3. Ouvre au moins un message en mode clair **et** en mode sombre du client mail :
   la carte doit rester sombre dans les deux cas.

## Notes de design (à respecter si tu édites)

- **Palette** reprise de `src/client/index.css` : fond `#0b0d10` (steel-950),
  carte `#12151a` (steel-900), bordures `#2a313b` (steel-700), texte `#c8cfd9`
  (steel-200), titres `#e6e8ec` (steel-100), secondaire `#a3adbb` (steel-300),
  wordmark et filet `#f2711c` / `#c9550f` (ember).
- **Bouton** : `#bd4f0e` avec texte `#ffffff` → contraste **4,90:1** (AA).
  `#f2711c` (ember-500) ne donne que 2,93:1 avec du blanc et `#c9550f` 4,38:1 :
  aucun des deux ne convient pour du texte. Si tu changes cette couleur,
  recalcule le contraste.
- **Fond sombre prudent** : tout le contenu est enfermé dans une carte dont le
  fond est posé deux fois (attribut `bgcolor` *et* `style` en ligne) sur la table
  et sur chaque `<td>`. Un client qui force le blanc n’affecte que la marge
  autour de la carte ; le texte clair reste sur son fond sombre. Ne place jamais
  de texte hors d’un conteneur à fond explicite.
- **Compatibilité** : tables HTML uniquement, styles en ligne, largeur 600 px,
  une seule media query (≤ 620 px) qui ne sert qu’au confort mobile — le rendu
  reste correct dans les clients qui l’ignorent. Le bouton est un `<td bgcolor>`,
  ce qui fonctionne sous Outlook (coins droits au lieu d’arrondis, sans plus).
- **Polices** : aucune webfont. Monospace
  `ui-monospace, 'Cascadia Mono', 'JetBrains Mono', Menlo, Consolas, monospace`
  pour le wordmark, les adresses, l’URL et le pied ; pile système sans-serif
  pour le corps, comme `body` dans `index.css`.
- **Ton** : tutoiement, phrases courtes, pas de superlatif.

## `biome.json` de ce dossier

`biome check .` (dans `bun run check`) analyse aussi le HTML. Le fichier
`biome.json` présent ici est une configuration imbriquée (`"root": false`) qui
active `html.parser.interpolation` : sans elle, chaque `{{ .ConfirmationURL }}`
est rejeté comme « Text expressions aren’t supported » et le gate échoue.
Les `!important` des media queries — indispensables pour surcharger les styles en
ligne — sont couverts par des commentaires `biome-ignore-start/end`, comme dans
`src/client/index.css`. Ne supprime pas ce fichier sans traiter les deux points.

## Développement local

Ces fichiers ne sont pas branchés sur `supabase/config.toml` (le dépôt n’en
contient pas — seulement `supabase/migrations/`). Si une stack Supabase locale
est ajoutée un jour, les templates s’y rattachent via des blocs
`[auth.email.template.<type>]` avec `content_path = "./supabase/templates/<fichier>.html"`.
