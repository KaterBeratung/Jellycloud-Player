import { t, getLocale } from './i18n.js';

export const TICKS = 10_000_000;
export const ticksToSec = (ticks) => (ticks || 0) / TICKS;

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let timer;
  const wrapped = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  wrapped.cancel = () => clearTimeout(timer);
  return wrapped;
}

/** 6720 s -> "1 Std. 52 Min." */
export function fmtDuration(sec) {
  const total = Math.max(0, Math.round(sec / 60));
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  if (hh && mm) return `${hh} ${t('unit.h')} ${mm} ${t('unit.min')}`;
  if (hh) return `${hh} ${t('unit.h')}`;
  return `${mm} ${t('unit.min')}`;
}

/** 3725 s -> "1:02:05", 95 s -> "1:35" */
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export function clockTime(date) {
  return new Intl.DateTimeFormat(getLocale(), { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function endsAt(remainingSec) {
  return clockTime(new Date(Date.now() + remainingSec * 1000));
}

export function fmtDate(iso) {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat(getLocale(), { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(iso));
  } catch {
    return '';
  }
}

export function fmtBitrate(bps) {
  if (!bps) return '';
  return bps >= 1e6 ? `${(bps / 1e6).toFixed(bps >= 1e7 ? 0 : 1)} Mbit/s` : `${Math.round(bps / 1e3)} kbit/s`;
}

export function fmtSize(bytes) {
  if (!bytes) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 1 : 2)} GB`;
  const mb = bytes / 1024 ** 2;
  return mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function langName(code) {
  if (!code || code === 'und') return '';
  try {
    return new Intl.DisplayNames([getLocale()], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Lokale Persistenz fuer kleine UI-Praeferenzen (Sortierung etc.). Faellt still auf Speicher zurueck. */
const memory = new Map();
export const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(`jc:${key}`);
      return v === null ? fallback : JSON.parse(v);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(`jc:${key}`, JSON.stringify(value));
    } catch {
      /* z.B. Speicher gesperrt */
    }
  }
};
