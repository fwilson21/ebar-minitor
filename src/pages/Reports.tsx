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
      .then(({ data }) => {
        const lista = (data as EstacionEbar[]) ?? [];
        setEstaciones(lista);
        setEstacionId((actual) => actual || lista[0]?.id || '');
      });
  }, []);

  const operadorNombre =
    operadores.find((o) => o.id === operadorId)?.nombre_completo ?? usuario?.nombre_completo ?? '';
  const estacionNombre = estaciones.find((e) => e.id === estacionId);

  const esRango = tipo === 'consolidado_fecha' || tipo === 'individual_estacion';
  const fechaInicioEfectiva = fechaInicio;
  const fechaFinEfectiva = esRango ? fechaFin : fechaInicio;
  const rangoLabel =
    fechaInicioEfectiva === fechaFinEfectiva
      ? fechaInicioEfectiva
      : `${fechaInicioEfectiva} al ${fechaFinEfectiva}`;

  async function obtenerVisitas(): Promise<VisitaParaReporte[]> {
    let query = supabase
      .from('visitas')
      .select(SELECT_VISITA_REPORTE)
      .gte('fecha_hora_llegada', `${fechaInicioEfectiva}T00:00:00`)
      .lte('fecha_hora_llegada', `${fechaFinEfectiva}T23:59:59`);

    if (tipo === 'diario_operador') {
      query = query.eq('operador_id', esAdmin ? operadorId : (usuario?.id ?? ''));
    }
    if (tipo === 'consolidado_fecha' && esAdmin && operadorId) {
      query = query.eq('operador_id', operadorId);
    }
    if (tipo === 'individual_estacion') {
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

      const titulo =
        tipo === 'diario_operador'
          ? `Reporte diario — ${operadorNombre}`
          : tipo === 'consolidado_fecha'
          ? `Reporte consolidado${esAdmin && operadorId ? ` — ${operadorNombre}` : ''}`
          : `Reporte de estación — ${estacionNombre ? `${estacionNombre.codigo} ${estacionNombre.nombre}` : ''}`;

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

  async function manejarEnviarWhatsApp(destino: 'grupo' | 'supervisores') {
    if (!ultimoPdf) {
      setMensaje('Primero genera el reporte en PDF.');
      return;
    }
    setEnviando(true);
    setMensaje(null);
    try {
      const base64 = await blobToBase64(ultimoPdf);
      const { error } = await supabase.functions.invoke('send-whatsapp', {
        body: {
          destino,
          nombre_archivo: ultimoNombre,
          pdf_base64: base64,
          mensaje: `Reporte EBAR — ${rangoLabel}`,
        },
      });
      if (error) throw error;
      setMensaje('Reporte enviado por WhatsApp.');
    } catch (err: any) {
      setMensaje(`No se pudo enviar por WhatsApp: ${err.message ?? err}`);
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
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoReporte)}>
            <option value="consolidado_fecha">Consolidado por fecha (todas las EBAR)</option>
            <option value="diario_operador">Diario por operador</option>
            <option value="individual_estacion">Individual por estación</option>
          </select>
        </div>

        {(tipo === 'diario_operador' || tipo === 'consolidado_fecha') && esAdmin && operadores.length > 0 && (
          <div>
            <label className="etiqueta">Operador</label>
            <select
              className="campo"
              value={operadorId}
              onChange={(e) => setOperadorId(e.target.value)}
            >
              {tipo === 'consolidado_fecha' && <option value="">Todos los operadores</option>}
              {operadores.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.nombre_completo}
                </option>
              ))}
            </select>
          </div>
        )}

        {tipo === 'individual_estacion' && estaciones.length > 0 && (
          <div>
            <label className="etiqueta">Estación</label>
            <select className="campo" value={estacionId} onChange={(e) => setEstacionId(e.target.value)}>
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
        <p className="etiqueta mb-1">Enviar por WhatsApp</p>
        <button
          onClick={() => manejarEnviarWhatsApp('grupo')}
          disabled={enviando || !ultimoPdf}
          className="boton-secundario w-full"
        >
          Enviar al grupo de WhatsApp
        </button>
        <button
          onClick={() => manejarEnviarWhatsApp('supervisores')}
          disabled={enviando || !ultimoPdf}
          className="boton-secundario w-full"
        >
          Enviar a supervisores individuales
        </button>
        <p className="text-xs text-slate-500">
          El envío requiere que la Edge Function <code>send-whatsapp</code> esté configurada con las credenciales de la
          WhatsApp Cloud API (ver README).
        </p>
      </div>

      {mensaje && <p className="text-sm text-slate-300">{mensaje}</p>}
    </div>
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
