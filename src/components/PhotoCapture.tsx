import { useRef, useState } from 'react';
import type { FotoLocal } from '../lib/types';
import { eliminarFotoGuardada, estamparFechaEnFoto } from '../lib/fotos';
import { FotoLightbox } from './FotoLightbox';

interface Props {
  fotos: FotoLocal[];
  onChange: (fotos: FotoLocal[]) => void;
}

/**
 * Captura fotos usando el input nativo de archivo con `capture="environment"`,
 * que en navegadores móviles abre directamente la cámara trasera. Las fotos
 * quedan como Blob en memoria/IndexedDB hasta que `offline.ts` las sube a
 * Google Drive a través de la Edge Function `upload-to-drive`.
 */
export function PhotoCapture({ fotos, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);

  async function manejarSeleccion(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    e.target.value = '';
    const ahora = new Date().toISOString();
    const nuevas: FotoLocal[] = await Promise.all(
      archivos.map(async (file) => ({
        id: crypto.randomUUID(),
        blob: await estamparFechaEnFoto(file, ahora),
        tomada_en: ahora,
        estado_subida: 'pendiente' as const,
      })),
    );
    onChange([...fotos, ...nuevas]);
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
        <button type="button" className="boton-secundario text-sm py-1.5 px-3" onClick={() => inputRef.current?.click()}>
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

      {fotos.length === 0 ? (
        <p className="text-sm text-slate-500">Sin fotos aún. Se almacenarán en Google Drive al sincronizar.</p>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {fotos.map((foto, idx) => {
            const src = foto.blob ? URL.createObjectURL(foto.blob) : foto.url_publica;
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
                  <span className="absolute bottom-1 left-1 text-[10px] bg-gauge-warn/90 text-panel-900 px-1.5 rounded">
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
