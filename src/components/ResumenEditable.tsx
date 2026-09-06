import { Fragment, useEffect, useRef, useState } from 'react';
import {
  cargarCorrectorEs,
  revisarTexto,
  esEscritorio,
  type PalabraMal,
  type CorrectorMulti,
} from '../lib/correctorEs';
import { resumenAHtml } from '../lib/resumenFormato';

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
}: {
  valor: string;
  onCambiar: (t: string) => void;
  onCorregirGlobal: (palabra: string, correccion: string) => void;
}) {
  return (
    <div>
      <CuadroContentEditable valor={valor} onCambiar={onCambiar} />
      {esEscritorio && <PanelCorrector texto={valor} onAplicar={onCorregirGlobal} />}
    </div>
  );
}

function CuadroContentEditable({ valor, onCambiar }: { valor: string; onCambiar: (t: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const enfocadoRef = useRef(false);

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
      }}
      onInput={() => onCambiar(ref.current?.innerText ?? '')}
      onBlur={() => {
        enfocadoRef.current = false;
        const t = ref.current?.innerText ?? '';
        onCambiar(t);
        if (ref.current) ref.current.innerHTML = resumenAHtml(t);
      }}
    />
  );
}

function PanelCorrector({
  texto,
  onAplicar,
}: {
  texto: string;
  onAplicar: (palabra: string, correccion: string) => void;
}) {
  const correctorRef = useRef<CorrectorMulti | null>(null);
  const [cargado, setCargado] = useState(false);
  const [fallo, setFallo] = useState(false);
  const [errores, setErrores] = useState<PalabraMal[]>([]);
  const [correcciones, setCorrecciones] = useState<Record<string, string>>({});

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

  return (
    <div className="mt-2 rounded-lg border border-gauge-warn/40 bg-gauge-warn/5 p-3">
      <p className="text-xs font-semibold text-slate-700 mb-2">
        Palabras que podrían estar mal escritas. Mirá la frase para decidir, corregí (o escribí a mano) y aplicá — se cambia en todo el documento.
      </p>
      {/* Grid: la frase de contexto ocupa la 1ª columna (flexible), y el "→ campo ✓" van SIEMPRE en
          las mismas columnas — así todos los campos de corrección quedan alineados uno debajo del otro. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_11rem_auto] items-center gap-x-2 gap-y-1.5">
        {errores.map((e) => {
          const valor = correcciones[e.palabra] ?? e.sugerencia ?? '';
          return (
            <Fragment key={e.palabra}>
              <span className="min-w-0 text-xs text-slate-500 leading-snug">
                {e.contexto.antes}
                <span
                  className="text-slate-900 font-semibold"
                  style={{ textDecoration: 'underline wavy #dc2626', textUnderlineOffset: '3px' }}
                >
                  {e.palabra}
                </span>
                {e.contexto.despues}
              </span>
              <span className="text-slate-400">→</span>
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
                className="w-full rounded border border-panel-600 bg-panel-900 px-1.5 py-1 text-sm"
                placeholder="escribe la correcta"
              />
              <button
                type="button"
                onClick={() => aplicar(e.palabra, valor)}
                disabled={!valor.trim() || valor.trim() === e.palabra}
                className="text-base text-gauge-ok disabled:opacity-30"
                title="Aplicar en todo el documento"
                aria-label="Aplicar corrección"
              >
                ✓
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
