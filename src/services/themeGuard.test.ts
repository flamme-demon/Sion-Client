// @vitest-environment node
import { describe, expect, it } from "vitest";

// Keep Node bindings local: the browser TypeScript project excludes Node globals.
type Fs = {
  mkdtempSync(prefix: string): string;
  mkdirSync(path: string): void;
  readFileSync(path: string, encoding: "utf8"): string;
  readdirSync(path: string, options: { withFileTypes: true }): {
    name: string; isDirectory(): boolean; isFile(): boolean;
  }[];
  rmSync(path: string, options: { recursive: true; force: true }): void;
  writeFileSync(path: string, data: string): void;
};
const { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } =
  (await import(/* @vite-ignore */ "node:fs" as string)) as Fs;
const { tmpdir } = (await import(/* @vite-ignore */ "node:os" as string)) as { tmpdir(): string };
const { join } = (await import(/* @vite-ignore */ "node:path" as string)) as { join(...paths: string[]): string };
const { fileURLToPath } = (await import(/* @vite-ignore */ "node:url" as string)) as { fileURLToPath(url: URL): string };

/**
 * Garde anti-couleurs-en-dur (§3.3 de `docs/roadmap-2.0.0.md`).
 *
 * Une couleur écrite en dur court-circuite le système de thèmes : elle reste
 * identique quelle que soit la palette choisie. Ce test échoue si un nouveau
 * `#hex` apparaît sous `src/` — `src/themes/` excepté, puisque c'est là que
 * les couleurs ont le droit d'exister.
 *
 * Deux échappatoires, volontairement explicites :
 *
 * 1. `themeColor("--token", "#repli")` — le repli n'est qu'un filet si le
 *    token manque (canvas 2D, test), la couleur réelle vient du thème.
 * 2. Une ligne marquée `theme-exempt` — couleurs volontairement hors thème
 *    (esthétique Matrix, habillages posés sur des pixels média : letterbox
 *    du partage, contrôles du visualiseur plein écran).
 */

/** Marqueur d'exemption : présent sur la ligne, il la sort du garde. */
const EXEMPTION_MARKER = "theme-exempt";

/** `themeColor("--color-x", "#fallback")` — repli autorisé (pas de capture). */
const THEME_COLOR_CALL = /themeColor\(\s*["'`][^"'`]*["'`]\s*,\s*["'`][^"'`]*["'`]\s*\)/g;

/** Toute couleur hexadécimale : #fff, #a8c7fa, #11223344. */
const HARDCODED_HEX = /#[0-9a-fA-F]{3,8}\b/g;

const SOURCE_ROOT = fileURLToPath(new URL("../", import.meta.url));

// Read current files on every scan, independently of Vite's transformed modules.
function readSources(root: string): Record<string, string> {
  const sources: Record<string, string> = {};
  function visit(relative: string) {
    for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (path !== "themes") visit(path);
      } else if (entry.isFile() && /\.(ts|tsx)$/.test(path) && !/\.test\.(ts|tsx)$/.test(path)) {
        sources[`../${path}`] = readFileSync(join(root, path), "utf8");
      }
    }
  }
  visit("");
  return sources;
}

export interface Offender {
  file: string;
  line: number;
  text: string;
}

/** Remplace les commentaires par des espaces — numéros de ligne préservés. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, "");
}

export function findHardcodedColors(files: Record<string, string>): Offender[] {
  const offenders: Offender[] = [];
  for (const [file, source] of Object.entries(files)) {
    const rawLines = source.split("\n");
    const codeLines = stripComments(source).split("\n");
    rawLines.forEach((raw, i) => {
      if (raw.includes(EXEMPTION_MARKER)) return;
      const code = (codeLines[i] ?? "").replace(THEME_COLOR_CALL, "");
      for (const match of code.matchAll(HARDCODED_HEX)) {
        offenders.push({ file, line: i + 1, text: match[0] });
      }
    });
  }
  return offenders;
}

describe("garde anti-couleurs-en-dur", () => {
  it("repère les hex en dur et tolère uniquement les formes prévues", () => {
    const offenders = findHardcodedColors({
      "exemple.tsx": [
        "const interdit = '#ff0000';", // → violation
        "const repli = themeColor('--color-amber', '#fbbf24');", // repli autorisé
        "const matrix = '#0f0'; // theme-exempt — esthétique Matrix", // exempté
        "// un commentaire qui mentionne #abcdef ne compte pas",
        "/* bloc : #123456 */ const ok = 1;",
      ].join("\n"),
    });
    expect(offenders).toEqual([{ file: "exemple.tsx", line: 1, text: "#ff0000" }]);
  });

  it("le balayage voit bien les sources de l'app", () => {
    expect(Object.keys(readSources(SOURCE_ROOT)).length).toBeGreaterThan(80);
  });

  it("reads new and edited files on each scan while excluding tests and theme definitions", () => {
    const root = mkdtempSync(join(tmpdir(), "sion-theme-guard-"));
    try {
      mkdirSync(join(root, "components"));
      mkdirSync(join(root, "themes"));
      writeFileSync(join(root, "themes", "palette.ts"), 'const color = "#123456";');
      writeFileSync(join(root, "components", "example.test.tsx"), 'const color = "#123456";');
      expect(readSources(root)).toEqual({});
      const component = join(root, "components", "route.tsx");
      writeFileSync(component, 'const shadow = "0 6px 24px #0006";');
      expect(findHardcodedColors(readSources(root))).toEqual([
        { file: "../components/route.tsx", line: 1, text: "#0006" },
      ]);
      writeFileSync(component, 'const color = "var(--color-outline)";');
      expect(findHardcodedColors(readSources(root))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("aucune couleur en dur sous src/ (hors src/themes/)", () => {
    const offenders = findHardcodedColors(readSources(SOURCE_ROOT)).map(
      (o) => `${o.file.replace(/^.*\/src\//, "")}:${o.line} — ${o.text}`,
    );
    expect(offenders).toEqual([]);
  });
});
