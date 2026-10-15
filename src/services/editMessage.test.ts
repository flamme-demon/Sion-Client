/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MatrixEvent } from "matrix-js-sdk";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), fetch: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../stores/useAppStore", () => ({ useAppStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("../stores/useSettingsStore", () => ({ useSettingsStore: { getState: () => ({}), subscribe: vi.fn() } }));
vi.mock("./soundService", () => ({ playMessageReceived: vi.fn() }));
vi.mock("./voiceChannelSounds", () => ({ playPokeCue: vi.fn(), playKickCue: vi.fn(), playMemberKickedCue: vi.fn(), noteKicked: vi.fn() }));
vi.mock("./adminCommandService", () => ({ findAdminRoom: vi.fn() }));
vi.mock("../utils/messageCache", () => ({ setCachedRoom: vi.fn(), appendCachedEventIds: vi.fn(), clearCache: vi.fn() }));

import { __setMatrixClientForTest, editMessage } from "./matrixService";
import { definirMoteur } from "./moteur";
import { extractMessagesFromEvents } from "../stores/useMatrixStore";
import { messageEditContent } from "../utils/messageEdit";

function event(content: Record<string, unknown>, id = "$photo") {
  return new MatrixEvent({ type: "m.room.message", content, event_id: id, sender: "@alice:hs", room_id: "!room:hs", origin_server_ts: 1 });
}
function clientFor(original: MatrixEvent | undefined) {
  const room = { findEventById: () => original, getMember: () => ({ name: "Alice" }), hasEncryptionStateEvent: vi.fn(() => false) };
  const client = {
    getRoom: () => room,
    getHomeserverUrl: () => "https://hs.test",
    getAccessToken: () => "test-token",
    getUser: () => null,
    getCrypto: vi.fn<() => { isEncryptionEnabledInRoom: () => Promise<boolean> } | undefined>(() => undefined),
    sendMessage: vi.fn().mockResolvedValue({ event_id: "$edit" }),
    mxcUrlToHttp: (mxc: string) => `https://hs.test/media/${mxc.slice(6)}`,
    decryptEventIfNeeded: vi.fn().mockResolvedValue(undefined),
    fetchRoomEvent: vi.fn(),
    getEventMapper: () => (raw: Record<string, unknown>) => new MatrixEvent(raw as never),
  };
  __setMatrixClientForTest(client as never);
  return { client, room };
}
beforeEach(() => {
  definirMoteur("js");
  mocks.fetch.mockReset().mockResolvedValue({ ok: true });
  mocks.invoke.mockReset().mockResolvedValue("$edit");
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { definirMoteur("js"); __setMatrixClientForTest(null); vi.unstubAllGlobals(); });

describe("editing messages with attachments", () => {
  it.each(["m.image", "m.video", "m.audio", "m.file"])("preserves %s across clear and encrypted caption edits and reloads", async (msgtype) => {
    for (const encrypted of [false, true]) {
      const original: Record<string, unknown> = {
        msgtype, body: "old caption", filename: "photo.png",
        info: { size: 42, mimetype: "image/png", w: 640, h: 480, thumbnail_url: "mxc://hs/thumb" },
        format: "org.matrix.custom.html", formatted_body: "<b>old caption</b>",
        ...(encrypted ? { file: { url: "mxc://hs/photo", key: { k: "secret" }, iv: "iv", hashes: { sha256: "hash" }, v: "v2" } } : { url: "mxc://hs/photo" }),
      };
      const { client, room } = clientFor(event(original));
      await editMessage("!room:hs", "$photo", "Quel fumier ce chat !");
      const sent = JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body);
      expect(sent["m.new_content"]).toMatchObject({ msgtype, filename: "photo.png", body: "Quel fumier ce chat !", info: original.info });
      expect(sent["m.new_content"][encrypted ? "file" : "url"]).toEqual(original[encrypted ? "file" : "url"]);
      expect(sent["m.new_content"].formatted_body).toBeUndefined();
      const reloaded = extractMessagesFromEvents([event(original), event(sent, "$edit")], room, client as never);
      expect(reloaded).toHaveLength(1);
      expect(reloaded[0]).toMatchObject({ id: "$photo", text: "Quel fumier ce chat !", msgtype, edited: true, attachments: [{ name: "photo.png", size: 42, url: "https://hs.test/media/hs/photo" }] });
      if (encrypted) expect(reloaded[0].attachments![0].encryptedFile).toEqual(original.file);
    }
  });
  it("adds a filename when a previously captionless photo gains a caption", () => {
    const edited = messageEditContent({ msgtype: "m.image", body: "photo.png", url: "mxc://hs/photo" }, "$photo", "caption");
    expect(edited["m.new_content"]).toMatchObject({ filename: "photo.png", body: "caption", url: "mxc://hs/photo" });
  });
  it("loads an original outside the timeline before editing it", async () => {
    const { client } = clientFor(undefined);
    client.fetchRoomEvent.mockResolvedValue(event({ msgtype: "m.image", body: "photo.png", url: "mxc://hs/photo" }).event);
    await editMessage("!room:hs", "$photo", "caption");
    expect(client.fetchRoomEvent).toHaveBeenCalledWith("!room:hs", "$photo");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)["m.new_content"].url).toBe("mxc://hs/photo");
  });
  it("uses the original media even when an earlier broken edit hid it", async () => {
    const original = event({ msgtype: "m.image", body: "photo.png", url: "mxc://hs/photo" });
    original.makeReplaced(event({ msgtype: "m.text", body: "* broken edit", "m.new_content": { msgtype: "m.text", body: "broken edit" } }, "$broken"));
    expect(original.getContent().msgtype).toBe("m.text");
    clientFor(original);
    await editMessage("!room:hs", "$photo", "new caption");
    expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)["m.new_content"]).toMatchObject({ msgtype: "m.image", url: "mxc://hs/photo" });
  });
  it("refuses to discard an unreadable original or a missing media reference", async () => {
    for (const original of [event({}), event({ msgtype: "m.image", body: "photo.png" })]) {
      clientFor(original);
      await expect(editMessage("!room:hs", "$photo", "caption")).rejects.toThrow();
    }
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps edits on the Rust engine when it owns the room", async () => {
    definirMoteur("rust");
    await editMessage("!room:hs", "$photo", "caption");
    expect(mocks.invoke).toHaveBeenCalledWith("matrix_editer", { salon: "!room:hs", cible: "$photo", texte: "caption" });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("sends media keys through SDK encryption in an encrypted room", async () => {
    const file = { url: "mxc://hs/photo", key: { k: "secret" }, iv: "iv" };
    const { client, room } = clientFor(event({ msgtype: "m.image", body: "photo.png", file }));
    room.hasEncryptionStateEvent.mockReturnValue(true);
    client.getCrypto.mockReturnValue({ isEncryptionEnabledInRoom: async () => true });
    await editMessage("!room:hs", "$photo", "caption");
    expect(client.sendMessage).toHaveBeenCalledWith("!room:hs", expect.objectContaining({ "m.new_content": expect.objectContaining({ file }) }));
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it("keeps the caption draft safe when room encryption is unavailable", async () => {
    const { room } = clientFor(event({ msgtype: "m.image", body: "photo.png", url: "mxc://hs/photo" }));
    room.hasEncryptionStateEvent.mockReturnValue(true);
    await expect(editMessage("!room:hs", "$photo", "caption")).rejects.toThrow("Chiffrement du salon indisponible");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
  it.each(["legacy", "v11", "unsigned"])("never restores a redacted photo from an old caption edit (%s)", (format) => {
    const original = event({ msgtype: "m.image", body: "photo.png", url: "mxc://hs/photo" });
    const edit = event(messageEditContent(original.getContent(), "$photo", "caption"), "$edit");
    const raw = { type: "m.room.redaction", event_id: "$delete", sender: "@alice:hs", content: {}, redacts: "$photo", origin_server_ts: 2, unsigned: {} };
    const redaction = new MatrixEvent(format === "v11" ? { ...raw, redacts: undefined, content: { redacts: "$photo" } } : raw);
    if (format === "unsigned") original.event.unsigned = { redacted_because: raw };
    const { client, room } = clientFor(original);
    expect(extractMessagesFromEvents(format === "unsigned" ? [original, edit] : [original, edit, redaction], room, client as never)).toEqual([]);
  });
});
