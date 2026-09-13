// Corrector de ortografía para los cuadros de texto libre (resumen del Informe Semanal, y —cuando
// el operador trabaja en una computadora— las observaciones de la visita). Diccionarios Hunspell
// ESPAÑOL + INGLÉS (`src/assets/dict/es.*` ~870 KB + `en.*` ~555 KB, vendorizados de `dictionary-es@4`
// / `dictionary-en@3` — no se importan directo porque su index.js usa `node:fs`). Una palabra está
// bien si CUALQUIERA de los dos idiomas la reconoce (así no marca términos técnicos en inglés).
// Todo (`nspell` + los dos diccionarios) se trae con `fetch`/`import()` DIFERIDO: solo baja en
// COMPUTADORA (ver `esEscritorio`); en el celular no se descarga nunca (pedido del usuario).

import type { Nspell } from 'nspell';
import affEsUrl from '../assets/dict/es.aff?url';
import dicEsUrl from '../assets/dict/es.dic?url';
import affEnUrl from '../assets/dict/en.aff?url';
import dicEnUrl from '../assets/dict/en.dic?url';
import { supabase } from './supabase';

/** Chequeo de ortografía español+inglés combinado. */
export interface CorrectorMulti {
  correct(word: string): boolean;
  suggest(word: string): string[];
  /** Suma una palabra al vocabulario ACEPTADO de esta sesión (no persiste sola — ver
   * `marcarPalabraBienEscrita`, que además la guarda en `diccionario_personalizado`). */
  add(word: string): void;
}

let instancia: CorrectorMulti | null = null;
let cargando: Promise<CorrectorMulti> | null = null;

// Términos de EBAR (en minúscula) que el diccionario general de español no incluye. Para una
// palabra puntual que solo hace falta agregar una vez, mejor usar el botón "Está bien escrita"
// del corrector (guarda en `diccionario_personalizado`, sin tocar código) — esta lista es para
// vocabulario de uso frecuente que conviene tener SIEMPRE, aunque la tabla esté vacía o sin red.
const TERMINOS_EBAR = [
  'impulsión', 'sumergible', 'sumergibles', 'cárcamo', 'cárcamos', 'variador', 'variadores',
  'guardamotor', 'guardamotores', 'contactor', 'contactores', 'breaker', 'breakers', 'elastomérica',
  'elastoméricas', 'elastomérico', 'izado', 'rejilla', 'rejillas', 'cerramiento', 'cerramientos',
  'guaya', 'guayas', 'macho', 'check', 'ebar', 'ptar', 'caudalímetro', 'macromedidor',
  'retrolavado', 'retrolavados', 'retrolavar',
];

/** true solo en pantallas de escritorio (mouse + ventana ancha) — el corrector no corre en celular. */
export const esEscritorio =
  typeof window !== 'undefined' &&
  window.matchMedia('(pointer: fine)').matches &&
  window.matchMedia('(min-width: 1024px)').matches;

export function cargarCorrectorEs(): Promise<CorrectorMulti> {
  if (instancia) return Promise.resolve(instancia);
  if (cargando) return cargando;
  cargando = (async () => {
    const [nspellMod, affEs, dicEs, affEn, dicEn, { data: extra }] = await Promise.all([
      import('nspell'),
      fetch(affEsUrl).then((r) => r.text()),
      fetch(dicEsUrl).then((r) => r.text()),
      fetch(affEnUrl).then((r) => r.text()),
      fetch(dicEnUrl).then((r) => r.text()),
      // Palabras que alguien marcó "Está bien escrita" antes (ver marcarPalabraBienEscrita) — si
      // falla (sin red, tabla vacía, etc.) sigue con el diccionario normal, no bloquea el corrector.
      supabase.from('diccionario_personalizado').select('palabra').then(
        (r) => r,
        () => ({ data: null }),
      ),
    ]);
    const nspell = ((nspellMod as any).default ?? nspellMod) as (aff: string, dic: string) => Nspell;
    const es = nspell(affEs, dicEs);
    const en = nspell(affEn, dicEn);
    // Vocabulario de EBAR que el diccionario general no trae, + lo que se fue agregando a mano.
    for (const termino of TERMINOS_EBAR) es.add(termino);
    for (const fila of extra ?? []) es.add((fila as { palabra: string }).palabra);
    instancia = {
      // Bien escrita si CUALQUIER idioma la reconoce (así no marca términos técnicos en inglés).
      correct: (w) => es.correct(w) || en.correct(w),
      // Las sugerencias salen del español (el texto es en español; un error suele ser de una
      // palabra española).
      suggest: (w) => es.suggest(w),
      add: (w) => {
        es.add(w);
        en.add(w);
      },
    };
    return instancia;
  })();
  return cargando;
}

export interface PalabraMal {
  palabra: string;
  sugerencia: string | null;
  /** Texto alrededor de la primera aparición, para que la analista vea en qué frase está y decida
   * si la sugerencia sirve o la escribe a mano. */
  contexto: { antes: string; despues: string };
}

// Una palabra: arranca con letra/número y sigue con letra/número/apóstrofo/guion.
const PALABRA_RE = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;
const CTX = 42; // caracteres de contexto a cada lado

const SIN_ACENTO = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');
const VOCAL_ACENTUADA: Record<string, string> = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú' };

/** El error de tilde es el más común en español: se prueba a acentuar cada vocal de a una y si el
 * resultado es una palabra válida, esa es casi seguro la corrección (nspell muchas veces NO la
 * sugiere — ej. "impulsion" → no propone "impulsión"). */
