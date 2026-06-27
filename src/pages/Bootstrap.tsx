import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export function Bootstrap() {
  const navigate = useNavigate();
  const [cargando, setCargando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function crearDatosBase() {
    setCargando(true);
    setMensaje(null);

    try {
      const { data: estacion, error: errorEstacion } = await supabase
        .from('estaciones_ebar')
        .insert({
          codigo: 'EBAR-001',
          nombre: 'Estación El Pintado',
          zona: 'urbana',
          direccion: 'Av. Maldonado y Pintado',
          latitud: -0.287,
          longitud: -78.538,
          numero_bombas: 2,
          estado_actual: 'operativa',
          activa: true,
        })
        .select('*')
        .single();

      if (errorEstacion) throw errorEstacion;

      const bombas = [
        { estacion_id: estacion.id, numero_bomba: 1, voltaje_nominal: 220, amperaje_nominal: 15, activa: true },
        { estacion_id: estacion.id, numero_bomba: 2, voltaje_nominal: 220, amperaje_nominal: 15, activa: true },
      ];

      const { error: errorBombas } = await supabase.from('bombas').insert(bombas);
      if (errorBombas) throw errorBombas;

      setMensaje('Datos base creados correctamente.');
      setTimeout(() => navigate('/estaciones'), 900);
    } catch (err: any) {
      setMensaje(`No se pudieron crear los datos base: ${err.message ?? err}`);
    } finally {
      setCargando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="tarjeta w-full max-w-md p-6 space-y-4">
        <h1 className="text-xl font-bold">Inicialización rápida</h1>
        <p className="text-sm text-slate-400">
          Crea una estación de ejemplo y sus bombas para probar el flujo completo con Supabase real.
        </p>

        <button onClick={crearDatosBase} disabled={cargando} className="boton-primario w-full">
          {cargando ? 'Creando…' : 'Crear datos base'}
        </button>

        {mensaje && <p className="text-sm text-slate-300">{mensaje}</p>}
      </div>
    </div>
  );
}
