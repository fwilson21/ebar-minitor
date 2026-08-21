import { useEffect, useState } from 'react';
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
  const [operadorId, setOperadorId] = useState<string>(usuario?.id ?? '');
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [estacionId, setEstacionId] = useState<string>('');
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ultimoPdf, setUltimoPdf] = useState<Blob | null>(null);
  const [ultimoNombre, setUltimoNombre] = useState('');

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

  // El selector de Estación solo debe ofrecer las EBAR donde el operador relevante (uno mismo si
  // no es admin; el elegido en "Operador" si es admin y hay uno seleccionado) tiene al menos una
  // visita registrada — una lista con las 29 EBAR de la empresa, casi todas sin ningún reporte de
  // ese operador, solo hacía más difícil encontrar la que sí importa (y elegir una sin reportes
  // termina en "No hay visitas registradas para los filtros seleccionados"). Sin un operador
  // puntual (admin con "Todos los operadores"), se muestran todas — no hay a quién acotar.
  useEffect(() => {
    const operadorEfectivo = esAdmin ? operadorId : usuario?.id;
    async function cargarEstaciones() {
      if (!operadorEfectivo) {
        const { data } = await supabase
          .from('estaciones_ebar')
          .select('id, codigo, nombre, zona, tipo')
          .order('codigo');
        setEstaciones((data as EstacionEbar[]) ?? []);
        return;
      }
      const { data: visitasOperador } = await supabase
        .from('visitas')
        .select('estacion_id')
        .eq('operador_id', operadorEfectivo);
      const idsConReportes = [...new Set((visitasOperador ?? []).map((v: any) => v.estacion_id as string))];
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
  const estacionNombre = estaciones.find((e) => e.id === estacionId);

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

    if (tipo === 'individual_estacion') {
      query = query.eq('estacion_id', estacionId);
    } else if (estacionId) {
      query = query.eq('estacion_id', estacionId);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map(mapearVisitaFila);
  }

  async function manejarGenerar() {
    setGenerando(true);
    setMensaje(null);
    try {
      const visitasSinFotos = await obtenerVisitas();
      if (visitasSinFotos.length === 0) {
        setMensaje('No hay visitas registradas para los filtros seleccionados.');
        return;
      }
      const visitas = await incrustarFotosVisitas(visitasSinFotos);

      const sufijoOperador = esAdmin && operadorId ? ` — ${operadorNombre}` : '';
      const sufijoEstacion = estacionNombre ? ` — ${estacionNombre.codigo} ${estacionNombre.nombre}` : '';
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
    try {
      const archivo = new File([ultimoPdf], ultimoNombre, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        await navigator.share({
          files: [archivo],
          title: 'Reporte EBAR',
          text: `Reporte EBAR — ${rangoLabel}`,
        });
        setMensaje('Reporte compartido.');
      } else {
        descargarBlob(ultimoPdf, ultimoNombre);
        setMensaje('Tu navegador no soporta compartir directo. El PDF se descargó — compártelo manualmente por WhatsApp, correo, etc.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        setMensaje(`No se pudo compartir: ${err.message ?? err}`);
      }
    } finally {
      setEnviando(false);
    }
  }

  function cambiarTipo(nuevoTipo: TipoReporte) {
    setTipo(nuevoTipo);
    setEstacionId('');
    setOperadorId(nuevoTipo === 'diario_operador' ? (usuario?.id ?? '') : '');
  }

  return (
    <div className="space-y-5">
      <h1 className="titulo-pantalla">Reportes</h1>

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
          estacionId={estacionId}
          setEstacionId={setEstacionId}
          esRango={esRango}
          fechaInicio={fechaInicio}
          setFechaInicio={setFechaInicio}
          fechaFin={fechaFin}
          setFechaFin={setFechaFin}
          generando={generando}
          manejarGenerar={manejarGenerar}
        />
        <BloqueCompartir enviando={enviando} ultimoPdf={ultimoPdf} manejarCompartir={manejarCompartir} mensaje={mensaje} />
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
                    estacionId={estacionId}
                    setEstacionId={setEstacionId}
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
                return <BloqueCompartir enviando={enviando} ultimoPdf={ultimoPdf} manejarCompartir={manejarCompartir} mensaje={mensaje} />;
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
  estacionId,
  setEstacionId,
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
  estacionId: string;
  setEstacionId: (v: string) => void;
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
        <div>
          <label className="etiqueta">Estación</label>
          <select className="campo" value={estacionId} onChange={(e) => setEstacionId(e.target.value)}>
            {tipo === 'individual_estacion' ? (
              <option value="" disabled>Selecciona una estación…</option>
            ) : (
              <option value="">Todas las estaciones</option>
            )}
            {agruparPorZonaYTipo(estaciones).map(({ zona, tipo: tipoGrupo, estaciones: delGrupo }) => (
              <optgroup key={`${zona}-${tipoGrupo}`} label={`${ETIQUETA_ZONA[zona] ?? zona} · ${ETIQUETA_TIPO[tipoGrupo] ?? tipoGrupo}`}>
                {delGrupo.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.codigo} — {e.nombre}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
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
        disabled={generando || (tipo === 'individual_estacion' && !estacionId)}
        className="boton-primario w-full"
      >
        {generando ? 'Generando…' : '📄 Generar PDF'}
      </button>
    </div>
  );
}

function BloqueCompartir({
  enviando,
  ultimoPdf,
  manejarCompartir,
  mensaje,
}: {
  enviando: boolean;
  ultimoPdf: Blob | null;
  manejarCompartir: () => void;
  mensaje: string | null;
}) {
  return (
    <div className="tarjeta p-4 space-y-2 lg:h-full lg:overflow-auto">
      <p className="etiqueta mb-1">Compartir</p>
      <button onClick={manejarCompartir} disabled={enviando || !ultimoPdf} className="boton-secundario w-full">
        📤 Descargar y compartir
      </button>
      <p className="text-xs text-slate-500">
        El PDF ya se descarga al generarlo. Este botón abre el menú para reenviarlo por WhatsApp, correo u otra app.
      </p>
      {mensaje && <p className="text-sm text-slate-700">{mensaje}</p>}
    </div>
  );
}

function formatFechaCorta(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}-${mes}-${anio}`;
}
