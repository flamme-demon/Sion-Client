/** Le visuel existe dès le HTML, avant l'hydratation des stores et React. */
let terminer: (() => void) | undefined;

export function initialiserDemarrage(): void {
  const cadre = document.getElementById("sion-demarrage");
  const video = cadre?.querySelector<HTMLVideoElement>("video");
  if (!cadre || !video || terminer) return;
  const reduit = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobile = window.matchMedia("(max-width: 767px)").matches;
  let pret = false;
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const libererVideo = () => {
    video.pause();
    video.removeAttribute("src");
    video.load();
  };
  const jouer = () => {
    if (pret || reduit.matches || document.hidden || video.ended || !video.hasAttribute("src")) return;
    try { void video.play()?.catch(() => { /* Le poster reste visible. */ }); }
    catch { /* Certains WebViews refusent la lecture automatique. */ }
  };
  const visible = () => { if (document.hidden) video.pause(); else jouer(); };
  const joue = () => { if (!pret && !reduit.matches && video.hasAttribute("src")) cadre.dataset.videoPrete = "true"; };
  const sansVideo = () => {
    delete cadre.dataset.videoPrete;
    libererVideo();
  };
  const sansAnimation = () => { if (reduit.matches) sansVideo(); };
  video.addEventListener("playing", joue);
  video.addEventListener("error", sansVideo);
  document.addEventListener("visibilitychange", visible);
  reduit.addEventListener("change", sansAnimation);
  if (!reduit.matches) {
    video.muted = true;
    video.playsInline = true;
    video.src = `/branding/demarrage-${mobile ? "mobile" : "desktop"}.mp4`;
    jouer();
  }

  const enlever = () => {
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    video.removeEventListener("playing", joue);
    video.removeEventListener("error", sansVideo);
    document.removeEventListener("visibilitychange", visible);
    reduit.removeEventListener("change", sansAnimation);
    libererVideo();
    cadre.remove();
    terminer = undefined;
  };
  terminer = () => {
    if (pret) return;
    pret = true;
    // Aucun délai imposé par la vidéo : l'interface est utilisable dès ce point.
    cadre.style.pointerEvents = "none";
    if (document.hidden || reduit.matches) { enlever(); return; }
    frame = requestAnimationFrame(() => {
      cadre.dataset.termine = "true";
      timer = setTimeout(enlever, 180);
    });
  };
}

/** Appelé après le rendu de la connexion ou de l'interface authentifiée. */
export function terminerDemarrage(): void { terminer?.(); }
