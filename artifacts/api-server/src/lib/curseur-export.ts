/**
 * Valeur de depart du curseur des exports CSV pagines.
 *
 * Les trois exports (journal d'audit, depenses, messages) parcourent leur
 * table par lots decroissants avec `WHERE id < curseur`, en partant d'une
 * valeur « plus grande que tout ». Ils partaient de `Number.MAX_SAFE_INTEGER`.
 *
 * Or ces identifiants sont des `serial`, c'est-a-dire des `integer` sur 4
 * octets. Postgres compare donc la colonne a un litteral qu'il doit d'abord
 * convertir en `integer` — et refuse : « value "9007199254740991" is out of
 * range for type integer » (SQLSTATE 22003). La toute PREMIERE requete
 * echouait, pour toute organisation, toujours : ces exports n'ont jamais pu
 * produire un fichier. Mesure du 19/09 contre la base de test.
 *
 * Le defaut etait invisible en lecture parce que la valeur est correcte en
 * JavaScript ; c'est la largeur de la colonne, non celle du langage, qui
 * decide.
 */
export const CURSEUR_EXPORT_DEBUT = 2_147_483_647;
