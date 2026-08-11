import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { guardarLayout, type BloqueLayout } from '../lib/layoutsAdmin';
import { guardarAnchoContenido } from '../lib/anchoContenido';

/** Todo lo que necesita una pantalla para tener su propio botón "Editar distribución": mover/
 * redimensionar sus bloques (contenido real, ver GridEditable) y ajustar su propio ancho — cada
 * pantalla guarda lo suyo por separado (pantallaId), no hay control único para toda la app. Ver
 * BarraDistribucion.tsx para la barra que consume este hook. */
export function useEditorDistribucion(pantallaId: string) {
  const { anchoDePantalla, setAnchoPantalla } = useAuth();
  const ancho = anchoDePantalla(pantallaId);

  const [modoEdicion, setModoEdicion] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardandoAncho, setGuardandoAncho] = useState(false);
  const [mensajeAncho, setMensajeAncho] = useState<string | null>(null);

  // Congela el ancho que ya estaba guardado al entrar a esta pantalla, solo para saber si hay
  // cambios sin guardar (habilitar/deshabilitar el botón "Guardar ancho") — igual que hacía
  // DistribucionEntorno.tsx con anchoAlEntrar.
  const anchoAlEntrar = useRef(ancho);
  // Copia siempre actualizada de `ancho` para poder leerla al desmontar (el efecto de abajo no
  // se vuelve a crear en cada arrastre, así que su cierre por sí solo quedaría con el valor viejo).
  const anchoActual = useRef(ancho);
  anchoActual.current = ancho;

  function alternarModoEdicion() {
    setModoEdicion((v) => !v);
    setMensaje(null);
    setMensajeAncho(null);
  }

  function restablecer() {
    setResetSignal((n) => n + 1);
    setMensaje(null);
  }

  function setAncho(v: number) {
    setAnchoPantalla(pantallaId, v);
  }

  async function guardar(layout: BloqueLayout[]) {
    setGuardando(true);
    setMensaje(null);
    try {
      await guardarLayout(pantallaId, layout);
      setMensaje('Distribución guardada.');
      setModoEdicion(false);
    } catch (err: any) {
      setMensaje(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  async function guardarAncho() {
    setGuardandoAncho(true);
    setMensajeAncho(null);
    try {
      await guardarAnchoContenido(pantallaId, ancho);
      anchoAlEntrar.current = ancho;
      setMensajeAncho('Ancho guardado.');
    } catch (err: any) {
      setMensajeAncho(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoAncho(false);
    }
  }

  // Si se sale de la pantalla con el ancho arrastrado sin guardar, no lo dejamos "pegado" para
  // la próxima visita — solo vive en memoria hasta que se guarda o se navega afuera.
  useEffect(() => {
    return () => {
      if (anchoActual.current !== anchoAlEntrar.current) setAnchoPantalla(pantallaId, anchoAlEntrar.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pantallaId]);

  return {
    modoEdicion,
    alternarModoEdicion,
    resetSignal,
    restablecer,
    guardando,
    mensaje,
    guardar,
    ancho,
    setAncho,
    guardandoAncho,
    mensajeAncho,
    guardarAncho,
    anchoSinGuardar: ancho !== anchoAlEntrar.current,
  };
}

export type EditorDistribucion = ReturnType<typeof useEditorDistribucion>;
