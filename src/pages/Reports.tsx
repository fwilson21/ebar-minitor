import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { abrirBlob, descargarBlob, generarReporteVisitas, type VisitaParaReporte } from '../lib/pdf';
import { incrustarFotosVisitas } from '../lib/fotos';
import { SELECT_VISITA_REPORTE, mapearVisitaFila } from '../lib/visitasReporte';
import type { EstacionEbar, Usuario } from '../lib/types';

type TipoReporte = 'diario_operador' | 'consolidado_fecha' | 'individual_estacion';

export function Reports() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador' || usuario?.rol === 'supervisor';

  const [tipo, setTipo] = useState<TipoReporte>('consolidado_fecha');
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().slice(0, 10));
  const [fechaFin, setFechaFin] = useState(new Date().toISOString().slice(0, 10));
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
    supabase
      .from('usuarios')
      .select('id, nombre_completo, rol, activo, firma_url')
      .eq('activo', true)
      .order('nombre_completo')
      .then(({ data }) => setOperadores((data as Usuario[]) ?? []));
  }, [esAdmin]);

  useEffect(() => {
    supabase
      .from('estaciones_ebar')
      .select('id, codigo, nombre, zona')
      .order('codigo')
      .then(({ data }) => setEstaciones((data as EstacionEbar[]) ?? []));
  }, []);

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

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold">Reportes</h1>

      <div className="tarjeta p-4 space-y-3">
        <div>
          <label className="etiqueta">Tipo de reporte</label>
          <select
            className="campo"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as TipoReporte);
              setEstacionId('');
              setOperadorId(e.target.value === 'diario_operador' ? (usuario?.id ?? '') : '');
            }}
          >
            <option value="consolidado_fecha">Consolidado por fecha</option>
            <option value="diario_operador">Diario por operador</option>
            <option value="individual_estacion">Individual por estación</option>
          </select>
        </div>

        {esAdmin && operadores.length > 0 && (
          <div>
            <label className="etiqueta">Operador</label>
            <select
              className="campo"
              value={operadorId}
              onChange={(e) => setOperadorId(e.target.value)}
            >
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
              {estaciones.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} — {e.nombre}
                </option>
              ))}
            </select>
          </div>
        )}

        {esRango ? (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="etiqueta">Fecha inicio</label>
              <input
                type="date"
                className="campo"
                value={fechaInicio}
                max={fechaFin}
                onChange={(e) => setFechaInicio(e.target.value)}
              />
            </div>
            <div>
              <label className="etiqueta">Fecha fin</label>
              <input
                type="date"
                className="campo"
                value={fechaFin}
                min={fechaInicio}
                onChange={(e) => setFechaFin(e.target.value)}
              />
            </div>
          </div>
        ) : (
          <div>
            <label className="etiqueta">Fecha</label>
            <input
              type="date"
              className="campo"
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
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

      <div className="tarjeta p-4 space-y-2">
        <p className="etiqueta mb-1">Compartir</p>
        <button
          onClick={manejarCompartir}
          disabled={enviando || !ultimoPdf}
          className="boton-secundario w-full"
        >
          📤 Descargar y compartir
        </button>
        <p className="text-xs text-slate-500">
          El PDF ya se descarga al generarlo. Este botón abre el menú para reenviarlo por WhatsApp, correo u otra app.
        </p>
      </div>

      {mensaje && <p className="text-sm text-slate-700">{mensaje}</p>}
    </div>
  );
}

function formatFechaCorta(fechaISO: string): string {
  const [anio, mes, dia] = fechaISO.split('-');
  return `${dia}-${mes}-${anio}`;
}
