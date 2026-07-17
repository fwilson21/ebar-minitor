import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionEstacion, EstacionEbar, Usuario } from '../lib/types';

export function Asignaciones() {
  const { usuario } = useAuth();
  const [operadores, setOperadores] = useState<Usuario[]>([]);
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [operadorId, setOperadorId] = useState('');
  const [cargando, setCargando] = useState(true);
  const [cargandoAsignaciones, setCargandoAsignaciones] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [asignacionesDefault, setAsignacionesDefault] = useState<Set<string>>(new Set());
  const [seleccionDefault, setSeleccionDefault] = useState<Set<string>>(new Set());

  const [asignacionesEspeciales, setAsignacionesEspeciales] = useState<AsignacionEstacion[]>([]);
  const [fechaEspecial, setFechaEspecial] = useState('');
  const [seleccionEspecial, setSeleccionEspecial] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function cargarBase() {
      const [{ data: ops }, { data: est }] = await Promise.all([
        supabase.from('usuarios').select('*').eq('rol', 'operador').eq('activo', true).order('nombre_completo'),
        supabase.from('estaciones_ebar').select('*').eq('activa', true).order('nombre'),
      ]);
      setOperadores((ops as Usuario[]) ?? []);
      setEstaciones((est as EstacionEbar[]) ?? []);
      setCargando(false);
    }
    cargarBase();
  }, []);

  useEffect(() => {
    if (!operadorId) {
      setAsignacionesDefault(new Set());
      setSeleccionDefault(new Set());
      setAsignacionesEspeciales([]);
      return;
    }
    cargarAsignaciones(operadorId);
  }, [operadorId]);

  async function cargarAsignaciones(opId: string) {
    setCargandoAsignaciones(true);
    const { data } = await supabase.from('asignaciones_estacion').select('*').eq('operador_id', opId);
    const lista = (data as AsignacionEstacion[]) ?? [];
    const porDefecto = new Set(lista.filter((a) => a.fecha === null).map((a) => a.estacion_id));
    setAsignacionesDefault(porDefecto);
    setSeleccionDefault(new Set(porDefecto));
    setAsignacionesEspeciales(
      lista.filter((a) => a.fecha !== null).sort((a, b) => (a.fecha! < b.fecha! ? 1 : -1)),
    );
    setSeleccionEspecial(new Set());
    setCargandoAsignaciones(false);
  }

  function alternar(set: Set<string>, setSet: (s: Set<string>) => void, estacionId: string) {
    const nuevo = new Set(set);
    if (nuevo.has(estacionId)) nuevo.delete(estacionId);
    else nuevo.add(estacionId);
    setSet(nuevo);
  }

  async function guardarDefault() {
    if (!operadorId) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const agregar = [...seleccionDefault].filter((id) => !asignacionesDefault.has(id));
      const quitar = [...asignacionesDefault].filter((id) => !seleccionDefault.has(id));

      if (agregar.length) {
        const { error } = await supabase.from('asignaciones_estacion').insert(
          agregar.map((estacion_id) => ({ operador_id: operadorId, estacion_id, fecha: null, creado_por: usuario?.id })),
        );
        if (error) throw error;
      }
      if (quitar.length) {
        const { error } = await supabase
          .from('asignaciones_estacion')
          .delete()
          .eq('operador_id', operadorId)
          .is('fecha', null)
          .in('estacion_id', quitar);
        if (error) throw error;
      }
      setAsignacionesDefault(new Set(seleccionDefault));
      setMensaje('Asignación por defecto guardada.');
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function agregarEspecial() {
    if (!operadorId || !fechaEspecial || seleccionEspecial.size === 0) return;
    setGuardando(true);
    setMensaje(null);
    try {
      const { error } = await supabase.from('asignaciones_estacion').insert(
        [...seleccionEspecial].map((estacion_id) => ({
          operador_id: operadorId,
          estacion_id,
          fecha: fechaEspecial,
          creado_por: usuario?.id,
        })),
      );
      // 23505 = ya existía esa estación asignada para ese operador en esa fecha: no es un error real.
      if (error && error.code !== '23505') throw error;
      await cargarAsignaciones(operadorId);
      setMensaje('Asignación especial agregada.');
    } catch (err: any) {
      setMensaje(`No se pudo agregar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function quitarEspecial(id: string) {
    setGuardando(true);
    const { error } = await supabase.from('asignaciones_estacion').delete().eq('id', id);
    if (!error) setAsignacionesEspeciales((prev) => prev.filter((a) => a.id !== id));
    setGuardando(false);
  }

  function nombreEstacion(estacionId: string): string {
    const e = estaciones.find((x) => x.id === estacionId);
    return e ? `${e.codigo} — ${e.nombre}` : estacionId;
  }

  if (cargando) return <p className="text-slate-400">Cargando…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Asignación de EBAR a operadores</h1>
        <p className="text-sm text-slate-400">
          Elige qué estaciones visita cada operador por defecto, y agrega asignaciones extra para un día puntual
          (fines de semana, feriados, refuerzos).
        </p>
      </div>

      <div>
        <label className="etiqueta">Operador</label>
        <select className="campo" value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
          <option value="">Selecciona un operador…</option>
          {operadores.map((o) => (
            <option key={o.id} value={o.id}>
              {o.nombre_completo}
            </option>
          ))}
        </select>
      </div>

      {mensaje && (
        <p className={`text-sm ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
      )}

      {operadorId && cargandoAsignaciones && <p className="text-slate-400">Cargando asignaciones…</p>}

      {operadorId && !cargandoAsignaciones && (
        <>
          <div className="tarjeta p-4 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Asignación por defecto</h2>
              <p className="text-xs text-slate-500">EBAR que este operador visita habitualmente, todos los días.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {estaciones.map((e) => {
                const activo = seleccionDefault.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => alternar(seleccionDefault, setSeleccionDefault, e.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border ${
                      activo ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-400'
                    }`}
                  >
                    {e.codigo}
                  </button>
                );
              })}
            </div>
            <button onClick={guardarDefault} disabled={guardando} className="boton-primario w-full">
              {guardando ? 'Guardando…' : 'Guardar asignación por defecto'}
            </button>
          </div>

          <div className="tarjeta p-4 space-y-3">
            <div>
              <h2 className="text-base font-semibold">Asignación especial por fecha</h2>
              <p className="text-xs text-slate-500">
                EBAR adicionales que este operador debe visitar solo ese día, sin afectar su asignación por defecto.
              </p>
            </div>

            <div>
              <label className="etiqueta">Fecha</label>
              <input
                type="date"
                className="campo"
                value={fechaEspecial}
                onChange={(e) => setFechaEspecial(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              {estaciones.map((e) => {
                const activo = seleccionEspecial.has(e.id);
                return (
                  <button
                    key={e.id}
                    type="button"
                    onClick={() => alternar(seleccionEspecial, setSeleccionEspecial, e.id)}
                    className={`text-sm px-3 py-1.5 rounded-full border ${
                      activo ? 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn' : 'border-panel-600 text-slate-400'
                    }`}
                  >
                    {e.codigo}
                  </button>
                );
              })}
            </div>

            <button
              onClick={agregarEspecial}
              disabled={guardando || !fechaEspecial || seleccionEspecial.size === 0}
              className="boton-primario w-full"
            >
              {guardando ? 'Guardando…' : 'Agregar asignación especial'}
            </button>

            {asignacionesEspeciales.length > 0 && (
              <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
                <p className="text-xs text-slate-500">Asignaciones especiales de este operador:</p>
                {asignacionesEspeciales.map((a) => (
                  <div key={a.id} className="flex items-center justify-between text-sm">
                    <span className="text-slate-300">
                      {a.fecha} · {nombreEstacion(a.estacion_id)}
                    </span>
                    <button
                      onClick={() => quitarEspecial(a.id)}
                      disabled={guardando}
                      className="text-gauge-danger hover:underline text-xs"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
