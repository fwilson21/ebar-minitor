import { useRef, useState } from 'react';
import type { Bomba, EstadoBomba, FotoLocal, RegistroBombaInput } from '../lib/types';
import { VOLTAJE_MAX, VOLTAJE_MIN } from '../lib/types';
import { eliminarFotoGuardada, estamparFechaEnFoto } from '../lib/fotos';
import { useAutoResizeTextarea } from '../lib/useAutoResizeTextarea';
import { FotoLightbox } from './FotoLightbox';
import { BotonDictado } from './BotonDictado';

const MAX_FOTOS = 3;

const ESTADOS: { value: EstadoBomba; label: string; claseActiva: string }[] = [
  { value: 'encendida', label: 'Encendida', claseActiva: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  { value: 'apagada', label: 'Apagada', claseActiva: 'bg-panel-700 border-panel-600 text-slate-800' },
  { value: 'en_falla', label: 'En falla', claseActiva: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
  {
    value: 'retirado_para_mantenimiento',
    label: 'Retirado para mtto.',
    claseActiva: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn',
  },
];

interface Props {
  bomba: Bomba;
  valor: RegistroBombaInput;
  onChange: (valor: RegistroBombaInput) => void;
}

export function PumpForm({ bomba, valor, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);
  const observacionesRef = useAutoResizeTextarea(valor.observaciones ?? '');

  const fueraDeRango =
    valor.voltaje != null && (valor.voltaje < VOLTAJE_MIN || valor.voltaje > VOLTAJE_MAX);

  function set<K extends keyof RegistroBombaInput>(key: K, v: RegistroBombaInput[K]) {
    onChange({ ...valor, [key]: v });
  }

  async function manejarFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const archivos = Array.from(e.target.files ?? []).slice(0, MAX_FOTOS - valor.fotos.length);
    e.target.value = '';
    const ahora = new Date().toISOString();
    const nuevas: FotoLocal[] = await Promise.all(
      archivos.map(async (file) => ({
        id: crypto.randomUUID(),
        blob: await estamparFechaEnFoto(file, ahora),
        tomada_en: ahora,
        estado_subida: 'pendiente' as const,
      })),
    );
    onChange({ ...valor, fotos: [...valor.fotos, ...nuevas] });
  }

  async function manejarEliminarFoto(foto: FotoLocal) {
    const yaSubida = foto.estado_subida === 'subida' && !foto.blob;
    if (yaSubida) {
      if (!window.confirm('¿Eliminar esta foto? Esta acción no se puede deshacer.')) return;
      const resultado = await eliminarFotoGuardada(foto.id);
      if (!resultado.ok) {
        alert(resultado.error);
        return;
      }
    }
    onChange({ ...valor, fotos: valor.fotos.filter((f) => f.id !== foto.id) });
  }

  return (
    <div className={`tarjeta p-4 ${fueraDeRango ? 'border-gauge-danger/60' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-base font-bold uppercase tracking-wide">Bomba {bomba.numero_bomba}</h4>
        {fueraDeRango && (
          <span className="text-xs text-gauge-danger font-medium">⚠ Voltaje fuera de rango ({VOLTAJE_MIN}–{VOLTAJE_MAX}V)</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="etiqueta">Estado</label>
          <div className="grid grid-cols-2 gap-2">
            {ESTADOS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => set('estado', valor.estado === e.value ? '' : e.value)}
                className={`rounded-lg px-3 py-2 text-sm border transition ${
                  valor.estado === e.value ? e.claseActiva : 'bg-panel-900 border-panel-600 text-slate-700'
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
          />
        </div>

        <div>
          <label className="etiqueta">Custodio</label>
          <input
            type="text"
            className="campo"
            value={valor.custodio ?? ''}
            onChange={(e) => set('custodio', e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Código SIGAME del bien</label>
          <input
            type="text"
            className="campo"
            value={valor.codigo_sigame ?? ''}
            onChange={(e) => set('codigo_sigame', e.target.value)}
          />
        </div>

        <div className="col-span-2">
          <label className="etiqueta">Observaciones</label>
          <div className="relative">
            <textarea
              ref={observacionesRef}
              className="campo pr-10 resize-none overflow-hidden"
              rows={2}
              value={valor.observaciones ?? ''}
              onChange={(e) => set('observaciones', e.target.value)}
            />
            <BotonDictado valorActual={valor.observaciones ?? ''} onTexto={(t) => set('observaciones', t)} />
          </div>
        </div>

        <div className="col-span-2">
          <div className="flex items-center justify-between mb-2">
            <span className="etiqueta mb-0">Fotos ({valor.fotos.length}/{MAX_FOTOS})</span>
            {valor.fotos.length < MAX_FOTOS && (
              <button
                type="button"
                className="boton-secundario text-sm py-1.5 px-3"
                onClick={() => inputRef.current?.click()}
              >
                📷 Tomar foto
              </button>
            )}
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={manejarFoto}
            />
          </div>
          {valor.fotos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {valor.fotos.map((foto, idx) => {
                const src = foto.blob ? URL.createObjectURL(foto.blob) : foto.url_publica;
                return (
                  <div key={foto.id} className="relative aspect-square rounded-lg overflow-hidden bg-panel-700">
                    {src && (
                      <img
                        src={src}
                        className="w-full h-full object-cover cursor-pointer"
                        alt=""
                        onClick={() => setFotoAbierta(idx)}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => manejarEliminarFoto(foto)}
                      className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white text-xs flex items-center justify-center"
                    >
                      ✕
                    </button>
                    {foto.estado_subida === 'pendiente' && (
                      <span className="absolute bottom-1 left-1 text-[10px] bg-gauge-warn/90 text-white px-1.5 rounded">
                        Pendiente
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {fotoAbierta !== null && (
        <FotoLightbox
          fotos={valor.fotos}
          indice={fotoAbierta}
          onCambiarIndice={setFotoAbierta}
          onCerrar={() => setFotoAbierta(null)}
        />
      )}
    </div>
  );
}
