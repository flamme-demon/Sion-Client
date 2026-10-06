import { invoke } from "@tauri-apps/api/core";
import { definirLecteurActif } from "./lecteurActif";
import { clearCache } from "../utils/messageCache";

/** Efface uniquement des données régénérables. La session, les préférences
 * et les magasins de chiffrement restent intacts. */
export async function purgerCachesApplication(): Promise<void> {
  definirLecteurActif(null);
  if ("__TAURI_INTERNALS__" in window) {
    await invoke("purger_caches_medias");
  }
  await clearCache();
}
