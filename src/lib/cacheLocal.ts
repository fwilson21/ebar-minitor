// Copia de la última lectura exitosa de ciertos datos (estaciones, bombas), guardada en
// localStorage para poder seguir mostrando algo útil cuando una consulta a Supabase falla por
// falta de señal — sin esto, un operador sin conexión no podía ni ver la lista de estaciones ni
// abrir el formulario de una estación ya conocida, aunque el guardado de la visita sí funciona
// offline desde antes (ver offline.ts).
export function guardarCacheLocal<T>(clave: string, datos: T) {
  try {
    localStorage.setItem(clave, JSON.stringify(datos));
  } catch {
    // localStorage lleno o no disponible: no es crítico, simplemente no queda cache.
  }
}

export function leerCacheLocal<T>(clave: string): T | null {
  try {
    const raw = localStorage.getItem(clave);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
