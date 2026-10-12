export type CameraBackground = "none" | "blur" | "image" | "aurora" | "sion";
export type CameraFilter = "none" | "mono" | "cinema" | "vhs" | "pixel";
export type CameraAccessory = "none" | "glasses" | "moustache" | "laugh";
export interface CameraEffects {
  background: CameraBackground; backgroundPath: string; backgroundName: string;
  blur: number; filter: CameraFilter; light: boolean; autoFrame: boolean;
  outline: boolean; accent: string; accessory: CameraAccessory;
}
export const DEFAULT_CAMERA_EFFECTS: CameraEffects = {
  background: "none", backgroundPath: "", backgroundName: "", blur: 12,
  filter: "none", light: false, autoFrame: false, outline: false,
  accent: "#78c8b0", // theme-exempt — repli du contour vidéo ; le panneau transmet la couleur du thème.
  accessory: "none",
};
export interface CameraEffectsStatus { ready: boolean; error: string | null; renderMs: number; analysisMs: number }
