import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { abrirBlob, descargarBlob, generarInformeSemanal } from '../lib/pdf';
import { hoyLocal } from '../lib/fecha';
import { nombreFeriadoCalculado, esDiaNoRegular } from '../lib/feriadosEcuador';
import {
  DIAS_SEMANA,
  lunesDeSemana,
  diasLaborables,
  diasFinDeSemana,
  formatFechaLarga,
  formatRangoSemana,
  formatRangoParaArchivo,
  formatFechaCortaTabla,
  fechaLocalDe,
  obtenerVisitasSemana,
  construirBloquesDia,
  fotosDelDia,
  construirSnapshotDia,
  detectarCambioDia,
  incrustarFotosBloques,
  codigoAsistenciaSugerido,
  CODIGOS_ASISTENCIA,
  LEYENDA_CODIGOS_ASISTENCIA,
  type VisitaCruda,
  type BloqueInforme,
  type SnapshotVisita,
  type CambioDetectado,
} from '../lib/informeSemanal';

const ANTECEDENTES_PLANTILLA =
  'El Cantón Francisco de Orellana cuenta con un sistema de alcantarillado sanitario y catorce ' +
  'estaciones de bombeo que impulsan las aguas residuales a la planta de tratamiento, ubicada Km ' +
  '3½ vía El Auca. El sistema de saneamiento en las parroquias de El Dorado, García Moreno, La ' +
  'Belleza y Nuevo Paraíso cuenta con infraestructura de impulsión dirigida a plantas de ' +
  'tratamiento con pretratamiento, tanques Imhoff y humedales artificiales.';

interface InformeRow {
  id: string;
  semana_desde: string;
  semana_hasta: string;
  antecedentes: string;
  conclusiones: string;
  recomendaciones: string;
  firma_fecha: string | null;
  firma_nombre: string;
  firma_cargo: string;
  asistencia: Record<string, Record<string, string>>;
  numero_informe: string | null;
  generado_en: string | null;
}

interface DiaRow {
  id: string;
  fecha: string;
  contenido: BloqueInforme[];
  aprobado: boolean;
  aprobado_en: string | null;
  snapshot_visitas: SnapshotVisita[] | null;
}

interface Operador {
  id: string;
  nombre_completo: string;
}

