import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { hayCambiosSinGuardar } from '../lib/formularioActivo';
import {
  BUILD_ACTUAL,
  consultarBuildMinimo,
  exigirBuildActualATodos,
  fechaLegibleBuild,
  forzarActualizacion,
} from '../lib/versionApp';

/**
 * Pie de página con la versión que está corriendo este equipo — visible para todos, sirve para
 * el soporte por teléfono ("¿qué versión te aparece abajo?").
 *
 * Dos controles:
 *   - "Forzar actualización" (todos): alternativa MANUAL a la actualización automática del
 *     service worker, para cuando la app se ve rara o no se actualiza sola. Borra la caché y
 *     recarga limpio (no toca las visitas/fotos pendientes).
 *   - "Exigir esta versión a todos" (solo admin): candado de versión — los equipos con una
 *     versión anterior quedan bloqueados con "Actualiza la app" (ver GuardaVersion).
 */
export function PieVersion() {
  const { usuario } = useAuth();
  const esAdmin = usuario?.rol === 'administrador';

  const [actualizando, setActualizando] = useState(false);

  const [minimo, setMinimo] = useState<number | null>(null);
  const [abiertoAdmin, setAbiertoAdmin] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensajeAdmin, setMensajeAdmin] = useState<string | null>(null);

  useEffect(() => {
    if (esAdmin) consultarBuildMinimo().then(setMinimo);
  }, [esAdmin]);

  async function actualizarAhora() {
    if (hayCambiosSinGuardar()) {
      alert('Tienes una visita a medio llenar. Guárdala (o pausa y sal) antes de actualizar la app.');
      return;
    }
    const ok = window.confirm(
      '¿Actualizar la app ahora?\n\n' +
        'Se va a recargar y tarda unos segundos. No se pierde nada de lo que ya guardaste: las ' +
        'visitas y fotos que estén esperando señal se envían igual después.',
    );
    if (!ok) return;
    setActualizando(true);
    await forzarActualizacion(); // recarga la página, no vuelve de acá
  }

  async function exigirATodos() {
    const ok = window.confirm(
      '¿Exigir esta versión a todas las tablets y celulares?\n\n' +
        'Cualquier equipo con una versión anterior va a quedar bloqueado con una pantalla de ' +
        '"Actualiza la app" la próxima vez que la abra con señal. Los que ya están en esta versión ' +
        '(o una más nueva) no se ven afectados.',
    );
    if (!ok) return;
    setGuardando(true);
    setMensajeAdmin(null);
    const { error } = await exigirBuildActualATodos(usuario?.id);
    setGuardando(false);
    if (error) {
      setMensajeAdmin(`No se pudo: ${error}`);
      return;
    }
    setMinimo(BUILD_ACTUAL);
    setMensajeAdmin('Listo. Los equipos con una versión anterior van a pedir actualización.');
  }

  const yaExigidaEsta = minimo != null && minimo > 0 && minimo === BUILD_ACTUAL;

  return (
    <footer className="mt-10 pt-4 border-t border-panel-600/40 text-center space-y-2">
      <p className="text-[11px] text-slate-400">
        EBAR Monitor · versión {fechaLegibleBuild()}
      </p>

      {/* Alternativa manual a la actualización automática — para todos los usuarios. */}
      <p className="text-[11px] text-slate-400">
        ¿La app se ve mal o no se actualiza sola?{' '}
        <button onClick={actualizarAhora} disabled={actualizando} className="underline disabled:opacity-50">
          {actualizando ? 'Actualizando…' : 'Forzar actualización'}
        </button>
      </p>

      {esAdmin && (
        <div className="text-[11px] text-slate-400 space-y-1">
          {minimo != null && minimo > 0 && (
            <p>
              Versión mínima exigida: {fechaLegibleBuild(minimo)}
              {yaExigidaEsta && ' (esta)'}
            </p>
          )}

          <button onClick={() => setAbiertoAdmin((v) => !v)} className="underline">
            {abiertoAdmin ? 'Ocultar' : 'Exigir esta versión a todos los equipos'}
          </button>

          {abiertoAdmin && (
            <div className="mt-1 flex flex-col items-center gap-1.5">
              <button
                onClick={exigirATodos}
                disabled={guardando || !BUILD_ACTUAL || yaExigidaEsta}
                className="boton-secundario text-xs px-3 py-1.5"
              >
                {guardando
                  ? 'Guardando…'
                  : yaExigidaEsta
                    ? 'Esta versión ya es la exigida'
                    : 'Exigir esta versión a todos'}
              </button>
              {mensajeAdmin && (
                <p className={mensajeAdmin.startsWith('No se pudo') ? 'text-gauge-danger' : 'text-gauge-ok'}>
                  {mensajeAdmin}
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </footer>
  );
}
