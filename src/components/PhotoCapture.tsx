import { useRef } from 'react';
import type { FotoLocal } from '../lib/types';

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

  function manejarSeleccion(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []);
    const nuevas: FotoLocal[] = archivos.map((file) => ({
      id: crypto.randomUUID(),
      blob: file,
      tomada_en: new Date().toISOString(),
      estado_subida: 'pendiente',
    }));
    onChange([...fotos, ...nuevas]);
    e.target.value = '';
  }

  function eliminar(id: string) {
    onChange(fotos.filter((f) => f.id !== id));
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
          {fotos.map((foto) => (
            <div key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-panel-700">
              {foto.blob && (
                // eslint-disable-next-line jsx-a11y/alt-text
                <img src={URL.createObjectURL(foto.blob)} className="w-full h-full object-cover" />
              )}
              <button
                type="button"
                onClick={() => eliminar(foto.id)}
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
          ))}
        </div>
      )}
    </div>
  );
}