export function InformeSemanal() {
  const { usuario, tienePermiso } = useAuth();
  const puedeVer = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';
  // "Editar distribución" acá es solo el control de ancho de esta pantalla (sinBloques en
  // BarraDistribucion) — es un único documento largo, no una grilla de bloques movibles. Mismo
  // criterio que VisitForm.tsx.
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador || tienePermiso('editar_distribucion');
  const editorDistribucion = useEditorDistribucion('informe_semanal');

  const [semanaDesde, setSemanaDesde] = useState(() => lunesDeSemana(hoyLocal()));
  const [cambiandoSemana, setCambiandoSemana] = useState(false);
  const [forzarEdicion, setForzarEdicion] = useState<Set<string>>(new Set());
  const [cargando, setCargando] = useState(true);
  const [informe, setInforme] = useState<InformeRow | null>(null);
  const [diasDB, setDiasDB] = useState<Record<string, DiaRow>>({});
  const [visitasSemana, setVisitasSemana] = useState<VisitaCruda[]>([]);
  const [operadoresDelDia, setOperadoresDelDia] = useState<Operador[]>([]);
  const [feriadosAdicionales, setFeriadosAdicionales] = useState<Set<string>>(new Set());
  const [edicion, setEdicion] = useState<Record<string, BloqueInforme[]>>({});
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [ultimoPdf, setUltimoPdf] = useState<Blob | null>(null);
  const [ultimoNombre, setUltimoNombre] = useState('');
  // Fechas (con visitas registradas) que faltan por aprobar al momento de tocar "Generar informe
  // final" — se avisa antes de generar en vez de dejarlas caer del informe en silencio.
  const [avisoDiasSinAprobar, setAvisoDiasSinAprobar] = useState<string[] | null>(null);
  // Aviso propio de "Generar/Descargar/Compartir", separado de `mensaje` (que se usa para el resto
  // de la pantalla) — este grupo de botones queda hasta abajo de una pantalla larga, así que su
  // aviso tiene que aparecer pegado a los botones, no arriba del todo donde no se ve (ver memoria
  // del proyecto sobre mensajes junto al botón).
  const [mensajeGenerar, setMensajeGenerar] = useState<string | null>(null);

  const dias = useMemo(() => diasLaborables(semanaDesde), [semanaDesde]);
  const finde = useMemo(() => diasFinDeSemana(semanaDesde), [semanaDesde]);
  const semanaBloqueada = Object.values(diasDB).some((d) => d.aprobado);

  useEffect(() => {
    if (!puedeVer) return;
    let cancelado = false;
    async function cargar() {
      setCargando(true);
      setEdicion({});
      const hasta = dias[DIAS_SEMANA - 1];
      const [{ data: informeRow }, visitas, { data: feriadosAdic }] = await Promise.all([
        supabase.from('informes_semanales').select('*').eq('semana_desde', semanaDesde).maybeSingle(),
        obtenerVisitasSemana(semanaDesde, hasta),
        supabase.from('feriados_adicionales').select('fecha'),
      ]);
      if (cancelado) return;

      setVisitasSemana(visitas);
      setFeriadosAdicionales(new Set((feriadosAdic ?? []).map((f: { fecha: string }) => f.fecha)));

      // Operadores activos con al menos una visita esta semana — nadie más entra en "Desarrollo
      // de la semana" ni en "Control semanal del personal" (ver memoria del proyecto).
      const idsConVisita = [...new Set(visitas.map((v) => v.operador_id))];
      if (idsConVisita.length > 0) {
        const { data: activos } = await supabase
          .from('usuarios')
          .select('id, nombre_completo')
          .eq('rol', 'operador')
          .eq('activo', true)
          .in('id', idsConVisita)
          .order('nombre_completo');
        if (!cancelado) setOperadoresDelDia((activos as Operador[]) ?? []);
      } else {
        setOperadoresDelDia([]);
      }

      let informeFinal = informeRow as InformeRow | null;
      if (!informeFinal) {
        // Primera vez que se abre esta semana: conclusiones/recomendaciones se copian de la
        // semana pasada (si existe) como punto de partida editable, antecedentes arranca con la
        // plantilla fija.
        const semanaAnterior = new Date(`${semanaDesde}T12:00:00`);
        semanaAnterior.setDate(semanaAnterior.getDate() - 7);
        const desdeAnterior = semanaAnterior.toISOString().slice(0, 10);
        const { data: anterior } = await supabase
          .from('informes_semanales')
          .select('conclusiones, recomendaciones')
          .eq('semana_desde', desdeAnterior)
          .maybeSingle();
        const { data: creado, error } = await supabase
          .from('informes_semanales')
          .upsert(
            {
              semana_desde: semanaDesde,
              semana_hasta: hasta,
              antecedentes: ANTECEDENTES_PLANTILLA,
              conclusiones: anterior?.conclusiones ?? '',
              recomendaciones: anterior?.recomendaciones ?? '',
              creado_por: usuario!.id,
            },
            { onConflict: 'semana_desde' },
          )
          .select()
          .single();
        if (error) {
          if (!cancelado) setMensaje(`No se pudo crear el informe de esta semana: ${error.message}`);
        } else {
          informeFinal = creado as InformeRow;
        }
      }
      if (!cancelado) setInforme(informeFinal);

      if (informeFinal) {
        const { data: diasRow } = await supabase
          .from('informes_semanales_dias')
          .select('*')
          .eq('informe_id', informeFinal.id);
        if (!cancelado) {
          const mapa: Record<string, DiaRow> = {};
          for (const d of (diasRow as DiaRow[]) ?? []) mapa[d.fecha] = d;
          setDiasDB(mapa);
        }
      }
      if (!cancelado) setCargando(false);
    }
    cargar();
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [semanaDesde, puedeVer]);

  if (!puedeVer) return <Navigate to="/reportes" replace />;

  async function guardarCampoInforme(campo: keyof InformeRow, valor: string) {
    if (!informe) return;
    setInforme({ ...informe, [campo]: valor });
    await supabase.from('informes_semanales').update({ [campo]: valor }).eq('id', informe.id);
  }

  async function guardarAsistencia(operadorId: string, fecha: string, codigo: string) {
    if (!informe) return;
    const nueva = {
      ...informe.asistencia,
      [operadorId]: { ...(informe.asistencia[operadorId] ?? {}), [fecha]: codigo },
    };
    setInforme({ ...informe, asistencia: nueva });
    await supabase.from('informes_semanales').update({ asistencia: nueva }).eq('id', informe.id);
  }

  function visitasDelDia(fecha: string): VisitaCruda[] {
    return visitasSemana.filter((v) => fechaLocalDe(v.fecha_hora_llegada) === fecha);
  }

  function bloquesDeHoy(fecha: string): BloqueInforme[] {
    return edicion[fecha] ?? construirBloquesDia(visitasDelDia(fecha));
  }

  function actualizarBloques(fecha: string, nuevos: BloqueInforme[]) {
    setEdicion((prev) => ({ ...prev, [fecha]: nuevos }));
  }

  async function aprobarDia(fecha: string) {
    if (!informe) return;
    const vDia = visitasDelDia(fecha);
    const contenido = bloquesDeHoy(fecha);
    const snapshot = construirSnapshotDia(vDia);
    const { data, error } = await supabase
      .from('informes_semanales_dias')
      .upsert(
        {
          informe_id: informe.id,
          fecha,
          contenido,
          aprobado: true,
          aprobado_en: new Date().toISOString(),
          aprobado_por: usuario!.id,
          snapshot_visitas: snapshot,
        },
        { onConflict: 'informe_id,fecha' },
      )
      .select()
      .single();
    if (error) {
      setMensaje(`No se pudo aprobar el día: ${error.message}`);
      return;
    }
    setDiasDB((prev) => ({ ...prev, [fecha]: data as DiaRow }));
    setEdicion((prev) => {
      const { [fecha]: _, ...resto } = prev;
      return resto;
    });
    setForzarEdicion((prev) => {
      if (!prev.has(fecha)) return prev;
      const copia = new Set(prev);
      copia.delete(fecha);
      return copia;
    });
  }

  // Editar un día ya aprobado aunque no haya ningún cambio detectado en las visitas — arranca la
  // edición desde el contenido ya guardado (no desde las visitas en crudo), para no perder ajustes
  // manuales previos (viñetas editadas/borradas, responsable, fotos elegidas).
  function editarDiaAprobado(fecha: string) {
    const fila = diasDB[fecha];
    if (!fila) return;
    setEdicion((prev) => ({ ...prev, [fecha]: fila.contenido }));
    setForzarEdicion((prev) => new Set(prev).add(fecha));
  }

  function cancelarEdicionAprobado(fecha: string) {
    setEdicion((prev) => {
      const { [fecha]: _, ...resto } = prev;
      return resto;
    });
    setForzarEdicion((prev) => {
      const copia = new Set(prev);
      copia.delete(fecha);
      return copia;
    });
  }

  async function actualizarDiaConCambio(fecha: string) {
    await aprobarDia(fecha); // recalcula contenido + snapshot desde las visitas actuales y re-aprueba
  }

  async function mantenerDiaComoEsta(fecha: string) {
    const fila = diasDB[fecha];
    if (!fila) return;
    const snapshot = construirSnapshotDia(visitasDelDia(fecha));
    const { data, error } = await supabase
      .from('informes_semanales_dias')
      .update({ snapshot_visitas: snapshot })
      .eq('id', fila.id)
      .select()
      .single();
    if (error) {
      setMensaje(`No se pudo actualizar: ${error.message}`);
      return;
    }
    setDiasDB((prev) => ({ ...prev, [fecha]: data as DiaRow }));
  }

  function rehacerBorrador() {
    setEdicion({});
    setMensaje('Los días sin aprobar se recalcularon desde las visitas.');
  }

  // Días laborables que de verdad necesitan aprobación (los feriados sin ninguna visita se
  // muestran como informativos y no cuentan para nada de lo de abajo).
  const diasRequeridos = dias.filter((f) => visitasDelDia(f).length > 0 || !esDiaNoRegular(f, feriadosAdicionales));
  const diasAprobados = diasRequeridos.filter((f) => diasDB[f]?.aprobado);
  const diasPorAprobar = diasRequeridos.filter((f) => !diasDB[f]?.aprobado);
  const diasConCambioPendiente = diasAprobados.filter(
    (f) => !!detectarCambioDia(diasDB[f].snapshot_visitas, visitasDelDia(f)),
  );
  // Ya no exige los 5 días aprobados: alcanza con al menos uno, y que ninguno de los ya aprobados
  // tenga un aviso de "⚠️ Cambió algo" sin resolver — eso sí bloquea, para no generar un informe
  // con contenido desactualizado sin que la analista lo haya visto.
  const puedeGenerar = diasAprobados.length > 0 && diasConCambioPendiente.length === 0;

  // Antes de generar: si queda algún día con visitas registradas por los operadores pero todavía
  // sin aprobar, avisa en vez de dejarlo caer del informe en silencio — el botón solo dispara
  // generarPdf() directo cuando ya no hay ninguno de esos.
  function manejarClickGenerar() {
    const diasConDatosSinAprobar = diasPorAprobar.filter((f) => visitasDelDia(f).length > 0);
    if (diasConDatosSinAprobar.length > 0) {
      setAvisoDiasSinAprobar(diasConDatosSinAprobar);
      return;
    }
    generarPdf();
  }

  function irAAprobar(fechas: string[]) {
    setAvisoDiasSinAprobar(null);
    document.getElementById(`dia-${fechas[0]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  async function generarPdf() {
    if (!informe || !puedeGenerar) return;
    setGenerando(true);
    setMensajeGenerar(null);
    try {
      const numero = informe.numero_informe || (await sugerirNumeroInforme());
      const diasPdf = await Promise.all(
        dias.map(async (f) => {
          const visitasDia = visitasDelDia(f);
          const fila = diasDB[f];
          // Un día que todavía no se aprobó no entra al PDF con contenido (se marca aparte como
          // pendiente) — ya no hace falta que los 5 días estén aprobados para generar.
          const bloques = fila?.aprobado ? await incrustarFotosBloques(fila.contenido, fotosDelDia(visitasDia)) : [];
          return {
            fecha: f,
            esFeriado: esDiaNoRegular(f, feriadosAdicionales) && visitasDia.length === 0,
            nombreFeriado: nombreFeriadoCalculado(f),
            aprobado: !!fila?.aprobado,
            bloques,
          };
        }),
      );
      // La tabla en pantalla muestra un código sugerido (T/F/-) para las celdas que la analista
      // todavía no tocó a mano — eso vive solo en la vista, `informe.asistencia` solo tiene lo que
      // se guardó explícitamente. El PDF tiene que ver lo mismo que se ve en pantalla, así que acá
      // se resuelve cada celda con el mismo criterio antes de armar el documento.
      const diasTabla = [...dias, ...finde];
      const asistenciaParaPdf: Record<string, Record<string, string>> = {};
      for (const op of operadoresDelDia) {
        asistenciaParaPdf[op.id] = {};
        for (const f of diasTabla) {
          const tieneVisita = visitasSemana.some((v) => v.operador_id === op.id && fechaLocalDe(v.fecha_hora_llegada) === f);
          asistenciaParaPdf[op.id][f] =
            informe.asistencia[op.id]?.[f] ?? codigoAsistenciaSugerido(f, tieneVisita, feriadosAdicionales);
        }
      }
      // El encabezado "Del ... al ..." refleja solo el tramo de días ya aprobados (puede ser más
      // corto que la semana completa si todavía falta aprobar alguno) — no la semana calendario
      // fija que identifica al informe en la base.
      const blob = await generarInformeSemanal({
        antecedentes: informe.antecedentes,
        conclusiones: informe.conclusiones,
        recomendaciones: informe.recomendaciones,
        firmaFecha: informe.firma_fecha,
        firmaNombre: informe.firma_nombre,
        firmaCargo: informe.firma_cargo,
        numeroInforme: numero,
        semanaDesde: diasAprobados[0],
        semanaHasta: diasAprobados[diasAprobados.length - 1],
        dias: diasPdf,
        operadores: operadoresDelDia,
        asistencia: asistenciaParaPdf,
        diasTabla,
      });
      // "Informe semanal No <número> del 24 al 26 de julio 2026 20260825_154411.pdf" — número tal
      // cual lo escribió la analista (puede no ser solo dígitos, ej. "MEMORANDO 258-458"), período
      // real (solo días aprobados) y marca de tiempo de cuándo se generó, para poder distinguir
      // reintentos del mismo informe sin pisar el archivo anterior en Descargas.
      const pad2 = (n: number) => String(n).padStart(2, '0');
      const ahora = new Date();
      const marcaTiempo =
        `${ahora.getFullYear()}${pad2(ahora.getMonth() + 1)}${pad2(ahora.getDate())}_` +
        `${pad2(ahora.getHours())}${pad2(ahora.getMinutes())}${pad2(ahora.getSeconds())}`;
      const numeroArchivo = numero.replace(/[\\/:*?"<>|]/g, '-');
      const periodoArchivo = formatRangoParaArchivo(diasAprobados[0], diasAprobados[diasAprobados.length - 1]);
      const nombre = `Informe semanal No ${numeroArchivo} del ${periodoArchivo} ${marcaTiempo}.pdf`;
      setUltimoPdf(blob);
      setUltimoNombre(nombre);
      // Se abre para que la analista vea de una que sí se generó — para guardarlo, usa el botón
      // "⬇️ Descargar" de abajo (esta pestaña muestra el PDF con su id interno de blob en la
      // dirección, no con el nombre real; si se guarda desde acá sale con ese nombre feo).
      abrirBlob(blob);
      await supabase
        .from('informes_semanales')
        .update({ numero_informe: numero, generado_en: new Date().toISOString() })
        .eq('id', informe.id);
      setInforme({ ...informe, numero_informe: numero, generado_en: new Date().toISOString() });
      setMensajeGenerar('✅ Informe generado y abierto en una pestaña nueva. Para guardarlo con su nombre, usa "Descargar" o "Compartir" acá abajo.');
    } catch (err: any) {
      setMensajeGenerar(`Error al generar el informe: ${err.message ?? err}`);
    } finally {
      setGenerando(false);
    }
  }

  async function sugerirNumeroInforme(): Promise<string> {
    const { count } = await supabase
      .from('informes_semanales')
      .select('id', { count: 'exact', head: true })
      .not('numero_informe', 'is', null);
    return String((count ?? 0) + 1).padStart(3, '0');
  }

  async function compartirPdf() {
    if (!ultimoPdf) {
      setMensajeGenerar('Primero genera el informe en PDF.');
      return;
    }
    setEnviando(true);
    setMensajeGenerar(null);
    try {
      const archivo = new File([ultimoPdf], ultimoNombre, { type: 'application/pdf' });
      if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
        await navigator.share({ files: [archivo], title: 'Informe Semanal EBAR', text: ultimoNombre });
        setMensajeGenerar('✅ Informe compartido.');
      } else {
        descargarBlob(ultimoPdf, ultimoNombre);
        setMensajeGenerar('Tu navegador no soporta compartir directo con archivo — el PDF se descargó, compártelo manualmente.');
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') setMensajeGenerar(`No se pudo compartir: ${err.message ?? err}`);
    } finally {
      setEnviando(false);
    }
  }

  if (cargando || !informe) return <p className="text-slate-600">Cargando…</p>;

  return (
    <div className="space-y-4">
      <Link to="/reportes" className="text-sm text-slate-600 hover:text-slate-900">
        ← Reportes
      </Link>
      <h1 className="titulo-pantalla">Informe Semanal</h1>

      {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} sinBloques />}

      {/* Candado de semana */}
      <div className="tarjeta p-4">
        {semanaBloqueada && !cambiandoSemana ? (
          <div className="flex items-center justify-between flex-wrap gap-2">
            <span className="text-sm font-semibold text-slate-800">
              🔒 Semana del {formatRangoSemana(dias[0], dias[4])}
            </span>
            <button
              type="button"
              onClick={() => setCambiandoSemana(true)}
              className="text-sm text-slate-600 hover:text-slate-900 underline"
            >
              Cambiar de semana →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <label className="etiqueta">Semana (elige cualquier día — se ajusta al lunes)</label>
            <input
              type="date"
              className="campo max-w-[220px]"
              value={semanaDesde}
              onChange={(e) => {
                setSemanaDesde(lunesDeSemana(e.target.value));
                setCambiandoSemana(false);
              }}
            />
            <p className="text-xs text-slate-500">
              {semanaBloqueada
                ? 'Vas a otra semana sin perder nada de esta — cada semana se guarda por separado.'
                : 'La semana queda fija apenas apruebes el primer día, para que ningún día ya aprobado se desarme por un cambio de fecha a mitad de semana.'}
            </p>
            {semanaBloqueada && (
              <button
                type="button"
                onClick={() => setCambiandoSemana(false)}
                className="text-xs text-slate-500 hover:text-slate-900 underline"
              >
                Cancelar
              </button>
            )}
          </div>
        )}
        <button type="button" onClick={rehacerBorrador} className="boton-secundario w-full mt-3">
          🔄 Rehacer borrador desde las visitas
        </button>
      </div>

      {mensaje && <p className="text-sm text-slate-700 bg-panel-700 rounded-lg px-3 py-2">{mensaje}</p>}

      {/* Antecedentes */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Antecedentes</h2>
      <div className="tarjeta p-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="etiqueta mb-0">Antecedentes</label>
          <span className="text-[10px] text-slate-500 bg-panel-700 px-2 py-1 rounded-full">📌 Plantilla fija, editable</span>
        </div>
        <textarea
          className="campo"
          rows={4}
          value={informe.antecedentes}
          onChange={(e) => setInforme({ ...informe, antecedentes: e.target.value })}
          onBlur={(e) => guardarCampoInforme('antecedentes', e.target.value)}
        />
      </div>

      {/* Desarrollo de la semana */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Desarrollo de la semana</h2>
      <p className="text-xs text-slate-500 -mt-2">
        Incluye a todos los operadores que registraron al menos una visita esta semana — nadie queda afuera ni hay
        que armar la lista a mano.
      </p>
      <div className="space-y-3">
        {dias.map((fecha) => (
          <div id={`dia-${fecha}`} key={fecha}>
            <DiaCard
              fecha={fecha}
              fila={diasDB[fecha]}
              visitasDia={visitasDelDia(fecha)}
              feriadosAdicionales={feriadosAdicionales}
              bloques={bloquesDeHoy(fecha)}
              estaForzado={forzarEdicion.has(fecha)}
              onCambiarBloques={(nuevos) => actualizarBloques(fecha, nuevos)}
              onAprobar={() => aprobarDia(fecha)}
              onActualizarConCambio={() => actualizarDiaConCambio(fecha)}
              onMantener={() => mantenerDiaComoEsta(fecha)}
              onEditar={() => editarDiaAprobado(fecha)}
              onCancelarEdicion={() => cancelarEdicionAprobado(fecha)}
            />
          </div>
        ))}
      </div>

      {/* Control semanal del personal */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Control semanal del personal</h2>
      <p className="text-xs text-slate-500 -mt-2">
        Las filas salen solas de los operadores activos: si se da de baja a alguien o se agrega uno nuevo, la
        próxima semana la tabla ya viene así, sin tocar nada a mano.
      </p>
      <div className="tarjeta p-4 overflow-x-auto">
        {operadoresDelDia.length === 0 ? (
          <p className="text-sm text-slate-500">Todavía no hay ninguna visita registrada esta semana.</p>
        ) : (
          <>
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="pb-2 pr-2">Operador</th>
                  {[...dias, ...finde].map((f) => {
                    const { dia, abrev } = formatFechaCortaTabla(f);
                    const esFinde = finde.includes(f);
                    return (
                      <th
                        key={f}
                        className={`pb-2 px-1 text-center font-normal ${esFinde ? 'text-slate-400' : ''}`}
                      >
                        {dia}
                        <br />
                        {abrev}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {operadoresDelDia.map((op) => (
                  <tr key={op.id} className="border-t border-panel-600">
                    <td className="py-1.5 pr-2 whitespace-nowrap">{op.nombre_completo}</td>
                    {[...dias, ...finde].map((f) => {
                      const tieneVisita = visitasSemana.some(
                        (v) => v.operador_id === op.id && fechaLocalDe(v.fecha_hora_llegada) === f,
                      );
                      const valor =
                        informe.asistencia[op.id]?.[f] ?? codigoAsistenciaSugerido(f, tieneVisita, feriadosAdicionales);
                      return (
                        <td key={f} className="py-1 px-1 text-center">
                          <select
                            className="text-xs border border-panel-600 rounded px-1 py-1 bg-panel-900 w-14"
                            value={valor}
                            onChange={(e) => guardarAsistencia(op.id, f, e.target.value)}
                          >
                            <option value="">—</option>
                            {CODIGOS_ASISTENCIA.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
              Se pre-llena solo: <b>T</b> únicamente si ese operador tiene al menos una visita registrada ese día,{' '}
              <b>F</b> en feriado, "-" en fin de semana. Sin visita y sin ser feriado/fin de semana, la celda queda
              vacía para completarla a mano.
              <br />
              {LEYENDA_CODIGOS_ASISTENCIA}
            </p>
          </>
        )}
      </div>

      {/* Conclusiones y recomendaciones */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Conclusiones y recomendaciones</h2>
      <div className="tarjeta p-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="etiqueta mb-0">Conclusiones</label>
          <span className="text-[10px] text-slate-500 bg-panel-700 px-2 py-1 rounded-full">↺ Copiado de la semana pasada</span>
        </div>
        <textarea
          className="campo"
          rows={3}
          value={informe.conclusiones}
          onChange={(e) => setInforme({ ...informe, conclusiones: e.target.value })}
          onBlur={(e) => guardarCampoInforme('conclusiones', e.target.value)}
        />
      </div>
      <div className="tarjeta p-4 space-y-2">
        <div className="flex items-center justify-between">
          <label className="etiqueta mb-0">Recomendaciones</label>
          <span className="text-[10px] text-slate-500 bg-panel-700 px-2 py-1 rounded-full">↺ Copiado de la semana pasada</span>
        </div>
        <textarea
          className="campo"
          rows={3}
          value={informe.recomendaciones}
          onChange={(e) => setInforme({ ...informe, recomendaciones: e.target.value })}
          onBlur={(e) => guardarCampoInforme('recomendaciones', e.target.value)}
        />
      </div>

      {/* Firma */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Firma</h2>
      <div className="tarjeta p-4 grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Fecha de emisión</label>
          <input
            type="date"
            className="campo"
            value={informe.firma_fecha ?? ''}
            onChange={(e) => setInforme({ ...informe, firma_fecha: e.target.value })}
            onBlur={(e) => guardarCampoInforme('firma_fecha', e.target.value)}
          />
        </div>
        <div>
          <label className="etiqueta">Nombre</label>
          <input
            type="text"
            className="campo"
            value={informe.firma_nombre}
            onChange={(e) => setInforme({ ...informe, firma_nombre: e.target.value })}
            onBlur={(e) => guardarCampoInforme('firma_nombre', e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <label className="etiqueta">Cargo</label>
          <input
            type="text"
            className="campo"
            value={informe.firma_cargo}
            onChange={(e) => setInforme({ ...informe, firma_cargo: e.target.value })}
            onBlur={(e) => guardarCampoInforme('firma_cargo', e.target.value)}
          />
        </div>
      </div>

      {/* Consolidar y generar */}
      <h2 className="text-xs font-bold uppercase tracking-wide text-slate-700 mt-6">Consolidar y generar</h2>
      <div className="tarjeta p-4 space-y-4">
        {diasConCambioPendiente.length > 0 && (
          <div className="rounded-lg border border-gauge-warn/30 bg-gauge-warn/10 p-3 text-sm text-gauge-warn">
            <p className="font-semibold">⚠️ Hay días con cambios sin resolver</p>
            <p className="text-xs text-slate-600 mt-1">
              Resuelve el aviso "⚠️ Cambió algo" en cada día marcado antes de generar el informe.
            </p>
          </div>
        )}
        {diasConCambioPendiente.length === 0 && diasAprobados.length === 0 && (
          <div className="rounded-lg border border-gauge-warn/30 bg-gauge-warn/10 p-3 text-sm text-gauge-warn">
            <p className="font-semibold">⚠️ Todavía no hay ningún día aprobado</p>
            <p className="text-xs text-slate-600 mt-1">Aprueba al menos un día para poder generar el informe.</p>
          </div>
        )}
        {puedeGenerar && diasPorAprobar.length > 0 && (
          <div className="rounded-lg border border-panel-600 bg-panel-700 p-3 text-sm text-slate-600">
            ℹ️ Todavía falta{diasPorAprobar.length === 1 ? '' : 'n'} {diasPorAprobar.length} día
            {diasPorAprobar.length === 1 ? '' : 's'} por aprobar. El informe se genera solo con los{' '}
            {diasAprobados.length} día{diasAprobados.length === 1 ? '' : 's'} ya aprobado
            {diasAprobados.length === 1 ? '' : 's'} — puedes volver a generarlo más tarde cuando apruebes el resto.
          </div>
        )}
        <div className="max-w-[220px]">
          <label className="etiqueta">N.º de informe</label>
          <input
            type="text"
            className="campo font-mono"
            placeholder="autosugerido"
            value={informe.numero_informe ?? ''}
            onChange={(e) => setInforme({ ...informe, numero_informe: e.target.value })}
            onBlur={(e) => guardarCampoInforme('numero_informe', e.target.value)}
          />
        </div>
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-xs text-slate-500 max-w-[380px]">
            Genera el PDF con el membrete institucional de siempre. Después usa los botones de abajo para
            descargarlo o compartirlo.
          </p>
          <button type="button" disabled={!puedeGenerar || generando} onClick={manejarClickGenerar} className="boton-primario">
            {generando ? 'Generando…' : '📄 Generar informe final (PDF)'}
          </button>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={!ultimoPdf}
            onClick={() => {
              descargarBlob(ultimoPdf!, ultimoNombre);
              setMensajeGenerar('⬇️ Descargado a tu carpeta de Descargas.');
            }}
            className="boton-secundario flex-1"
          >
            ⬇️ Descargar
          </button>
          <button
            type="button"
            disabled={!ultimoPdf || enviando}
            onClick={compartirPdf}
            className="boton-secundario flex-1"
          >
            {enviando ? 'Compartiendo…' : '📤 Compartir'}
          </button>
        </div>
        {mensajeGenerar && (
          <p className="text-sm text-slate-700 bg-panel-700 rounded-lg px-3 py-2">{mensajeGenerar}</p>
        )}
      </div>

      {avisoDiasSinAprobar && (
        <>
          <div className="fixed inset-0 bg-black/50 z-20" onClick={() => setAvisoDiasSinAprobar(null)} />
          <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 bg-panel-800 border border-panel-600/60 rounded-xl shadow-xl w-[90vw] max-w-md p-4 space-y-3">
            <h2 className="font-semibold text-sm text-gauge-warn">⚠️ Hay días con actividad sin aprobar</h2>
            <p className="text-xs text-slate-600">
              Estos días tienen visitas registradas por los operadores pero todavía no están aprobados — si generas
              ahora, van a quedar fuera del informe:
            </p>
            <ul className="text-xs text-slate-700 list-disc list-inside space-y-0.5">
              {avisoDiasSinAprobar.map((f) => (
                <li key={f}>{formatFechaLarga(f)}</li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 pt-1">
              <button type="button" onClick={() => irAAprobar(avisoDiasSinAprobar)} className="boton-primario">
                Ir a aprobarlos
              </button>
              <button
                type="button"
                onClick={() => {
                  setAvisoDiasSinAprobar(null);
                  generarPdf();
                }}
                className="boton-secundario"
              >
                Generar de todas formas
              </button>
              <button type="button" onClick={() => setAvisoDiasSinAprobar(null)} className="text-xs text-slate-500 hover:text-slate-900 underline">
                Cancelar
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ----------------------------------------------------------------------------
// Tarjeta de un día
// ----------------------------------------------------------------------------

function resumenDia(bloques: BloqueInforme[]) {
  const estaciones = new Set(bloques.map((b) => b.estacion_id)).size;
  const responsables = new Set(bloques.map((b) => b.operador_id)).size;
  return { estaciones, responsables };
}

function DiaCard({
  fecha,
  fila,
  visitasDia,
  feriadosAdicionales,
  bloques,
  estaForzado,
  onCambiarBloques,
  onAprobar,
  onActualizarConCambio,
  onMantener,
  onEditar,
  onCancelarEdicion,
}: {
  fecha: string;
  fila: DiaRow | undefined;
  visitasDia: VisitaCruda[];
  feriadosAdicionales: Set<string>;
  bloques: BloqueInforme[];
  estaForzado: boolean;
  onCambiarBloques: (nuevos: BloqueInforme[]) => void;
  onAprobar: () => void;
  onActualizarConCambio: () => void;
  onMantener: () => void;
  onEditar: () => void;
  onCancelarEdicion: () => void;
}) {
  const esFeriado = esDiaNoRegular(fecha, feriadosAdicionales);
  const nombreFeriado = nombreFeriadoCalculado(fecha);

  if (esFeriado && visitasDia.length === 0) {
    return (
      <div className="tarjeta p-3 flex items-center justify-between text-sm">
        <span className="text-slate-700">{formatFechaLarga(fecha)}</span>
        <span className="text-xs text-slate-500">Feriado{nombreFeriado ? ` (${nombreFeriado})` : ''} — sin actividad registrada</span>
      </div>
    );
  }

  const cambio: CambioDetectado | null = fila?.aprobado ? detectarCambioDia(fila.snapshot_visitas, visitasDia) : null;

  if (fila?.aprobado && !cambio && !estaForzado) {
    const { estaciones, responsables } = resumenDia(fila.contenido);
    return (
      <details className="tarjeta p-4">
        <summary className="cursor-pointer flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-slate-800">{formatFechaLarga(fecha)}</h3>
          <span className="flex items-center gap-2 text-xs text-slate-500">
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gauge-ok/15 text-gauge-ok">✓ Aprobado</span>
            {estaciones} estación{estaciones === 1 ? '' : 'es'} · {responsables} responsable
            {responsables === 1 ? '' : 's'}
          </span>
        </summary>
        <p className="text-xs text-slate-500 mt-3">
          Aprobado el {fila.aprobado_en ? new Date(fila.aprobado_en).toLocaleDateString('es-EC') : ''}, sin cambios en
          las visitas desde entonces. {estaciones} estación{estaciones === 1 ? '' : 'es'} con actividad ese día.
        </p>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onEditar} className="boton-secundario text-xs py-1.5 px-3">
            ✏️ Editar este día
          </button>
        </div>
      </details>
    );
  }

  if (fila?.aprobado && cambio) {
    return (
      <details className="tarjeta p-4" open>
        <summary className="cursor-pointer flex items-center justify-between gap-2 flex-wrap">
          <h3 className="font-semibold text-slate-800">{formatFechaLarga(fecha)}</h3>
          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-gauge-warn/15 text-gauge-warn">⚠️ Cambió algo</span>
        </summary>
        <div className="mt-3 rounded-lg border border-gauge-warn/30 bg-gauge-warn/10 p-3 space-y-3">
          <p className="text-sm font-semibold text-gauge-warn">
            ⚠️ Los reportes de los operadores cambiaron desde que aprobaste este día
            {fila.aprobado_en ? ` (${new Date(fila.aprobado_en).toLocaleDateString('es-EC')})` : ''}
          </p>
          <div className="rounded-lg bg-panel-900 border border-panel-600 p-3 text-xs space-y-1.5">
            <p className="text-slate-500">
              {cambio.quien}
              {cambio.cuando ? ` actualizó su visita hoy a las ${cambio.cuando}` : ''}
            </p>
            <p className="text-slate-500 line-through">{cambio.textoAntes}</p>
            <p className="text-slate-800">{cambio.textoAhora}</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={onActualizarConCambio} className="boton-primario text-sm py-2 px-3">
              ✅ Actualizar este día con el cambio
            </button>
            <button type="button" onClick={onMantener} className="boton-secundario text-sm py-2 px-3">
              Mantener como está
            </button>
          </div>
        </div>
      </details>
    );
  }

  // Sin aprobar (borrador editable), o edición forzada de un día ya aprobado sin cambios.
  const { estaciones, responsables } = resumenDia(bloques);
  return (
    <div className="tarjeta p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="font-semibold text-slate-800">{formatFechaLarga(fecha)}</h3>
        <span className="flex items-center gap-2 text-xs text-slate-500">
          <span
            className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
              estaForzado ? 'bg-gauge-ok/15 text-gauge-ok' : 'bg-panel-700 text-slate-600'
            }`}
          >
            {estaForzado ? '✓ Aprobado — editando' : '✏️ Sin aprobar'}
          </span>
          {bloques.length > 0
            ? `${estaciones} estación${estaciones === 1 ? '' : 'es'} · ${responsables} responsable${responsables === 1 ? '' : 's'}`
            : 'Sin visitas registradas'}
        </span>
      </div>

      {bloques.length === 0 ? (
        <p className="text-sm text-slate-500">Ningún operador registró visitas este día.</p>
      ) : (
        <div className="space-y-4">
          {bloques.map((b, i) => (
            <BloqueEditor
              key={`${b.estacion_id}-${b.operador_id}`}
              bloque={b}
              fotosDisponibles={visitasDia
                .filter((v) => v.estacion_id === b.estacion_id && v.operador_id === b.operador_id)
                .flatMap((v) => v.fotos)}
              onCambiar={(nuevo) => {
                const copia = [...bloques];
                copia[i] = nuevo;
                onCambiarBloques(copia);
              }}
            />
          ))}
        </div>
      )}

      <div className="border-t border-dashed border-panel-600 pt-3 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-xs text-slate-500 max-w-[380px]">
          {estaForzado
            ? 'Guarda para actualizar el día ya aprobado con estos cambios.'
            : 'Al aprobar, este día queda guardado tal cual. Si después cambia algo en las visitas de los operadores, va a avisar antes de tocarlo.'}
        </p>
        <div className="flex items-center gap-2">
          {estaForzado && (
            <button type="button" onClick={onCancelarEdicion} className="boton-secundario text-sm py-2 px-4">
              Cancelar
            </button>
          )}
          <button type="button" onClick={onAprobar} className="boton-primario text-sm py-2 px-4">
            {estaForzado ? '💾 Guardar cambios' : '✓ Aprobar y guardar este día'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BloqueEditor({
  bloque,
  fotosDisponibles,
  onCambiar,
}: {
  bloque: BloqueInforme;
  fotosDisponibles: { id: string; url: string; descripcion: string | null; tomada_en: string }[];
  onCambiar: (nuevo: BloqueInforme) => void;
}) {
  return (
    <div className="rounded-lg border border-panel-600 p-3 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap text-sm">
        <span className="font-medium text-slate-800">🏭 {bloque.estacion_nombre}</span>
        {(bloque.hora_inicio || bloque.hora_fin) && (
          <span className="text-xs text-slate-500">
            {bloque.hora_inicio ?? '—'} – {bloque.hora_fin ?? '—'}
          </span>
        )}
      </div>

      <div>
        <label className="etiqueta">Responsable</label>
        <input
          type="text"
          className="campo"
          value={bloque.responsable}
          onChange={(e) => onCambiar({ ...bloque, responsable: e.target.value })}
        />
      </div>

      <div>
        <label className="etiqueta">Actividad (viñetas editables, sacadas de las observaciones del operador)</label>
        <div className="space-y-2">
          {bloque.vinetas.map((v, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="mt-3 w-1.5 h-1.5 rounded-full bg-slate-500 shrink-0" />
              <textarea
                className="campo flex-1"
                rows={2}
                value={v}
                onChange={(e) => {
                  const nuevas = [...bloque.vinetas];
                  nuevas[i] = e.target.value;
                  onCambiar({ ...bloque, vinetas: nuevas });
                }}
              />
              <button
                type="button"
                onClick={() => onCambiar({ ...bloque, vinetas: bloque.vinetas.filter((_, j) => j !== i) })}
                className="text-slate-400 hover:text-gauge-danger text-sm mt-2"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => onCambiar({ ...bloque, vinetas: [...bloque.vinetas, ''] })}
          className="text-xs text-slate-600 hover:text-slate-900 underline mt-1"
        >
          + Agregar viñeta
        </button>
      </div>

      {fotosDisponibles.length > 0 && (
        <div>
          <label className="etiqueta">Fotos a incluir en el PDF</label>
          <div className="grid grid-cols-4 gap-2">
            {fotosDisponibles.map((f, i) => {
              const marcada = bloque.fotos_seleccionadas.includes(f.id);
              return (
                <label key={f.id} className="relative cursor-pointer">
                  <span className="absolute top-1.5 right-1.5 z-10 bg-white/90 rounded-md p-0.5 shadow leading-none">
                    <input
                      type="checkbox"
                      className="block w-5 h-5 accent-gauge-ok cursor-pointer"
                      checked={marcada}
                      onChange={(e) => {
                        const seleccionadas = e.target.checked
                          ? [...bloque.fotos_seleccionadas, f.id]
                          : bloque.fotos_seleccionadas.filter((id) => id !== f.id);
                        onCambiar({ ...bloque, fotos_seleccionadas: seleccionadas });
                      }}
                    />
                  </span>
                  <img
                    src={f.url}
                    className={`w-full aspect-square object-cover rounded-md ${marcada ? '' : 'opacity-40'}`}
                    alt=""
                  />
                  <span className="block text-[10px] text-slate-500 mt-0.5">Foto {i + 1}</span>
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
