// Reine Hilfen fuer den Pausenbildschirm (ohne DOM, damit sie sich testen lassen).

/** Dauer als Text: "1 Std. 12 Min." / "53 Min." / "weniger als 1 Min." (englisch "1 h 12 min"). */
export function formatSpan(sec, lang = 'de') {
  const total = Math.max(0, Math.round((Number(sec) || 0) / 60));
  const de = lang === 'de';
  if (total < 1) return de ? 'weniger als 1 Min.' : 'under 1 min';
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (!h) return de ? `${m} Min.` : `${m} min`;
  if (!m) return de ? `${h} Std.` : `${h} h`;
  return de ? `${h} Std. ${m} Min.` : `${h} h ${m} min`;
}

/** Uhrzeit ("22:41", englisch "10:41 PM"). */
export function formatClock(date, lang = 'de') {
  return date.toLocaleTimeString(lang === 'de' ? 'de-DE' : 'en-US', { hour: '2-digit', minute: '2-digit' });
}

/** Wann der Film zu Ende ist, wenn man jetzt weiterschaut (Rest geteilt durch die Geschwindigkeit). */
export function endsAt(now, duration, position, speed = 1) {
  const left = Math.max(0, (Number(duration) || 0) - (Number(position) || 0)) / (Number(speed) > 0 ? Number(speed) : 1);
  return { at: new Date(now + left * 1000), left };
}

/** Kapitel an einer Position: { n (ab 1), title } oder null. */
export function chapterAt(list, pos) {
  if (!Array.isArray(list) || list.length < 2) return null;
  let at = -1;
  list.forEach((c, i) => {
    if (Number(c.time) <= pos + 0.001) at = i;
  });
  return at < 0 ? null : { n: at + 1, title: String(list[at].title ?? '') };
}

/** Kapitelname nur, wenn er mehr sagt als "Kapitel 3". */
export function isGenericChapter(title) {
  return !title || /^(kapitel|chapter)\s*\d+$/i.test(String(title).trim());
}
