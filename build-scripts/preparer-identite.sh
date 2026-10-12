#!/usr/bin/env bash
# Regénère les ressources à partir du dossier de visuels fourni pour Sion.
set -euo pipefail
if [ "$#" -ne 1 ]; then
    echo "Usage : $0 <dossier-des-visuels>" >&2
    exit 1
fi
VISUELS=$(realpath "$1")
PROJET=$(cd "$(dirname "$0")/.." && pwd)
cd "$PROJET"
TEMP_IDENTITE=$(mktemp -d)
trap 'rm -rf "$TEMP_IDENTITE"' EXIT
cp "$VISUELS/Logo-light-couleur-transparent.png" "$TEMP_IDENTITE/logo.png"
cat > "$TEMP_IDENTITE/fond.svg" <<'EOF'
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024"><path fill="#050907" d="M0 0h1024v1024H0z" /></svg>
EOF
cat > "$TEMP_IDENTITE/icones.json" <<'EOF'
{"default":"logo.png","bg_color":"#050907","android_bg":"fond.svg","android_fg":"logo.png","android_fg_scale":85}
EOF
bun run tauri icon "$TEMP_IDENTITE/icones.json" --output "$TEMP_IDENTITE/icones"
# Tauri n'applique android_fg_scale qu'aux icônes classiques. Le premier plan
# adaptatif doit garder sa propre marge : 64 % place toute la tête, oreilles
# comprises, dans le cercle protégé de 66 dp sur une couche de 108 dp.
for PREMIER_PLAN in "$TEMP_IDENTITE"/icones/android/mipmap-*/ic_launcher_foreground.png; do
    TAILLE=$(ffprobe -v error -select_streams v:0 -show_entries stream=width -of csv=p=0 "$PREMIER_PLAN")
    ffmpeg -nostdin -y -hide_banner -loglevel error -i "$PREMIER_PLAN" \
        -vf "scale=trunc(iw*0.64):trunc(ih*0.64):flags=lanczos,pad=$TAILLE:$TAILLE:(ow-iw)/2:(oh-ih)/2:color=black@0,format=rgba" \
        -frames:v 1 "$TEMP_IDENTITE/premier-plan.png"
    mv "$TEMP_IDENTITE/premier-plan.png" "$PREMIER_PLAN"
done
mkdir -p "$TEMP_IDENTITE/icones/android/values"
cat > "$TEMP_IDENTITE/icones/android/values/ic_launcher_background.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources><color name="ic_launcher_background">#050907</color></resources>
EOF
cp -R "$TEMP_IDENTITE/icones/." src-tauri/icons/
mkdir -p public/branding
cp src-tauri/icons/32x32.png public/branding/favicon.png
cp -R src-tauri/icons/android/. src-tauri/gen/android/app/src/main/res/
for FORMAT in mobile desktop; do
    if [ "$FORMAT" = mobile ]; then
        SOURCE_VIDEO="$VISUELS/splash-screen-mobile-couleur-anime.mp4"
    else
        SOURCE_VIDEO="$VISUELS/bandeau-logo+text-couleur-anime.mp4"
    fi
    ffmpeg -nostdin -y -hide_banner -loglevel error -i "$SOURCE_VIDEO" \
        -vf reverse -an -c:v libx264 -profile:v main -preset medium -crf 23 \
        -pix_fmt yuv420p -movflags +faststart -threads 2 "public/branding/demarrage-$FORMAT.mp4"
    ffmpeg -nostdin -y -hide_banner -loglevel error -i "public/branding/demarrage-$FORMAT.mp4" \
        -frames:v 1 -c:v libwebp -quality 88 "public/branding/demarrage-$FORMAT.webp"
done
ffmpeg -nostdin -y -hide_banner -loglevel error -i "$VISUELS/Logo-light-couleur-transparent.png" \
    -vf scale=256:256 -frames:v 1 -c:v libwebp -quality 90 public/branding/logo.webp
ffmpeg -nostdin -y -hide_banner -loglevel error -i "$VISUELS/Logo+Text-couleur.png" \
    -vf scale=720:-2 -frames:v 1 -c:v libwebp -quality 90 public/branding/logo-texte.webp
