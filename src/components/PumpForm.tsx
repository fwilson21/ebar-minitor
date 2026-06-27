import type { Bomba, EstadoBomba, RegistroBombaInput } from '../lib/types';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';

const ESTADOS: { value: EstadoBomba; label: string }[] = [
  { value: 'encendida', label: 'Encendida' },
  { value: 'apagada', label: 'Apagada' },
  { value: 'en_reposo', label: 'En reposo' },
];

interface Props {
  bomba: Bomba;
  valor: RegistroBombaInput;
  onChange: (valor: RegistroBombaInput) => void;
}

export function PumpForm({ bomba, valor, onChange }: Props) {
  const fueraDeRango =
    valor.voltaje != null && (valor.voltaje < VOLTAJE_MIN || valor.voltaje > VOLTAJE_MAX);

  function set<K extends keyof RegistroBombaInput>(key: K, v: RegistroBombaInput[K]) {
    onChange({ ...valor, [key]: v });
  }

  return (
    <div className={`tarjeta p-4 ${fueraDeRango ? 'border-gauge-danger/60' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="font-semibold">Bomba {bomba.numero_bomba}</h4>
        {fueraDeRango && (
          <span className="text-xs text-gauge-danger font-medium">⚠ Voltaje fuera de rango ({VOLTAJE_MIN}–{VOLTAJE_MAX}V)</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="etiqueta">Estado</label>
          <div className="flex gap-2">
            {ESTADOS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => set('estado', e.value)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm border transition ${
                  valor.estado === e.value
                    ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok'
                    : 'bg-panel-900 border-panel-600 text-slate-300'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="etiqueta">Voltaje (V)</label>
          <input
            type="number"
            inputMode="decimal"
            className="campo lectura"
            value={valor.voltaje ?? ''}
            onChange={(e) => set('voltaje', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="220"
          />
        </div>
        <div>
          <label className="etiqueta">Amperaje (A)</label>
          <input
            type="number"
            inputMode="decimal"
            className="campo lectura"
            value={valor.amperaje ?? ''}
            onChange={(e) => set('amperaje', e.target.value === '' ? null : Number(e.target.value))}
            placeholder="12.5"
          />
        </div>

        <div className="col-span-2">
          <label className="etiqueta">Horas de operación acumuladas</label>
          <input
            type="number"
            inputMode="decimal"
            className="campo lectura"
            value={valor.horas_operacion_acumuladas ?? ''}
            onChange={(e) =>
              set('horas_operacion_acumuladas', e.target.value === '' ? null : Number(e.target.value))
            }
            placeholder="0"
          />
        </div>

        <div className="col-span-2">
          <label className="etiqueta">Observaciones</label>
          <textarea
            className="campo"
            rows={2}
            value={valor.observaciones ?? ''}
            onChange={(e) => set('observaciones', e.target.value)}
            placeholder="Ruido en rodamiento, vibración leve, etc."
          />
        </div>
      </div>
    </div>
  );
}
