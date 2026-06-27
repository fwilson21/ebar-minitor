import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { encolarVisita, sincronizarPendientes } from '../lib/offline';
import { PumpForm } from '../components/PumpForm';
import { PhotoCapture } from '../components/PhotoCapture';
import type {
  Bomba,
  EstacionEbar,
  EstadoEstacion,
  FotoLocal,
  NivelTanque,
  RegistroBombaInput,
  VisitaInput,
} from '../lib/types';

export function VisitForm() {
  const { id: estacionId } = useParams<{ id: string }>();
  const { usuario } = useAuth();
  const navigate = useNavigate();

  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [bombas, setBombas] = useState<Bomba[]>([]);
  const [registrosBombas, setRegistrosBombas] = useState<Record<string, RegistroBombaInput>>({});
  const [horaLlegada] = useState(new Date().toISOString());
  const [estadoEstacion, setEstadoEstacion] = useState<EstadoEstacion>('operativa');
  const [nivelTanque, setNivelTanque] = useState<NivelTanque>('medio');
  const [olores, setOlores] = useState(false);
  const [oloresDesc, setOloresDesc] = useState('');
  const [ruidos, setRuidos] = useState(false);
  const [ruidosDesc, setRuidosDesc] = useState('');
  const [cerramientoOk, setCerramientoOk] = useState(true);
  const [cerramientoObs, setCerramientoObs] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (!estacionId) return;
    async function cargar() {
      const [{ data: est }, { data: bombasData }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', estacionId).single(),
        supabase.from('bombas').select('*').eq('estacion_id', estacionId).eq('activa', true).order('numero_bomba'),
      ]);
      setEstacion(est as EstacionEbar);
      const lista = (bombasData as Bomba[]) ?? [];
      setBombas(lista);
      const iniciales: Record<string, RegistroBombaInput> = {};
      for (const b of lista) {
        iniciales[b.id] = {
          bomba_id: b.id,
          numero_bomba: b.numero_bomba,
          estado: 'encendida',
          voltaje: b.voltaje_nominal ?? null,
          amperaje: null,
          horas_operacion_acumuladas: null,
          observaciones: '',
        };
      }
      setRegistrosBombas(iniciales);
    }
    cargar();
  }, [estacionId]);

  async function manejarGuardar() {
    if (!estacion || !usuario) return;
    setGuardando(true);
    setMensaje(null);

    const payload: VisitaInput = {
      cliente_uuid: crypto.randomUUID(),
      estacion_id: estacion.id,
      operador_id: usuario.id,
      fecha_hora_llegada: horaLlegada,
      fecha_hora_salida: new Date().toISOString(),
      estado_estacion: estadoEstacion,
      nivel_tanque: nivelTanque,
      olores_anormales: olores,
      olores_descripcion: olores ? oloresDesc : null,
      ruidos_extranos: ruidos,
      ruidos_descripcion: ruidos ? ruidosDesc : null,
      cerramiento_ok: cerramientoOk,
      cerramiento_observaciones: cerramientoOk ? null : cerramientoObs,
      observaciones_generales: observaciones || null,
      bombas: Object.values(registrosBombas),
      fotos,
    };

    try {
      // Si hay estado actual de la estación distinto, lo actualizamos también.
      const { error: errorEstacion } = await supabase
        .from('estaciones_ebar')
        .update({ estado_actual: estadoEstacion })
        .eq('id', estacion.id);
      if (errorEstacion) throw errorEstacion;

      if (navigator.onLine) {
        // Intento directo; si falla, cae a la cola offline para no perder el registro.
        const { error: errorVisita } = await supabase.from('visitas').insert({
          cliente_uuid: payload.cliente_uuid,
          estacion_id: payload.estacion_id,
          operador_id: payload.operador_id,
          fecha_hora_llegada: payload.fecha_hora_llegada,
          fecha_hora_salida: payload.fecha_hora_salida,
          estado_estacion: payload.estado_estacion,
          nivel_tanque: payload.nivel_tanque,
          olores_anormales: payload.olores_anormales,
          olores_descripcion: payload.olores_descripcion,
          ruidos_extranos: payload.ruidos_extranos,
          ruidos_descripcion: payload.ruidos_descripcion,
          cerramiento_ok: payload.cerramiento_ok,
          cerramiento_observaciones: payload.cerramiento_observaciones,
          observaciones_generales: payload.observaciones_generales,
        });
        if (errorVisita) throw errorVisita;
        await encolarVisita(payload); // reutiliza la cola para subir bombas/fotos de forma consistente
        await sincronizarPendientes();
      } else {
        await encolarVisita(payload);
      }

      setMensaje('Visita registrada correctamente.');
      setTimeout(() => navigate(`/estaciones/${estacion.id}`), 800);
    } catch (err: any) {
      // Conexión inestable a mitad de carga: igual se guarda localmente.
      await encolarVisita(payload);
      setMensaje('Sin conexión estable: la visita se guardó en el dispositivo y se sincronizará automáticamente.');
      setTimeout(() => navigate(`/estaciones/${estacion.id}`), 1500);
    } finally {
      setGuardando(false);
    }
  }

  if (!estacion) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Nueva visita</h1>
        <p className="text-sm text-slate-400">{estacion.nombre} · {estacion.codigo}</p>
      </div>

      <div className="tarjeta p-4 space-y-3">
        <div>
          <label className="etiqueta">Estado general de la estación</label>
          <select
            className="campo"
            value={estadoEstacion}
            onChange={(e) => setEstadoEstacion(e.target.value as EstadoEstacion)}
          >
            <option value="operativa">Operativa</option>
            <option value="mantenimiento_correctivo">Mantenimiento correctivo</option>
            <option value="fuera_de_servicio">Fuera de servicio</option>
          </select>
        </div>

        <div>
          <label className="etiqueta">Nivel de tanque de almacenamiento</label>
          <div className="flex gap-2">
            {(['alto', 'medio', 'bajo'] as NivelTanque[]).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setNivelTanque(n)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm border capitalize ${
                  nivelTanque === n ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-300'
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-2">Bombas</h2>
        <div className="space-y-3">
          {bombas.map((b) => (
            <PumpForm
              key={b.id}
              bomba={b}
              valor={registrosBombas[b.id]}
              onChange={(v) => setRegistrosBombas((prev) => ({ ...prev, [b.id]: v }))}
            />
          ))}
        </div>
      </div>

      <div className="tarjeta p-4 space-y-3">
        <CampoSiNo
          label="¿Olores anormales?"
          valor={olores}
          onChange={setOlores}
          descripcion={oloresDesc}
          onDescripcion={setOloresDesc}
        />
        <CampoSiNo
          label="¿Ruidos extraños?"
          valor={ruidos}
          onChange={setRuidos}
          descripcion={ruidosDesc}
          onDescripcion={setRuidosDesc}
        />
        <CampoSiNo
          label="Cerramiento y seguridad OK"
          valor={!cerramientoOk}
          onChange={(v) => setCerramientoOk(!v)}
          descripcion={cerramientoObs}
          onDescripcion={setCerramientoObs}
          invertido
        />
        <div>
          <label className="etiqueta">Observaciones generales / novedades</label>
          <textarea className="campo" rows={3} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} />
        </div>
      </div>

      <div className="tarjeta p-4">
        <PhotoCapture fotos={fotos} onChange={setFotos} />
      </div>

      {mensaje && <p className="text-sm text-gauge-ok">{mensaje}</p>}

      <button onClick={manejarGuardar} disabled={guardando} className="boton-primario w-full">
        {guardando ? 'Guardando…' : 'Guardar visita'}
      </button>
    </div>
  );
}

function CampoSiNo({
  label,
  valor,
  onChange,
  descripcion,
  onDescripcion,
  invertido,
}: {
  label: string;
  valor: boolean;
  onChange: (v: boolean) => void;
  descripcion: string;
  onDescripcion: (v: string) => void;
  invertido?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="etiqueta mb-0">{label}</label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onChange(invertido ? false : true)}
            className={`text-xs px-3 py-1 rounded-full border ${
              (invertido ? !valor : valor)
                ? 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger'
                : 'border-panel-600 text-slate-400'
            }`}
          >
            Sí
          </button>
          <button
            type="button"
            onClick={() => onChange(invertido ? true : false)}
            className={`text-xs px-3 py-1 rounded-full border ${
              (invertido ? valor : !valor)
                ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok'
                : 'border-panel-600 text-slate-400'
            }`}
          >
            No
          </button>
        </div>
      </div>
      {(invertido ? valor : valor) && (
        <input
          className="campo mt-2"
          placeholder="Describe brevemente…"
          value={descripcion}
          onChange={(e) => onDescripcion(e.target.value)}
        />
      )}
    </div>
  );
}
