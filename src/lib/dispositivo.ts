const CLAVE_DEVICE_ID = 'ebar_device_id';

// Identificador propio del celular/navegador, generado una sola vez y guardado
// en el almacenamiento local (persiste entre sesiones mientras no se borren los
// datos de la app). Se usa para vincular cada cuenta de operador a un celular.
export function obtenerIdDispositivo(): string {
  let id = localStorage.getItem(CLAVE_DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLAVE_DEVICE_ID, id);
  }
  return id;
}
