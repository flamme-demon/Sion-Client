import { describe, expect, it } from "vitest";
import { migrateSettingsState } from "./useSettingsStore";

describe("migration sion-settings v0/v1 → v2", () => {
  it("conserve les réglages et complète les cues absents", () => {
    const customJoin = {
      path: "/data/cues/cue_123.wav",
      start: 0.25,
      end: 1.5,
      gain: 0.8,
    };
    const migrated = migrateSettingsState({
      language: "fr",
      voiceSounds: { join: customJoin },
    });

    expect(migrated.language).toBe("fr");
    expect(migrated.voiceSounds?.join).toEqual(customJoin);
    expect(migrated.voiceSounds?.memberKicked).toBeNull();
    expect(migrated.voiceSounds?.undeafen).toBeNull();
  });

  it("répare un snapshot sans objet voiceSounds", () => {
    const migrated = migrateSettingsState({ voiceSounds: null, screenShareAudio: false });
    expect(migrated.screenShareAudio).toBe(false);
    expect(Object.keys(migrated.voiceSounds ?? {})).toHaveLength(10);
  });

  it("retire les favoris et conserve une vue Tous avec sa catégorie et les compteurs TOP", () => {
    const ancien = {
      soundboardFavorites: ["$favori"], soundboardView: { mode: "all", category: "Films/Comédie" },
      soundboardPlayCounts: { $son: 12 }, memeboardPlayCounts: { $meme: 3 },
    };
    const migrated = migrateSettingsState(ancien);
    expect(migrated).not.toHaveProperty("soundboardFavorites");
    expect(migrated.soundboardView).toEqual(ancien.soundboardView);
    expect(migrated.soundboardPlayCounts).toEqual(ancien.soundboardPlayCounts);
    expect(migrated.memeboardPlayCounts).toEqual(ancien.memeboardPlayCounts);
    expect(ancien.soundboardFavorites).toEqual(["$favori"]);
  });
});
