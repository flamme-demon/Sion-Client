import { expect, it, vi } from "vitest";
import { adresseServeurMedia } from "./livekitTokenService";
vi.mock("./matrixService", () => ({ getMatrixClient: () => null }));
it("respecte un serveur média distinct du service JWT", () => {
  expect(adresseServeurMedia("https://jwt.team.example", "wss://media.team.example/rtc")).toBe("wss://media.team.example/rtc");
  expect(adresseServeurMedia("https://jwt.team.example", "ws://192.168.10.2:7880")).toBe("ws://192.168.10.2:7880");
});
it("conserve le proxy public pour une adresse locale et pour les anciennes réponses", () => {
  for (const url of ["ws://127.0.0.1:7880", "ws://[::1]:7880", "ws://localhost:7880", "https://invalide.example"]) expect(adresseServeurMedia("https://livekit.sionchat.fr", url)).toBe("wss://livekit.sionchat.fr");
  expect(adresseServeurMedia("http://localhost:8081")).toBe("ws://localhost:8081");
});
