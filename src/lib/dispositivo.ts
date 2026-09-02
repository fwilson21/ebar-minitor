import { generarUUID } from './uuid';
import { guardarDeviceIdEspejo, leerDeviceIdEspejo } from './offlineDB';

const CLAVE_DEVICE_ID = 'ebar_device_id';

function leerLocal(): string | null {
  try {
    return localStorage.getItem(CLAVE_DEVICE_ID);
  } catch {
    return null;
  }
}

function guardarLocal(id: string) {
  try {
    localStorage.setItem(CLAVE_DEVICE_ID, id);
  } catch {
    // localStorage puede fallar en modo privado / con almacenamiento bloqueado.
  }
}

// Identificador propio del celular/navegador, generado una sola vez y guardado en el
// almacenamiento local. Se usa para vincular cada cuenta de operador a su teléfono de trabajo.
// Esta versión sync solo mira localStorage — usar `obtenerIdDispositivoRobusto()` donde se pueda
// esperar una promesa (login), que además respalda en IndexedDB.
export function obtenerIdDispositivo(): string {
  let id = leerLocal();
  if (!id) {
    id = generarUUID();
    guardarLocal(id);
  }
  return id;
}

/**
 * Identificador del teléfono con respaldo en IndexedDB además de localStorage.
 *
 * En iPhone el navegador borra el localStorage con relativa frecuencia (a los pocos días sin
 * abrir la app, o cuando el teléfono anda con poco espacio) — y eso hacía que al día siguiente
 * el operador quedara bloqueado con "tu usuario ya está en otro teléfono". Ahora, si al menos una
 * de las dos copias (localStorage o IndexedDB) sobrevive, se restaura la otra y el identificador
 * se mantiene. Solo se genera uno nuevo si las DOS están vacías.
 */
export async function obtenerIdDispositivoRobusto(): Promise<string> {
  const local = leerLocal();
  let espejo: string | null = null;
  try {
    espejo = await leerDeviceIdEspejo();
  } catch {
    espejo = null;
  }

  const id = local || espejo || generarUUID();

  if (local !== id) guardarLocal(id);
  if (espejo !== id) {
    try {
      await guardarDeviceIdEspejo(id);
    } catch {
      // IndexedDB puede no estar disponible; con localStorage ya alcanza para funcionar.
    }
  }
  return id;
}

/**
 * ¿Este equipo es un teléfono/tablet (no una computadora)?
 *
 * Se usa para decidir el modo de sesión de los operadores: en el teléfono de trabajo registran
 * visitas (con vinculación de dispositivo); en una computadora entran en "modo consulta" (solo
 * lectura, para generar informes). Ante la duda se prefiere "móvil" — un teléfono de campo mal
 * clasificado como computadora dejaría al operador sin poder trabajar.
 */
export function esDispositivoMovil(): boolean {
  if (typeof navigator === 'undefined') return true;
  const ua = navigator.userAgent || '';

  const uaData = (navigator as unknown as { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (uaData && typeof uaData.mobile === 'boolean' && uaData.mobile) return true;

  if (/Android|iPhone|iPod|Windows Phone|IEMobile|BlackBerry|Opera Mini|Mobile/i.test(ua)) return true;

  // iPad con iPadOS 13+ se hace pasar por "Macintosh" en el user agent — se delata por el táctil.
  if (/iPad/i.test(ua)) return true;
  if (/Macintosh/i.test(ua) && typeof navigator.maxTouchPoints === 'number' && navigator.maxTouchPoints > 1) {
    return true;
  }

  return false;
}

export function esDispositivoEscritorio(): boolean {
  return !esDispositivoMovil();
}
