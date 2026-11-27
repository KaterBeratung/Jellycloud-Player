# Code signing policy

Free code signing provided by [SignPath.io](https://about.signpath.io/), certificate by [SignPath Foundation](https://signpath.org/).

*Deutsch: Die Windows-Installer von Jellycloud Player werden kostenlos über SignPath.io signiert, das Zertifikat stellt die SignPath Foundation aus. In Windows steht deshalb „SignPath Foundation“ als Herausgeber.*

## What is signed

- The Windows installer `Jellycloud-Player-Setup-<version>.exe` published in the [releases](https://github.com/KaterBeratung/Jellycloud-Player/releases) of this repository.
- Only installers built by the GitHub Actions workflow [`.github/workflows/windows-release.yml`](.github/workflows/windows-release.yml) from the source code in this repository are submitted for signing. Nothing built on a private machine is signed.
- Third-party programs bundled with the installer (mpv, see [`THIRD-PARTY.txt`](THIRD-PARTY.txt)) are taken unchanged from their upstream release and verified against fixed SHA-256 checksums ([`tools/fetch-mpv.ps1`](tools/fetch-mpv.ps1)); they are not re-signed with this certificate.
- The Android app (APK) is not part of this signing process.

## Team roles

| Role | Members |
| --- | --- |
| Committers and reviewers | [KaterBeratung](https://github.com/KaterBeratung) |
| Approvers | [KaterBeratung](https://github.com/KaterBeratung) |

Every signing request is approved manually by an approver. All team members use multi-factor authentication for GitHub and SignPath.

## Privacy policy

This program will not transfer any information to other networked systems unless specifically requested by the user or the person installing or operating it, with the following exceptions that are part of its function:

- **Your media server:** the program connects to the Jellyfin server you sign in to (and, if you set one up, to your Seerr server) to browse and play your library and to report playback progress to that server. With Seerr connected, posters of titles that are not in your library are loaded from TMDB (`image.tmdb.org`).
- **Update check:** shortly after start and every few hours the program downloads `latest.json` from the releases of this GitHub repository to see whether a newer version exists. No personal data is sent; GitHub receives the usual request data (IP address, user agent).
- **Trailers:** trailers are played from YouTube (`youtube-nocookie.com`) when trailer playback is enabled (it can be switched off in the settings).
- **Discord Rich Presence:** only if you switch it on, the program tells the Discord app running on the same computer what you are watching (Discord then shows it to people who can see your profile).

The program contains no analytics, telemetry or advertising.
