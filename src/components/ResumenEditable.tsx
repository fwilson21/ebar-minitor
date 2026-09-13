import { Fragment, useEffect, useRef, useState } from 'react';
import {
  cargarCorrectorEs,
  revisarTexto,
  marcarPalabraBienEscrita,
  detectarCorreccionPalabra,
  esEscritorio,
  type PalabraMal,
  type CorrectorMulti,
} from '../lib/correctorEs';
import { resumenAHtml } from '../lib/resumenFormato';
import { useAuth } from '../contexts/AuthContext';

/**
 * Cuadro para editar un resumen ("Etiqueta: contenido. Otra etiqueta: contenido.") con:
 *  - los nombres de capítulo en negrita (`contentEditable`, crece con el contenido, sin recorte);
 *  - debajo, SOLO en computadora (`esEscritorio`), el corrector de ortografía español+inglés: lista
 *    las palabras que no reconoce con la frase donde están y un campo de corrección (sugerencia
 *    automática precargada, editable a mano). Al aplicar, `onCorregirGlobal(palabra, correccion)`
 *    lleva el cambio a todo el documento (todas las visitas / bloques que compartan esa palabra).
 * Usado por el Informe Semanal y por la vista previa de Reportes (formato Súper compacto).
 */
export function ResumenEditable({
  valor,
  onCambiar,
  onCorregirGlobal,
  onErroresCambian,
}: {
  valor: string;
  onCambiar: (t: string) => void;
  onCorregirGlobal: (palabra: string, correccion: string) => void;
  /** Avisa cada vez que el panel de abajo pasa de tener palabras sin corregir a no tener (o al
   * revés) — pedido del usuario: quiere bloquear "Generar PDF" mientras cualquier resumen del
   * reporte todavía tenga este panel abierto. Sin esta prop, ResumenEditable no avisa nada (uso
   * normal del Informe Semanal, que no tiene ese bloqueo). */
  onErroresCambian?: (hayErrores: boolean) => void;
}) {
  return (
    <div>
      <CuadroContentEditable valor={valor} onCambiar={onCambiar} onCorregirGlobal={onCorregirGlobal} />
      {esEscritorio && <PanelCorrector texto={valor} onAplicar={onCorregirGlobal} onErroresCambian={onErroresCambian} />}
    </div>
  );
}

