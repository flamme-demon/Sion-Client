import { invoke } from "@tauri-apps/api/core";

export interface EtatDiagnostic {
  actif: boolean;
  expire_a: number;
  plateforme: string;
  capture_disponible: boolean;
  capture_active: boolean;
  capture_erreur: string | null;
  rapports: number;
  taille_rapports: number;
}

export const obtenirDiagnostic = () => invoke<EtatDiagnostic>("diagnostic_etat");
export const configurerDiagnostic = (active: boolean) => invoke<EtatDiagnostic>("diagnostic_configurer", { active });
export const configurerCaptureDiagnostic = (active: boolean) => invoke<EtatDiagnostic>("diagnostic_configurer_capture", { active });
export const exporterDiagnostic = (inclureCrashs: boolean) => invoke<string | null>("diagnostic_exporter", { inclureCrashs });
export const ouvrirDossierDiagnostic = (crashs = false) => invoke<void>("diagnostic_ouvrir_dossier", { crashs });
