import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { guardarLayout, type BloqueLayout } from '../lib/layoutsAdmin';
import { GridEditable } from '../components/GridEditable';
import { ANCHO_CONTENIDO_MAX, ANCHO_CONTENIDO_MIN, guardarAnchoContenido } from '../lib/anchoContenido';

export function DistribucionEntorno() {
  const { usuario, anchoContenido, setAnchoContenido } = useAuth();
  const [pantallaId, setPantallaId] = useState(PANTALLAS_EDITABLES[0]?.id ?? '');
  const [resetSignal, setResetSignal] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  // anchoContenido vive en AuthContext (no acá) para que arrastrar el control se vea reflejado
  // de inmediato en toda la app (esta misma pantalla incluida), no solo en el número — moverlo
  // NO guarda nada todavía, eso lo hace manejarGuardarAncho() al tocar el botón. anchoAlEntrar
  // congela el valor que ya estaba guardado al abrir esta pantalla, solo para saber si hay
  // cambios sin guardar (habilitar/deshabilitar el botón).
  const [anchoAlEntrar] = useState(anchoContenido);
  const [guardandoAncho, setGuardandoAncho] = useState(false);
  const [mensajeAncho, setMensajeAncho] = useState<string | null>(null);

  async function manejarGuardarAncho() {
    setGuardandoAncho(true);
    setMensajeAncho(null);
    try {
      await guardarAnchoContenido(anchoContenido);
      setMensajeAncho('Ancho guardado. Se aplica a todos los usuarios en escritorio.');
    } catch (err: any) {
      setMensajeAncho(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoAncho(false);
    }
  }

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
        <div>
          <h2 className="text-base font-semibold">Ancho del contenido</h2>
          <p className="text-xs text-slate-500">
            Arrastra para elegir qué tan ancho se ve el contenido en escritorio — evita que las pantallas se vean
            estiradas de punta a punta en monitores anchos. En celular no aplica (el ancho siempre es el de la
            pantalla).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="range"
            className="flex-1 accent-gauge-ok"
            min={ANCHO_CONTENIDO_MIN}
            max={ANCHO_CONTENIDO_MAX}
            step={20}
            value={anchoContenido}
            onChange={(e) => setAnchoContenido(Number(e.target.value))}
          />
          <span className="text-sm text-slate-700 w-16 text-right flex-shrink-0">{anchoContenido}px</span>
        </div>
        <button
          onClick={manejarGuardarAncho}
          disabled={guardandoAncho || anchoContenido === anchoAlEntrar}
          className="boton-primario w-full sm:w-auto px-6"
        >
          {guardandoAncho ? 'Guardando…' : 'Guardar ancho'}
        </button>
        {mensajeAncho && (
          <p className={`text-sm ${mensajeAncho.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}`}>
            {mensajeAncho}
          </p>
        )}
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
