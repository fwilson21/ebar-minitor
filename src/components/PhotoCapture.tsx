import { useRef, useState } from 'react';
import type { FotoLocal } from '../lib/types';
import { crearFotoLocal, eliminarFotoGuardada } from '../lib/fotos';
import { useObjectUrls } from '../lib/useObjectUrls';
import { FotoLightbox } from './FotoLightbox';
import { CamaraFoto } from './CamaraFoto';

interface Props {
  fotos: FotoLocal[];
  onChange: (fotos: FotoLocal[]) => void;
}

/**
 * Captura fotos SOLO con la cámara en vivo dentro de la propia app (ver CamaraFoto.tsx) — más
 * liviana en memoria que la app de Cámara nativa, y sobre todo: no deja adjuntar una foto vieja
 * de la galería (el `<input capture>` de antes sí dejaba, en iPhone siempre). Las fotos de las
 * visitas tienen que ser del momento. Quedan como Blob en memoria/IndexedDB hasta que
 * `offline.ts` las sube a Google Drive a través de la Edge Function `upload-to-drive`.
 */
export function PhotoCapture({ fotos, onChange }: Props) {
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  const urls = useObjectUrls(fotos);

  // Cada captura de CamaraFoto llega una por una (mientras el operador sigue disparando con la
  // cámara todavía abierta) — se agrega de a una al estado en vez de esperar a "Listo" para no
  // perder fotos ya tomadas si algo falla a mitad de la sesión.
  async function agregarFotoDesdeCamara(blob: Blob, dispositivoEnHorizontal: boolean) {
    const nueva = await crearFotoLocal(blob, new Date().toISOString(), dispositivoEnHorizontal);
    onChange([...fotosRef.current, nueva]);
  }

  async function eliminar(foto: FotoLocal) {
    const yaSubida = foto.estado_subida === 'subida' && !foto.blob;
    if (yaSubida) {
      if (!window.confirm('¿Eliminar esta foto? Esta acción no se puede deshacer.')) return;
      const resultado = await eliminarFotoGuardada(foto.id);
      if (!resultado.ok) {
        alert(resultado.error);
        return;
      }
    }
    onChange(fotos.filter((f) => f.id !== foto.id));
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="etiqueta mb-0">Fotografías de la visita</label>
        <button type="button" className="boton-secundario text-sm py-1.5 px-3" onClick={() => setCamaraAbierta(true)}>
          📷 Tomar foto
        </button>
      </div>

      {camaraAbierta && (
        <CamaraFoto
          maxFotos={Infinity}
          etiquetaSeccion="Fotos de la visita"
          fotosPrevias={fotos.length}
          onCapturar={agregarFotoDesdeCamara}
          onCerrar={() => setCamaraAbierta(false)}
        />
      )}

      {fotos.length === 0 ? (
        <p className="text-sm text-slate-500">Sin fotos aún. Se almacenarán en Google Drive al sincronizar.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((foto, idx) => {
            const src = foto.blob ? urls[foto.id] : foto.url_publica;
            return (
              <div key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-panel-700">
                {src && (
                  // eslint-disable-next-line jsx-a11y/alt-text
                  <img src={src} className="w-full h-full object-cover cursor-pointer" onClick={() => setFotoAbierta(idx)} />
                )}
                <button
                  type="button"
                  onClick={() => eliminar(foto)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                >
                  ✕
                </button>
                {foto.estado_subida === 'pendiente' && (
                  <span className="absolute bottom-1 left-1 text-[10px] bg-gauge-warn/90 text-white px-1.5 rounded">
                    Pendiente
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {fotoAbierta !== null && (
        <FotoLightbox
          fotos={fotos}
          indice={fotoAbierta}
          onCambiarIndice={setFotoAbierta}
          onCerrar={() => setFotoAbierta(null)}
        />
      )}
    </div>
  );
}
