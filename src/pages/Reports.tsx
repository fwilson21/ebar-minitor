import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { abrirBlob, descargarBlob, generarReporteVisitas, type VisitaParaReporte, type FilaNoVisitadaReporte } from '../lib/pdf';
import { incrustarFotosVisitas } from '../lib/fotos';
import { SELECT_VISITA_REPORTE, mapearVisitaFila } from '../lib/visitasReporte';
import type { EstacionEbar, Usuario } from '../lib/types';
import { codigoYNombre } from '../lib/agruparEstaciones';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { hoyLocal } from '../lib/fecha';
import { agruparPorZonaYTipo, ETIQUETA_ZONA, ETIQUETA_TIPO } from '../lib/agruparEstaciones';

type TipoReporte = 'diario_operador' | 'consolidado_fecha' | 'individual_estacion';

export function Reports() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  // "Editar distribución" es exclusiva del administrador real (ver migración 0053).
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador;
  const editorDistribucion = useEditorDistribucion('reportes');

  const [tipo, setTipo] = useState<TipoReporte>('consolidado_fecha');
  // Formato del PDF, independiente del tipo (se ofrece en los 3): Extenso = como siempre, una caja
  // con borde por categoría y todas sus fotos. Compacto = las categorías listadas en texto, con
  // una sola grilla de fotos al final (una representativa por categoría, 5 por fila) — pedido del
  // usuario para un reporte de menos hojas. El encabezado/datos de la visita no cambian entre los 2.
  // Arranca en "compacto" (pedido del usuario, 2026-09-03) — Extenso sigue disponible, solo deja
  // de ser la opción por defecto.
  const [formato, setFormato] = useState<'extenso' | 'compacto'>('compacto');
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
  // null = "Todas las estaciones" (sin filtro); un Set (incluso vacío) = selección explícita —
  // antes un Set vacío hacía doble turno para las dos cosas ("Todas" Y "ninguna elegida a mano"),
  // así que destildar la última estación quedaba indistinguible de tildar "Todas" y todo volvía a
  // marcarse solo. Con el sentinel separado, cada estado tiene un único significado.
  const [estacionIds, setEstacionIds] = useState<Set<string> | null>(null);
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ultimoPdf, setUltimoPdf] = useState<Blob | null>(null);
  const [ultimoNombre, setUltimoNombre] = useState('');
  // Caso puntual "no se pudo compartir directo, quedó descargado" — su propio aviso destacado con
  // la instrucción de qué hacer, no un renglón de texto plano más.
  const [avisoCompartirManual, setAvisoCompartirManual] = useState(false);

  // "INFORME No." del encabezado tipo memo — a diferencia de Informe Semanal, este reporte no
  // tiene una numeración propia guardada en la base; queda a mano, vacío por defecto (si se deja
  // vacío, esa línea no sale en el PDF — ver bloqueEncabezadoMemo).
  const [numeroInforme, setNumeroInforme] = useState('');

  // Encabezado tipo memo del PDF (formato GADMFO: PARA/DE/ASUNTO/FECHA) — pedido del usuario.
  // "Para" arranca con un valor fijo (a quién se le suele dirigir este reporte); "De" arranca con
  // quien esté generando el reporte ahora mismo; los 3 quedan editables antes de generar.
  const [paraNombre, setParaNombre] = useState('Ing. Freddy Vásconez');
  const [paraCargo, setParaCargo] = useState('JEFE DE SERVICIOS DE ALCANTARILLADO');
  const [deNombre, setDeNombre] = useState('');
  const [deCargo, setDeCargo] = useState('');
  const [asunto, setAsunto] = useState('');
  const [asuntoTocado, setAsuntoTocado] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    setDeNombre((prev) => prev || usuario.nombre_completo);
    setDeCargo((prev) => prev || usuario.cargo || '');
  }, [usuario]);

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

  const operadorNombre =
    operadores.find((o) => o.id === operadorId)?.nombre_completo ?? usuario?.nombre_completo ?? '';
  // Con selección explícita, solo esas EBAR; con "Todas las estaciones" (null), TODAS las que
  // ofrece el selector (ya vienen acotadas al rango de fechas + operador elegido, ver
  // cargarEstaciones más abajo) — así el Asunto (más abajo) nombra las EBAR reales del reporte
  // incluso sin haber tildado ninguna a mano.
  const estacionesElegidas = estacionIds ? estaciones.filter((e) => estacionIds.has(e.id)) : estaciones;

  const esRango = tipo === 'consolidado_fecha' || tipo === 'individual_estacion';
  const fechaInicioEfectiva = fechaInicio;
  const fechaFinEfectiva = esRango ? fechaFin : fechaInicio;
  const rangoLabel =
    fechaInicioEfectiva === fechaFinEfectiva
      ? formatFechaCorta(fechaInicioEfectiva)
      : `${formatFechaCorta(fechaInicioEfectiva)} al ${formatFechaCorta(fechaFinEfectiva)}`;

  // El selector de Estación solo ofrece las EBAR visitadas DENTRO del rango de fechas elegido (y
  // por el operador puntual elegido, si hay uno) — así, al mover las fechas, la lista se acota a
  // lo que de verdad hay para reportar en ese período. Antes mostraba cualquier EBAR con al menos
  // una visita alguna vez; una lista con las 29 EBAR de la empresa, muchas sin nada en ese rango,
  // solo hacía más difícil encontrar la que importa. Con "Todos los operadores" se acota igual,
  // pero contra las visitas de cualquiera.
  useEffect(() => {
    const operadorEfectivo = esAdmin ? operadorId : usuario?.id;
    async function cargarEstaciones() {
      let query = supabase
        .from('visitas')
        .select('estacion_id')
        .gte('fecha_hora_llegada', `${fechaInicioEfectiva}T00:00:00`)
        .lte('fecha_hora_llegada', `${fechaFinEfectiva}T23:59:59`);
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
  }, [esAdmin, operadorId, usuario?.id, fechaInicioEfectiva, fechaFinEfectiva]);

  // Al acotarse la lista de estaciones (cambió el rango de fechas o el operador), se quitan de la
  // selección a mano las EBAR que ya no están disponibles — para que ni el "Asunto" ni el filtro
  // del reporte arrastren una estación que no aplica. "Todas las estaciones" (null) se mantiene.
  useEffect(() => {
    setEstacionIds((prev) => {
      if (prev === null) return null;
      const disponibles = new Set(estaciones.map((e) => e.id));
      const filtrado = new Set([...prev].filter((id) => disponibles.has(id)));
      return filtrado.size === prev.size ? prev : filtrado;
    });
  }, [estaciones]);

  // Título base del reporte (sin sufijo de operador/estación) — se usa tanto para armar el título
  // real del PDF (manejarGenerar) como para sugerir el "Asunto" del encabezado tipo memo acá abajo.
  const tituloBase =
    tipo === 'diario_operador' ? 'Reporte diario' : tipo === 'consolidado_fecha' ? 'Reporte consolidado' : 'Reporte de estación';
  // El "Asunto" sugerido incluye el nombre de las EBAR del campo Estación — elegidas a mano, o
  // todas las que ofrece el selector si quedó en "Todas las estaciones" (pedido del usuario:
  // el asunto de un reporte de un operador debe nombrar sus EBAR aunque no haya tildado ninguna).
  const nombresEstacionesElegidas = estacionesElegidas.map((e) => e.nombre).join(', ');
  const asuntoSugerido = nombresEstacionesElegidas
    ? `${tituloBase} — ${nombresEstacionesElegidas} — ${rangoLabel}`
    : `${tituloBase} — ${rangoLabel}`;

  // El Asunto se sugiere solo según el tipo/rango de fechas y las estaciones elegidas, mientras
  // nadie haya escrito el suyo a mano — apenas lo tocan, deja de autocompletarse.
  useEffect(() => {
    if (!asuntoTocado) setAsunto(asuntoSugerido);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asuntoSugerido]);

  async function obtenerVisitas(): Promise<VisitaParaReporte[]> {
    // Selección explícita de cero estaciones (se destildaron todas a mano, sin volver a marcar
    // "Todas") — no hay nada que traer, ni falta ir a la base a preguntar.
    if (estacionIds !== null && estacionIds.size === 0) return [];

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

    if (estacionIds !== null) {
      query = query.in('estacion_id', [...estacionIds]);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map(mapearVisitaFila);
  }

  // "EBAR sin visitar CON MOTIVO REGISTRADO" — solo las que el operador (o supervisor/admin) ya
  // justificó (ver justificaciones_no_visita, migración 0055), no todas las que faltan por
  // visitar (esas ya se ven aparte en el Dashboard — acá listarlas todas sin motivo no aportaba
  // nada, solo alargaba el PDF). Solo aplica a "Reporte consolidado" de un solo día
  // (fechaInicio === fechaFin); en un rango de varios días o en los otros 2 tipos de reporte
  // (diario por operador, de una sola estación) no hay una lista de "no visitadas" con un
  // significado claro, así que queda vacía y el PDF no agrega la sección (ver bloqueNoVisitadas en
  // pdf.ts). Es la foto de TODA la empresa ese día — no se filtra por el operador elegido arriba
  // (que no visitó no dice quién sí), pero si se eligieron estaciones puntuales en el filtro, la
  // lista se acota a esas.
  async function obtenerNoVisitadas(): Promise<FilaNoVisitadaReporte[]> {
    if (tipo !== 'consolidado_fecha' || fechaInicioEfectiva !== fechaFinEfectiva) return [];
    if (estacionIds !== null && estacionIds.size === 0) return [];

    let queryEstaciones = supabase.from('estaciones_ebar').select('id, nombre, codigo').eq('activa', true);
    if (estacionIds !== null) queryEstaciones = queryEstaciones.in('id', [...estacionIds]);

    const [{ data: todasActivas }, { data: visitasDelDia }, { data: justificacionesDia }] = await Promise.all([
      queryEstaciones,
      supabase
        .from('visitas')
        .select('estacion_id')
        .gte('fecha_hora_llegada', `${fechaInicioEfectiva}T00:00:00`)
        .lte('fecha_hora_llegada', `${fechaInicioEfectiva}T23:59:59`),
      supabase
        .from('justificaciones_no_visita')
        .select('estacion_id, motivo, usuarios ( nombre_completo )')
        .eq('fecha', fechaInicioEfectiva),
    ]);

    const idsConVisita = new Set(((visitasDelDia ?? []) as any[]).map((v) => v.estacion_id));
    const mapaJustificaciones = new Map(
      ((justificacionesDia ?? []) as any[]).map((j) => [
        j.estacion_id,
        { motivo: j.motivo as string, registrado_por: (j.usuarios?.nombre_completo as string) ?? null },
      ]),
    );

    return ((todasActivas ?? []) as EstacionEbar[])
      .filter((e) => !idsConVisita.has(e.id) && mapaJustificaciones.has(e.id))
      .map((e) => ({
        nombre: e.nombre,
        codigo: e.codigo,
        motivo: mapaJustificaciones.get(e.id)!.motivo,
        registrado_por: mapaJustificaciones.get(e.id)!.registrado_por,
      }))
      .sort((a, b) => a.codigo.localeCompare(b.codigo));
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
      const noVisitadas = await obtenerNoVisitadas();

      const blob = await generarReporteVisitas(
        visitas,
        {
          numero: numeroInforme,
          para: { nombre: paraNombre, cargo: paraCargo },
          de: { nombre: deNombre, cargo: deCargo },
          asunto,
          fecha: hoyLocal(),
        },
        noVisitadas,
        formato,
      );
      const nombreFechas =
        fechaInicioEfectiva === fechaFinEfectiva ? fechaInicioEfectiva : `${fechaInicioEfectiva}_a_${fechaFinEfectiva}`;
      const ahora = new Date();
      const horaArchivo = [ahora.getHours(), ahora.getMinutes(), ahora.getSeconds()]
        .map((n) => String(n).padStart(2, '0'))
        .join('-');
      const nombre = `reporte_${tipo}_${formato}_${nombreFechas}_${horaArchivo}.pdf`;
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
    // "Individual por estación" no tiene "Todas" — arranca sin nada elegido (obliga a elegir). El
    // resto arranca en "Todas" (null = sin filtro).
    setEstacionIds(nuevoTipo === 'individual_estacion' ? new Set() : null);
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
          formato={formato}
          setFormato={setFormato}
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
          numeroInforme={numeroInforme}
          setNumeroInforme={setNumeroInforme}
          paraNombre={paraNombre}
          setParaNombre={setParaNombre}
          paraCargo={paraCargo}
          setParaCargo={setParaCargo}
          deNombre={deNombre}
          setDeNombre={setDeNombre}
          deCargo={deCargo}
          setDeCargo={setDeCargo}
          asunto={asunto}
          setAsunto={setAsunto}
          setAsuntoTocado={setAsuntoTocado}
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
                    formato={formato}
                    setFormato={setFormato}
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
                    numeroInforme={numeroInforme}
                    setNumeroInforme={setNumeroInforme}
                    paraNombre={paraNombre}
                    setParaNombre={setParaNombre}
                    paraCargo={paraCargo}
                    setParaCargo={setParaCargo}
                    deNombre={deNombre}
                    setDeNombre={setDeNombre}
                    deCargo={deCargo}
                    setDeCargo={setDeCargo}
                    asunto={asunto}
                    setAsunto={setAsunto}
                    setAsuntoTocado={setAsuntoTocado}
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
  formato,
  setFormato,
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
  numeroInforme,
  setNumeroInforme,
  paraNombre,
  setParaNombre,
  paraCargo,
  setParaCargo,
  deNombre,
  setDeNombre,
  deCargo,
  setDeCargo,
  asunto,
  setAsunto,
  setAsuntoTocado,
  generando,
  manejarGenerar,
}: {
  tipo: TipoReporte;
  onCambiarTipo: (t: TipoReporte) => void;
  formato: 'extenso' | 'compacto';
  setFormato: (f: 'extenso' | 'compacto') => void;
  esAdmin: boolean;
  operadores: Usuario[];
  operadorId: string;
  setOperadorId: (v: string) => void;
  estaciones: EstacionEbar[];
  estacionIds: Set<string> | null;
  setEstacionIds: (v: Set<string> | null) => void;
  esRango: boolean;
  fechaInicio: string;
  setFechaInicio: (v: string) => void;
  fechaFin: string;
  setFechaFin: (v: string) => void;
  numeroInforme: string;
  setNumeroInforme: (v: string) => void;
  paraNombre: string;
  setParaNombre: (v: string) => void;
  paraCargo: string;
  setParaCargo: (v: string) => void;
  deNombre: string;
  setDeNombre: (v: string) => void;
  deCargo: string;
  setDeCargo: (v: string) => void;
  asunto: string;
  setAsunto: (v: string) => void;
  setAsuntoTocado: (v: boolean) => void;
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

      <div>
        <label className="etiqueta">Formato</label>
        <select className="campo" value={formato} onChange={(e) => setFormato(e.target.value as 'extenso' | 'compacto')}>
          <option value="compacto">Compacto — actividades en lista, 1 foto por categoría (5 por fila)</option>
          <option value="extenso">Extenso — una caja con todas las fotos por categoría</option>
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

      {estaciones.length > 0 ? (
        <SelectorEstaciones
          estaciones={estaciones}
          seleccionadas={estacionIds}
          onCambiar={setEstacionIds}
          obligatorio={tipo === 'individual_estacion'}
        />
      ) : (
        <div>
          <label className="etiqueta">Estación</label>
          <p className="text-xs text-slate-500">
            No hay estaciones con visitas en ese rango de fechas
            {esAdmin && operadorId ? ' para el operador elegido' : ''}.
          </p>
        </div>
      )}

      <div>
        <label className="etiqueta">N.º de informe (opcional)</label>
        <input
          type="text"
          className="campo"
          placeholder="ej. 020-GADMFO-DAPA-2026"
          value={numeroInforme}
          onChange={(e) => setNumeroInforme(e.target.value)}
        />
      </div>

      {/* Encabezado tipo memo del PDF (formato GADMFO) — siempre visible (pedido del usuario); ya
          viene precargado con valores por defecto razonables. */}
      <div className="tarjeta p-3">
        <p className="text-sm font-medium text-slate-700">Encabezado del PDF (Para / De / Asunto)</p>
        <div className="space-y-3 mt-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta">Para (nombre)</label>
              <input type="text" className="campo" value={paraNombre} onChange={(e) => setParaNombre(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta">Para (cargo)</label>
              <input type="text" className="campo" value={paraCargo} onChange={(e) => setParaCargo(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta">De (nombre)</label>
              <input type="text" className="campo" value={deNombre} onChange={(e) => setDeNombre(e.target.value)} />
            </div>
            <div>
              <label className="etiqueta">De (cargo)</label>
              <input type="text" className="campo" value={deCargo} onChange={(e) => setDeCargo(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="etiqueta">Asunto</label>
            <textarea
              className="campo"
              rows={2}
              value={asunto}
              onChange={(e) => {
                setAsunto(e.target.value);
                setAsuntoTocado(true);
              }}
            />
          </div>
        </div>
      </div>

      <button
        onClick={manejarGenerar}
        disabled={generando || (tipo === 'individual_estacion' && (!estacionIds || estacionIds.size === 0))}
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
  /** null = "Todas las estaciones" (sin filtro). Un Set — incluso vacío — es selección explícita:
   * vacío ahí significa de verdad "ninguna elegida", nunca "Todas". Antes un mismo Set vacío hacía
   * doble turno para las dos cosas, así que destildar la última estación quedaba indistinguible de
   * tildar "Todas" y todo volvía a marcarse solo. */
  seleccionadas: Set<string> | null;
  onCambiar: (nuevo: Set<string> | null) => void;
  /** "Individual por estación": no existe la opción "Todas", hace falta elegir al menos una. */
  obligatorio: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const grupos = agruparPorZonaYTipo(estaciones);

  const modoTodas = seleccionadas === null; // solo posible cuando !obligatorio

  const resumen = modoTodas
    ? 'Todas las estaciones'
    : seleccionadas.size === 0
      ? obligatorio
        ? 'Selecciona una o más estaciones…'
        : 'Ninguna estación seleccionada'
      : seleccionadas.size === 1
        ? estaciones.find((e) => seleccionadas!.has(e.id))?.codigo ?? '1 estación'
        : `${seleccionadas.size} estaciones seleccionadas`;

  // Si estaba en "Todas" (null), tocar una estación puntual la vuelve explícita — todas menos la
  // que se acaba de destildar — en vez de partir de un conjunto vacío y terminar con esa única
  // estación marcada (que es lo contrario de lo que se tocó).
  function expandir(): Set<string> {
    return modoTodas ? new Set(estaciones.map((e) => e.id)) : new Set(seleccionadas);
  }

  // Si el resultado termina incluyendo TODAS las estaciones a mano, "colapsa" a `null` — mismo
  // estado (y mismo query sin filtro) que tocar "Todas las estaciones". Solo en ese sentido: llegar
  // a CERO por destildar todo NUNCA colapsa a `null` (eso es lo que se acaba de arreglar) — un Set
  // vacío se queda vacío, y en pantalla se ve "Ninguna estación seleccionada" en vez de "Todas". No
  // aplica en modo obligatorio (ahí no existe "Todas" ni siquiera al llegar a estar todas marcadas).
  function colapsarSiCompleto(nuevo: Set<string>): Set<string> | null {
    return !obligatorio && nuevo.size === estaciones.length ? null : nuevo;
  }

  function alternarEstacion(id: string) {
    const nuevo = expandir();
    if (nuevo.has(id)) nuevo.delete(id);
    else nuevo.add(id);
    onCambiar(colapsarSiCompleto(nuevo));
  }

  function alternarGrupo(idsGrupo: string[]) {
    const todasMarcadasDelGrupo = idsGrupo.every((id) => modoTodas || seleccionadas!.has(id));
    const nuevo = expandir();
    for (const id of idsGrupo) {
      if (todasMarcadasDelGrupo) nuevo.delete(id);
      else nuevo.add(id);
    }
    onCambiar(colapsarSiCompleto(nuevo));
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
                    checked={modoTodas}
                    // Toggle real: tildada → destilda todo (Set vacío, "ninguna"); destildada →
                    // tilda "Todas" (null). Antes siempre volvía a `new Set()` sin importar el
                    // estado, así que nunca se podía usar para destildar todo de una.
                    onChange={() => onCambiar(modoTodas ? new Set() : null)}
                  />
                  Todas las estaciones
                </label>
              )}
              {grupos.map(({ zona, tipo, estaciones: delGrupo }) => {
                const idsGrupo = delGrupo.map((e) => e.id);
                const todasMarcadas = modoTodas || idsGrupo.every((id) => seleccionadas!.has(id));
                const algunaMarcada = modoTodas || idsGrupo.some((id) => seleccionadas!.has(id));
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
                            checked={modoTodas || seleccionadas!.has(e.id)}
                            onChange={() => alternarEstacion(e.id)}
                          />
                          {codigoYNombre(e)}
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
