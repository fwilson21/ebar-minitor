// Corrector de ortografía en español para el cuadro "Resumen de la actividad" del Informe Semanal.
// El diccionario Hunspell (`src/assets/dict/es.aff` + `es.dic`, ~870 KB, vendorizado del paquete
// `dictionary-es@4` — no se puede importar directo porque su index.js usa `node:fs`) y la librería
// `nspell` se traen con `fetch`/`import()` DIFERIDO: solo bajan cuando de verdad se abre el Informe
// Semanal en una COMPUTADORA (ver `esEscritorio`) — en el celular no se descarga nunca, para no
// hacer más pesada la app en campo (pedido del usuario).

import type { Nspell } from 'nspell';
import affUrl from '../assets/dict/es.aff?url';
import dicUrl from '../assets/dict/es.dic?url';

let instancia: Nspell | null = null;
let cargando: Promise<Nspell> | null = null;

// Términos de EBAR (en minúscula) que el diccionario general de español no incluye.
const TERMINOS_EBAR = [
  'impulsión', 'sumergible', 'sumergibles', 'cárcamo', 'cárcamos', 'variador', 'variadores',
  'guardamotor', 'guardamotores', 'contactor', 'contactores', 'breaker', 'breakers', 'elastomérica',
  'elastoméricas', 'elastomérico', 'izado', 'rejilla', 'rejillas', 'cerramiento', 'cerramientos',
  'guaya', 'guayas', 'macho', 'check', 'ebar', 'ptar', 'caudalímetro', 'macromedidor',
];

/** true solo en pantallas de escritorio (mouse + ventana ancha) — el corrector no corre en celular. */
export const esEscritorio =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: fine)').matches &&
  window.matchMedia('(min-width: 1024px)').matches;

export function cargarCorrectorEs(): Promise<Nspell> {
  if (instancia) return Promise.resolve(instancia);
  if (cargando) return cargando;
  cargando = (async () => {
    const [nspellMod, aff, dic] = await Promise.all([
      import('nspell'),
      fetch(affUrl).then((r) => r.text()),
      fetch(dicUrl).then((r) => r.text()),
    ]);
    const nspell = ((nspellMod as any).default ?? nspellMod) as (aff: string, dic: string) => Nspell;
    instancia = nspell(aff, dic);
    // Vocabulario de EBAR que el diccionario general no trae — para que no salgan marcados como
    // error términos habituales del informe.
    for (const termino of TERMINOS_EBAR) instancia.add(termino);
    return instancia;
  })();
  return cargando;
}

export interface PalabraMal {
  palabra: string;
  sugerencia: string | null;
}

// Separadores de palabra: todo lo que no sea letra/número/apóstrofo/guion.
const SEPARADOR = /[^\p{L}\p{N}'’-]+/u;

const SIN_ACENTO = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const VOCAL_ACENTUADA: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

/** El error de tilde es el más común en español: se prueba a acentuar cada vocal de a una y si el
 * resultado es una palabra válida, esa es casi seguro la corrección (nspell muchas veces NO la
 * sugiere — ej. "impulsion" → no propone "impulsión"). */
function acentuarVocal(corrector: Nspell, palabra: string): string | null {
  const lower = palabra.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const ac = VOCAL_ACENTUADA[lower[i]];
    if (ac && corrector.correct(lower.slice(0, i) + ac + lower.slice(i + 1))) {
      return lower.slice(0, i) + ac + lower.slice(i + 1);
    }
  }
  return null;
}

/** Mejor corrección para una palabra mal escrita: 1) acentuar una vocal, 2) una sugerencia de
 * nspell que solo difiera en tildes, 3) la primera sugerencia de nspell, 4) nada. */
function mejorSugerencia(corrector: Nspell, palabra: string): string | null {
  const porAcento = acentuarVocal(corrector, palabra);
  if (porAcento) return porAcento;
  const sugerencias = corrector.suggest(palabra);
  const sinTilde = SIN_ACENTO(palabra).toLowerCase();
  return sugerencias.find((s) => SIN_ACENTO(s).toLowerCase() === sinTilde) ?? sugerencias[0] ?? null;
}

/** Devuelve las palabras del texto que el diccionario no reconoce, sin repetir, con su primera
 * sugerencia. Se saltan: palabras de 1-2 letras, con dígitos, TODO EN MAYÚSCULAS (siglas: EBAR,
 * PTAR, LC…) y las que empiezan con mayúscula (nombres propios / inicio de oración — para esas
 * queda el corrector del navegador con clic derecho). */
export function revisarTexto(corrector: Nspell, texto: string): PalabraMal[] {
  const vistas = new Set<string>();
  const salida: PalabraMal[] = [];
  for (const bruto of texto.split(SEPARADOR)) {
    const palabra = bruto.replace(/^['’-]+|['’-]+$/g, '');
    if (palabra.length < 3) continue;
    if (/\d/.test(palabra)) continue;
    if (palabra === palabra.toUpperCase()) continue;
    if (palabra[0] !== palabra[0].toLowerCase()) continue;
    const clave = palabra.toLowerCase();
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    if (corrector.correct(palabra) || corrector.correct(clave)) continue;
    salida.push({ palabra, sugerencia: mejorSugerencia(corrector, palabra) });
  }
  return salida;
}

/** Reemplaza TODAS las apariciones de `palabra` como palabra suelta (respetando límites unicode). */
export function reemplazarPalabra(texto: string, palabra: string, reemplazo: string): string {
  const esc = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?![\\p{L}\\p{N}])`, 'gu');
  return texto.replace(re, (_m, previo) => `${previo}${reemplazo}`);
}
