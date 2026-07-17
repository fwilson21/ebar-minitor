import { useEffect, useState } from 'react';

export type EstadoUbicacion =
  | { tipo: 'buscando' }
  | { tipo: 'error'; mensaje: string }
  | { tipo: 'ok'; lat: number; lon: number; precision: number };

// Ubicación GPS del dispositivo, actualizada en vivo mientras `activo` sea true (usa
// watchPosition, no una sola lectura) — así el bloqueo por distancia se levanta solo en
// cuanto el operador se acerca, sin que tenga que recargar la página. Funciona offline
// (usa el chip GPS del celular, no depende de conexión a internet).
export function useUbicacionActual(activo: boolean): EstadoUbicacion {
  const [estado, setEstado] = useState<EstadoUbicacion>({ tipo: 'buscando' });

  useEffect(() => {
    if (!activo) return;
    if (!('geolocation' in navigator)) {
      setEstado({ tipo: 'error', mensaje: 'Este dispositivo no permite obtener tu ubicación (GPS no disponible).' });
      return;
    }
    setEstado({ tipo: 'buscando' });
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setEstado({ tipo: 'ok', lat: pos.coords.latitude, lon: pos.coords.longitude, precision: pos.coords.accuracy }),
      (err) => {
        const mensaje =
          err.code === err.PERMISSION_DENIED
            ? 'Debes permitir el acceso a tu ubicación para registrar la visita.'
            : 'No se pudo obtener tu ubicación. Verifica que el GPS del celular esté activado.';
        setEstado({ tipo: 'error', mensaje });
      },
      // maximumAge alto y timeout largo a propósito: varias EBAR quedan en zonas sin señal de
      // datos móviles, donde el GPS del celular (que no depende de internet) tarda más en dar
      // la primera ubicación al no tener asistencia de red (A-GPS). Un timeout corto ahí
      // terminaba en "error" antes de que el chip GPS lograra ubicarse.
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 45000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [activo]);

  return estado;
}

export function distanciaMetros(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
