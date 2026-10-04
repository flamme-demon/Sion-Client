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
});
