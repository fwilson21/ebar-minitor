import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { abrirBlob, descargarBlob, generarReporteVisitas, type VisitaParaReporte } from '../lib/pdf';
import { incrustarFotosVisitas } from '../lib/fotos';
import { SELECT_VISITA_REPORTE, mapearVisitaFila } from '../lib/visitasReporte';
import type { EstacionEbar, Usuario } from '../lib/types';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { hoyLocal } from '../lib/fecha';
import { agruparPorZonaYTipo, ETIQUETA_ZONA, ETIQUETA_TIPO } from '../lib/agruparEstaciones';

type TipoReporte = 'diario_operador' | 'consolidado_fecha' | 'individual_estacion';

export function Reports() {
  const { usuario, tienePermiso } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  // "Editar distribución" es del administrador real o de quien tenga el permiso
  // 'editar_distribucion' (ni siquiera supervisor lo tiene por defecto).
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador || tienePermiso('editar_distribucion');
  const editorDistribucion = useEditorDistribucion('reportes');

  const [tipo, setTipo] = useState<TipoReporte>('consolidado_fecha');
  const [fechaInicio, setFechaInicio] = useState(hoyLocal());
  const [fechaFin, setFechaFin] = useState(hoyLocal());
  const [operadores, setOperadores] = useState<Usuario[]>([]);
  // Arranca en el propio id SOLO si quien mira la pantalla es operador (para "Diario por
  // operador" viendo sus propias visitas) — un administrador/supervisor no es operador, así que
  // arrancaba con un id que no calzaba con ninguna opción real del selector (el de abajo ya solo
  // trae rol operador): el <select> mostraba "Todos los operadores" (primera opción, por no
  // encontrar match) pero el estado seguía guardando el id del admin por dentro, desincronizado
  // de lo que se veía en pantalla — eso rompía el filtro de Estación de más abajo.
  const [operadorId, setOperadorId] = useState<string>(usuario?.rol === 'operador' ? usuario.id : '');
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [estacionIds, setEstacionIds] = useState<Set<string>>(new Set());
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ultimoPdf, setUltimoPdf] = useState<Blob | null>(null);
  const [ultimoNombre, setUltimoNombre] = useState('');
  // Caso puntual "no se pudo compartir directo, quedó descargado" — su propio aviso destacado con
  // la instrucción de qué hacer, no un renglón de texto plano más.
  const [avisoCompartirManual, setAvisoCompartirManual] = useState(false);

  useEffect(() => {
    if (!esAdmin) return;
    // Solo rol operador: el resto del personal (supervisor, administrador, digitador) no
    // registra visitas, así que nunca tendría reportes que generar acá.
    supabase
      .from('usuarios')
      .select('id, nombre_completo, rol, activo, firma_url')
      .eq('activo', true)
      .eq('rol', 'operador')
      .order('nombre_completo')
      .then(({ data }) => setOperadores((data as Usuario[]) ?? []));
  }, [esAdmin]);

  // El selector de Estación solo debe ofrecer las EBAR que tienen al menos una visita registrada
  // — una lista con las 29 EBAR de la empresa, muchas sin ningún reporte, solo hacía más difícil
  // encontrar la que sí importa (y elegir una sin reportes termina en "No hay visitas registradas
  // para los filtros seleccionados"). Si hay un operador puntual elegido (uno mismo si no es
  // admin; el elegido en "Operador" si es admin), se acota a sus reportes; con "Todos los
  // operadores" se acota igual, pero contra los reportes de cualquiera (no se muestran todas sin
  // filtrar).
  useEffect(() => {
    const operadorEfectivo = esAdmin ? operadorId : usuario?.id;
    async function cargarEstaciones() {
      let query = supabase.from('visitas').select('estacion_id');
      if (operadorEfectivo) query = query.eq('operador_id', operadorEfectivo);
      const { data: visitasRelevantes } = await query;
      const idsConReportes = [...new Set((visitasRelevantes ?? []).map((v: any) => v.estacion_id as string))];
      if (idsConReportes.length === 0) {
        setEstaciones([]);
        return;
      }
      const { data } = await supabase
        .from('estaciones_ebar')
        .select('id, codigo, nombre, zona, tipo')
        .in('id', idsConReportes)
        .order('codigo');
      setEstaciones((data as EstacionEbar[]) ?? []);
    }
    cargarEstaciones();
  }, [esAdmin, operadorId, usuario?.id]);

  const operadorNombre =
    operadores.find((o) => o.id === operadorId)?.nombre_completo ?? usuario?.nombre_completo ?? '';
  const estacionesElegidas = estaciones.filter((e) => estacionIds.has(e.id));

  const esRango = tipo === 'consolidado_fecha' || tipo === 'individual_estacion';
  const fechaInicioEfectiva = fechaInicio;
  const fechaFinEfectiva = esRango ? fechaFin : fechaInicio;
  const rangoLabel =
    fechaInicioEfectiva === fechaFinEfectiva
      ? formatFechaCorta(fechaInicioEfectiva)
      : `${formatFechaCorta(fechaInicioEfectiva)} al ${formatFechaCorta(fechaFinEfectiva)}`;

  async function obtenerVisitas(): Promise<VisitaParaReporte[]> {
    let query = supabase
      .from('visitas')
      .select(SELECT_VISITA_REPORTE)
      .gte('fecha_hora_llegada', `${fechaInicioEfectiva}T00:00:00`)
      .lte('fecha_hora_llegada', `${fechaFinEfectiva}T23:59:59`);

    if (tipo === 'diario_operador') {
      query = query.eq('operador_id', esAdmin ? operadorId : (usuario?.id ?? ''));
    } else if (esAdmin && operadorId) {
      query = query.eq('operador_id', operadorId);
    }

    if (estacionIds.size > 0) {
      query = query.in('estacion_id', [...estacionIds]);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map(mapearVisitaFila);
  }

  async function manejarGenerar() {
    setGenerando(true);
    setMensaje(null);
    setAvisoCompartirManual(false);
    try {
      const visitasSinFotos = await obtenerVisitas();
      if (visitasSinFotos.length === 0) {
        setMensaje('No hay visitas registradas para los filtros seleccionados.');
        return;
      }
      const visitas = await incrustarFotosVisitas(visitasSinFotos);

      const sufijoOperador = esAdmin && operadorId ? ` — ${operadorNombre}` : '';
      const sufijoEstacion =
        estacionesElegidas.length === 1
          ? ` — ${estacionesElegidas[0].codigo} ${estacionesElegidas[0].nombre}`
          : estacionesElegidas.length > 1
            ? ` — ${estacionesElegidas.length} estaciones`
            : '';
      const titulo =
        tipo === 'diario_operador'
          ? `Reporte diario — ${operadorNombre}${sufijoEstacion}`
          : tipo === 'consolidado_fecha'
          ? `Reporte consolidado${sufijoOperador}${sufijoEstacion}`
          : `Reporte de estación${sufijoEstacion}${sufijoOperador}`;

      const blob = await generarReporteVisitas(`${titulo}\n${rangoLabel}`, visitas);
      const nombreFechas =
        fechaInicioEfectiva === fechaFinEfectiva ? fechaInicioEfectiva : `${fechaInicioEfectiva}_a_${fechaFinEfectiva}`;
      const ahora = new Date();
      const horaArchivo = [ahora.getHours(), ahora.getMinutes(), ahora.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join('-');
      const nombre = `reporte_${tipo}_${nombreFechas}_${horaArchivo}.pdf`;
      setUltimoPdf(blob);
      setUltimoNombre(nombre);
      descargarBlob(blob, nombre);
      abrirBlob(blob);

      await supabase.from('reportes').insert({
        tipo,
        generado_por: usuario?.id,
        fecha_referencia: fechaInicioEfectiva,
        operador_id: tipo === 'diario_operador' ? (esAdmin ? operadorId : usuario?.id) : null,
      });

      setMensaje('Reporte generado y descargado.');
    } catch (err: any) {
      setMensaje(`Error al generar el reporte: ${err.message ?? err}`);
    } finally {
      setGenerando(false);
    }
  }

  async function manejarCompartir() {
    if (!ultimoPdf) {
      setMensaje('Primero genera el reporte en PDF.');
      return;
    }
    setEnviando(true);
    setMensaje(null);
    setAvisoCompartirManual(false);
    try {
      const archivo = new File([ultimoPdf], ultimoNombre, { type: 'application/pdf' });
      if (!navigator.canShare || !navigator.canShare({ files: [archivo] })) {
        descargarBlob(ultimoPdf, ultimoNombre);
        setAvisoCompartirManual(true);
        return;
      }
      try {
        await navigator.share({
          files: [archivo],
          title: 'Reporte EBAR',
          text: `Reporte EBAR — ${rangoLabel}`,
        });
        setMensaje('Reporte compartido.');
      } catch (err: any) {
        if (err?.name === 'AbortError') return; // cerró el selector sin elegir nada, no es un error
        // El navegador dice que sí puede compartir (canShare) pero lo niega al intentarlo (ej. un
        // reporte con muchas fotos pesa más de lo que el selector nativo admite) — se descarga como
        // respaldo en vez de dejar al usuario solo con un error técnico y sin el archivo.
        descargarBlob(ultimoPdf, ultimoNombre);
        setAvisoCompartirManual(true);
      }
    } finally {
      setEnviando(false);
    }
  }

  function cambiarTipo(nuevoTipo: TipoReporte) {
    setTipo(nuevoTipo);
    setEstacionIds(new Set());
    if (nuevoTipo !== 'diario_operador') {
      setOperadorId('');
      return;
    }
    // "Diario por operador" no tiene la opción "Todos" — siempre necesita alguien elegido. Si
    // quien mira la pantalla es operador, se autoselecciona a sí mismo; si es administrador/
    // supervisor (no aparece en la lista, que solo trae rol operador), se autoselecciona el
    // primero de la lista para no dejar el selector desincronizado del estado real (mismo bug
    // que el de operadorId inicial, ver arriba).
    setOperadorId(usuario?.rol === 'operador' ? usuario.id : (operadores[0]?.id ?? ''));
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="titulo-pantalla">Reportes</h1>
        {/* Fuera de GridEditable a propósito (no es un bloque movible más) — el Informe Semanal
            es una pantalla aparte, esto es solo la puerta de entrada. Exclusivo de
            administrador/supervisor, igual que el resto de esta pantalla. */}
        {esAdmin && (
          <Link to="/informe-semanal" className="boton-secundario text-sm py-2 px-3">
            📋 Informe Semanal
          </Link>
        )}
      </div>

      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-5">
        <BloqueFiltrosGenerar
          tipo={tipo}
          onCambiarTipo={cambiarTipo}
          esAdmin={esAdmin}
          operadores={operadores}
          operadorId={operadorId}
          setOperadorId={setOperadorId}
          estaciones={estaciones}
          estacionIds={estacionIds}
          setEstacionIds={setEstacionIds}
          esRango={esRango}
          fechaInicio={fechaInicio}
          setFechaInicio={setFechaInicio}
          fechaFin={fechaFin}
          setFechaFin={setFechaFin}
          generando={generando}
          manejarGenerar={manejarGenerar}
        />
        <BloqueCompartir
          enviando={enviando}
          manejarCompartir={manejarCompartir}
          mensaje={mensaje}
          avisoCompartirManual={avisoCompartirManual}
          ultimoNombre={ultimoNombre}
        />
      </div>

      {/* Escritorio (lg+): mismos bloques, acomodados según lo guardado (o el acomodo por
          defecto). Solo el administrador ve "Editar distribución" (ni siquiera supervisor). */}
      <div className="hidden lg:block space-y-3">
        {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} />}
        <GridEditable
          pantallaId="reportes"
          bloques={PANTALLAS_EDITABLES.find((p) => p.id === 'reportes')!.bloques}
          modoEdicion={puedeEditarDistribucion && editorDistribucion.modoEdicion}
          resetSignal={editorDistribucion.resetSignal}
          objetivoEdicion={editorDistribucion.objetivoActivo}
          onGuardar={editorDistribucion.guardar}
          renderBloque={(bloqueId) => {
            switch (bloqueId) {
              case 'filtros_generar':
                return (
                  <BloqueFiltrosGenerar
                    tipo={tipo}
                    onCambiarTipo={cambiarTipo}
                    esAdmin={esAdmin}
                    operadores={operadores}
                    operadorId={operadorId}
                    setOperadorId={setOperadorId}
                    estaciones={estaciones}
                    estacionIds={estacionIds}
                    setEstacionIds={setEstacionIds}
                    esRango={esRango}
                    fechaInicio={fechaInicio}
                    setFechaInicio={setFechaInicio}
                    fechaFin={fechaFin}
                    setFechaFin={setFechaFin}
                    generando={generando}
                    manejarGenerar={manejarGenerar}
                  />
                );
              case 'compartir':
                return (
                  <BloqueCompartir
                    enviando={enviando}
                    manejarCompartir={manejarCompartir}
                    mensaje={mensaje}
                    avisoCompartirManual={avisoCompartirManual}
                    ultimoNombre={ultimoNombre}
                  />
                );
              default:
                return null;
            }
          }}
        />
        {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>
    </div>
  );
}

function BloqueFiltrosGenerar({
  tipo,
  onCambiarTipo,
  esAdmin,
  operadores,
  operadorId,
  setOperadorId,
  estaciones,
  estacionIds,
  setEstacionIds,
  esRango,
  fechaInicio,
  setFechaInicio,
  fechaFin,
  setFechaFin,
  generando,
  manejarGenerar,
}: {
  tipo: TipoReporte;
  onCambiarTipo: (t: TipoReporte) => void;
  esAdmin: boolean;
  operadores: Usuario[];
  operadorId: string;
  setOperadorId: (v: string) => void;
  estaciones: EstacionEbar[];
  estacionIds: Set<string>;
  setEstacionIds: (v: Set<string>) => void;
  esRango: boolean;
  fechaInicio: string;
  setFechaInicio: (v: string) => void;
  fechaFin: string;
  setFechaFin: (v: string) => void;
  generando: boolean;
  manejarGenerar: () => void;
}) {
  return (
    <div className="tarjeta p-4 space-y-3 lg:h-full lg:overflow-auto">
      <div>
        <label className="etiqueta">Tipo de reporte</label>
        <select className="campo" value={tipo} onChange={(e) => onCambiarTipo(e.target.value as TipoReporte)}>
          <option value="consolidado_fecha">Consolidado por fecha</option>
          <option value="diario_operador">Diario por operador</option>
          <option value="individual_estacion">Individual por estación</option>
        </select>
      </div>

      {esAdmin && operadores.length > 0 && (
        <div>
          <label className="etiqueta">Operador</label>
          <select className="campo" value={operadorId} onChange={(e) => setOperadorId(e.target.value)}>
            {tipo !== 'diario_operador' && <option value="">Todos los operadores</option>}
            {operadores.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nombre_completo}
              </option>
            ))}
          </select>
        </div>
      )}

      {estaciones.length > 0 && (
        <SelectorEstaciones
          estaciones={estaciones}
          seleccionadas={estacionIds}
          onCambiar={setEstacionIds}
          obligatorio={tipo === 'individual_estacion'}
        />
      )}

      {esRango ? (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="etiqueta">Fecha inicio</label>
            <input type="date" className="campo" value={fechaInicio} max={fechaFin} onChange={(e) => setFechaInicio(e.target.value)} />
          </div>
          <div>
            <label className="etiqueta">Fecha fin</label>
            <input type="date" className="campo" value={fechaFin} min={fechaInicio} onChange={(e) => setFechaFin(e.target.value)} />
          </div>
        </div>
      ) : (
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" className="campo" value={fechaInicio} onChange={(e) => setFechaInicio(e.target.value)} />
        </div>
      )}

      <button
        onClick={manejarGenerar}
        disabled={generando || (tipo === 'individual_estacion' && estacionIds.size === 0)}
        className="boton-primario w-full"
      >
        {generando ? 'Generando…' : '📄 Generar PDF'}
      </button>
    </div>
  );
}

