// Jellyfin-CSS (jellyfin-css/jellycloud.css): 1) Quelltext der Datei, 2) die nachgebaute Vorschauseite (jellyfin-css/preview.html), 3) optional gegen einen echten
// laufenden Jellyfin-Server (Umgebung JF_URL und JF_TOKEN_FILE: Datei mit Zugriffsschluessel und Benutzer-Id in zwei Zeilen), wie es im Browser aussieht.
// Bilder: SHOT_DIR (Standard: ./shots). Die Vorschau ist nachgebaut, nur Teil 3 beweist etwas ueber ein echtes Jellyfin.
//   $env:JC_DEV='1'; electron . --user-data-dir=$env:TEMP\jc-test --shots=tools/shots/jellyfin-css.js
//   mit echtem Server: zusaetzlich $env:JF_URL='http://127.0.0.1:8096'; $env:JF_TOKEN_FILE='<datei>'
const path = require('node:path');
const fs = require('node:fs');
const root = path.join(__dirname, '..', '..');

module.exports = async (ctx) => {
  const out = process.env.SHOT_DIR || path.join(root, 'shots');
  fs.mkdirSync(out, { recursive: true });
  let pass = 0;
  let fail = 0;
  const check = (name, ok, detail = '') => {
    if (ok) pass++;
    else fail++;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
  };
  const errors = [];
  ctx.win.webContents.on('console-message', (e) => {
    if (e.level === 'error' || e.level >= 3) errors.push(`${e.message} (${e.sourceId}:${e.lineNumber})`);
  });

  // ---------- Teil 1: Quelltext der Datei ----------
  const cssPath = path.join(root, 'jellyfin-css', 'jellycloud.css');
  const css = fs.readFileSync(cssPath, 'utf8');
  check('Datei ist reines ASCII (laesst sich ohne Zeichensatz-Probleme ins Dashboard einfuegen)', /^[\x00-\x7f]*$/.test(css));
  const noComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  check('Klammern sind ausgeglichen', (noComments.match(/\{/g) || []).length === (noComments.match(/\}/g) || []).length, `${(noComments.match(/\{/g) || []).length} Bloecke`);
  const cardBlur = [...noComments.matchAll(/([^{}]+)\{([^{}]*backdrop-filter\s*:\s*blur[^{}]*)\}/g)].filter((m) => /\.card|cardOverlay|cardScalable|\.itemsContainer/.test(m[1]));
  check('Auf Karten gibt es keinen Weichzeichner (backdrop-filter)', cardBlur.length === 0, cardBlur.map((m) => m[1].trim().slice(0, 60)).join(' | '));
  check('Es werden keine fremden Adressen geladen (kein @import, kein url(http))', !/@import|url\(\s*['"]?https?:/i.test(noComments));
  check('Das CSS ist eigener Code: keine Variablen- oder Klassennamen von ElegantFin (GPL-2.0) uebernommen', !/--largerRadius|--largeRadius|--smallRadius|--smallerRadius|--cardHoverEffect|--appBarSeamlessBlur|--headerColor/.test(css));

  const nz = (v) => v && v !== 'none' && v !== 'normal' && v !== 'rgba(0, 0, 0, 0)';
  const rgbOf = (v) => (/rgba?\((\d+), (\d+), (\d+)/.exec(v ?? '') ?? []).slice(1, 4).map(Number);

  // ---------- Teil 2: Vorschauseite ----------
  ctx.win.setContentSize(1600, 900);
  await ctx.win.loadFile(path.join(root, 'jellyfin-css', 'preview.html'));
  await ctx.wait(1200);
  const s = (sel, prop) => ctx.run(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? getComputedStyle(e)[${JSON.stringify(prop)}] : null; })()`);

  check('Vorschau: die Stylesheet-Datei wurde geladen (Seitenhintergrund ist das Blau-Grau #111827)', (await s('body', 'backgroundColor')) === 'rgb(17, 24, 39)', await s('body', 'backgroundColor'));
  check('Vorschau: Schrift ist Segoe UI', /Segoe UI/.test(await s('body', 'fontFamily')));
  check('Vorschau: Kopfzeile (alte Leiste) ist weich gezeichnet', /blur/.test((await s('.skinHeader', 'backdropFilter')) ?? ''));
  const tab = rgbOf(await s('.emby-tab-button-active', 'backgroundColor'));
  check('Vorschau: der gewaehlte Tab ist eine Indigo-Kapsel mit weisser Schrift', tab.length === 3 && tab[2] > tab[0] + 80 && (await s('.emby-tab-button-active', 'color')) === 'rgb(255, 255, 255)' && parseFloat(await s('.emby-tab-button-active', 'borderTopLeftRadius')) > 100, `${tab}`);
  check('Vorschau: Karten sind abgerundet (1 em)', parseFloat(await s('#row2 .cardScalable', 'borderTopLeftRadius')) >= 14, await s('#row2 .cardScalable', 'borderTopLeftRadius'));
  check('Vorschau: Karten haben keinen Weichzeichner', ((await s('#row2 .cardScalable', 'backdropFilter')) ?? 'none') === 'none' && ((await s('#row2 .cardOverlayFab-primary', 'backdropFilter')) ?? 'none') === 'none');
  check('Vorschau: Reihentitel fett in der Anzeigeschrift', parseFloat(await s('.sectionTitle', 'fontSize')) >= 20 && (await s('.sectionTitle', 'fontWeight')) === '700');
  check('Vorschau: Abspielknopf der Detailseite ist die helle Kapsel mit dunkler Schrift', (await s('.mainDetailButtons .btnPlay', 'backgroundColor')) === 'rgb(255, 255, 255)' && (await s('.mainDetailButtons .btnPlay', 'color')) === 'rgb(17, 24, 39)' && parseFloat(await s('.mainDetailButtons .btnPlay', 'borderTopLeftRadius')) > 100);
  check('Vorschau: Bestaetigen-Knopf ist die Akzentflaeche', (rgbOf(await s('.button-submit', 'backgroundColor'))[2] ?? 0) > 200);
  check('Vorschau: Eingabefeld hat Rundung und blau-grauen Grund', parseFloat(await s('.emby-input', 'borderTopLeftRadius')) >= 6 && nz(await s('.emby-input', 'backgroundColor')) && (rgbOf(await s('.emby-input', 'backgroundColor'))[2] ?? 0) > (rgbOf(await s('.emby-input', 'backgroundColor'))[0] ?? 255));
  check('Vorschau: Menue-Dialog ist durchscheinend mit Rundung', /blur/.test((await s('.dialog', 'backdropFilter')) ?? '') && parseFloat(await s('.dialog', 'borderTopLeftRadius')) >= 14);

  check('Vorschau Media Bar: Abspielen ist die helle Kapsel', (await s('#slides-container .play-button', 'backgroundColor')) === 'rgb(255, 255, 255)' && parseFloat(await s('#slides-container .play-button', 'borderTopLeftRadius')) > 100);
  check('Vorschau Media Bar: Details und Favorit sind runde Knoepfe ohne Weichzeichner', (await s('#slides-container .detail-button', 'borderTopLeftRadius')) === '50%' && ((await s('#slides-container .favorite-button', 'backdropFilter')) ?? 'none') === 'none');
  check('Vorschau Media Bar: Seitenpunkte liegen in einer Kapsel', parseFloat(await s('#slides-container .dots-container', 'borderTopLeftRadius')) > 100 && /blur/.test((await s('#slides-container .dots-container', 'backdropFilter')) ?? ''));
  check('Vorschau Media Bar: der aktive Punkt ist eine laengere Pille (28 px), die anderen 8 px', (await s('#slides-container .dot.active', 'width')) === '28px' && (await s('#slides-container .dot:not(.active)', 'width')) === '8px');
  check('Vorschau Media Bar: Pfeile sind runde Knoepfe', (await s('#slides-container .arrow', 'borderTopLeftRadius')) === '50%');
  check('Vorschau Media Bar: die Altersfreigabe ist ein Rahmen ohne Flaeche', (await s('#slides-container .age-rating', 'backgroundColor')) === 'rgba(0, 0, 0, 0)' && parseFloat(await s('#slides-container .age-rating', 'borderTopWidth')) > 0);
  check('Vorschau Media Bar: die Abdunklung ist ein dreifacher Verlauf', ((await s('#slides-container .gradient-overlay', 'backgroundImage')) ?? '').split('linear-gradient').length - 1 === 3);
  check('Vorschau Media Bar: Seitenrand folgt --jc-pad', (await ctx.run(`getComputedStyle(document.documentElement).getPropertyValue('--slideshow-gutter').trim()`)) === (await ctx.run(`getComputedStyle(document.documentElement).getPropertyValue('--jc-pad').trim()`)));

  // Akzentfarbe umstellen: alles folgt den Variablen
  await ctx.run(`document.documentElement.style.setProperty('--jc-accent', '#2fa36b'); document.documentElement.style.setProperty('--jc-accent-rgb', '47 163 107'); document.documentElement.style.setProperty('--jc-accent-ink', '#ffffff')`);
  await ctx.wait(300);
  check('Vorschau: eigene Akzentfarbe: Tab und Bestaetigen-Knopf wechseln mit', (await s('.emby-tab-button-active', 'backgroundColor')) === 'rgb(47, 163, 107)' && (await s('.button-submit', 'backgroundColor')) === 'rgb(47, 163, 107)', `${await s('.emby-tab-button-active', 'backgroundColor')} / ${await s('.button-submit', 'backgroundColor')}`);
  await ctx.capture(path.join(out, 'jellyfin-css-vorschau-gruen.png'));
  await ctx.run(`document.documentElement.style.removeProperty('--jc-accent'); document.documentElement.style.removeProperty('--jc-accent-rgb'); document.documentElement.style.removeProperty('--jc-accent-ink')`);
  await ctx.wait(300);
  await ctx.capture(path.join(out, 'jellyfin-css-vorschau-home.png'));
  await ctx.run(`window.scrollTo(0, 99999)`);
  await ctx.wait(400);
  await ctx.capture(path.join(out, 'jellyfin-css-vorschau-detail.png'));

  ctx.win.setMinimumSize(300, 300); // das App-Fenster ist sonst nicht schmaler als 920 px
  ctx.win.setContentSize(390, 800);
  await ctx.wait(500);
  check('Vorschau, schmales Fenster: die Rundung der Karten sinkt', parseFloat(await s('#row2 .cardScalable', 'borderTopLeftRadius')) < parseFloat('15') && parseFloat(await s('#row2 .cardScalable', 'borderTopLeftRadius')) > 8, await s('#row2 .cardScalable', 'borderTopLeftRadius'));
  check('Vorschau, schmales Fenster: kein waagerechtes Scrollen der ganzen Seite', await ctx.run(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`), await ctx.run(`document.documentElement.scrollWidth + ' / ' + document.documentElement.clientWidth`));
  ctx.win.setContentSize(1600, 900);

  // ---------- Teil 3: echter Jellyfin-Server (optional) ----------
  const URL = process.env.JF_URL;
  if (URL && process.env.JF_TOKEN_FILE) {
    const [tok, uid] = fs.readFileSync(process.env.JF_TOKEN_FILE, 'utf8').split(/\r?\n/);
    const load = async (hash) => {
      await ctx.win.loadURL('about:blank'); // nur ein anderer #-Teil laedt nicht neu
      await ctx.win.loadURL(`${URL}/web/index.html${hash}`);
      await ctx.wait(7500);
    };
    await ctx.win.loadURL(`${URL}/web/index.html`);
    await ctx.wait(3000);
    const sid = await ctx.run(`fetch('/System/Info/Public').then((r) => r.json()).then((j) => j.Id)`);
    const ver = await ctx.run(`fetch('/System/Info/Public').then((r) => r.json()).then((j) => j.Version)`);
    await ctx.run(`localStorage.setItem('jellyfin_credentials', JSON.stringify({ Servers: [{ ManualAddress: '${URL}', manualAddressOnly: true, Id: '${sid}', Name: 'Test', AccessToken: '${tok}', UserId: '${uid}', DateLastAccessed: Date.now(), LastConnectionMode: 2 }] }))`);
    const movie = await ctx.run(`fetch('/Items?Recursive=true&IncludeItemTypes=Movie&Limit=1', { headers: { Authorization: 'MediaBrowser Token="${tok}"' } }).then((r) => r.json()).then((j) => j.Items[0]?.Id)`);
    // Das CSS kommt wie im Betrieb vom Server (Branding/Css), hier als <style> eingesetzt (der Browser hielte sonst eine alte Fassung im Zwischenspeicher)
    const inject = () => ctx.run(`fetch('/Branding/Css', { cache: 'no-store' }).then((r) => r.text()).then((t) => { document.getElementById('jc-live')?.remove(); const st = document.createElement('style'); st.id = 'jc-live'; st.textContent = t; document.body.append(st); return t.length; })`);
    console.log(`INFO echter Server: Jellyfin ${ver}`);
    await load('#/home');
    const len = await inject();
    await ctx.wait(800);
    check(`Echt (Jellyfin ${ver}): der Server liefert das CSS (Branding/Css)`, len > 5000, `${len} Zeichen`);
    check('Echt: Seitenhintergrund ist das Blau-Grau', (await s('body', 'backgroundColor')) === 'rgb(17, 24, 39)', await s('body', 'backgroundColor'));
    check('Echt: die MUI-Farbvariable des Servers ist auf den Akzent gesetzt (Jellyfin-Blau weg)', !/#00a4dc/i.test(await ctx.run(`getComputedStyle(document.documentElement).getPropertyValue('--jf-palette-primary-main')`)));
    if (await s('.MuiAppBar-root', 'position')) {
      check('Echt: die Kopfleiste (MUI) ist durchscheinend ohne eigene Flaeche', (await s('.MuiAppBar-root', 'backgroundColor')) === 'rgba(0, 0, 0, 0)');
      check('Echt: der Avatar in der Kopfleiste hat die Akzentfarbe', !/rgb\(0, 164, 220\)/.test(await s('.MuiAvatar-root', 'backgroundColor')) && nz(await s('.MuiAvatar-root', 'backgroundImage')));
    }
    check('Echt: Karten sind abgerundet', parseFloat(await s('.card .cardScalable', 'borderTopLeftRadius')) >= 12, await s('.card .cardScalable', 'borderTopLeftRadius'));
    check('Echt: Reihentitel fett', (await s('.sectionTitle', 'fontWeight')) === '700');
    await ctx.capture(path.join(out, 'jellyfin-css-echt-home.png'));
    if (movie) {
      await ctx.run(`location.hash = '#/details?id=${movie}'`);
      await ctx.wait(4500);
      await inject();
      await ctx.wait(600);
      check('Echt, Detailseite: Abspielen ist die helle Kapsel', (await s('.mainDetailButtons .btnPlay', 'backgroundColor')) === 'rgb(255, 255, 255)');
      check('Echt, Detailseite: der Seitengrund ist durchgehend der Verlauf (keine graue Flaeche)', (await s('.detailPageWrapperContainer', 'backgroundColor')) === 'rgba(0, 0, 0, 0)');
      await ctx.capture(path.join(out, 'jellyfin-css-echt-detail.png'));
    }
  } else {
    console.log('INFO Teil 3 (echter Jellyfin-Server) uebersprungen: JF_URL und JF_TOKEN_FILE nicht gesetzt');
  }

  // Meldungen der Media Bar selbst (slideshowpure.js, Fremdcode) und des Servers zaehlen nicht
  check('Keine Konsolenfehler aus dem eigenen Code', errors.filter((e) => !/Failed to load resource|favicon|Refused to|ERR_|net::|slideshowpure\.js|Failed to parse JSON/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  console.log(`Ergebnis: ${pass} PASS, ${fail} FAIL`);
  if (fail) process.exitCode = 1;
};
