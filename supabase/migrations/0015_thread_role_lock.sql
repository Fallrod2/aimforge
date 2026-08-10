-- Le fil du coach : seul le serveur peut parler au nom du coach (SPEC §5 sexies).
--
-- La migration 0014 autorisait un client authentifié à insérer **n'importe
-- quelle** ligne de son propre fil, y compris `role = 'coach'`. Le contrôle
-- d'accès était bon (personne n'écrit chez quelqu'un d'autre) ; le contrôle
-- d'**autorité** manquait, et deux choses en découlaient :
--
-- 1. **une fausse réplique du coach**. Rien n'empêchait `supabase.from(...)
--    .insert({role: 'coach', content: '…'})` depuis la console du navigateur.
--    La ligne était ensuite relue par `api/coach-thread` et rejouée au modèle
--    comme un **tour assistant** : le joueur pouvait donc écrire lui-même ce
--    que le coach « avait dit » au tour précédent. Ce n'est pas seulement une
--    curiosité — c'est le seul endroit du produit où du texte choisi par
--    l'utilisateur entre dans le prompt sans passer par la frontière de
--    confiance (`sealStats` scelle les balises, il ne change pas le rôle) ;
-- 2. **le contournement de la borne du message**. La fonction refuse au-delà de
--    2 000 caractères avant de dépenser un jeton ; la colonne, elle, en accepte
--    8 000 (garde-fou de stockage). Écrire directement en base laissait donc
--    poser 8 000 caractères, relus ensuite comme contexte.
--
-- Le correctif suit le patron de `linked_accounts` (migration 0007) : ce que le
-- client n'a pas autorité à écrire, il ne peut pas l'écrire — et le serveur le
-- fait à sa place, sous la service key, **après avoir vérifié l'identité de
-- l'appelant avec `auth.getUser`**. C'est sûr pour la même raison qu'en 0007 :
-- le `user_id` inséré ne vient jamais du corps de la requête, il vient du jeton
-- vérifié ; la service key n'est pas une porte ouverte, elle est le moyen
-- d'écrire une ligne dont l'utilisateur n'est pas l'auteur.

/* ------------------------------------------------------------------ */
/* La policy d'insertion, resserrée                                    */
/* ------------------------------------------------------------------ */

drop policy "coach_thread_messages_insert_own" on public.coach_thread_messages;

-- `to authenticated` est explicite : la policy ne parle qu'au navigateur. Le
-- `service_role` ne la lit pas — il porte `bypassrls`, et c'est exactement ce
-- qui permet à la fonction serverless d'écrire les lignes du coach.
--
-- Trois conditions, et chacune ferme une porte :
--
-- - `auth.uid() = user_id` — inchangé : on n'écrit que chez soi ;
-- - `role = 'user'` — le client ne peut plus **se faire passer pour le coach**.
--   C'est la condition centrale de cette migration ;
-- - `char_length(content) <= 2000` — la borne du contrat (celle que la fonction
--   applique avant de dépenser un jeton) devient aussi celle de la base pour ce
--   chemin. La borne de colonne à 8 000 reste, mais elle ne concerne plus que
--   les lignes écrites par le serveur, dont la réponse du modèle.
--
-- `debrief_id is null` s'y ajoute pour une raison de cohérence plus que de
-- sécurité : une carte est un message **du coach**, elle porte le debrief que
-- le serveur vient de générer. Un message d'utilisateur qui porterait une
-- référence de debrief s'afficherait comme une carte tout en étant du joueur —
-- un état que rien dans le produit ne sait produire, donc un état qu'on refuse.
-- L'`exists (…)` de la 0014 disparaît avec lui : il vérifiait que le debrief
-- référencé appartenait à l'appelant, ce qui n'a plus d'objet quand la
-- référence doit être nulle. **Cette vérification n'est pas perdue : elle est
-- déplacée dans la fonction serverless**, qui pose la carte sous la service key
-- et doit donc la faire elle-même (la RLS ne la protège plus).
create policy "coach_thread_messages_insert_own" on public.coach_thread_messages
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and role = 'user'
    and debrief_id is null
    and char_length(content) <= 2000
  );

-- Les policies de lecture et de suppression ne bougent pas : lire son fil et
-- l'effacer restent des gestes du navigateur, et aucun des deux ne permet
-- d'écrire quoi que ce soit.
--
-- Toujours aucune policy `update`, pour la même raison qu'en 0011 et 0014 : un
-- message dit est dit. Sans elle, la restriction ci-dessus ne se contourne pas
-- non plus en écrivant une ligne `user` puis en la retournant en `coach`.
