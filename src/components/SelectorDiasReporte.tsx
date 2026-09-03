import { useEffect, useState } from 'react';
import { motivoDia } from '../lib/feriadosEcuador';
import { generarCeldasMes, sumarMeses } from '../lib/calendarioMes';

const DIAS_SEMANA_CORTOS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function tituloMes(mes: string): string {
  const [anio, mesNum] = mes.split('-').map(Number);
  return `${MESES_LARGO[mesNum - 1]} de ${anio}`;
}

/**
 * Calendario para elegir, día por día, cuáles entran al reporte cuando se marca "Días
 * específicos" en Reports.tsx — independiente del casillero "Solo fines de semana y feriados"
 * (ese filtra automático, sin calendario). Acá se puede elegir CUALQUIER día dentro de
 * [fechaInicio, fechaFin], sin que tengan que ser consecutivos; fin de semana/feriado se marca
 * aparte solo como referencia visual (un puntito), no restringe qué se puede tocar.
 */
export function SelectorDiasReporte({
  fechaInicio,
  fechaFin,
  feriadosAdicionales,
  diasElegidos,
  onCambiar,
}: {
  fechaInicio: string;
  fechaFin: string;
  feriadosAdicionales: Map<string, string>;
  diasElegidos: Set<string>;
  onCambiar: (dias: Set<string>) => void;
}) {
  const [mesVisible, setMesVisible] = useState(fechaInicio.slice(0, 7));

  // Si cambia el rango de arriba, el mes visible salta al de inicio del rango nuevo — así no
  // queda mirando un mes que ya no tiene nada que ver con lo elegido.
  useEffect(() => {
    setMesVisible(fechaInicio.slice(0, 7));
  }, [fechaInicio]);

  function alternar(fecha: string) {
    const nuevo = new Set(diasElegidos);
    if (nuevo.has(fecha)) nuevo.delete(fecha);
    else nuevo.add(fecha);
    onCambiar(nuevo);
  }

  const celdas = generarCeldasMes(mesVisible);

  return (
    <div className="tarjeta p-5 space-y-3 border-2 border-sky-500/40">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMesVisible((m) => sumarMeses(m, -1))} className="boton-secundario px-3 py-2 text-base font-bold">
          ‹
        </button>
        <p className="text-base font-bold capitalize text-slate-900">{tituloMes(mesVisible)}</p>
        <button type="button" onClick={() => setMesVisible((m) => sumarMeses(m, 1))} className="boton-secundario px-3 py-2 text-base font-bold">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {DIAS_SEMANA_CORTOS.map((d) => (
          <div key={d} className="text-xs text-slate-600 font-bold uppercase tracking-wide">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {celdas.map((fecha, i) => {
          if (!fecha) return <div key={i} />;
          const dentroDelRango = fecha >= fechaInicio && fecha <= fechaFin;
          const motivo = motivoDia(fecha, feriadosAdicionales);
          const elegido = diasElegidos.has(fecha);
          return (
            <button
              key={fecha}
              type="button"
              disabled={!dentroDelRango}
              onClick={() => alternar(fecha)}
              title={motivo ?? undefined}
              className={`relative h-11 rounded-lg border-2 text-base font-bold transition disabled:cursor-default ${
                !dentroDelRango
                  ? 'border-transparent text-slate-300'
                  : elegido
                    ? 'border-gauge-ok bg-gauge-ok text-white shadow-md scale-[1.03]'
                    : 'border-panel-500 bg-panel-700 text-slate-800 hover:border-sky-500 hover:bg-sky-500/10'
              }`}
            >
              {Number(fecha.slice(-2))}
              {/* Puntito de referencia (fin de semana/feriado) — solo informativo, no cambia si se
                  puede tocar el día o no; queda visible sobre los 2 fondos (elegido o no). */}
              {dentroDelRango && motivo !== null && (
                <span
                  className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${elegido ? 'bg-white' : 'bg-gauge-warn'}`}
                />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600 pt-1">
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-3 h-3 rounded bg-gauge-ok" /> Elegido
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-gauge-warn" /> Fin de semana o feriado (referencia)
        </span>
      </div>

      <p className="text-sm font-semibold text-slate-700">
        {diasElegidos.size} día{diasElegidos.size === 1 ? '' : 's'} elegido{diasElegidos.size === 1 ? '' : 's'} — toca cualquier día
        (dentro del {fechaInicio} al {fechaFin}) para incluirlo o quitarlo.
      </p>
    </div>
  );
}
