import { describe, it, expect, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...args: unknown[]) => invoke(...args) }));

import {
  moteurMatrix, connecter, fils, chargerHistorique, urlLecture, creerSondage, envoyerFichier, requeteAdmin, ErreurApiAdmin, appareils, detailsSalon, amorcer, modifierSon, modifierMeme, rechercherUtilisateurs,
  envoyerTexte, repondre,
} from "./matrixCore";

describe("matrixCore", () => {
  it("transmet la transaction de l'écho local et laisse les anciens appels sans transaction", async () => {
    invoke.mockResolvedValue("$message");
    await envoyerTexte("!salon", "bonjour", "sion-transaction");
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_texte", { salon: "!salon", corps: "bonjour", transaction: "sion-transaction" });
    await envoyerTexte("!salon", "bonjour");
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_texte", { salon: "!salon", corps: "bonjour", transaction: null });
    await repondre("!salon", "$origine", "réponse", "sion-reponse");
    expect(invoke).toHaveBeenLastCalledWith("matrix_repondre", { salon: "!salon", cible: "$origine", corps: "réponse", transaction: "sion-reponse" });
  });
  it("transmet le pseudo à la commande d'annuaire du cœur Rust", async () => {
    invoke.mockResolvedValue({ utilisateurs: [], limite: false });
    expect(await rechercherUtilisateurs("Alice")).toEqual({ utilisateurs: [], limite: false });
    expect(invoke).toHaveBeenLastCalledWith("matrix_rechercher_utilisateurs", { terme: "Alice" });
  });
  it("retombe sur le moteur JS si le pont ne répond pas (hors Tauri)", async () => {
    invoke.mockImplementation(() => Promise.reject(new Error("pas de Tauri")));
    expect(await moteurMatrix()).toBe("js");
  });

  it("n'active le moteur Rust que sur une réponse explicite", async () => {
    invoke.mockResolvedValue("rust");
    expect(await moteurMatrix()).toBe("rust");
    invoke.mockResolvedValue("autre chose");
    expect(await moteurMatrix()).toBe("js");
  });

  it("passe les arguments de connexion sous les noms attendus par Tauri", async () => {
    invoke.mockResolvedValue(undefined);
    await connecter("sionchat.fr", "moi", "secret");
    expect(invoke).toHaveBeenLastCalledWith("matrix_connecter", {
      serveur: "sionchat.fr",
      identifiant: "moi",
      motDePasse: "secret",
    });
  });

  it("calcule l'heure affichée, absente des messages du cœur", async () => {
    const ts = new Date(2026, 8, 26, 14, 5).getTime();
    invoke.mockResolvedValue([{ salon: "!a:hs", aPlus: true, messages: [{ id: "$1", user: "Alice", role: "user", ts, text: "salut" }] }]);
    const [fil] = await fils();
    expect(fil.messages[0].time).toBe("14:05");
    expect(fil.aPlus).toBe(true);
  });

  it("fait lire un média sion-media par le serveur local, sur toutes les plateformes", async () => {
    invoke.mockResolvedValue(41234);
    expect(await urlLecture("sion-media://localhost/00ff00ff00ff00ff")).toBe("http://127.0.0.1:41234/matrix/00ff00ff00ff00ff");
    expect(await urlLecture("http://sion-media.localhost/00ff00ff00ff00ff?vignette=1")).toBe(
      "http://127.0.0.1:41234/matrix/00ff00ff00ff00ff",
    );
    // Média en clair : la clé porte l'adresse mxc:// encodée.
    expect(await urlLecture("sion-media://localhost/mbXhjOi8vaHMvYWJj_-")).toBe("http://127.0.0.1:41234/matrix/mbXhjOi8vaHMvYWJj_-");
    expect(await urlLecture("https://ailleurs/son.mp3")).toBe("https://ailleurs/son.mp3");
    invoke.mockResolvedValue(0);
    expect(await urlLecture("sion-media://localhost/00ff00ff00ff00ff")).toBeNull();
  });

  it("passe les options de sondage sous les noms attendus, échéance absente = null", async () => {
    invoke.mockResolvedValue("$s");
    await creerSondage("!a:hs", "On y va ?", ["Oui", "Non"]);
    expect(invoke).toHaveBeenLastCalledWith("matrix_creer_sondage", {
      salon: "!a:hs", question: "On y va ?", options: ["Oui", "Non"], secret: false, max: 1, fin: null,
    });
  });

  it("dépose le fichier en octets bruts puis l'envoie par son chemin", async () => {
    invoke.mockImplementation((commande: string) => Promise.resolve(commande === "stage_media" ? "/tmp/sion-media/x.png" : "$f"));
    const id = await envoyerFichier("!a:hs", new File([new Uint8Array([1, 2, 3])], "x.png", { type: "image/png" }));
    expect(id).toBe("$f");
    const depot = invoke.mock.calls.find((c) => c[0] === "stage_media");
    expect(depot?.[1]).toBeInstanceOf(Uint8Array);
    expect(depot?.[2]).toEqual({ headers: { "x-sion-ext": "png" } });
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_fichier", {
      salon: "!a:hs", chemin: "/tmp/sion-media/x.png", nom: "x.png", mime: "image/png", largeur: null, hauteur: null, dureeMs: null, legende: null,
    });
  });

  it("transmet la légende avec le fichier au cœur Rust", async () => {
    invoke.mockImplementation((commande: string) => Promise.resolve(commande === "stage_media" ? "/tmp/sion-media/photo.png" : "$photo"));
    await envoyerFichier("!a:hs", new File([new Uint8Array([1])], "photo.png", { type: "image/png" }), { legende: "Pour avoir la bêta !" });
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_fichier", expect.objectContaining({ nom: "photo.png", legende: "Pour avoir la bêta !" }));
  });

  it("dépose séparément la petite miniature et la vidéo avant un seul message", async () => {
    invoke.mockClear();
    invoke.mockImplementation((commande: string, _args: unknown, options?: { headers: Record<string, string> }) =>
      Promise.resolve(commande === "stage_media" ? `/tmp/sion-media/depot.${options?.headers["x-sion-ext"]}` : "$video"));
    await envoyerFichier("!a:hs", new File([new Uint8Array([1, 2, 3])], "clip.webm", { type: "video/webm" }), {
      largeur: 1920, hauteur: 1080, dureeMs: 100_000,
      miniature: new File([new Uint8Array([255, 216, 255])], "preview.jpg", { type: "image/jpeg" }),
    });
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(["stage_media", "stage_media", "matrix_envoyer_fichier"]);
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_fichier", expect.objectContaining({
      chemin: "/tmp/sion-media/depot.webm", miniatureChemin: "/tmp/sion-media/depot.jpg",
      largeur: 1920, hauteur: 1080, dureeMs: 100_000,
    }));
  });

  it("envoie encore la vidéo si le dépôt de sa miniature échoue", async () => {
    invoke.mockClear();
    invoke.mockImplementation((commande: string, _args: unknown, options?: { headers: Record<string, string> }) => {
      if (commande !== "stage_media") return Promise.resolve("$video");
      return options?.headers["x-sion-ext"] === "jpg"
        ? Promise.reject(new Error("dépôt indisponible"))
        : Promise.resolve("/tmp/sion-media/clip.webm");
    });
    expect(await envoyerFichier("!a:hs", new File([new Uint8Array([1])], "clip.webm", { type: "video/webm" }), {
      miniature: new File([new Uint8Array([255, 216, 255])], "preview.jpg", { type: "image/jpeg" }),
    })).toBe("$video");
    expect(invoke).toHaveBeenLastCalledWith("matrix_envoyer_fichier", expect.objectContaining({ chemin: "/tmp/sion-media/clip.webm" }));
    expect(invoke.mock.lastCall?.[1]).not.toHaveProperty("miniatureChemin");
  });

  it("le mandataire d'administration lève l'erreur d'adminService, errcode compris", async () => {
    invoke.mockResolvedValue({ status: 403, corps: { errcode: "M_FORBIDDEN" } });
    const echec = requeteAdmin("/_continuwuity/admin/rooms/list", { authentifiee: true });
    await expect(echec).rejects.toBeInstanceOf(ErreurApiAdmin);
    await expect(echec).rejects.toMatchObject({ status: 403, errcode: "M_FORBIDDEN" });
    expect(invoke).toHaveBeenLastCalledWith("matrix_requete_admin", {
      methode: "GET", chemin: "/_continuwuity/admin/rooms/list", corps: null, authentifiee: true,
    });
    invoke.mockResolvedValue({ status: 200, corps: { name: "continuwuity", version: "26.9.0" } });
    expect(await requeteAdmin("/_continuwuity/server_version")).toEqual({ name: "continuwuity", version: "26.9.0" });
  });

  it("rend l'infini du créateur d'un salon v12 comme le JS", async () => {
    // i64::MAX tel que JSON.parse le lit : 2⁶³.
    const infini = 2 ** 63;
    invoke.mockResolvedValue({
      membres: [{ userId: "@a:hs", displayName: "A", avatarUrl: null, powerLevel: infini }, { userId: "@b:hs", displayName: "B", avatarUrl: null, powerLevel: 50 }],
      moi: infini, niveauEtat: 50, niveauInvitation: 0, peutEcrire: true, regleAcces: "invite",
    });
    const d = await detailsSalon("!a:hs");
    expect([d.moi, d.membres[0].powerLevel, d.membres[1].powerLevel]).toEqual([Infinity, Infinity, 50]);
  });

  it("amorçage sans mot de passe : null, jamais undefined (Tauri l'exige)", async () => {
    invoke.mockResolvedValue("EsTc 1234");
    expect(await amorcer()).toBe("EsTc 1234");
    expect(invoke).toHaveBeenLastCalledWith("matrix_amorcer", { motDePasse: null });
  });

  it("édition d'un son : clé absente = inchangé, null = effacé", async () => {
    invoke.mockResolvedValue(undefined);
    await modifierSon("$s", "Ouf", "A", null, 1, { refText: null });
    expect(invoke).toHaveBeenLastCalledWith("matrix_modifier_son", {
      eventId: "$s", label: "Ouf", categorie: "A", emoji: null, gain: 1, changements: { refText: null },
    });
  });

  it("édition d'un meme : nom et emoji, null retire l'emoji", async () => {
    invoke.mockResolvedValue(undefined);
    await modifierMeme("$m", "Matou", null);
    expect(invoke).toHaveBeenLastCalledWith("matrix_modifier_meme", { eventId: "$m", label: "Matou", emoji: null, categorie: null });
    await modifierMeme("$m", "Matou", null, "Animaux/Chats");
    expect(invoke).toHaveBeenLastCalledWith("matrix_modifier_meme", { eventId: "$m", label: "Matou", emoji: null, categorie: "Animaux/Chats" });
  });

  it("rend les appareils sous la forme de getDevices", async () => {
    invoke.mockResolvedValue([{ device_id: "ABC" }]);
    expect(await appareils()).toEqual({ devices: [{ device_id: "ABC" }] });
  });

  it("désigne le salon sous le nom attendu par Tauri", async () => {
    invoke.mockResolvedValue(false);
    expect(await chargerHistorique("!a:hs")).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith("matrix_charger_historique", { salon: "!a:hs" });
  });
});
