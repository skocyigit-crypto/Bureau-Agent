/**
 * Analyse du flux SSE (assistant IA, commandant, transcription vocale...).
 *
 * Une regression ici ne leve aucune erreur : elle se manifeste par un ecran qui
 * reste vide ou se fige a mi-reponse — lu par l'utilisateur comme "l'IA ne
 * repond pas", donc diagnostique tres tard. Les cas figes ci-dessous sont ceux
 * qui arrivent reellement en production : evenement coupe par la frontiere d'un
 * paquet reseau, commentaire de maintien de connexion insere par un proxy,
 * lignes `data:` multiples, charge utile non-JSON.
 */
import { describe, it, expect } from "vitest";
import { parseSseBuffer, decodeSseData } from "../sse-parser";

describe("parseSseBuffer — decoupage", () => {
  it("extrait un evenement complet", () => {
    const { events, rest } = parseSseBuffer('event: token\ndata: {"t":"a"}\n\n');
    expect(events).toEqual([{ event: "token", data: '{"t":"a"}' }]);
    expect(rest).toBe("");
  });

  it("extrait plusieurs evenements d'un seul morceau", () => {
    const { events } = parseSseBuffer("data: 1\n\ndata: 2\n\n");
    expect(events.map((e) => e.data)).toEqual(["1", "2"]);
  });

  it("utilise \"message\" comme nom par defaut", () => {
    expect(parseSseBuffer("data: x\n\n").events[0].event).toBe("message");
  });

  it("conserve un evenement incomplet pour le morceau suivant", () => {
    const first = parseSseBuffer('event: token\ndata: {"t"');
    expect(first.events).toHaveLength(0);
    expect(first.rest).toBe('event: token\ndata: {"t"');

    // Le morceau suivant complete le precedent: c'est exactement ce que fait la
    // boucle de lecture (buffer = rest, puis concatenation).
    const second = parseSseBuffer(first.rest + ':"a"}\n\n');
    expect(second.events).toEqual([{ event: "token", data: '{"t":"a"}' }]);
    expect(second.rest).toBe("");
  });

  it("concatene les lignes data: multiples d'un meme evenement", () => {
    const { events } = parseSseBuffer("data: ab\ndata: cd\n\n");
    expect(events[0].data).toBe("abcd");
  });
});

describe("parseSseBuffer — bruit ignore", () => {
  it("ignore les commentaires de maintien de connexion", () => {
    const { events } = parseSseBuffer(": ping\n\ndata: reel\n\n");
    expect(events.map((e) => e.data)).toEqual(["reel"]);
  });

  it("ignore les blocs vides", () => {
    expect(parseSseBuffer("\n\n\n\n").events).toHaveLength(0);
  });

  it("ignore un evenement sans data", () => {
    expect(parseSseBuffer("event: done\n\n").events).toHaveLength(0);
  });

  it("ne rend aucun evenement pour un tampon vide", () => {
    expect(parseSseBuffer("")).toEqual({ events: [], rest: "" });
  });
});

describe("decodeSseData", () => {
  it("decode le JSON", () => {
    expect(decodeSseData('{"t":"a"}')).toEqual({ t: "a" });
  });

  it("rend le texte brut quand ce n'est pas du JSON", () => {
    expect(decodeSseData("erreur passerelle")).toBe("erreur passerelle");
  });
});
