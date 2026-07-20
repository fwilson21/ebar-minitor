import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import type { AsignacionEstacion, EstacionEbar, Usuario } from '../lib/types';
import { registrarFormularioActivo, desregistrarFormularioActivo } from '../lib/formularioActivo';

function dentroDelRango(fecha: string, desde: string, hasta: string): boolean {
  return fecha >= desde && fecha <= hasta;
}

/** De varias asignaciones especiales para la misma estación en distintas fechas dentro del
 * rango elegido, se queda solo con la más reciente — evita listar una fila por cada día repetido
 * (típico de los turnos de fin de semana/feriado, que generan una fila por EBAR y por día). */
function soloLaUltimaPorEstacion(lista: AsignacionEstacion[]): AsignacionEstacion[] {
  const porEstacion = new Map<string, AsignacionEstacion>();
  for (const a of lista) {
    const actual = porEstacion.get(a.estacion_id);
    if (!actual || (a.fecha ?? '') > (actual.fecha ?? '')) porEstacion.set(a.estacion_id, a);
  }
  return [...porEstacion.values()].sort((a, b) => (b.fecha ?? '').localeCompare(a.fecha ?? ''));
}

export function Asignaciones() {
  const { usuario } = useAuth();
  const [operadores, setOperadores] = useState<Usuario[]>([]);
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [operadorId, setOperadorId] = useState('');
  const [cargando, setCargando] = useState(true);
  const [cargandoAsignaciones, setCargandoAsignaciones] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  const [todasAsignaciones, setTodasAsignaciones] = useState<AsignacionEstacion[]>([]);

  // Filtro de "qué ventana de fechas estoy viendo" — se usa tanto en el resumen de arriba como en
  // la lista de asignaciones especiales del operador elegido más abajo. Sin fecha "desde", no se
  // muestra ninguna asignación especial (solo la de por defecto), para no inundar la pantalla.
  const [filtroDesde, setFiltroDesde] = useState('');
  const [filtroHasta, setFiltroHasta] = useState('');
  const hayFiltro = !!filtroDesde;
  const filtroHastaEfectivo = filtroHasta || filtroDesde;

  const [asignacionesDefault, setAsignacionesDefault] = useState<Set<string>>(new Set());
  const [seleccionDefault, setSeleccionDefault] = useState<Set<string>>(new Set());

  const [asignacionesEspeciales, setAsignacionesEspeciales] = useState<AsignacionEstacion[]>([]);
  const [fechaEspecial, setFechaEspecial] = useState('');
  const [seleccionEspecial, setSeleccionEspecial] = useState<Set<string>>(new Set());

  useEffect(() => {
    async function cargarBase() {
      const [{ data: ops }, { data: est }, { data: asigTodas }] = await Promise.all([
        supabase.from('usuarios').select('*').eq('rol', 'operador').eq('activo', true).order('nombre_completo'),
        supabase.from('estaciones_ebar').select('*').eq('activa', true).order('nombre'),
        supabase.from('asignaciones_estacion').select('*'),
      ]);
      setOperadores((ops as Usuario[]) ?? []);
      setEstaciones((est as EstacionEbar[]) ?? []);
      setTodasAsignaciones((asigTodas as AsignacionEstacion[]) ?? []);
      setCargando(false);
    }
    cargarBase();
  }, []);

  async function cargarTodasAsignaciones() {
    const { data } = await supabase.from('asignaciones_estacion').select('*');
    setTodasAsignaciones((data as AsignacionEstacion[]) ?? []);
  }

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
      await cargarTodasAsignaciones();
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
      await cargarTodasAsignaciones();
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
    if (!error) {
      setAsignacionesEspeciales((prev) => prev.filter((a) => a.id !== id));
      await cargarTodasAsignaciones();
    }
    setGuardando(false);
  }

  function nombreEstacion(estacionId: string): string {
    const e = estaciones.find((x) => x.id === estacionId);
    return e ? `${e.codigo} — ${e.nombre}` : estacionId;
  }

  function codigoEstacion(estacionId: string): string {
    return estaciones.find((x) => x.id === estacionId)?.codigo ?? '?';
  }

  // Le avisa al header (botón "Salir") si hay cambios sin guardar en esta pantalla: la
  // asignación por defecto marcada pero no guardada, o una asignación especial a medio llenar
  // (fecha + al menos una estación ya elegidas pero sin tocar "Agregar" todavía).
  useEffect(() => {
    const seleccionDefaultDistinta =
      seleccionDefault.size !== asignacionesDefault.size ||
      [...seleccionDefault].some((id) => !asignacionesDefault.has(id));
    const hayPendienteEspecial = !!fechaEspecial && seleccionEspecial.size > 0;

    registrarFormularioActivo({
      hayCambios: seleccionDefaultDistinta || hayPendienteEspecial,
      guardar: async () => {
        if (seleccionDefaultDistinta) await guardarDefault();
        if (hayPendienteEspecial) await agregarEspecial();
      },
    });
    return () => desregistrarFormularioActivo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionDefault, asignacionesDefault, fechaEspecial, seleccionEspecial]);

  if (cargando) return <p className="text-slate-400">Cargando…</p>;

  const asignacionesEspecialesFiltradas = hayFiltro
    ? soloLaUltimaPorEstacion(
        asignacionesEspeciales.filter((a) => a.fecha && dentroDelRango(a.fecha, filtroDesde, filtroHastaEfectivo)),
      )
    : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Asignación de EBAR a operadores</h1>
        <p className="text-sm text-slate-400">
          Elige qué estaciones visita cada operador por defecto, y agrega asignaciones extra para un día puntual
          (fines de semana, feriados, refuerzos).
        </p>
      </div>

      <div className="tarjeta p-4 space-y-3">
        <div>
          <h2 className="text-base font-semibold">Resumen de asignaciones</h2>
          <p className="text-xs text-slate-500">
            Qué EBAR tiene cada operador por defecto. Elegí una fecha (o un rango) para ver también sus asignaciones
            especiales de esos días.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Ver desde</label>
            <input type="date" className="campo" value={filtroDesde} onChange={(e) => setFiltroDesde(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta">Hasta (opcional)</label>
            <input
              type="date"
              className="campo"
              value={filtroHasta}
              onChange={(e) => setFiltroHasta(e.target.value)}
              disabled={!filtroDesde}
            />
          </div>
        </div>

        {operadores.length === 0 ? (
          <p className="text-sm text-slate-500">No hay operadores activos.</p>
        ) : (
          <div className="space-y-3">
            {operadores.map((o) => {
              const deEsteOperador = todasAsignaciones.filter((a) => a.operador_id === o.id);
              const porDefecto = deEsteOperador.filter((a) => a.fecha === null);
              const especialesEnRango = hayFiltro
                ? soloLaUltimaPorEstacion(
                    deEsteOperador.filter((a) => a.fecha && dentroDelRango(a.fecha, filtroDesde, filtroHastaEfectivo)),
                  )
                : [];
              return (
                <div key={o.id} className="border-b border-panel-600/40 pb-3 last:border-0 last:pb-0">
                  <p className="text-sm font-medium text-slate-100">{o.nombre_completo}</p>
                  <p className="text-xs text-slate-400">
                    Por defecto:{' '}
                    {porDefecto.length > 0 ? porDefecto.map((a) => codigoEstacion(a.estacion_id)).join(', ') : 'Ninguna'}
                  </p>
                  {hayFiltro && (
                    <div className="text-xs text-slate-500 mt-1">
                      {especialesEnRango.length > 0 ? (
                        especialesEnRango.map((a) => (
                          <p key={a.id}>
                            {a.fecha} · {codigoEstacion(a.estacion_id)}
                          </p>
                        ))
                      ) : (
                        <p className="italic">Sin asignación especial en ese rango.</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
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

            {hayFiltro ? (
              <div className="space-y-1.5 pt-2 border-t border-panel-600/40">
                <p className="text-xs text-slate-500">Asignaciones especiales de este operador en ese rango:</p>
                {asignacionesEspecialesFiltradas.length > 0 ? (
                  asignacionesEspecialesFiltradas.map((a) => (
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
                  ))
                ) : (
                  <p className="text-xs text-slate-500 italic">Sin asignaciones especiales en ese rango.</p>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500 pt-2 border-t border-panel-600/40">
                Elegí una fecha arriba, en "Resumen de asignaciones", para ver las que ya están cargadas.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