function CuadroContentEditable({
  valor,
  onCambiar,
  onCorregirGlobal,
}: {
  valor: string;
  onCambiar: (t: string) => void;
  /** Si el usuario corrige una palabra a mano (retipeándola) o con el menú del botón derecho del
   * navegador (su corrector nativo), esa misma corrección se replica sola en el resto del informe
   * — pedido del usuario, para no tener que repetirla EBAR por EBAR. Ver `detectarCorreccionPalabra`. */
  onCorregirGlobal: (palabra: string, correccion: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enfocadoRef = useRef(false);
  // Foto del texto al entrar al cuadro (retipear se hace tecla por tecla — comparar recién al
  // salir, no en cada `onInput`, es lo único que da un antes/después limpio de "una palabra
  // cambió"). El menú del botón derecho en cambio reemplaza la palabra de una sola vez mientras
  // el cuadro sigue enfocado, así que ese caso se revisa aparte en `onInput` (ver abajo).
  const textoAlEnfocarRef = useRef('');

  useEffect(() => {
    // Solo re-pinta el HTML resaltado cuando NO está enfocado (si no, se pierde la posición del cursor).
    if (!enfocadoRef.current && ref.current && ref.current.innerText !== valor) {
      ref.current.innerHTML = resumenAHtml(valor);
    }
  }, [valor]);

  return (
    <div
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      spellCheck
      lang="es"
      className="campo w-full min-h-[7rem] whitespace-pre-wrap leading-relaxed"
      onFocus={() => {
        enfocadoRef.current = true;
        textoAlEnfocarRef.current = ref.current?.innerText ?? '';
      }}
      onInput={(e) => {
        const t = ref.current?.innerText ?? '';
        onCambiar(t);
        // `insertReplacementText` es el tipo de evento que dispara el navegador cuando el usuario
        // elige una sugerencia de SU corrector nativo (clic derecho sobre la palabra subrayada) —
        // a diferencia de retipear (que llega como `insertText`/`deleteContentBackward` de a una
        // letra, sin nada útil para comparar todavía). Ese reemplazo ya quedó completo de una vez,
        // así que se puede revisar ahí mismo sin esperar a salir del cuadro.
        const tipo = (e.nativeEvent as InputEvent).inputType;
        if (tipo === 'insertReplacementText') {
          const cambio = detectarCorreccionPalabra(textoAlEnfocarRef.current, t);
          if (cambio) onCorregirGlobal(cambio.palabra, cambio.correccion);
        }
        textoAlEnfocarRef.current = t;
      }}
      onBlur={() => {
        enfocadoRef.current = false;
        const t = ref.current?.innerText ?? '';
        onCambiar(t);
        // Retipeo a mano: recién acá, al salir del cuadro, hay un antes/después completo y estable
        // para comparar (ver comentario de `textoAlEnfocarRef` arriba).
        const cambio = detectarCorreccionPalabra(textoAlEnfocarRef.current, t);
        if (cambio) onCorregirGlobal(cambio.palabra, cambio.correccion);
        if (ref.current) ref.current.innerHTML = resumenAHtml(t);
      }}
    />
  );
}

function PanelCorrector({
  texto,
  onAplicar,
  onErroresCambian,
}: {
  texto: string;
  onAplicar: (palabra: string, correccion: string) => void;
  onErroresCambian?: (hayErrores: boolean) => void;
}) {
  const { usuario } = useAuth();
  const correctorRef = useRef<CorrectorMulti | null>(null);
  const [cargado, setCargado] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [errores, setErrores] = useState<PalabraMal[]>([]);
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({});
  const [marcando, setMarcando] = useState<Set<string>>(new Set());
  const [errorMarcar, setErrorMarcar] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    cargarCorrectorEs()
      .then((c) => {
        if (!vivo) return;
        correctorRef.current = c;
        setCargado(true);
      })
      .catch(() => vivo && setFallo(true));
    return () => {
      vivo = false;
    };
  }, []);

  useEffect(() => {
    if (!cargado || !correctorRef.current) return;
    const t = setTimeout(() => setErrores(revisarTexto(correctorRef.current!, texto)), 300);
    return () => clearTimeout(t);
  }, [texto, cargado]);

  // Avisa al padre cada vez que este panel pasa de tener palabras sin corregir a no tener (o al
  // revés) — así "Generar PDF" (Reports.tsx) puede bloquearse mientras cualquier resumen del
  // reporte todavía tenga este panel abierto. Al desmontarse (el bloque desaparece de la vista
  // previa, ej. cambió el filtro) avisa que ya no hay error propio, para no dejar una marca
  // huérfana bloqueando para siempre.
  useEffect(() => {
    onErroresCambian?.(errores.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [errores.length]);
  useEffect(() => () => onErroresCambian?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  if (fallo || !cargado || errores.length === 0) return null;

  const aplicar = (palabra: string, valor: string) => {
    const limpio = valor.trim();
    if (!limpio || limpio === palabra) return;
    onAplicar(palabra, limpio);
    setErrores((prev) => prev.filter((e) => e.palabra !== palabra));
    setCorrecciones((prev) => {
      const { [palabra]: _, ...resto } = prev;
      return resto;
    });
  };

  // "Está bien escrita": a diferencia de "Aplicar", no cambia nada del texto — solo guarda la
  // palabra (diccionario_personalizado, migración 0059) para que el corrector deje de marcarla,
  // en esta sesión y en cualquier computadora de acá en más.
  const marcarBienEscrita = async (palabra: string) => {
    if (!correctorRef.current || marcando.has(palabra)) return;
    setErrorMarcar(null);
    setMarcando((prev) => new Set(prev).add(palabra));
    try {
      await marcarPalabraBienEscrita(correctorRef.current, palabra, usuario?.id);
      setErrores((prev) => prev.filter((e) => e.palabra !== palabra));
    } catch (err: any) {
      setErrorMarcar(`No se pudo guardar "${palabra}": ${err.message ?? err}`);
    } finally {
      setMarcando((prev) => {
        const copia = new Set(prev);
        copia.delete(palabra);
        return copia;
      });
    }
  };

  return (
    // Fondo rojo (no el amarillo de advertencia de antes) — pedido del usuario: que se note de
    // entrada que este cuadro necesita atención, no que pase como un aviso más entre los demás.
    <div className="mt-2 rounded-lg border-2 border-gauge-danger bg-gauge-danger/15 p-3">
      <p className="text-sm font-bold text-gauge-danger mb-2">
        Palabras que podrían estar mal escritas. Mirá la frase para decidir, corregí (o escribí a mano) y aplicá — se cambia en todo el documento.
      </p>
      {/* Grid: la frase de contexto llega como mucho a ~la mitad de la página (columna acotada,
          no `1fr`), y JUSTO después va el "→ campo ✓ | está bien escrita" — así los campos quedan
          pegados a la frase y alineados uno debajo del otro, sin el hueco grande de antes. */}
      <div className="grid grid-cols-[minmax(0,40rem)_auto_14rem_auto_auto] items-center gap-x-3 gap-y-2">
        {errores.map((e) => {
          const valor = correcciones[e.palabra] ?? e.sugerencia ?? '';
          return (
            <Fragment key={e.palabra}>
              <span className="min-w-0 text-sm text-slate-600 leading-snug">
                {e.contexto.antes}
                <span
                  className="text-slate-900 font-bold"
                  style={{ textDecoration: 'underline wavy #dc2626', textUnderlineOffset: '3px' }}
                >
                  {e.palabra}
                </span>
                {e.contexto.despues}
              </span>
              <span className="text-slate-400 text-base">→</span>
              <input
                type="text"
                value={valor}
                spellCheck
                lang="es"
                onChange={(ev) => setCorrecciones((prev) => ({ ...prev, [e.palabra]: ev.target.value }))}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') {
                    ev.preventDefault();
                    aplicar(e.palabra, valor);
                  }
                }}
                className="w-full rounded border border-panel-600 bg-panel-900 px-2 py-1 text-sm"
                placeholder="escribe la correcta"
              />
              <button
                type="button"
                onClick={() => aplicar(e.palabra, valor)}
                disabled={!valor.trim() || valor.trim() === e.palabra}
                className="text-lg text-gauge-ok disabled:opacity-30"
                title="Aplicar en todo el documento"
                aria-label="Aplicar corrección"
              >
                ✓
              </button>
              <button
                type="button"
                onClick={() => marcarBienEscrita(e.palabra)}
                disabled={marcando.has(e.palabra)}
                className="text-xs font-medium text-gauge-idle underline decoration-dotted whitespace-nowrap disabled:opacity-30"
                title="No es un error — dejar de marcarla siempre, en cualquier computadora"
              >
                {marcando.has(e.palabra) ? 'Guardando…' : 'Está bien escrita'}
              </button>
            </Fragment>
          );
        })}
      </div>
      {errorMarcar && <p className="text-xs text-gauge-danger mt-2">{errorMarcar}</p>}
    </div>
  );
}
