import { useRef, useState } from 'react';
import type { EstadoEquipo, FotoLocal, RegistroEquipo } from '../lib/types';
import { crearFotoLocal, eliminarFotoGuardada } from '../lib/fotos';
import { useAutoResizeTextarea } from '../lib/useAutoResizeTextarea';
import { useObjectUrls } from '../lib/useObjectUrls';
import { FotoLightbox } from './FotoLightbox';
import { BotonDictado } from './BotonDictado';
import { CamaraFoto } from './CamaraFoto';

const MAX_FOTOS = 3;

type OpcionEstado = { value: EstadoEquipo; label: string; claseActiva: string };

const ESTADOS: OpcionEstado[] = [
  { value: 'operativo', label: 'Operativo', claseActiva: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  { value: 'en_falla', label: 'En falla', claseActiva: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
  { value: 'requiere_mantenimiento', label: 'Requiere mtto.', claseActiva: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' },
];

const CLASE_INACTIVA = 'bg-panel-900 border-panel-600 text-slate-700';

interface Props {
  titulo: string;
  valor: RegistroEquipo;
  onChange: (v: RegistroEquipo) => void;
  /** Oculta el selector de Estado — para subcategorías que solo registran observaciones y fotos. */
  sinEstado?: boolean;
  /** Placeholder del campo de observaciones. Pasar '' para no mostrar ninguno. */
  placeholderObservaciones?: string;
  /** Si se pasa, al elegir cualquier estado aparece un selector 1..N para marcar qué unidades. */
  cantidadNumerada?: number;
  /** Opciones de estado a mostrar (valor/etiqueta/color), en el orden dado. Por defecto: Operativo/En falla/Requiere mtto. */
  opciones?: OpcionEstado[];
  /** Reemplaza el selector de Estado por uno de "Tiene"/"No tiene". Observaciones y fotos solo se muestran si "Tiene". */
  tieneSelector?: boolean;
  /** Junto con tieneSelector: además de Observaciones/Fotos, muestra también el selector de Estado cuando "Sí tiene". */
  estadoSiTiene?: boolean;
}

export function EquipoSection({
  titulo,
  valor,
  onChange,
  sinEstado,
  placeholderObservaciones = 'Detalle del estado observado…',
  cantidadNumerada,
  opciones = ESTADOS,
  tieneSelector,
  estadoSiTiene,
}: Props) {
  const [fotoAbierta, setFotoAbierta] = useState<number | null>(null);
  const [camaraAbierta, setCamaraAbierta] = useState(false);
  // Cupo fijado al ABRIR la cámara (no recalculado en cada foto): CamaraFoto ya lleva su propio
  // contador de disparos de la sesión, así que si acá se recalculara en vivo contra
  // valor.fotos.length (que también crece con cada foto) se estaría restando dos veces el mismo
  // avance y el disparador se apagaría antes de llegar a MAX_FOTOS.
  const [cupoCamara, setCupoCamara] = useState(0);
  const valorRef = useRef(valor);
  valorRef.current = valor;
  const urls = useObjectUrls(valor.fotos);
  const observacionesRef = useAutoResizeTextarea(valor.observaciones ?? '');
  const mostrarDetalle = !tieneSelector || valor.tiene === true;
  const mostrarEstado = !sinEstado && (!tieneSelector || (estadoSiTiene && valor.tiene === true));

  function elegirTiene(nuevoValor: boolean) {
    const tiene = valor.tiene === nuevoValor ? null : nuevoValor;
    onChange(
      tiene === true
        ? { ...valor, tiene }
        : { ...valor, tiene, estado: '', observaciones: '', numeros_afectados: [], fotos: [] },
    );
  }

  // Ver el mismo comentario en PhotoCapture.tsx: cada captura de CamaraFoto llega una por una.
  async function agregarFotoDesdeCamara(blob: Blob, dispositivoEnHorizontal: boolean) {
    const nueva = await crearFotoLocal(blob, new Date().toISOString(), dispositivoEnHorizontal);
    onChange({ ...valorRef.current, fotos: [...valorRef.current.fotos, nueva] });
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
    <div className="tarjeta p-4 space-y-3">
      <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">{titulo}</h3>

      {tieneSelector && (
        <div>
          <label className="etiqueta">¿Tiene?</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => elegirTiene(true)}
              className={`flex-1 rounded-lg px-2 py-2 text-xs border transition ${
                valor.tiene === true ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : CLASE_INACTIVA
              }`}
            >
              Sí tiene
            </button>
            <button
              type="button"
              onClick={() => elegirTiene(false)}
              className={`flex-1 rounded-lg px-2 py-2 text-xs border transition ${
                // Antes usaba casi el mismo gris que el botón SIN marcar (bg-panel-700 sobre
                // CLASE_INACTIVA con bg-panel-900) — apenas se distinguía cuál de los dos estaba
                // elegido. gauge-idle (el mismo tono que ya se usa en otras pantallas para "no
                // aplica"/neutral) marca "No tiene" con un color propio y bien distinto del verde
                // de "Sí tiene", sin sugerir que sea un problema.
                valor.tiene === false ? 'bg-gauge-idle/15 border-gauge-idle text-gauge-idle' : CLASE_INACTIVA
              }`}
            >
              No tiene
            </button>
          </div>
        </div>
      )}

      {mostrarEstado && (
        <div>
          <label className="etiqueta">Estado</label>
          <div className="flex gap-2">
            {opciones.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => {
                  const nuevoEstado = valor.estado === e.value ? '' : e.value;
                  onChange({ ...valor, estado: nuevoEstado, numeros_afectados: [] });
                }}
                className={`flex-1 rounded-lg px-2 py-2 text-xs border transition ${
                  valor.estado === e.value ? e.claseActiva : CLASE_INACTIVA
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {mostrarEstado && cantidadNumerada && valor.estado !== '' && (
        <div>
          <label className="etiqueta">¿Cuáles? (N.º)</label>
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: cantidadNumerada }, (_, i) => i + 1).map((n) => {
              const activo = (valor.numeros_afectados ?? []).includes(n);
              const claseActiva = opciones.find((e) => e.value === valor.estado)?.claseActiva ?? '';
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => {
                    const actuales = valor.numeros_afectados ?? [];
                    const nuevos = activo
                      ? actuales.filter((x) => x !== n)
                      : [...actuales, n].sort((a, b) => a - b);
                    onChange({ ...valor, numeros_afectados: nuevos });
                  }}
                  className={`w-10 h-10 rounded-lg text-sm border font-medium transition ${
                    activo ? claseActiva : CLASE_INACTIVA
                  }`}
                >
                  {n}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mostrarDetalle && (
      <div>
        <label className="etiqueta">Observaciones</label>
        <div className="relative">
          <textarea
            ref={observacionesRef}
            className="campo pr-10 resize-none overflow-hidden"
            rows={2}
            value={valor.observaciones ?? ''}
            onChange={(e) => onChange({ ...valor, observaciones: e.target.value })}
            placeholder={placeholderObservaciones}
          />
          <BotonDictado
            valorActual={valor.observaciones ?? ''}
            onTexto={(t) => onChange({ ...valor, observaciones: t })}
          />
        </div>
      </div>
      )}

      {mostrarDetalle && (
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="etiqueta mb-0">Fotos ({valor.fotos.length}/{MAX_FOTOS})</span>
          {valor.fotos.length < MAX_FOTOS && (
            <button
              type="button"
              className="boton-secundario text-sm py-1.5 px-3"
              onClick={() => {
                setCupoCamara(MAX_FOTOS - valor.fotos.length);
                setCamaraAbierta(true);
              }}
            >
              📷 Tomar foto
            </button>
          )}
        </div>

        {camaraAbierta && (
          <CamaraFoto
            maxFotos={cupoCamara}
            etiquetaSeccion={titulo}
            fotosPrevias={valor.fotos.length}
            totalMax={MAX_FOTOS}
            onCapturar={agregarFotoDesdeCamara}
            onCerrar={() => setCamaraAbierta(false)}
          />
        )}
        {valor.fotos.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {valor.fotos.map((foto, idx) => {
              const src = foto.blob ? urls[foto.id] : foto.url_publica;
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
      )}

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
