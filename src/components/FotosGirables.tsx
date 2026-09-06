import { useState, type ReactNode } from 'react';
import { girarFotoSubida, eliminarFotoGuardada, type SentidoGiro } from '../lib/fotos';
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
  /** Si viene, agrupa `fotos` por categoría (misma etiqueta que ya se mostraba debajo de cada una)
   * y solo muestra la PRIMERA de cada una — el informe lleva 1 foto por capítulo, mostrar 2 o 3
   * candidatas sueltas confundía (pedido del usuario, 2026-09-06: "solo la primera foto de cada
   * capítulo, no dos ni tres"). Si esa foto no corresponde de verdad a su capítulo, se borra con
   * `onBorrar` — la candidata siguiente (si había otra) pasa a mostrarse sola, sin necesidad de
   * elegir nada a mano. Sin `categorias`, se listan todas las fotos planas (comportamiento del
   * Informe Semanal, que no tiene este concepto de "una foto por capítulo"). */
  categorias?: {
    onBorrar: (fotoId: string) => void;
  };
}) {
  const [girando, setGirando] = useState<Set<string>>(new Set());
  const [borrando, setBorrando] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  async function girar(f: FotoGirable, sentido: SentidoGiro) {
    if (girando.has(f.id) || borrando.has(f.id)) return;
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

  async function borrar(f: FotoGirable, onBorrada: (fotoId: string) => void) {
    if (girando.has(f.id) || borrando.has(f.id)) return;
    if (!window.confirm('¿Eliminar esta foto? Esta acción no se puede deshacer.')) return;
    setError(null);
    setBorrando((prev) => new Set(prev).add(f.id));
    try {
      const resultado = await eliminarFotoGuardada(f.id);
      if (!resultado.ok) throw new Error(resultado.error ?? 'No se pudo eliminar la foto.');
      onBorrada(f.id);
    } catch (err: any) {
      setError(err?.message ?? 'No se pudo eliminar la foto.');
      setBorrando((prev) => {
        const copia = new Set(prev);
        copia.delete(f.id);
        return copia;
      });
    }
    // Si salió bien no hace falta sacarla de `borrando`: la foto desaparece de `fotos` (el padre
    // la filtra) y esta tarjeta ni se vuelve a renderizar.
  }

  if (!fotos.length) return null;

  // Tarjeta de una foto (imagen + botones de giro, y de borrar si `onBorrar` viene) — comparte el
  // mismo mecanismo en los 2 modos (plano y agrupado), solo cambia lo que va debajo de la imagen.
  function tarjeta(f: FotoGirable, pie: ReactNode, onBorrar?: (fotoId: string) => void) {
    const ocupada = girando.has(f.id) || borrando.has(f.id);
    return (
      <div key={f.id} className="relative">
        <img
          src={f.url}
          alt=""
          className={`w-full aspect-square object-cover rounded-md ${ocupada ? 'animate-pulse' : ''}`}
        />
        <div className="absolute top-1 left-1 flex gap-1">
          <button
            type="button"
            disabled={ocupada}
            onClick={() => girar(f, 'izquierda')}
            className="w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center disabled:opacity-40"
            aria-label="Girar foto a la izquierda"
          >
            ↺
          </button>
          <button
            type="button"
            disabled={ocupada}
            onClick={() => girar(f, 'derecha')}
            className="w-6 h-6 rounded-full bg-black/60 text-white text-sm flex items-center justify-center disabled:opacity-40"
            aria-label="Girar foto a la derecha"
          >
            ↻
          </button>
        </div>
        {onBorrar && (
          <button
            type="button"
            disabled={ocupada}
            onClick={() => borrar(f, onBorrar)}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center disabled:opacity-40"
            title="Borrar (esta foto no corresponde a este capítulo)"
            aria-label="Borrar foto"
          >
            ✕
          </button>
        )}
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
    // UNA sola grilla de 4 por fila con solo la primera foto de cada capítulo — si un capítulo
    // tiene más de una candidata, las demás quedan disponibles (borrar la que se ve revela la
    // siguiente sola) pero no se muestran todas juntas.
    const unaPorCapitulo = [...grupos.values()].map((lista) => lista[0]);
    return (
      <div className="mt-2">
        <p className="text-xs text-slate-500 mb-1">
          Fotos (↺ ↻ giran la foto y dejan la fecha horizontal, ✕ borra si no corresponde a este capítulo) — el informe lleva 1 foto por capítulo.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
          {unaPorCapitulo.map((f) => {
            const label = etiquetaFoto(f.etiqueta);
            const pie = (
              <span className="block text-[10px] text-slate-500 mt-0.5 truncate" title={label}>
                {label}
              </span>
            );
            return tarjeta(f, pie, categorias.onBorrar);
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
