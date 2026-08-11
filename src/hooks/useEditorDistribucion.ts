import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { guardarLayout, type BloqueLayout, type ObjetivoDistribucion } from '../lib/layoutsAdmin';
import { guardarAnchoContenido, obtenerAnchosPantalla, ANCHO_CONTENIDO_DEFAULT } from '../lib/anchoContenido';

/** Todo lo que necesita una pantalla para tener su propio botón "Editar distribución": mover/
 * redimensionar sus bloques (contenido real, ver GridEditable) y ajustar su propio ancho — cada
 * pantalla guarda lo suyo por separado (pantallaId), y además cada acomodo se puede dirigir a
 * roles específicos (objetivoActivo elige qué variante se está viendo/editando; objetivosGuardar
 * es el checklist de a quién se le aplica al guardar). Ver BarraDistribucion.tsx para la barra
 * que consume este hook. */
export function useEditorDistribucion(pantallaId: string) {
  const { anchoDePantalla, setAnchoPantalla } = useAuth();

  const [modoEdicion, setModoEdicion] = useState(false);
  const [resetSignal, setResetSignal] = useState(0);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [guardandoAncho, setGuardandoAncho] = useState(false);
  const [mensajeAncho, setMensajeAncho] = useState<string | null>(null);

  // Qué variante se está mostrando/editando ahora mismo dentro del editor, y a quién se le
  // aplica si se guarda tal cual — por defecto arrancan iguales (arreglás "Todos" y se guarda
  // para "Todos"), pero se pueden separar: cambiar el selector solo cambia la vista previa, tildar
  // más casillas del checklist hace que lo mismo se guarde también para esos otros roles.
  const [objetivoActivo, setObjetivoActivoState] = useState<ObjetivoDistribucion>('todos');
  const [objetivosGuardar, setObjetivosGuardar] = useState<Set<ObjetivoDistribucion>>(new Set(['todos']));

  function setObjetivoActivo(o: ObjetivoDistribucion) {
    // Si se estaba mirando otra variante con un ancho arrastrado sin guardar, no lo dejamos
    // "pegado" al cambiar de variante — el efecto de abajo trae el que corresponde a la nueva.
    if (anchoActual.current !== anchoAlEntrar.current) setAnchoPantalla(pantallaId, anchoAlEntrar.current);
    setObjetivoActivoState(o);
    setObjetivosGuardar(new Set([o]));
  }

  function alternarObjetivoGuardar(o: ObjetivoDistribucion) {
    setObjetivosGuardar((prev) => {
      const next = new Set(prev);
      if (next.has(o)) next.delete(o);
      else next.add(o);
      // Al menos uno tiene que quedar marcado — si se destilda el último, vuelve a quedar el activo.
      return next.size === 0 ? new Set([objetivoActivo]) : next;
    });
  }

  const ancho = anchoDePantalla(pantallaId);
  // Congela el ancho que ya estaba guardado (para la variante activa) al entrar/cambiar de
  // variante, solo para saber si hay cambios sin guardar (habilitar/deshabilitar "Guardar ancho").
  const anchoAlEntrar = useRef(ancho);
  // Copia siempre actualizada de `ancho` para poder leerla al desmontar/cambiar de variante (el
  // efecto de abajo no se vuelve a crear en cada arrastre, así que su cierre quedaría con el valor viejo).
  const anchoActual = useRef(ancho);
  anchoActual.current = ancho;

  function alternarModoEdicion() {
    // Si se está saliendo del modo edición con un ancho arrastrado sin guardar, no lo dejamos
    // "pegado" — vuelve al que ya estaba guardado antes de tocar el control.
    if (modoEdicion && anchoActual.current !== anchoAlEntrar.current) {
      setAnchoPantalla(pantallaId, anchoAlEntrar.current);
    }
    setModoEdicion((v) => !v);
    setObjetivoActivo('todos');
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
      await guardarLayout(pantallaId, layout, [...objetivosGuardar]);
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
      await guardarAnchoContenido(pantallaId, ancho, [...objetivosGuardar]);
      anchoAlEntrar.current = ancho;
      setMensajeAncho('Ancho guardado.');
    } catch (err: any) {
      setMensajeAncho(`No se pudo guardar: ${err.message ?? err}`);
    } finally {
      setGuardandoAncho(false);
    }
  }

  // Al cambiar la variante que se está previsualizando (o al entrar en modo edición), trae el
  // ancho ya guardado para esa variante (heredando de "Todos" si no tiene uno propio) y lo deja
  // como punto de partida — así el control de ancho arranca en el valor correcto para quien se
  // está editando, no en el de quien mira la pantalla ahora mismo.
  useEffect(() => {
    if (!modoEdicion) return;
    let cancelado = false;
    obtenerAnchosPantalla(objetivoActivo).then((mapa) => {
      if (cancelado) return;
      const valor = mapa[pantallaId] ?? ANCHO_CONTENIDO_DEFAULT;
      anchoAlEntrar.current = valor;
      setAnchoPantalla(pantallaId, valor);
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoEdicion, objetivoActivo, pantallaId]);

  // Si se sale de la pantalla (navegando a otra) con el ancho arrastrado sin guardar, no lo
  // dejamos "pegado" para la próxima visita — solo vive en memoria hasta que se guarda. (Salir del
  // modo edición o cambiar de variante ya se maneja arriba, en alternarModoEdicion/setObjetivoActivo.)
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
    objetivoActivo,
    setObjetivoActivo,
    objetivosGuardar,
    alternarObjetivoGuardar,
  };
}

export type EditorDistribucion = ReturnType<typeof useEditorDistribucion>;
