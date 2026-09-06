import { useState, type ReactNode } from 'react';
import { girarFotoSubida, type SentidoGiro } from '../lib/fotos';
import { etiquetaFoto } from '../lib/pdf';

type FotoGirable = { id: string; visita_id: string; url: string; etiqueta?: string | null; tomada_en: string };

/**
 * Grilla de fotos ya subidas con botones ↺ / ↻ para girarlas (redibujando el sello de fecha
 * horizontal) — mismo mecanismo que el editor del Informe Semanal. Al girar, `girarFotoSubida`
 * reemplaza el archivo en Drive y la fila de `fotos`; `onGirada(fotoId, nuevaUrl)` avisa al padre
 * para refrescar la miniatura. Admin/supervisor pueden girar cualquiera; un operador solo las de
 * su propia visita (lo valida la Edge Function).
 */
export function FotosGirables({
  fotos,
  onGirada,
  categorias,
}: {
  fotos: FotoGirable[];
  onGirada: (fotoId: string, nuevaUrl: string) => void;
  /** Si viene, agrupa `fotos` por categoría (misma etiqueta que ya se mostraba debajo de cada
   * una) — en las categorías con MÁS DE UNA candidata (ej. 2 visitas el mismo día, cada una con su
   * propia foto de "Cerramiento y seguridad") deja elegir cuál es la que se usa en el informe, en
   * vez de mostrar todas sueltas como si fueran fotos distintas. Sin esto, se listan todas planas
   * (comportamiento del Informe Semanal, que no tiene este concepto de "una foto por categoría"). */
  categorias?: {
    /** label de categoría → id de foto elegida. Sin entrada = la primera de esa categoría (mismo
     * criterio que usa el PDF por defecto). */
    elegidaPorCategoria: Record<string, string>;
    onElegir: (label: string, fotoId: string) => void;
  };
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

  // Tarjeta de una foto (imagen + botones de giro) — comparte el mismo mecanismo de girar en los
  // 2 modos (plano y agrupado), solo cambia lo que va debajo de la imagen.
  function tarjeta(f: FotoGirable, pie: ReactNode, atenuada = false) {
    const estaGirando = girando.has(f.id);
    return (
      <div key={f.id} className={`relative ${atenuada ? 'opacity-50 hover:opacity-90 transition-opacity' : ''}`}>
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
        {pie}
      </div>
    );
  }

  if (categorias) {
    const grupos = new Map<string, FotoGirable[]>();
    for (const f of fotos) {
      const label = etiquetaFoto(f.etiqueta);
      if (!grupos.has(label)) grupos.set(label, []);
      grupos.get(label)!.push(f);
    }
    // UNA sola grilla con TODAS las fotos, en el orden en que vienen — sin cortar por capítulo
    // (pedido explícito del usuario, 2026-09-06: "4 fotos en la misma línea sin importar su grupo
    // ni capítulo"). Cuando una foto pertenece a un capítulo con más de una candidata, su pie
    // cambia por el botón de elegir cuál usar — eso ya alcanza para distinguirla, no hace falta
    // separarla en su propio bloque.
    return (
      <div className="mt-2">
        <p className="text-xs text-slate-500 mb-1">
          Fotos (↺ ↻ giran la foto y dejan la fecha horizontal) — el informe lleva 1 foto por capítulo; si hay más de una, elegí cuál usar.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {fotos.map((f) => {
            const label = etiquetaFoto(f.etiqueta);
            const lista = grupos.get(label)!;
            const hayVarias = lista.length > 1;
            const elegidaId = categorias.elegidaPorCategoria[label] ?? lista[0].id;
            const elegida = f.id === elegidaId;
            const pie = hayVarias ? (
              <button
                type="button"
                onClick={() => categorias.onElegir(label, f.id)}
                disabled={elegida}
                className={`block w-full text-[10px] mt-0.5 rounded px-1 py-0.5 text-center font-semibold ${
                  elegida ? 'bg-gauge-ok/15 text-gauge-ok' : 'text-slate-500 underline decoration-dotted hover:text-gauge-idle'
                }`}
              >
                {elegida ? `✓ Se usa en el informe (${label})` : `Usar esta (${label})`}
              </button>
            ) : (
              <span className="block text-[10px] text-slate-500 mt-0.5 truncate" title={label}>
                {label}
              </span>
            );
            return tarjeta(f, pie, hayVarias && !elegida);
          })}
        </div>
        {error && <p className="text-xs text-gauge-danger mt-1">{error}</p>}
      </div>
    );
  }

  return (
    <div className="mt-2">
      <p className="text-xs text-slate-500 mb-1">Fotos (↺ ↻ giran la foto y dejan la fecha horizontal):</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
        {fotos.map((f) =>
          tarjeta(
            f,
            <span className="block text-[10px] text-slate-500 mt-0.5 truncate" title={etiquetaFoto(f.etiqueta)}>
              {etiquetaFoto(f.etiqueta)}
            </span>,
          ),
        )}
      </div>
      {error && <p className="text-xs text-gauge-danger mt-1">{error}</p>}
    </div>
  );
}
