/**
 * Genera un UUID v4, con reserva por si `crypto.randomUUID` no existe en el navegador. Algunos
 * WebView de Android desactualizados (y navegadores viejos) no lo soportan aunque sí tengan
 * `crypto.getRandomValues`, mucho más compatible — sin esta reserva, tomar una foto o guardar una
 * visita tiraba una excepción sin aviso en esos celulares y no quedaba guardado nada (ni la
 * visita ni las fotos, porque ambas dependen de generar un id antes de poder guardar).
 */
export function generarUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // versión 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variante
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0'));
    return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
  }
  // Último recurso, sin `crypto` en absoluto (no debería pasar en un contexto seguro/HTTPS,
  // pero mejor esto que dejar de poder guardar).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