/** Selector de una o varias EBAR, agrupado por zona+tipo — reemplaza al <select> nativo de
 * antes: en el picker nativo del celular no se podía elegir más de una sin que se cerrara el
 * cuadro, y no había forma de marcar un grupo entero de una (pedido explícito del usuario). El
 * cuadro de diálogo se queda abierto entre selección y selección — se cierra recién con "Listo"
 * o tocando afuera. */
function SelectorEstaciones({
  estaciones,
  seleccionadas,
  onCambiar,
  obligatorio,
}: {
  estaciones: EstacionEbar[];
  seleccionadas: Set<string>;
  onCambiar: (nuevo: Set<string>) => void;
  /** "Individual por estación": no existe la opción "Todas", hace falta elegir al menos una. */
  obligatorio: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const grupos = agruparPorZonaYTipo(estaciones);

  // Conjunto vacío = "Todas las estaciones" (así se guarda: sin filtro, en vez de listar cada id a
  // mano — de paso, una estación nueva que se cree después ya queda incluida sola). Antes esto
  // dejaba cada casilla individual sin marcar mientras "Todas" sí lo estaba, que se veía
  // contradictorio — `modoTodas` hace que las casillas de abajo se vean marcadas también en ese
  // caso, sin cambiar cómo se guarda el filtro.
  const modoTodas = !obligatorio && seleccionadas.size === 0;

  const resumen =
    seleccionadas.size === 0
      ? obligatorio
        ? 'Selecciona una o más estaciones…'
        : 'Todas las estaciones'
      : seleccionadas.size === 1
        ? estaciones.find((e) => seleccionadas.has(e.id))?.codigo ?? '1 estación'
        : `${seleccionadas.size} estaciones seleccionadas`;

  // Si estaba en "Todas" (selección implícita), tocar una estación puntual la vuelve explícita —
  // todas menos la que se acaba de destildar — en vez de partir de un conjunto vacío y terminar
  // con esa única estación marcada (que es lo contrario de lo que se tocó).
  function expandirSiModoTodas(): Set<string> {
    return modoTodas ? new Set(estaciones.map((e) => e.id)) : new Set(seleccionadas);
  }

  // Si el resultado termina incluyendo TODAS las estaciones a mano, "colapsa" de vuelta al
  // conjunto vacío — mismo estado (y mismo query sin filtro) que tocar "Todas las estaciones". No
  // aplica en modo obligatorio: ahí no existe "Todas", así que el conjunto vacío sí significa
  // "nada elegido todavía" y no hay que colapsar aunque se marquen todas a mano.
  function colapsarSiCompleto(nuevo: Set<string>) {
    onCambiar(!obligatorio && nuevo.size === estaciones.length ? new Set() : nuevo);
  }

  function alternarEstacion(id: string) {
    const nuevo = expandirSiModoTodas();
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    colapsarSiCompleto(nuevo);
  }

  function alternarGrupo(idsGrupo: string[]) {
    const todasMarcadas = idsGrupo.every((id) => modoTodas || seleccionadas.has(id));
    const nuevo = expandirSiModoTodas();
    for (const id of idsGrupo) {
      if (todasMarcadas) nuevo.delete(id);
      else nuevo.add(id);
    }
    colapsarSiCompleto(nuevo);
  }

  return (
    <div>
      <label className="etiqueta">Estación</label>
      <button type="button" onClick={() => setAbierto(true)} className="campo text-left truncate">
        {resumen}
      </button>

      {/* createPortal a document.body: en escritorio este selector vive dentro de un bloque de
          GridEditable, que react-grid-layout posiciona con `transform` (translate) en línea —
          cualquier ancestro con `transform` vuelve a definir el marco de referencia de los hijos
          `position: fixed` (spec de CSS), así que sin el portal este modal (y su fondo oscuro)
          quedaba encogido/recortado al tamaño del bloque en vez de cubrir toda la pantalla, y el
          título "Elegir estaciones" se veía cortado. Con el portal, el modal sale de ese árbol y
          se posiciona de verdad contra el viewport completo. */}
      {abierto &&
        createPortal(
          <>
          <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setAbierto(false)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[92vw] max-w-md max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b border-panel-600/40 shrink-0">
              <h2 className="font-semibold text-sm text-slate-900">Elegir estaciones</h2>
              <button onClick={() => setAbierto(false)} className="text-slate-600 hover:text-slate-900 text-lg leading-none">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {!obligatorio && (
                <label className="flex items-center gap-2 text-sm font-medium text-slate-900 pb-2 border-b border-panel-600/40">
                  <input
                    type="checkbox"
                    className="w-4 h-4 accent-gauge-ok"
                    checked={seleccionadas.size === 0}
                    onChange={() => onCambiar(new Set())}
                  />
                  Todas las estaciones
                </label>
              )}
              {grupos.map(({ zona, tipo, estaciones: delGrupo }) => {
                const idsGrupo = delGrupo.map((e) => e.id);
                const todasMarcadas = modoTodas || idsGrupo.every((id) => seleccionadas.has(id));
                const algunaMarcada = modoTodas || idsGrupo.some((id) => seleccionadas.has(id));
                return (
                  <div key={`${zona}-${tipo}`}>
                    <label className="flex items-center gap-2 text-xs font-bold text-sky-700 uppercase tracking-wider mb-1.5">
                      <input
                        type="checkbox"
                        className="w-4 h-4 accent-gauge-ok shrink-0"
                        checked={todasMarcadas}
                        ref={(el) => {
                          if (el) el.indeterminate = algunaMarcada && !todasMarcadas;
                        }}
                        onChange={() => alternarGrupo(idsGrupo)}
                      />
                      {ETIQUETA_ZONA[zona] ?? zona} · {ETIQUETA_TIPO[tipo] ?? tipo}
                    </label>
                    <div className="pl-6 space-y-1.5">
                      {delGrupo.map((e) => (
                        <label key={e.id} className="flex items-center gap-2 text-sm text-slate-800">
                          <input
                            type="checkbox"
                            className="w-4 h-4 accent-gauge-ok shrink-0"
                            checked={modoTodas || seleccionadas.has(e.id)}
                            onChange={() => alternarEstacion(e.id)}
                          />
                          {e.codigo} — {e.nombre}
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="p-4 border-t border-panel-600/40 shrink-0">
              <button type="button" onClick={() => setAbierto(false)} className="boton-primario w-full">
                Listo
              </button>
            </div>
          </div>
          </>,
          document.body,
        )}
    </div>
  );
}

function BloqueCompartir({
  enviando,
  manejarCompartir,
  mensaje,
  avisoCompartirManual,
  ultimoNombre,
}: {
  enviando: boolean;
  manejarCompartir: () => void;
  mensaje: string | null;
  avisoCompartirManual: boolean;
  ultimoNombre: string;
}) {
  return (
    <div className="tarjeta p-4 space-y-2 lg:h-full lg:overflow-auto">
      <p className="etiqueta mb-1">Compartir</p>
      {/* Siempre clickeable (antes quedaba deshabilitado sin ninguna explicación mientras no
          hubiera un PDF generado) — manejarCompartir ya trae su propia validación y avisa "Primero
          genera el reporte en PDF" en `mensaje` si todavía no hay nada que enviar. */}
      <button onClick={manejarCompartir} disabled={enviando} className="boton-secundario w-full">
        📤 Descargar y compartir
      </button>
      <p className="text-xs text-slate-500">
        El PDF ya se descarga al generarlo. Este botón abre el menú para reenviarlo por WhatsApp, correo u otra app.
      </p>
      {avisoCompartirManual ? (
        <div className="rounded-lg border-2 border-gauge-warn/40 bg-gauge-warn/10 p-3 space-y-1">
          <p className="text-sm font-bold text-gauge-warn">📥 El PDF ya está en tu carpeta de Descargas</p>
          <p className="text-xs text-slate-700">
            Tu navegador no dejó enviarlo directo (suele ser por el tamaño del archivo, con muchas fotos). Para
            mandarlo: abre WhatsApp, correo o la app que prefieras y <b>adjúntalo a mano desde Descargas</b> — ya
            tiene el nombre "{ultimoNombre}".
          </p>
        </div>
      ) : (
        mensaje && <p className="text-sm text-slate-700">{mensaje}</p>
      )}
    </div>
  );
}

function formatFechaCorta(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}-${mes}-${anio}`;
}
