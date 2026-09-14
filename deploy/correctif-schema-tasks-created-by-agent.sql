-- Colonne manquante en production: tasks.created_by_agent
--
-- POURQUOI CE FICHIER EXISTE
--
-- Le #78 (11/09/2026) a ajoute cette colonne au schema. La fusion est partie
-- sans la poussee du schema, et la production a passe quatre jours avec:
--
--   * le moteur d'automatisation en echec toutes les cinq minutes
--     (1011 erreurs « column "created_by_agent" does not exist » en sept jours);
--   * le panneau « activite recente » du tableau de bord en 500;
--   * la liste des taches, l'export de donnees et les operations en masse
--     casses des qu'ils lisent la table `tasks` en entier.
--
-- PORTEE — mesuree, pas supposee
--
-- La sonde de derive de schema, qui tourne DANS la production et compare
-- chaque colonne declaree par le code a `information_schema`, rapporte:
--
--     « 1 colonne(s) attendues par le code sont absentes de la base:
--       tasks.created_by_agent. »
--
-- Une seule. Ce fichier ne fait donc qu'une chose.
--
-- DEFINITION — celle du schema, a l'identique
--
--   createdByAgent: text("created_by_agent")
--
-- Texte, nullable, sans valeur par defaut, sans index, sans contrainte. Un
-- nul signifie « saisie par un humain »; un identifiant d'agent signifie
-- « proposee par cette IA-la ».
--
-- SANS RISQUE POUR LES DONNEES
--
-- L'operation est ADDITIVE et IDEMPOTENTE: `IF NOT EXISTS` la rend rejouable,
-- et ajouter une colonne nullable sans defaut ne reecrit aucune ligne
-- existante (PostgreSQL se contente de modifier le catalogue). Aucune donnee
-- n'est lue, modifiee ni supprimee.

-- PROPRIETE DE LA TABLE
--
-- `tasks` appartient au role applicatif `agent`, alors que l'import Cloud SQL
-- s'execute par defaut sous `postgres`. Un premier essai s'est arrete sur
-- « must be owner of table tasks » — la base a bien ete atteinte, seule la
-- propriete manquait.
--
-- On emprunte donc le role le temps de l'instruction, puis ON LE REND. Le
-- `REVOKE` final est ce qui distingue un emprunt d'une elevation de
-- privileges: apres ce fichier, `postgres` n'est pas plus puissant qu'avant.
--
-- `IF NOT EXISTS` sur le GRANT n'existe pas en SQL; un GRANT deja accorde est
-- simplement sans effet, donc l'ensemble reste rejouable.

GRANT agent TO CURRENT_USER;
SET ROLE agent;

ALTER TABLE tasks ADD COLUMN IF NOT EXISTS created_by_agent text;

RESET ROLE;
REVOKE agent FROM CURRENT_USER;
