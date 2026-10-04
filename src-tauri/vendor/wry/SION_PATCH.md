# Patch Sion — wry 0.55.1

## Problème

Sous Linux, le processus web de WebKitGTK (2.52, moteur Skia) mesure son
empreinte par la RSS brute (`/proc/self/statm`), pages partagées des polices
comprises, contre une limite de min(3 Go, RAM) :

- au-delà de 0,33 × la limite (1014 Mo), il purge ses caches toutes les 30 s
  (`MemoryPressureHandler::measurementTimerFired` → `releaseNoncriticalMemory`) ;
- chaque purge vide le cache des polices de repli
  (`SkiaSystemFallbackFontCache::clear`) ; la mise en page suivante recrée une
  `SkTypeface` par police de repli, avec un nouveau mmap du fichier entier,
  et l'ancienne n'est jamais libérée (même après rechargement de la page) ;
- chaque copie (NotoColorEmoji : 10,7 Mo) gonfle la RSS, ce qui entretient
  les purges : +700 Mo/h mesurés ;
- sans seuil de mise à mort réglé, WebKit tue à 4 Go un processus dont la
  page n'a pas le focus (3 Go + 1 Go par page) : « Unable to shrink memory
  footprint of process (8521 MB) below the kill thresold (4096 MB) » après
  22 h d'ouverture.

La vraie RAM consommée (PSS) reste faible : ce sont des pages de fichier
partagées. Mais WebKit les compte, se croit sous pression, et se tue.

L'accumulation des copies n'a été vue qu'avec GDK en X11 (essai du 04/10,
purges forcées toutes les 30 s, emoji affiché) : +1 copie par purge en X11,
une seule copie stable en Wayland. Les purges, elles, ont lieu dans les deux
cas dès 1 Go de RSS, et la mise à mort à 4 Go aussi.

Les seuils se règlent par la propriété `memory-pressure-settings` du
`WebKitWebContext`, uniquement à sa construction (*construct-only*). Or wry
construit ce contexte lui-même. Il n'existe pas de variable d'environnement
côté WebKit.

## Correctif

`src/webkitgtk/web_context.rs` : `WebContextImpl::new` passe des
`MemoryPressureSettings` au constructeur du contexte :

- limite = RAM du système, bornée entre 3 et 16 Go : les purges ne
  commencent plus qu'au tiers de la RAM ;
- seuil de mise à mort explicite à 1,0 × la limite ;
- `SION_WEBKIT_MEMORY_LIMIT_MB` force la limite, pour le diagnostic
  seulement : une limite basse ramène les purges tout de suite.

La pression mémoire réelle du système reste signalée au processus web par le
moniteur de WebKit (côté interface), qui purge alors comme avant.

## Vérifier

Compter les copies de la police emoji dans le processus web :
`grep -c NotoColorEmoji /proc/<pid WebKitWebProcess>/maps`. Le chiffre
doit rester stable sur des heures, sans grimper de 1 toutes les 30 s.

Les purges se voient avec l'inspecteur distant (`Memory.enable`, événement
`Memory.memoryPressure`). Essai du 04/10 sur 64 Go de RAM : à 1 425 Mo de
RSS, aucune purge avec le patch ; avec `SION_WEBKIT_MEMORY_LIMIT_MB=1500`,
une purge toutes les 30 s dès 550 Mo, ce qui confirme que le réglage atteint
bien le processus web.

## Retrait

Supprimer ce fork et l'entrée `wry` de `[patch.crates-io]` si wry (ou Tauri)
permet de fournir les réglages de pression mémoire, ou si WebKit cesse de
compter les pages partagées et de remapper ses polices de repli.
