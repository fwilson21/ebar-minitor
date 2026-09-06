import { useState } from 'react';
import { girarFotoSubida, type SentidoGiro } from '../lib/fotos';
import { etiquetaFoto } from '../lib/pdf';

type FotoGirable = { id: string; visita_id: string; url: string; etiqueta?: string | null; tomada_en: string };

/**
 * Grilla de fotos ya subidas con botones ↺ / ↻ para girarlas (redibujando el sello de fecha
 * horizontal) — mismo mecanismo que el editor del Informe Semanal. Al girar, `girarFotoSubida`
 * reemplaza el archivo en Drive y la fila de `fotos`; `onGirada(fotoId, nuevaUrl)` avisa al padre
 * para refrescar la miniatura. Solo admin/supervisor (lo valida la Edge Function).
 */
export function FotosGirables({
  fotos,
  onGirada,
}: {
  fotos: FotoGirable[];
  onGirada: (fotoId: string, nuevaUrl: string) => void;
}) {
  const [girando, setGirando] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function girar(f: FotoGirable, sentido: SentidoGiro) {
    if (girando.has(f.id)) return;
    setError(null);
    setGirando((prev) => new Set(prev).add(f.id));
    try {
      const nuevaUrl = await girarFotoSubida(f, sentido);
      onGirada(f.id, nuevaUrl);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo girar la foto.');
    } finally {
      setGirando((prev) => {
        const copia = new Set(prev);
        copia.delete(f.id);
        return copia;
      });
    }
  }

  if (!fotos.length) return null;

  return (
    <div className="mt-2">
      <p className="text-xs text-slate-500 mb-1">Fotos (↺ ↻ giran la foto y dejan la fecha horizontal):</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {fotos.map((f) => {
          const estaGirando = girando.has(f.id);
          return (
            <div key={f.id} className="relative">
              <img
                src={f.url}
                alt=""
                className={`w-full aspect-square object-cover rounded-md ${estaGirando ? 'animate-pulse' : ''}`}
              />
              <div className="absolute top-1 left-1 flex gap-1">
                <button
                  type="button"
                  disabled={estaGirando}
                  onClick={() => girar(f, 'izquierda')}
                  className="w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center disabled:opacity-40"
                  aria-label="Girar foto a la izquierda"
                >
                  ↺
                </button>
                <button
                  type="button"
                  disabled={estaGirando}
                  onClick={() => girar(f, 'derecha')}
                  className="w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center disabled:opacity-40"
                  aria-label="Girar foto a la derecha"
                >
                  ↻
                </button>
              </div>
              <span className="block text-[10px] text-slate-500 mt-0.5 truncate" title={etiquetaFoto(f.etiqueta)}>
                {etiquetaFoto(f.etiqueta)}
              </span>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-gauge-danger mt-1">{error}</p>}
    </div>
  );
}
