import { beforeEach, expect, it, vi } from "vitest";
import { readClipboardFiles } from "./clipboardImage";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/path", () => ({ basename: async (path: string) => path.split(/[\\/]/).pop() }));
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1]).buffer;

beforeEach(() => invoke.mockReset());

it("prépare toutes les images copiées dans l’explorateur, avec leur nom et leur format", async () => {
  invoke.mockImplementation(async (command: string) => command === "read_clipboard_files"
    ? ["/tmp/Mes images/photo été.png", "C:\\Images\\animation.gif"] : png);
  const files = await readClipboardFiles();
  expect(files.map((file) => ({ name: file.name, type: file.type, size: file.size }))).toEqual([
    { name: "photo été.png", type: "image/png", size: 5 },
    { name: "animation.gif", type: "image/gif", size: 5 },
  ]);
  expect(invoke).toHaveBeenCalledWith("read_dropped_file", { path: "/tmp/Mes images/photo été.png" });
  expect(invoke).toHaveBeenCalledWith("read_dropped_file", { path: "C:\\Images\\animation.gif" });
  expect(invoke).not.toHaveBeenCalledWith("read_clipboard_image");
});

it("conserve le collage d’une capture quand le presse-papiers ne contient pas de fichiers", async () => {
  invoke.mockImplementation(async (command: string) => command === "read_clipboard_files" ? [] : png);
  const files = await readClipboardFiles();
  expect(files).toHaveLength(1);
  expect(files[0].type).toBe("image/png");
  expect(files[0].size).toBe(5);
  expect(invoke).toHaveBeenCalledWith("read_clipboard_image");
});

it("ne prépare aucune pièce jointe pour un presse-papiers texte", async () => {
  invoke.mockImplementation(async (command: string) => command === "read_clipboard_files" ? [] : new ArrayBuffer(0));
  expect(await readClipboardFiles()).toEqual([]);
});

it("conserve le repli image si le binaire ne fournit pas encore la lecture des fichiers copiés", async () => {
  invoke.mockImplementation(async (command: string) => {
    if (command === "read_clipboard_files") throw new Error("unknown command");
    return png;
  });
  expect((await readClipboardFiles())[0].type).toBe("image/png");
});
