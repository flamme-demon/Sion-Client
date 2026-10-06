import { describe, expect, it } from "vitest";
import { isMissingUpdaterCommand } from "./updateError";

describe("missing native updater", () => {
  it("recognizes frontend/native version mismatches", () => {
    for (const command of ["update_platform", "update_download", "update_install"]) {
      expect(isMissingUpdaterCommand(`Command ${command} not found`)).toBe(true);
      expect(isMissingUpdaterCommand(new Error(`Command ${command} not found`))).toBe(true);
    }
  });
  it("preserves network, permission and unrelated command errors", () => {
    for (const error of ["GitHub HTTP 403", "Command update_install not allowed", "Command matrix_etat not found", null]) {
      expect(isMissingUpdaterCommand(error)).toBe(false);
    }
  });
});
