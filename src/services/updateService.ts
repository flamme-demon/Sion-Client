/** GitHub release selection. Installation is handled by the native updater. */
export const GITHUB_REPO = "flamme-demon/Sion-Client";
const CHECK_INTERVAL = 60 * 60 * 1000;

export interface ReleaseAsset { name: string; browser_download_url: string }
export interface Release {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
  body?: string;
  assets: ReleaseAsset[];
}
export interface UpdateInfo {
  tag: string;
  version: string;
  channel: "stable" | "alpha" | "beta" | "rc" | "experimental";
  downloadUrl: string;
  releaseUrl: string;
  notes: string;
  integrated: boolean;
}

function parseVersion(version: string) {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*))?(?:\+[\da-zA-Z-]+(?:\.[\da-zA-Z-]+)*)?$/.exec(version);
  if (!match) return null;
  const pre = match[4]?.split(".") ?? [];
  if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0")) return null;
  return { core: match.slice(1, 4).map(BigInt), pre };
}

/** SemVer precedence, including numeric prerelease identifiers (beta.10 > beta.9). */
export function compareVersions(a: string, b: string): number {
  const av = parseVersion(a), bv = parseVersion(b);
  if (!av || !bv) throw new Error("Invalid version");
  for (let i = 0; i < 3; i++) {
    if (av.core[i] !== bv.core[i]) return av.core[i] > bv.core[i] ? 1 : -1;
  }
  if (!av.pre.length || !bv.pre.length) return Number(!av.pre.length) - Number(!bv.pre.length);
  for (let i = 0; i < Math.max(av.pre.length, bv.pre.length); i++) {
    const x = av.pre[i], y = bv.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x), ny = /^\d+$/.test(y);
    if (nx && ny) return BigInt(x) > BigInt(y) ? 1 : -1;
    if (nx !== ny) return nx ? -1 : 1;
    return x > y ? 1 : -1;
  }
  return 0;
}

export function getAsset(assets: ReleaseAsset[], platform: string): ReleaseAsset | undefined {
  return assets.find((asset) => {
    const name = asset.name.toLowerCase();
    if (platform === "android-aarch64") return name.endsWith(".apk") && /arm64|aarch64|universal/.test(name);
    if (platform === "windows-x86_64") return name.endsWith(".exe") && !/uninstall|arm64|aarch64/.test(name);
    if (platform === "linux-x86_64") return name.endsWith(".appimage") && !/arm64|aarch64/.test(name);
    return false;
  });
}

export function selectUpdate(releases: Release[], current: string, experimental: boolean, platform: string): UpdateInfo | null {
  const candidates = releases.filter((release) => {
    const version = parseVersion(release.tag_name);
    return version && !release.draft &&
      (experimental || (!release.prerelease && !version.pre.length)) &&
      compareVersions(release.tag_name, current) > 0 && getAsset(release.assets ?? [], platform);
  }).sort((a, b) => compareVersions(b.tag_name, a.tag_name));
  const latest = candidates[0];
  if (!latest) return null;
  const version = latest.tag_name.replace(/^v/, "");
  const prerelease = parseVersion(version)!.pre[0];
  const channel = !prerelease ? "stable" : ["alpha", "beta", "rc"].includes(prerelease)
    ? prerelease as "alpha" | "beta" | "rc" : "experimental";
  return {
    tag: latest.tag_name, version, channel,
    downloadUrl: getAsset(latest.assets, platform)!.browser_download_url,
    releaseUrl: latest.html_url || `https://github.com/${GITHUB_REPO}/releases/tag/${latest.tag_name}`,
    notes: latest.body ?? "",
    integrated: platform.startsWith("android-") || latest.assets.some((asset) => asset.name === "updater.json"),
  };
}

const cache = new Map<string, { time: number; update: UpdateInfo | null }>();
export async function checkForUpdate(experimental = false, force = false): Promise<UpdateInfo | null> {
  let platform: string;
  if (window.__TAURI_INTERNALS__) {
    const { invoke } = await import("@tauri-apps/api/core");
    platform = await invoke<string>("update_platform");
  } else {
    platform = /Android/.test(navigator.userAgent) ? "android-aarch64" :
      /Windows/.test(navigator.userAgent) ? "windows-x86_64" : "linux-x86_64";
  }
  const key = `${experimental}:${platform}`;
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.time < CHECK_INTERVAL) return cached.update;
  const releases: Release[] = [];
  // Releases are ordered by publication date, not SemVer. Examine multiple pages.
  for (let page = 1; page <= 5; page++) {
    const response = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=100&page=${page}`, {
      headers: { Accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
    const batch = await response.json() as Release[];
    if (!Array.isArray(batch)) throw new Error("Invalid release response");
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const update = selectUpdate(releases, __APP_VERSION__, experimental, platform);
  // Failed requests never poison the hourly cache.
  cache.set(key, { time: Date.now(), update });
  return update;
}
