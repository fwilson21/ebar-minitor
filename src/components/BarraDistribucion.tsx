import { ANCHO_CONTENIDO_MAX, ANCHO_CONTENIDO_MIN } from '../lib/anchoContenido';
import type { EditorDistribucion } from '../hooks/useEditorDistribucion';

/** Botón "Editar distribución" + (cuando está activo) el control de ancho de esta pantalla. Cada
 * pantalla que use GridEditable en escritorio pone esto arriba de su <GridEditable>, pasándole
 * modoEdicion/resetSignal/onGuardar del mismo editor (ver useEditorDistribucion.ts). */
export function BarraDistribucion({ editor }: { editor: EditorDistribucion }) {
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
  } = editor;

  return (
    <div className="hidden lg:block space-y-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500">
          {modoEdicion
            ? 'Arrastra la manija de arriba de cada bloque para moverlo, o su esquina para cambiar el tamaño. El resto de la pantalla sigue funcionando normal mientras acomodas.'
            : ''}
        </p>
        <div className="flex items-center gap-2 flex-shrink-0">
          {modoEdicion && (
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
        <div className="tarjeta p-3 space-y-2">
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
        </div>
      )}

      {mensaje && (
        <p className={`text-sm ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
      )}
    </div>
  );
}
