mpv fuer Jellycloud Player
==========================

Hier liegt der mitgelieferte mpv-Build (Windows x86_64):
  mpv 0.41.0-1374-g48fca90e8 vom 2026-11-01, Build von shinchiro/mpv-winbuild-cmake
  Quelle: https://github.com/shinchiro/mpv-winbuild-cmake/releases/tag/20261101 (von https://mpv.io/installation/ verlinkt)
  Archiv: mpv-x86_64-20261101-git-48fca90e8c.7z
  SHA-256: 7a887a10b74c1a4a7e8c29ead8300cfc610c466c4686bf9dcb92ca2f224ba110 (gegen die GitHub-Angabe geprueft)

mpv ist FEST in die App eingebaut: Der Installer (npm run dist) packt diesen Ordner nach "resources\mpv", und die App
verwendet ausschliesslich dieses mpv (im Entwicklungsmodus den Ordner vendor\mpv). Es gibt in der App bewusst keine
Auswahl eines anderen mpv, keinen PATH-Lookup und keine eigene mpv.conf.

Andere mpv-Version einbauen (nur fuer Entwickler): mpv.exe (und ggf. DLLs) hier ersetzen und den Installer neu bauen.

mpv steht unter GPL/LGPL: https://github.com/mpv-player/mpv  Bei Weitergabe des Installers die Lizenzbedingungen beachten.
