import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import {
  BUILD_ACTUAL,
  consultarBuildMinimo,
  exigirBuildActualATodos,
  fechaLegibleBuild,
} from '../lib/versionApp';

/**
 * Pie de página con la versión que está corriendo este equipo — visible para todos, sirve para
 * el soporte por teléfono ("¿qué versión te aparece abajo?"). Para el administrador agrega el
 * control de "candado de versión": exigir esta versión a todas las tablets/celulares, de modo
 * que los que tengan una anterior queden bloqueados con "Actualiza la app" (ver GuardaVersion).
 */
export function PieVersion() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador';
  const [minimo, setMinimo] = useState<number | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  useEffect(() => {
    if (esAdmin) consultarBuildMinimo().then(setMinimo);
  }, [esAdmin]);

  async function exigir() {
    const ok = window.confirm(
      '¿Exigir esta versión a todas las tablets y celulares?\n\n' +
        'Cualquier equipo con una versión anterior va a quedar bloqueado con una pantalla de ' +
        '"Actualiza la app" la próxima vez que la abra con señal. Los que ya están en esta versión ' +
        '(o una más nueva) no se ven afectados.',
    );
    if (!ok) return;
    setGuardando(true);
    setMensaje(null);
    const { error } = await exigirBuildActualATodos(usuario?.id);
    setGuardando(false);
    if (error) {
      setMensaje(`No se pudo: ${error}`);
      return;
    }
    setMinimo(BUILD_ACTUAL);
    setMensaje('Listo. Los equipos con una versión anterior van a pedir actualización.');
  }

  const yaExigidaEsta = minimo != null && minimo > 0 && minimo === BUILD_ACTUAL;

  return (
    <footer className="mt-10 pt-4 border-t border-panel-600/40 text-center space-y-1">
      <p className="text-[11px] text-slate-400">
        EBAR Monitor · versión {fechaLegibleBuild()}
      </p>

      {esAdmin && (
        <div className="text-[11px] text-slate-400 space-y-1">
          {minimo != null && minimo > 0 && (
            <p>
              Versión mínima exigida: {fechaLegibleBuild(minimo)}
              {yaExigidaEsta && ' (esta)'}
            </p>
          )}

          <button onClick={() => setAbierto((v) => !v)} className="underline">
            {abierto ? 'Ocultar' : 'Forzar actualización de todos'}
          </button>

          {abierto && (
            <div className="mt-1 flex flex-col items-center gap-1.5">
              <button
                onClick={exigir}
                disabled={guardando || !BUILD_ACTUAL || yaExigidaEsta}
                className="boton-secundario text-xs px-3 py-1.5"
              >
                {guardando
                  ? 'Guardando…'
                  : yaExigidaEsta
                    ? 'Esta versión ya es la exigida'
                    : 'Exigir esta versión a todos'}
              </button>
              {mensaje && (
                <p className={mensaje.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}>
                  {mensaje}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}
