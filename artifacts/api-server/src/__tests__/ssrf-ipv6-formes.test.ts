/**
 * La garde anti-SSRF reconnait une adresse interne sous TOUTES ses ecritures.
 *
 * Une meme adresse IPv6 s'ecrit de dizaines de facons, et `new URL` en
 * reecrit certaines : `[::ffff:127.0.0.1]` devient `[::ffff:7f00:1]`. La
 * garde ne reconnaissait que la forme pointee — `isBlockedIp("::ffff:7f00:1")`
 * rendait false — et acceptait `https://[::127.0.0.1]/` (bloc ::/96). Les
 * formes mappees n'etaient refusees que par chance, a l'etape DNS.
 * (Releve le 22/09/2026 sur un signalement de la session BatiFlow.)
 *
 * Cette garde protege toute URL fournie par un client : webhooks, plateforme
 * agreee, recherche web.
 */
process.env.NODE_ENV = "production";

import { describe, expect, it } from "vitest";
import { assertSafePublicUrl, isBlockedIp } from "../lib/ssrf-guard";

describe("formes IPv6 d'une adresse interne", () => {
  const internes = [
    ["::ffff:7f00:1", "IPv4 mappee, hexadecimale (forme rendue par new URL)"],
    ["::ffff:127.0.0.1", "IPv4 mappee, pointee"],
    ["0:0:0:0:0:ffff:7f00:1", "IPv4 mappee, developpee"],
    ["::ffff:a9fe:a9fe", "metadonnees cloud 169.254.169.254, mappee"],
    ["::ffff:a00:1", "10.0.0.1, mappee"],
    ["::127.0.0.1", "IPv4 compatible (::/96, deprecie)"],
    ["::7f00:1", "IPv4 compatible, hexadecimale"],
    ["::", "non specifiee"],
    ["::1", "boucle locale"],
    ["0:0:0:0:0:0:0:1", "boucle locale, developpee"],
    ["64:ff9b::7f00:1", "NAT64 vers 127.0.0.1"],
    ["2002:7f00:1::", "6to4 vers 127.0.0.1"],
    ["fe80::1", "lien-local"],
    ["febf::1", "lien-local, fin de fe80::/10 (la garde ne testait que « fe80: »)"],
    ["fc00::1", "unique-local"],
    ["fd12:3456::1", "unique-local"],
    ["ff02::1", "multicast"],
    ["[::ffff:7f00:1]", "entre crochets, comme dans un hostname"],
    ["fe80::1%eth0", "avec identifiant de zone"],
  ] as const;
  for (const [ip, pourquoi] of internes) {
    it(`bloque ${ip} — ${pourquoi}`, () => {
      expect(isBlockedIp(ip)).toBe(true);
    });
  }
});

describe("adresses publiques : pas de faux positif", () => {
  const publiques = [
    ["2001:4860:4860::8888", "resolveur public IPv6"],
    ["2606:4700:4700::1111", "resolveur public IPv6"],
    ["::ffff:808:808", "8.8.8.8 mappee"],
    ["64:ff9b::808:808", "NAT64 vers 8.8.8.8"],
    ["2002:808:808::1", "6to4 vers 8.8.8.8"],
    ["8.8.8.8", "IPv4 publique"],
  ] as const;
  for (const [ip, pourquoi] of publiques) {
    it(`laisse passer ${ip} — ${pourquoi}`, () => {
      expect(isBlockedIp(ip)).toBe(false);
    });
  }
});

describe("de bout en bout, par l'URL", () => {
  for (const u of ["https://[::127.0.0.1]/", "https://[::ffff:7f00:1]/", "https://[::ffff:127.0.0.1]/", "https://[64:ff9b::a9fe:a9fe]/"]) {
    it(`refuse ${u}`, async () => {
      await expect(assertSafePublicUrl(u)).rejects.toThrow(/interdite|interne|privée/);
    });
  }
});

describe("robustesse du decodage", () => {
  it("une chaine qui n'est pas une IP n'est pas bloquee pour autant (le DNS decidera)", () => {
    expect(isBlockedIp("exemple.fr")).toBe(false);
  });
  it("une IPv6 malformee ne fait pas planter la garde", () => {
    expect(() => isBlockedIp("1:2:3:4:5:6:7:8:9")).not.toThrow();
    expect(() => isBlockedIp("::ffff:999.1.1.1")).not.toThrow();
    expect(() => isBlockedIp(":::1")).not.toThrow();
  });
});
