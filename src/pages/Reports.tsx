import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { descargarBlob, generarReporteVisitas, type VisitaParaReporte } from '../lib/pdf';

const EMPRESA = {
  nombre: 'Tu Empresa de Agua y Saneamiento',
  direccion: 'Quito, Ecuador',
  telefono: '+593 99 999 9999',
};

type TipoReporte = 'diario_operador' | 'consolidado_fecha' | 'individual_estacion';

export function Reports() {
  const { usuario } = useAuth();
  const [tipo, setTipo] = useState<TipoReporte>('consolidado_fecha');
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [generando, setGenerando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [ultimoPdf, setUltimoPdf] = useState<Blob | null>(null);
  const [ultimoNombre, setUltimoNombre] = useState('');

  async function obtenerVisitas(): Promise<VisitaParaReporte[]> {
    let query = supabase
      .from('visitas')
      .select(
        `id, fecha_hora_llegada, fecha_hora_salida, estado_estacion, nivel_tanque,
         olores_anormales, olores_descripcion, ruidos_extranos, ruidos_descripcion,
         cerramiento_ok, observaciones_generales,
         estaciones_ebar ( nombre, codigo, zona ),
         usuarios ( nombre_completo, firma_url ),
         registros_bombas ( numero_bomba, estado, voltaje, amperaje, horas_operacion_acumuladas, observaciones, voltaje_fuera_rango ),
         fotos ( url_publica )`
      )
      .gte('fecha_hora_llegada', `${fecha}T00:00:00`)
      .lte('fecha_hora_llegada', `${fecha}T23:59:59`);

    if (tipo === 'diario_operador' && usuario) {
      query = query.eq('operador_id', usuario.id);
    }

    const { data, error } = await query;
    if (error) throw error;

    return (data ?? []).map((v: any) => ({
      estacion_nombre: v.estaciones_ebar?.nombre ?? '-',
      estacion_codigo: v.estaciones_ebar?.codigo ?? '-',
      zona: v.estaciones_ebar?.zona ?? '-',
      fecha_hora_llegada: v.fecha_hora_llegada,
      fecha_hora_salida: v.fecha_hora_salida,
      operador_nombre: v.usuarios?.nombre_completo ?? '-',
      firma_url: v.usuarios?.firma_url ?? null,
      estado_estacion: v.estado_estacion,
      nivel_tanque: v.nivel_tanque,
      olores_anormales: v.olores_anormales,
      olores_descripcion: v.olores_descripcion,
      ruidos_extranos: v.ruidos_extranos,
      ruidos_descripcion: v.ruidos_descripcion,
      cerramiento_ok: v.cerramiento_ok,
      observaciones_generales: v.observaciones_generales,
      bombas: v.registros_bombas ?? [],
      fotos_urls: (v.fotos ?? []).map((f: any) => f.url_publica).filter(Boolean),
    }));
  }

  async function manejarGenerar() {
    setGenerando(true);
    setMensaje(null);
    try {
      const visitas = await obtenerVisitas();
      if (visitas.length === 0) {
        setMensaje('No hay visitas registradas para los filtros seleccionados.');
        return;
      }
      const titulo =
        tipo === 'diario_operador'
          ? `Reporte diario — ${usuario?.nombre_completo}`
          : tipo === 'consolidado_fecha'
          ? 'Reporte consolidado'
          : 'Reporte de estación';

      const blob = await generarReporteVisitas(EMPRESA, `${titulo}\n${fecha}`, visitas);
      const nombre = `reporte_${tipo}_${fecha}.pdf`;
      setUltimoPdf(blob);
      setUltimoNombre(nombre);
      descargarBlob(blob, nombre);

      // Registrar el reporte en la base de datos para trazabilidad.
      await supabase.from('reportes').insert({
        tipo,
        generado_por: usuario?.id,
        fecha_referencia: fecha,
        operador_id: tipo === 'diario_operador' ? usuario?.id : null,
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
          destino, // 'grupo' usa el grupo por defecto; 'supervisores' busca números en `usuarios`
          nombre_archivo: ultimoNombre,
          pdf_base64: base64,
          mensaje: `Reporte EBAR — ${fecha}`,
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
            <option value="diario_operador">Diario por operador (mis visitas)</option>
            <option value="individual_estacion">Individual por estación</option>
          </select>
        </div>
        <div>
          <label className="etiqueta">Fecha</label>
          <input type="date" className="campo" value={fecha} onChange={(e) => setFecha(e.target.value)} />
        </div>
        <button onClick={manejarGenerar} disabled={generando} className="boton-primario w-full">
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
