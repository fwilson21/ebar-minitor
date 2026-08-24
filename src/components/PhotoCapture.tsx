import { useRef, useState } from 'react';
import type { FotoLocal } from '../lib/types';
import { crearFotoLocal, eliminarFotoGuardada, estamparFechaEnFoto } from '../lib/fotos';
import { generarUUID } from '../lib/uuid';
import { useObjectUrls } from '../lib/useObjectUrls';
import { FotoLightbox } from './FotoLightbox';
import { CamaraFoto } from './CamaraFoto';

interface Props {
  fotos: FotoLocal[];
  onChange: (fotos: FotoLocal[]) => void;
}

/**
 * Captura fotos con la cámara en vivo dentro de la propia app (ver CamaraFoto.tsx) — mucho más
 * liviana en memoria que la app de Cámara nativa del celular, que en algunos celulares de poca
 * RAM cerraba la pestaña de golpe. Si el navegador no soporta esto o el operador niega el
 * permiso, cae de vuelta al input nativo de archivo con `capture="environment"` (el de siempre,
 * que en navegadores móviles abre la cámara trasera del sistema). Las fotos quedan como Blob en
 * memoria/IndexedDB hasta que `offline.ts` las sube a Google Drive a través de la Edge Function
 * `upload-to-drive`.
 */
export function PhotoCapture({ fotos, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  const fotosRef = useRef(fotos);
  fotosRef.current = fotos;
  const urls = useObjectUrls(fotos);

  async function manejarSeleccion(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = '';
    const ahora = new Date().toISOString();
    const nuevas: FotoLocal[] = await Promise.all(
      archivos.map(async (file) => ({
        id: generarUUID(),
        blob: await estamparFechaEnFoto(file, ahora),
        tomada_en: ahora,
        estado_subida: 'pendiente' as const,
      })),
    );
    onChange([...fotos, ...nuevas]);
  }

  // Cada captura de CamaraFoto llega una por una (mientras el operador sigue disparando con la
  // cámara todavía abierta) — se agrega de a una al estado en vez de esperar a "Listo" para no
  // perder fotos ya tomadas si algo falla a mitad de la sesión.
  async function agregarFotoDesdeCamara(blob: Blob) {
    const nueva = await crearFotoLocal(blob, new Date().toISOString());
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
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={manejarSeleccion}
        />
      </div>

      {camaraAbierta && (
        <CamaraFoto
          maxFotos={Infinity}
          onCapturar={agregarFotoDesdeCamara}
          onCerrar={() => setCamaraAbierta(false)}
          onError={() => {
            setCamaraAbierta(false);
            inputRef.current?.click();
          }}
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
