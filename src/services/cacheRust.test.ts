import { describe, it, expect, vi, beforeEach } from "vitest";

const lire = vi.fn();
vi.mock("./matrixCore", () => ({ detailsSalon: (salon: string) => lire(salon) }));

import * as cacheRust from "./cacheRust";

const attendre = () => new Promise((r) => setTimeout(r, 0));
const membres = (ids: string[]) => ({ membres: ids.map((userId) => ({ userId })) });

describe("cacheRust.oublierDetails", () => {
  beforeEach(() => {
    cacheRust.vider();
    lire.mockReset();
  });

  it("ne prévient l'interface que si les détails relus ont changé", async () => {
    const prevenir = vi.fn();
    cacheRust.surChangement(prevenir);
    lire.mockResolvedValue(membres(["@a:x"]));

    cacheRust.detailsSalon("!s");
    await attendre();
    expect(prevenir).toHaveBeenCalledTimes(1);

    // Relecture périodique, valeur identique : rien à redessiner.
    cacheRust.oublierDetails("!s");
    await attendre();
    expect(lire).toHaveBeenCalledTimes(2);
    expect(prevenir).toHaveBeenCalledTimes(1);
    expect(cacheRust.detailsSalon("!s")).toEqual(membres(["@a:x"]));

    lire.mockResolvedValue(membres(["@a:x", "@b:x"]));
    cacheRust.oublierDetails("!s");
    await attendre();
    expect(prevenir).toHaveBeenCalledTimes(2);
  });

  it("ignore une réponse de l'ancienne session et permet une nouvelle demande immédiatement", async () => {
    let terminer!: (valeur: unknown) => void;
    const prevenir = vi.fn(); cacheRust.surChangement(prevenir);
    lire.mockReturnValueOnce(new Promise((resolve) => { terminer = resolve; }));
    cacheRust.detailsSalon("!s"); await attendre();
    cacheRust.vider();
    lire.mockResolvedValue(membres(["@nouveau:x"]));
    cacheRust.detailsSalon("!s"); await attendre();
    terminer(membres(["@ancien:x"])); await attendre();
    expect(cacheRust.detailsSalon("!s")).toEqual(membres(["@nouveau:x"]));
    expect(lire).toHaveBeenCalledTimes(2);
    expect(prevenir).toHaveBeenCalledTimes(1);
  });

  it("borne les détails des salons consultés à 128 entrées", async () => {
    lire.mockResolvedValue(membres(["@a:x"]));
    for (let i = 0; i < 129; i++) await cacheRust.detailsFrais(`!s${i}`);
    expect(cacheRust.detailsSalon("!s128")).toEqual(membres(["@a:x"]));
    expect(cacheRust.detailsSalon("!s0")).toBeUndefined();
    await attendre();
    expect(lire).toHaveBeenCalledTimes(130);
  });
});
