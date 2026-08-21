import { useEffect, useRef } from 'react';
import type { FotoLocal } from './types';

/**
 * Arma UNA sola URL `blob:` por foto (no una nueva en cada render) y la libera cuando la foto se
 * saca de la lista o cuando el componente que la usa se desmonta.
 *
 * Causa real confirmada (2026-08-21) de que la app se cerraba de golpe al tomar más de una foto
 * en un celular con poca RAM: `URL.createObjectURL(foto.blob)` se llamaba directo en el cuerpo
 * del render (en PhotoCapture/EquipoSection/PumpForm/FotoLightbox), sin `URL.revokeObjectURL()`.
 * Cada URL creada así queda "pinchada" en memoria hasta que se revoca a mano o se cierra la
 * pestaña — y el formulario de visita se re-renderiza seguido (cada tecla escrita, cada segundo
 * del contador de tiempo en sitio, etc.), así que en cada uno de esos renders se creaba una URL
 * NUEVA por cada foto ya tomada, sin liberar la anterior. Con varias fotos y una sesión larga
 * (llenar todo el formulario), el navegador terminaba con miles de URLs sin liberar apuntando a
 * los mismos blobs — la app aguantaba la primera foto pero se quedaba sin memoria en la segunda o
 * tercera.
 */
export function useObjectUrls(fotos: FotoLocal[]): Record<string, string> {
  const cacheRef = useRef(new Map<string, string>());

  // Sincrónico durante el render (no en un efecto) para que la miniatura aparezca de una, sin
  // parpadear en blanco el primer frame mientras se crea la URL.
  const urls: Record<string, string> = {};
  for (const foto of fotos) {
    if (!foto.blob) continue;
    let url = cacheRef.current.get(foto.id);
    if (!url) {
      url = URL.createObjectURL(foto.blob);
      cacheRef.current.set(foto.id, url);
    }
    urls[foto.id] = url;
  }

  // Después de cada render: libera las URLs de fotos que ya no están en la lista (se sacaron) o
  // que perdieron el blob (terminaron de subirse y ahora usan url_publica).
  useEffect(() => {
    const idsVigentes = new Set(fotos.filter((f) => f.blob).map((f) => f.id));
    for (const [id, url] of cacheRef.current) {
      if (!idsVigentes.has(id)) {
        URL.revokeObjectURL(url);
        cacheRef.current.delete(id);
      }
    }
  });

  // Al desmontar el componente (ej. se cierra el formulario): libera todo lo que quedaba.
  useEffect(() => {
    const cache = cacheRef.current;
    return () => {
      for (const url of cache.values()) URL.revokeObjectURL(url);
      cache.clear();
    };
  }, []);

  return urls;
}