function acentuarVocal(corrector: CorrectorMulti, palabra: string): string | null {
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
function mejorSugerencia(corrector: CorrectorMulti, palabra: string): string | null {
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
export function revisarTexto(corrector: CorrectorMulti, texto: string): PalabraMal[] {
  const vistas = new Set<string>();
  const salida: PalabraMal[] = [];
  for (const m of texto.matchAll(PALABRA_RE)) {
    const palabra = m[0].replace(/^['’-]+|['’-]+$/g, '');
    const clave = palabra.toLowerCase();
    // Caso especial: algunos operadores escriben "x" suelta en vez de "por" (ej. "cambió x estar
    // dañada"). Una letra sola pasaría de largo el filtro de "menos de 3 letras" de abajo (y ni
    // nspell ni el corrector nativo del navegador la marcan — es una letra válida), así que se
    // fuerza a marcarla — salvo que se vea como una multiplicación entre números ("10 x 15"), que
    // es un uso real y no un typeo de "por".
    const esXComoPor = clave === 'x' && !seVeComoMultiplicacion(texto, m.index ?? 0, m[0].length);
    if (!esXComoPor) {
      if (palabra.length < 3) continue;
      if (/\d/.test(palabra)) continue;
      if (palabra === palabra.toUpperCase()) continue;
      if (palabra[0] !== palabra[0].toLowerCase()) continue;
    }
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    if (!esXComoPor && (corrector.correct(palabra) || corrector.correct(clave))) continue;
    const inicio = m.index ?? 0;
    const fin = inicio + m[0].length;
    salida.push({
      palabra,
      sugerencia: esXComoPor ? 'por' : mejorSugerencia(corrector, palabra),
      contexto: {
        antes: (inicio > CTX ? '…' : '') + texto.slice(Math.max(0, inicio - CTX), inicio),
        despues: texto.slice(fin, fin + CTX) + (fin + CTX < texto.length ? '…' : ''),
      },
    });
  }
  return salida;
}

/** `true` si la "x" en `[inicio, inicio+largo)` de `texto` está entre dos números (con o sin
 * espacio de por medio, ej. "10 x 15" o "10x15") — ahí es una multiplicación real, no el typeo de
 * "por" que se corrige más arriba. */
function seVeComoMultiplicacion(texto: string, inicio: number, largo: number): boolean {
  const antes = texto.slice(0, inicio).trimEnd();
  const despues = texto.slice(inicio + largo).trimStart();
  return /\d$/.test(antes) && /^\d/.test(despues);
}

/**
 * Compara el texto de un párrafo ANTES y DESPUÉS de una edición y, si el único cambio real fue UNA
 * palabra reemplazada por otra (typeo corregido a mano, o corregido con el menú del botón derecho
 * del navegador — ambos casos llegan acá igual, como texto antes/después, sin saber cómo pasó),
 * devuelve ese par para que quien llama lo replique en el resto del informe con `reemplazarPalabra`
 * — pedido del usuario: no quiere tener que repetir la misma corrección EBAR por EBAR.
 *
 * Deliberadamente conservador: si cambió la CANTIDAD de palabras (se agregó o borró una, se partió
 * una en dos) o si cambió más de una palabra a la vez, devuelve `null` — un reemplazo automático
 * ahí adivinaría mal cuál de los cambios replicar y podría arruinar otros párrafos sin que el
 * usuario lo haya pedido. Solo el caso simple y sin ambigüedad: una palabra por otra.
 */
export function detectarCorreccionPalabra(anterior: string, nuevo: string): { palabra: string; correccion: string } | null {
  if (anterior === nuevo) return null;
  const antes = anterior.match(PALABRA_RE) ?? [];
  const despues = nuevo.match(PALABRA_RE) ?? [];
  if (antes.length !== despues.length) return null;
  let indiceDistinto = -1;
  for (let i = 0; i < antes.length; i++) {
    if (antes[i] === despues[i]) continue;
    if (indiceDistinto !== -1) return null; // más de una palabra cambió — ambiguo, no se toca
    indiceDistinto = i;
  }
  if (indiceDistinto === -1) return null; // ningún token cambió (el cambio fue solo de espacios/puntuación)
  const palabra = antes[indiceDistinto];
  const correccion = despues[indiceDistinto];
  if (palabra.length < 3 || /\d/.test(palabra)) return null; // mismo criterio que `revisarTexto`
  return { palabra, correccion };
}

/** Reemplaza TODAS las apariciones de `palabra` como palabra suelta (respetando límites unicode). */
export function reemplazarPalabra(texto: string, palabra: string, reemplazo: string): string {
  const esc = palabra.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${esc})(?![\\p{L}\\p{N}])`, 'gu');
  return texto.replace(re, (_m, previo) => `${previo}${reemplazo}`);
}

/** Botón "Está bien escrita" del corrector: guarda la palabra en `diccionario_personalizado`
 * (migración 0059) para que deje de marcarse en CUALQUIER computadora de acá en más, y la suma al
 * corrector ya cargado para que deje de marcarse en esta misma sesión sin recargar la página. Si
 * ya estaba guardada (otra persona la agregó antes) el `unique` de la tabla lo avisa con un error
 * "duplicate key" — se ignora, no es un problema real (la palabra ya iba a dejar de marcarse). */
export async function marcarPalabraBienEscrita(corrector: CorrectorMulti, palabra: string, usuarioId?: string): Promise<void> {
  const clave = palabra.toLowerCase();
  corrector.add(clave);
  const { error } = await supabase.from('diccionario_personalizado').insert({ palabra: clave, creado_por: usuarioId ?? null });
  if (error && error.code !== '23505') throw error; // 23505 = unique_violation, ya estaba
}
