import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { guardarLayout, type BloqueLayout } from '../lib/layoutsAdmin';
import { GridEditable } from '../components/GridEditable';

export function DistribucionEntorno() {
  const { usuario } = useAuth();
  const [pantallaId, setPantallaId] = useState(PANTALLAS_EDITABLES[0]?.id ?? '');
  const [resetSignal, setResetSignal] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  if (!usuario) return null;
  if (usuario.rol !== 'administrador') return <Navigate to="/" replace />;

  const pantalla = PANTALLAS_EDITABLES.find((p) => p.id === pantallaId);

  async function manejarGuardar(layout: BloqueLayout[]) {
    setGuardando(true);
    setMensaje(null);
    try {
      await guardarLayout(pantallaId, layout);
      setMensaje('Distribución guardada. Se aplica a todos los usuarios en escritorio.');
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold">Distribución de entorno de trabajo</h1>
        <p className="text-sm text-slate-600">
          Arrastra y redimensiona los bloques de cada pantalla para escritorio. Lo que guardes acá se aplica para
          todos los usuarios, solo en escritorio — en celular las pantallas no cambian.
        </p>
      </div>

      <div className="tarjeta p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="etiqueta">Pantalla</label>
            <select
              className="campo"
              value={pantallaId}
              onChange={(e) => {
                setPantallaId(e.target.value);
                setMensaje(null);
              }}
            >
              {PANTALLAS_EDITABLES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() => {
              setResetSignal((n) => n + 1);
              setMensaje(null);
            }}
            className="boton-secundario"
          >
            Restablecer por defecto
          </button>
        </div>

        {mensaje && (
          <p className={`text-sm ${mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>{mensaje}</p>
        )}

        {pantalla && (
          <GridEditable
            key={pantalla.id}
            pantallaId={pantalla.id}
            bloques={pantalla.bloques}
            modoEdicion
            resetSignal={resetSignal}
            onGuardar={manejarGuardar}
            renderBloque={(bloqueId) => {
              const bloque = pantalla.bloques.find((b) => b.id === bloqueId);
              return (
                <div className="tarjeta h-full flex items-center justify-center p-3 text-sm font-medium text-slate-700 text-center">
                  {bloque?.titulo}
                </div>
              );
            }}
          />
        )}
        {guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>
    </div>
  );
}
