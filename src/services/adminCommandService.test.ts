import { describe, it, expect, vi } from "vitest";

vi.mock("./matrixService", () => ({ getMatrixClient: () => null }));

import { compteAnnonceInscrit } from "./adminCommandService";

describe("compteAnnonceInscrit", () => {
  it("lit le compte dans l'avis d'inscription de Continuwuity", () => {
    expect(compteAnnonceInscrit(
      'New user "@lea:sionchat.fr" registered on this server from IP 192.168.1.20.',
      "@conduit:sionchat.fr",
    )).toBe("@lea:sionchat.fr");
  });

  it("accepte la variante avec le nom de l'appareil", () => {
    expect(compteAnnonceInscrit(
      'New user "@lea:sionchat.fr" registered on this server from IP 192.168.1.20 and device display name "Sion".',
      "@conduit:sionchat.fr",
    )).toBe("@lea:sionchat.fr");
  });

  it("ignore le même texte quand il ne vient pas du bot du serveur", () => {
    expect(compteAnnonceInscrit('New user "@lea:sionchat.fr" registered on this server from IP 1.2.3.4.', "@flamme:sionchat.fr")).toBeNull();
    expect(compteAnnonceInscrit('New user "@lea:sionchat.fr" registered on this server from IP 1.2.3.4.', undefined)).toBeNull();
  });

  it("ignore les réponses de commande du bot", () => {
    expect(compteAnnonceInscrit("Found 10 local user account(s):\n```\n@flamme:sionchat.fr\n```", "@conduit:sionchat.fr")).toBeNull();
  });
});
