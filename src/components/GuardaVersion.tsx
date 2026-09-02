import { useEffect, useState, type ReactNode } from 'react';
import { hayCambiosSinGuardar } from '../lib/formularioActivo';
import {
  BUILD_ACTUAL,
  buildEsObsoleto,
  consultarBuildMinimo,
  fechaLegibleBuild,
  forzarActualizacion,
} from '../lib/versionApp';

// Cada cuánto re-consultar la versión mínima mientras la app sigue abierta. Además se re-consulta
// al montar, al volver a primer plano (visibilitychange) y al recuperar señal (online).
const CADA_MS = 5 * 60 * 1000;

/**
 * Envuelve toda la app. Si el administrador exigió una versión más nueva que la que corre este
 * cliente (ver src/lib/versionApp.ts), muestra la pantalla de "Actualizar ahora" en lugar del
 * contenido. Si en ese momento hay un formulario con datos sin guardar, no tapa nada de golpe:
 * deja una barra roja arriba pidiendo guardar primero, y recién bloquea cuando ya no hay nada
 * pendiente.
 */
export function GuardaVersion({ children }: { children: ReactNode }) {
  const [obsoleta, setObsoleta] = useState(false);
  // La comprobación de "hay cambios sin guardar" no es reactiva (es una variable de módulo). Con
  // la versión ya marcada obsoleta, un tick corto re-evalúa el render para que la pantalla de
  // bloqueo aparezca apenas el operador termina de guardar la visita.
  const [, setNonce] = useState(0);

  useEffect(() => {
    let vivo = true;

    async function chequear() {
      const minimo = await consultarBuildMinimo();
      if (vivo && minimo != null) setObsoleta(buildEsObsoleto(minimo));
    }

    chequear();
    const intervalo = setInterval(chequear, CADA_MS);
    const alVolverAPrimerPlano = () => {
      if (document.visibilityState === 'visible') chequear();
    };
    document.addEventListener('visibilitychange', alVolverAPrimerPlano);
    window.addEventListener('online', chequear);

    return () => {
      vivo = false;
      clearInterval(intervalo);
      document.removeEventListener('visibilitychange', alVolverAPrimerPlano);
      window.removeEventListener('online', chequear);
    };
  }, []);

  useEffect(() => {
    if (!obsoleta) return;
    const t = setInterval(() => setNonce((n) => n + 1), 2000);
    return () => clearInterval(t);
  }, [obsoleta]);

  if (obsoleta && !hayCambiosSinGuardar()) {
    return <PantallaActualizacionObligatoria />;
  }

  return (
    <>
      {obsoleta && <BarraActualizacionPendiente />}
      {children}
    </>
  );
}

function BarraActualizacionPendiente() {
  return (
    <div className="w-full bg-gauge-danger text-white text-sm px-4 py-2.5 text-center sticky top-0 z-50 shadow-md">
      Hay una versión nueva <strong>obligatoria</strong> de la app. Guarda esta visita para poder
      actualizar.
    </div>
  );
}

function PantallaActualizacionObligatoria() {
  const [actualizando, setActualizando] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-panel-900">
      <div className="tarjeta max-w-md w-full p-6 space-y-4 text-center">
        <div className="text-4xl" aria-hidden>🔄</div>
        <h1 className="text-lg font-bold text-slate-900">Hay una versión nueva de la app</h1>
        <p className="text-sm text-slate-600">
          El administrador dejó una actualización obligatoria. Toca el botón para descargarla —
          tarda unos segundos y <strong>no se pierde nada</strong> de lo que ya guardaste (las
          visitas y fotos que estén esperando señal se envían igual después).
        </p>

        <button
          onClick={() => {
            setActualizando(true);
            forzarActualizacion();
          }}
          disabled={actualizando}
          className="boton-primario w-full"
        >
          {actualizando ? 'Actualizando…' : 'Actualizar ahora'}
        </button>

        <details className="text-left">
          <summary className="text-xs text-slate-500 cursor-pointer">El botón no funcionó</summary>
          <p className="text-xs text-slate-500 mt-2 leading-relaxed">
            En el celular, abre Chrome → menú <strong>⋮</strong> → Configuración → Configuración de
            sitios → busca esta página en la lista → <strong>“Borrar y restablecer”</strong>. Después
            cierra Chrome por completo y vuelve a entrar.
          </p>
        </details>

        <p className="text-[11px] text-slate-400">
          Versión de este equipo: {fechaLegibleBuild(BUILD_ACTUAL)}
        </p>
      </div>
    </div>
  );
}
