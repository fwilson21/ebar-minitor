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
 * Calendario para elegir, día por día, cuáles entran al reporte "Solo fines de semana y
 * feriados" (Reports.tsx) — a diferencia de "Fecha inicio/Fecha fin" (que sigue definiendo el
 * rango completo a revisar), acá se puede dejar fuera cualquier sábado/domingo/feriado puntual
 * sin que los demás tengan que ser consecutivos. Solo los días DENTRO de [fechaInicio, fechaFin]
 * Y que sean fin de semana/feriado son clickeables — el resto se ve pero no se puede tocar, para
 * que quede claro que están fuera de lo que se va a generar.
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
    <div className="tarjeta p-3 space-y-2">
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setMesVisible((m) => sumarMeses(m, -1))} className="boton-secundario px-2 py-1 text-xs">
          ‹
        </button>
        <p className="text-xs font-semibold capitalize">{tituloMes(mesVisible)}</p>
        <button type="button" onClick={() => setMesVisible((m) => sumarMeses(m, 1))} className="boton-secundario px-2 py-1 text-xs">
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {DIAS_SEMANA_CORTOS.map((d) => (
          <div key={d} className="text-[10px] text-slate-500 font-semibold">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {celdas.map((fecha, i) => {
          if (!fecha) return <div key={i} />;
          const dentroDelRango = fecha >= fechaInicio && fecha <= fechaFin;
          const motivo = motivoDia(fecha, feriadosAdicionales);
          const elegible = dentroDelRango && motivo !== null;
          const elegido = diasElegidos.has(fecha);
          return (
            <button
              key={fecha}
              type="button"
              disabled={!elegible}
              onClick={() => alternar(fecha)}
              title={motivo ?? undefined}
              className={`h-8 rounded-lg border text-xs font-medium transition disabled:cursor-default ${
                !dentroDelRango
                  ? 'border-transparent text-slate-300'
                  : !elegible
                    ? 'border-panel-600/40 text-slate-400'
                    : elegido
                      ? 'border-gauge-ok bg-gauge-ok/20 text-gauge-ok'
                      : 'border-gauge-warn/50 bg-gauge-warn/10 text-gauge-warn hover:bg-gauge-warn/20'
              }`}
            >
              {Number(fecha.slice(-2))}
            </button>
          );
        })}
      </div>

      <p className="text-xs text-slate-500">
        {diasElegidos.size} día{diasElegidos.size === 1 ? '' : 's'} elegido{diasElegidos.size === 1 ? '' : 's'} — toca un fin de semana o
        feriado (dentro del {fechaInicio} al {fechaFin}) para incluirlo o quitarlo.
      </p>
    </div>
  );
}
