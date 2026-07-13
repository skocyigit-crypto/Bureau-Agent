import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isBlockedIp, assertSafePublicUrl } from "../lib/ssrf-guard";

describe("isBlockedIp", () => {
  it("bloque les plages IPv4 internes/réservées", () => {
    for (const ip of [
      "0.0.0.0",
      "10.0.0.1",
      "127.0.0.1",
      "169.254.169.254", // métadonnées cloud
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1", // CGNAT
      "224.0.0.1", // multicast
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("autorise les IPv4 publiques", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "203.0.113.10", "172.32.0.1", "192.169.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(false);
    }
  });

  it("bloque les IPv6 loopback/link-local/unique-local + IPv4 mappée privée", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedIp(ip), ip).toBe(true);
    }
  });

  it("autorise une IPv6 publique et une IPv4 mappée publique", () => {
    expect(isBlockedIp("2606:4700:4700::1111")).toBe(false);
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
  });
});

describe("assertSafePublicUrl", () => {
  const prev = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });
  afterEach(() => {
    process.env.NODE_ENV = prev;
  });

  it("rejette une URL invalide", async () => {
    await expect(assertSafePublicUrl("pas une url")).rejects.toThrow();
  });

  it("rejette http en production", async () => {
    await expect(assertSafePublicUrl("http://example.com/hook")).rejects.toThrow();
  });

  it("rejette localhost et les hôtes internes", async () => {
    await expect(assertSafePublicUrl("https://localhost/hook")).rejects.toThrow();
    await expect(assertSafePublicUrl("https://api.internal/hook")).rejects.toThrow();
  });

  it("rejette une IP littérale privée", async () => {
    await expect(assertSafePublicUrl("https://169.254.169.254/latest/meta-data")).rejects.toThrow();
    await expect(assertSafePublicUrl("https://10.0.0.5/hook")).rejects.toThrow();
  });

  it("accepte une IP littérale publique", async () => {
    const url = await assertSafePublicUrl("https://1.1.1.1/hook");
    expect(url.hostname).toBe("1.1.1.1");
  });
});
