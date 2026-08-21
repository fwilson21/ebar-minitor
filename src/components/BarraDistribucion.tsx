import { ANCHO_CONTENIDO_MAX, ANCHO_CONTENIDO_MIN } from '../lib/anchoContenido';
import { OBJETIVOS_DISTRIBUCION, OBJETIVO_LABEL, type ObjetivoDistribucion } from '../lib/layoutsAdmin';
import type { EditorDistribucion } from '../hooks/useEditorDistribucion';

/** Botón "Editar distribución" + (cuando está activo) el selector de a quién se le está
 * previsualizando, el control de ancho de esta pantalla, y el checklist de a quién aplica al
 * guardar. Cada pantalla que use GridEditable en escritorio pone esto arriba de su
 * <GridEditable>, pasándole modoEdicion/resetSignal/onGuardar/objetivoEdicion del mismo editor
 * (ver useEditorDistribucion.ts).
 *
 * `sinBloques`: para pantallas de un solo bloque de contenido (ej. formulario de visita) que
 * solo necesitan el control de ancho, sin <GridEditable> debajo — oculta "Restablecer por
 * defecto" (no tendría nada que restablecer, resetSignal no lo consume nadie). */
export function BarraDistribucion({ editor, sinBloques }: { editor: EditorDistribucion; sinBloques?: boolean }) {
  const {
    modoEdicion,
    alternarModoEdicion,
    restablecer,
    mensaje,
    ancho,
    setAncho,
    guardandoAncho,
    mensajeAncho,
    guardarAncho,
    anchoSinGuardar,
    objetivoActivo,
    setObjetivoActivo,
    objetivosGuardar,
    alternarObjetivoGuardar,
  } = editor;

  return (
    <div className="hidden lg:block space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {modoEdicion
            ? sinBloques
              ? 'Ajusta con el control de abajo qué tan ancho se ve el contenido en la pantalla de la computadora.'
              : 'Arrastra la manija de arriba de cada bloque para moverlo, o su esquina para cambiar el tamaño. El resto de la pantalla sigue funcionando normal mientras acomodas.'
            : ''}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          {modoEdicion && !sinBloques && (
            <button type="button" onClick={restablecer} className="boton-secundario text-sm px-3 py-1.5">
              Restablecer por defecto
            </button>
          )}
          <button type="button" onClick={alternarModoEdicion} className="boton-secundario text-sm px-3 py-1.5">
            {modoEdicion ? 'Salir de edición' : 'Editar distribución'}
          </button>
        </div>
      </div>

      {modoEdicion && (
        <div className="tarjeta p-3 space-y-3">
          <div className="flex items-center gap-3 flex-wrap">
            <label className="etiqueta mb-0 flex-shrink-0">Estás viendo/editando la distribución de</label>
            <select
              className="campo w-auto text-sm py-1.5"
              value={objetivoActivo}
              onChange={(e) => setObjetivoActivo(e.target.value as ObjetivoDistribucion)}
            >
              {OBJETIVOS_DISTRIBUCION.map((o) => (
                <option key={o} value={o}>
                  {OBJETIVO_LABEL[o]}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <label className="etiqueta mb-0 flex-shrink-0">Ancho de esta pantalla</label>
            <input
              type="range"
              className="flex-1 accent-gauge-ok"
              min={ANCHO_CONTENIDO_MIN}
              max={ANCHO_CONTENIDO_MAX}
              step={20}
              value={ancho}
              onChange={(e) => setAncho(Number(e.target.value))}
            />
            <span className="text-xs text-slate-700 w-14 text-right flex-shrink-0">{ancho}px</span>
            <button
              type="button"
              onClick={guardarAncho}
              disabled={guardandoAncho || !anchoSinGuardar}
              className="boton-secundario text-sm px-3 py-1.5 flex-shrink-0"
            >
              {guardandoAncho ? 'Guardando…' : 'Guardar ancho'}
            </button>
          </div>
          {mensajeAncho && (
            <p className={`text-xs ${mensajeAncho.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
              {mensajeAncho}
            </p>
          )}

          <div className="border-t border-panel-600/40 pt-2 space-y-1.5">
            <p className="etiqueta mb-0">Al guardar (distribución de bloques y ancho), aplicar a</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {OBJETIVOS_DISTRIBUCION.map((o) => (
                <label key={o} className="flex items-center gap-1.5 text-sm text-slate-700 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-gauge-ok"
                    checked={objetivosGuardar.has(o)}
                    onChange={() => alternarObjetivoGuardar(o)}
                  />
                  {OBJETIVO_LABEL[o]}
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {mensaje && (
        <p className={`text-sm ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
      )}
    </div>
  );
}
