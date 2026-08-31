import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  encolarEdicionVisita, encolarVisita, sincronizarPendientes,
  guardarBorradorVisita, obtenerBorradorVisita, eliminarBorradorVisita,
} from '../lib/offline';
import { esMismoDia, formatearFechaHoraFoto, urlMiniaturaDrive } from '../lib/fotos';
import { hoyLocal } from '../lib/fecha';
import { useAutoResizeTextarea } from '../lib/useAutoResizeTextarea';
import { generarUUID } from '../lib/uuid';
import { distanciaMetros, useUbicacionActual } from '../lib/useUbicacion';
import { claveCacheBombas, CLAVE_CACHE_ESTACIONES, guardarCacheLocal, leerCacheLocal } from '../lib/cacheLocal';
import { registrarFormularioActivo, desregistrarFormularioActivo } from '../lib/formularioActivo';
import { PumpForm } from '../components/PumpForm';
import { PhotoCapture } from '../components/PhotoCapture';
import { EquipoSection } from '../components/EquipoSection';
import { BotonDictado } from '../components/BotonDictado';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import type {
  Bomba,
  EstacionEbar,
  EstadoEquipo,
  EstadoEstacion,
  FotoLocal,
  NivelTanque,
  RegistroBombaInput,
  RegistroEquipo,
  VisitaInput,
} from '../lib/types';

const crearEquipo = (): RegistroEquipo => ({ estado: '', observaciones: '', fotos: [] });

const DISTANCIA_MAXIMA_METROS = 300;
// Tope al margen de error del GPS que se le resta a la distancia (ver más abajo). Sin este tope,
// un celular que reporte un margen de error enorme dejaría pasar a cualquier distancia: en
// iPhone, si el operador tiene desactivada "Ubicación exacta" (Ajustes > Privacidad > Localización
// > la app/Safari), el margen de error que entrega el sistema salta de metros a VARIOS
// KILÓMETROS — con eso la resta siempre daba 0 y el bloqueo por distancia quedaba anulado sin
// importar dónde estuviera el operador en realidad. 150 m es lo que el propio GPS normal reporta
// como peor caso cerca de estructuras de concreto/metal (ver comentario en `distanciaEfectiva`).
const MARGEN_GPS_MAXIMO_METROS = 150;

const ESTADOS_ESTACION: { value: EstadoEstacion; label: string; claseActiva: string }[] = [
  { value: 'operativa', label: 'Operativa', claseActiva: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  {
    value: 'mantenimiento_correctivo',
    label: 'Mantenimiento correctivo',
    claseActiva: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn',
  },
  { value: 'fuera_de_servicio', label: 'Fuera de servicio', claseActiva: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
];

// Para "Líneas de impulsión y guías de izado" y las subcategorías de "Válvulas": mismos 3 valores
// del enum (operativo/en_falla/requiere_mantenimiento), pero reordenados y con "en_falla" mostrado
// como "Fuera de servicio" (a pedido del usuario, distinto del resto de equipos que dicen "En falla").
const ESTADOS_VALVULAS_LINEAS: { value: EstadoEquipo; label: string; claseActiva: string }[] = [
  { value: 'operativo', label: 'Operativo', claseActiva: 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' },
  {
    value: 'requiere_mantenimiento',
    label: 'Requiere mantenimiento',
    claseActiva: 'bg-gauge-warn/15 border-gauge-warn text-gauge-warn',
  },
  { value: 'en_falla', label: 'Fuera de servicio', claseActiva: 'bg-gauge-danger/15 border-gauge-danger text-gauge-danger' },
];

function formatearDuracion(ms: number): string {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  if (horas > 0) return `${horas}h ${String(minutos).padStart(2, '0')}m`;
  return `${String(minutos).padStart(2, '0')}:${String(segundos).padStart(2, '0')}`;
}

function equipoParaBD(equipo: RegistroEquipo | null | undefined) {
  return equipo
    ? {
        estado: equipo.estado,
        observaciones: equipo.observaciones ?? null,
        numeros_afectados: equipo.numeros_afectados ?? null,
        tiene: equipo.tiene ?? null,
      }
    : null;
}

export function VisitForm() {
  const { id: estacionId, visitaId } = useParams<{ id: string; visitaId?: string }>();
  const { usuario, tienePermiso } = useAuth();
  const navigate = useNavigate();
  const modoEdicion = !!visitaId;
  // "Editar distribución" acá es solo el control de ancho de esta pantalla (sinBloques en
  // BarraDistribucion) — el formulario es un único bloque de contenido, no una grilla de bloques
  // movibles como Inicio/Estaciones. Mismo criterio que el resto de la app: administrador real o
  // quien tenga el permiso 'editar_distribucion' delegado (ver /permisos).
  const esAdministrador = usuario?.rol === 'administrador';
  const puedeEditarDistribucion = esAdministrador || tienePermiso('editar_distribucion');
  const editorDistribucion = useEditorDistribucion('visita_formulario');

  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [bombas, setBombas] = useState<Bomba[]>([]);
  // Bloqueo por asignación: la asignación la controla exclusivamente el administrador/supervisor
  // desde "Asignar" — si el operador no tiene la estación asignada hoy (por defecto o especial),
  // no puede registrar la visita, tenga o no otras asignaciones cargadas.
  const [asignacion, setAsignacion] = useState<{ asignadaHoy: boolean } | null>(null);
  const [registrosBombas, setRegistrosBombas] = useState<Record<string, RegistroBombaInput>>({});
  const [bombasSeleccionadas, setBombasSeleccionadas] = useState<Set<string>>(new Set());
  const [cargandoDatos, setCargandoDatos] = useState(true);
  const [horaLlegada, setHoraLlegada] = useState(new Date().toISOString());
  const [fechaSalidaOriginal, setFechaSalidaOriginal] = useState<string | null>(null);
  const [ahora, setAhora] = useState(Date.now());
  const [estadoEstacion, setEstadoEstacion] = useState<EstadoEstacion | ''>('');
  const [nivelTanque, setNivelTanque] = useState<NivelTanque | ''>('');
  const [observaciones, setObservaciones] = useState('');
  const observacionesRef = useAutoResizeTextarea(observaciones);
  const [fotos, setFotos] = useState<FotoLocal[]>([]);
  const [lineasImpulsion, setLineasImpulsion] = useState<RegistroEquipo>(crearEquipo);
  const [guiasIzado, setGuiasIzado] = useState<RegistroEquipo>(crearEquipo);
  const [valvulasCompuerta, setValvulasCompuerta] = useState<RegistroEquipo>(crearEquipo);
  const [valvulasCheck, setValvulasCheck] = useState<RegistroEquipo>(crearEquipo);
  const [valvulaAire, setValvulaAire] = useState<RegistroEquipo>(crearEquipo);
  const [camaraRejilla, setCamaraRejilla] = useState<RegistroEquipo>(crearEquipo);
  const [camaraValvulaCompuerta, setCamaraValvulaCompuerta] = useState<RegistroEquipo>(crearEquipo);
  const [tableroDistribucion, setTableroDistribucion] = useState<RegistroEquipo>(crearEquipo);
  const [variador, setVariador] = useState<RegistroEquipo>(crearEquipo);
  const [descargaEmergencia, setDescargaEmergencia] = useState<RegistroEquipo>(crearEquipo);
  const [tuberia400ValvulasAire, setTuberia400ValvulasAire] = useState<RegistroEquipo>(crearEquipo);
  const [tuberia400Uniones, setTuberia400Uniones] = useState<RegistroEquipo>(crearEquipo);
  const [tuberia600ValvulasAire, setTuberia600ValvulasAire] = useState<RegistroEquipo>(crearEquipo);
  const [tuberia600Uniones, setTuberia600Uniones] = useState<RegistroEquipo>(crearEquipo);
  const [cerramientoSeguridad, setCerramientoSeguridad] = useState<RegistroEquipo>(crearEquipo);
  const [jardineras, setJardineras] = useState<RegistroEquipo>(crearEquipo);
  const [patiosManiobras, setPatiosManiobras] = useState<RegistroEquipo>(crearEquipo);
  const [guardando, setGuardando] = useState(false);
  const [eliminandoVisita, setEliminandoVisita] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [pasoConfirmacion, setPasoConfirmacion] = useState<0 | 1 | 2>(0);
  const guardadoRef = useRef(false);
  const esLineaConduccion = estacion?.tipo === 'linea_conduccion';
  // A pedido del usuario: si el operador marca la estación como "Fuera de servicio", ya no hay
  // nada más que reportar aparte del motivo — se ocultan nivel de tanque, bombas, cerramiento/
  // jardineras/patios y estado de equipos, y solo queda visible el cuadro de Observaciones
  // generales + fotos (más abajo también se salta su validación obligatoria y se guardan como
  // null, igual que ya se hace para las estaciones tipo línea de conducción).
  const esFueraDeServicio = estadoEstacion === 'fuera_de_servicio';

  function equipoSnapshot(eq: RegistroEquipo) {
    return {
      estado: eq.estado,
      observaciones: eq.observaciones ?? '',
      fotos: eq.fotos.map((f) => f.id).sort(),
      numeros_afectados: (eq.numeros_afectados ?? []).slice().sort(),
      tiene: eq.tiene ?? null,
    };
  }

  function construirSnapshot() {
    return {
      estadoEstacion, nivelTanque, observaciones,
      fotos: fotos.map((f) => f.id).sort(),
      bombasSeleccionadas: Array.from(bombasSeleccionadas).sort(),
      registrosBombas: Object.values(registrosBombas)
        .filter((b) => bombasSeleccionadas.has(b.bomba_id))
        .sort((a, b) => a.numero_bomba - b.numero_bomba)
        .map((b) => ({ ...b })),
      lineasImpulsion: equipoSnapshot(lineasImpulsion),
      guiasIzado: equipoSnapshot(guiasIzado),
      valvulasCompuerta: equipoSnapshot(valvulasCompuerta),
      valvulasCheck: equipoSnapshot(valvulasCheck),
      valvulaAire: equipoSnapshot(valvulaAire),
      camaraRejilla: equipoSnapshot(camaraRejilla),
      camaraValvulaCompuerta: equipoSnapshot(camaraValvulaCompuerta),
      tableroDistribucion: equipoSnapshot(tableroDistribucion),
      variador: equipoSnapshot(variador),
      descargaEmergencia: equipoSnapshot(descargaEmergencia),
      tuberia400ValvulasAire: equipoSnapshot(tuberia400ValvulasAire),
      tuberia400Uniones: equipoSnapshot(tuberia400Uniones),
      tuberia600ValvulasAire: equipoSnapshot(tuberia600ValvulasAire),
      tuberia600Uniones: equipoSnapshot(tuberia600Uniones),
      cerramientoSeguridad: equipoSnapshot(cerramientoSeguridad),
      jardineras: equipoSnapshot(jardineras),
      patiosManiobras: equipoSnapshot(patiosManiobras),
    };
  }

  function claveBorrador() {
    return `visita:${estacionId}:${visitaId ?? 'nueva'}`;
  }

  // Copia completa del formulario (a diferencia de construirSnapshot(), que solo guarda ids de
  // fotos para comparar cambios) — esto es lo que se guarda como borrador para poder continuar
  // la visita más tarde, incluidas las fotos ya tomadas (como Blob, IndexedDB las soporta bien).
  function construirBorrador() {
    return {
      horaLlegada, fechaSalidaOriginal,
      estadoEstacion, nivelTanque, observaciones, fotos,
      bombasSeleccionadas: Array.from(bombasSeleccionadas),
      registrosBombas,
      lineasImpulsion, guiasIzado, valvulasCompuerta, valvulasCheck, valvulaAire,
      camaraRejilla, camaraValvulaCompuerta, tableroDistribucion, variador, descargaEmergencia,
      tuberia400ValvulasAire, tuberia400Uniones, tuberia600ValvulasAire, tuberia600Uniones,
      cerramientoSeguridad, jardineras, patiosManiobras,
    };
  }

  function restaurarBorrador(datos: ReturnType<typeof construirBorrador>) {
    setHoraLlegada(datos.horaLlegada);
    setFechaSalidaOriginal(datos.fechaSalidaOriginal);
    setEstadoEstacion(datos.estadoEstacion);
    setNivelTanque(datos.nivelTanque);
    setObservaciones(datos.observaciones);
    setFotos(datos.fotos);
    setBombasSeleccionadas(new Set(datos.bombasSeleccionadas));
    setRegistrosBombas(datos.registrosBombas);
    setLineasImpulsion(datos.lineasImpulsion);
    setGuiasIzado(datos.guiasIzado);
    setValvulasCompuerta(datos.valvulasCompuerta);
    setValvulasCheck(datos.valvulasCheck);
    setValvulaAire(datos.valvulaAire);
    setCamaraRejilla(datos.camaraRejilla);
    setCamaraValvulaCompuerta(datos.camaraValvulaCompuerta);
    setTableroDistribucion(datos.tableroDistribucion);
    setVariador(datos.variador);
    setDescargaEmergencia(datos.descargaEmergencia);
    setTuberia400ValvulasAire(datos.tuberia400ValvulasAire);
    setTuberia400Uniones(datos.tuberia400Uniones);
    setTuberia600ValvulasAire(datos.tuberia600ValvulasAire);
    setTuberia600Uniones(datos.tuberia600Uniones);
    setCerramientoSeguridad(datos.cerramientoSeguridad);
    setJardineras(datos.jardineras);
    setPatiosManiobras(datos.patiosManiobras);
  }

  async function pausarYSalir(salir: () => void) {
    if (!estacionId) return;
    await guardarBorradorVisita(claveBorrador(), estacionId, visitaId, construirBorrador());
    guardadoRef.current = true; // ya quedó a salvo como borrador: no mostrar el aviso de "salir sin guardar"
    salir();
  }

  // Opuesto de pausarYSalir: en vez de guardar el avance para retomarlo con el tiempo real
  // transcurrido, lo descarta por completo — incluido cualquier borrador que ya se haya
  // autoguardado solo (ver el useEffect de autoguardado más abajo), que si no quedaría huérfano
  // en el dispositivo y reaparecería la próxima vez que se abra "Nueva visita" en esta estación.
  async function descartarBorrador(salir: () => void) {
    if (estacionId) await eliminarBorradorVisita(claveBorrador());
    guardadoRef.current = true;
    salir();
  }

  // Para el botón del encabezado (junto al temporizador): a diferencia del aviso de navegación
  // de abajo (que ya es en sí mismo una confirmación), este actúa directo sobre la visita en
  // curso sin que el operador haya intentado salir — pide confirmación aparte porque es
  // irreversible.
  function descartarYSalir() {
    if (!estacionId) return;
    const confirmar = window.confirm(
      '¿Salir sin guardar? Vas a perder todo lo registrado en esta visita — el tiempo transcurrido no va a quedar contado.',
    );
    if (confirmar) descartarBorrador(() => navigate(`/estaciones/${estacionId}`));
  }

  // Solo para "Editar visita": descarta los cambios hechos en esta pantalla y vuelve a la
  // estación, sin pasar por el modal de "datos sin guardar" (el botón ya es esa confirmación).
  function salirSinGuardar() {
    guardadoRef.current = true;
    navigate(`/estaciones/${estacionId}`);
  }

  // Exclusivo del administrador — útil para visitas mal cargadas o hechas solo de prueba. Borra
  // en cascada sus fotos y registros de bombas (FK "on delete cascade", ver migración 0001); las
  // fotos ya subidas a Drive quedan huérfanas ahí (mismo comportamiento ya aceptado al borrar una
  // foto suelta, ver eliminarFotoGuardada en fotos.ts) — no se intenta borrar el archivo remoto.
  async function eliminarVisita() {
    if (!visitaId) return;
    const confirmado = window.confirm(
      'Vas a eliminar esta visita completa, junto con sus fotos y registros de bombas. Esta acción no se puede deshacer. ¿Continuar?',
    );
    if (!confirmado) return;
    setEliminandoVisita(true);
    setMensaje(null);
    try {
      const { error } = await supabase.from('visitas').delete().eq('id', visitaId);
      if (error) throw error;
      guardadoRef.current = true; // evita el aviso de "salir sin guardar" al navegar después de borrar
      navigate(`/estaciones/${estacionId}`);
    } catch (err: any) {
      setMensaje(`No se pudo eliminar la visita: ${err.message ?? err}`);
      setEliminandoVisita(false);
    }
  }

  const snapshotInicialRef = useRef<string | null>(null);
  useEffect(() => {
    if (!cargandoDatos && snapshotInicialRef.current === null) {
      snapshotInicialRef.current = JSON.stringify(construirSnapshot());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cargandoDatos]);

  const snapshotActual = JSON.stringify(construirSnapshot());
  const hayCambios =
    !guardadoRef.current &&
    snapshotInicialRef.current !== null &&
    snapshotActual !== snapshotInicialRef.current;

  // Autoguardado del borrador: si el operador deja el celular a medio llenar (batería, se
  // cierra la app sola, etc.) no se pierde lo ya ingresado — no depende de que use el botón
  // "Pausar" a propósito.
  useEffect(() => {
    if (!hayCambios || !estacionId) return;
    const t = setTimeout(() => {
      guardarBorradorVisita(claveBorrador(), estacionId, visitaId, construirBorrador());
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotActual]);

  // Le avisa al header (botón "Salir") que hay datos sin guardar, para que ofrezca guardarlos
  // como borrador antes de cerrar sesión — "Salir" no navega dentro de la app, así que el
  // useBlocker de abajo no se entera solo.
  useEffect(() => {
    registrarFormularioActivo({
      hayCambios,
      guardar: async () => {
        if (!estacionId) return;
        await guardarBorradorVisita(claveBorrador(), estacionId, visitaId, construirBorrador());
        guardadoRef.current = true;
      },
    });
    return () => desregistrarFormularioActivo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hayCambios, snapshotActual]);

  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => hayCambios && currentLocation.pathname !== nextLocation.pathname
  );

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!hayCambios) return;
      e.preventDefault();
      e.returnValue = '';
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [hayCambios]);

  function validar(): string[] {
    if (esLineaConduccion || esFueraDeServicio) return [];
    const lista: string[] = [];
    for (const b of Object.values(registrosBombas)) {
      if (!bombasSeleccionadas.has(b.bomba_id)) continue;
      if (b.estado === 'encendida') {
        if (b.voltaje == null) lista.push(`Bomba ${b.numero_bomba}: voltaje no ingresado`);
        if (b.amperaje == null) lista.push(`Bomba ${b.numero_bomba}: amperaje no ingresado`);
      }
    }
    // "Estación con problemas sin observaciones" se subió a primerCampoObligatorioFaltante() —
    // pasó de aviso blando (se podía "Guardar de todas formas") a bloqueo real.
    return lista;
  }

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, []);

  const tiempoEnSitio = formatearDuracion(ahora - new Date(horaLlegada).getTime());

  function manejarClickGuardar() {
    // Si falta un campo obligatorio (no "blando" como voltaje/amperaje/observaciones), ni
    // siquiera tiene sentido ofrecer "Guardar de todas formas": igual se va a bloquear después.
    // Antes esto se descubría recién DESPUÉS de confirmar dos veces, y parecía que el botón "no
    // guardaba nada".
    const campoFaltante = primerCampoObligatorioFaltante();
    if (campoFaltante) {
      setMensaje(campoFaltante);
      return;
    }
    const lista = validar();
    if (lista.length === 0) {
      manejarGuardar();
    } else {
      setErrores(lista);
      setPasoConfirmacion(1);
    }
  }

  useEffect(() => {
    if (!estacionId) return;
    async function cargar() {
      const [{ data: est }, { data: bombasData }] = await Promise.all([
        supabase.from('estaciones_ebar').select('*').eq('id', estacionId).single(),
        supabase.from('bombas').select('*').eq('estacion_id', estacionId).eq('activa', true).order('numero_bomba'),
      ]);

      // Sin conexión: usar la copia de esta estación y de sus bombas — precargadas solas para
      // TODAS las EBAR activas apenas hay señal (ver precargaOffline.ts), sin depender de que este
      // operador/celular haya abierto antes esta EBAR puntual con conexión.
      const claveBombas = claveCacheBombas(estacionId!); // ya se validó arriba (if (!estacionId) return;)
      const estacionFinal = est ?? leerCacheLocal<EstacionEbar[]>(CLAVE_CACHE_ESTACIONES)?.find((e) => e.id === estacionId) ?? null;
      setEstacion(estacionFinal as EstacionEbar);

      const lista = bombasData ? (bombasData as Bomba[]) : leerCacheLocal<Bomba[]>(claveBombas) ?? [];
      if (bombasData) guardarCacheLocal(claveBombas, bombasData);
      setBombas(lista);

      // Solo aplica a operadores registrando una visita NUEVA (no al editar una ya guardada, ni
      // a admin/supervisor).
      if (usuario?.rol === 'operador' && !modoEdicion) {
        const hoy = hoyLocal();
        const { data: asignadaHoyData } = await supabase
          .from('asignaciones_estacion')
          .select('id')
          .eq('operador_id', usuario.id)
          .eq('estacion_id', estacionId)
          .or(`fecha.is.null,fecha.eq.${hoy}`);
        // Si no hay señal, la consulta falla y `asignadaHoyData` queda null — ahí no se bloquea
        // nada (no se puede verificar, y no se le quita el registro offline al operador por
        // esto). Si la consulta sí respondió (aunque sea con 0 filas), ya se puede confiar: sin
        // asignación para hoy, se bloquea.
        setAsignacion(asignadaHoyData === null ? null : { asignadaHoy: asignadaHoyData.length > 0 });
      } else {
        setAsignacion(null);
      }

      const clave = `visita:${estacionId}:${visitaId ?? 'nueva'}`;
      const borrador = await obtenerBorradorVisita(clave);
      if (borrador) {
        const datos = borrador.datos as ReturnType<typeof construirBorrador>;
        const llegadaTexto = new Date(datos.horaLlegada).toLocaleString('es-EC', {
          day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
        });
        const continuar = window.confirm(
          `Hay una visita en pausa, iniciada el ${llegadaTexto}. ¿Continuar donde quedaste?\n\n` +
            'Aceptar = continuar · Cancelar = descartar y empezar de nuevo',
        );
        if (continuar) {
          restaurarBorrador(datos);
          setCargandoDatos(false);
          return;
        }
        await eliminarBorradorVisita(clave);
      }

      setBombasSeleccionadas(new Set());
      const iniciales: Record<string, RegistroBombaInput> = {};
      for (const b of lista) {
        iniciales[b.id] = {
          bomba_id: b.id,
          numero_bomba: b.numero_bomba,
          estado: '',
          voltaje: null,
          amperaje: null,
          horas_operacion_acumuladas: null,
          observaciones: '',
          custodio: b.custodio ?? '',
          codigo_sigame: b.codigo_sigame ?? '',
          fotos: [],
        };
      }

      if (visitaId) {
        const { data: visita } = await supabase
          .from('visitas')
          .select(
            `*, registros_bombas ( bomba_id, numero_bomba, estado, voltaje, amperaje, horas_operacion_acumuladas, observaciones ),
             fotos ( id, url_publica, drive_file_id, descripcion )`
          )
          .eq('id', visitaId)
          .single();

        if (visita) {
          setHoraLlegada(visita.fecha_hora_llegada);
          setFechaSalidaOriginal(visita.fecha_hora_salida ?? new Date().toISOString());
          setEstadoEstacion(visita.estado_estacion);
          setNivelTanque(visita.nivel_tanque);
          setObservaciones(visita.observaciones_generales ?? '');

          const todasLasFotos = (visita.fotos as any[]) ?? [];
          const fotosPorSeccion = (nombre: string | null): FotoLocal[] =>
            todasLasFotos
              .filter((f) => (nombre ? f.descripcion === nombre : !f.descripcion))
              .map((f) => ({
                id: f.id,
                url_publica: urlMiniaturaDrive(f.drive_file_id, f.url_publica),
                drive_file_id: f.drive_file_id ?? undefined,
                tomada_en: visita.fecha_hora_llegada,
                estado_subida: 'subida' as const,
              }));

          const registrosGuardados = (visita.registros_bombas as any[]) ?? [];
          if (registrosGuardados.length > 0) {
            setBombasSeleccionadas(new Set(registrosGuardados.map((rb) => rb.bomba_id)));
          }
          for (const rb of registrosGuardados) {
            iniciales[rb.bomba_id] = {
              ...iniciales[rb.bomba_id],
              bomba_id: rb.bomba_id,
              numero_bomba: rb.numero_bomba,
              estado: rb.estado,
              voltaje: rb.voltaje,
              amperaje: rb.amperaje,
              horas_operacion_acumuladas: rb.horas_operacion_acumuladas,
              observaciones: rb.observaciones ?? '',
              fotos: fotosPorSeccion(`bomba_${rb.numero_bomba}`),
            };
          }

          const equipoDesde = (campo: any, nombre: string): RegistroEquipo => ({
            estado: campo?.estado ?? 'operativo',
            observaciones: campo?.observaciones ?? '',
            numeros_afectados: campo?.numeros_afectados ?? [],
            tiene: campo?.tiene ?? null,
            fotos: fotosPorSeccion(nombre),
          });

          setFotos(fotosPorSeccion(null));
          setLineasImpulsion(equipoDesde(visita.lineas_impulsion, 'lineas_impulsion'));
          setGuiasIzado(equipoDesde(visita.guias_izado, 'guias_izado'));
          setValvulasCompuerta(equipoDesde(visita.valvulas_compuerta, 'valvulas_compuerta'));
          setValvulasCheck(equipoDesde(visita.valvulas_check, 'valvulas_check'));
          setValvulaAire(equipoDesde(visita.valvula_aire, 'valvula_aire'));
          setCamaraRejilla(equipoDesde(visita.camara_rejilla, 'camara_rejilla'));
          setCamaraValvulaCompuerta(equipoDesde(visita.camara_valvula_compuerta, 'camara_valvula_compuerta'));
          setTableroDistribucion(equipoDesde(visita.tablero_distribucion, 'tablero_distribucion'));
          setVariador(equipoDesde(visita.variador, 'variador'));
          setDescargaEmergencia(equipoDesde(visita.descarga_emergencia, 'descarga_emergencia'));
          setTuberia400ValvulasAire(equipoDesde(visita.tuberia_400_valvulas_aire, 'tuberia_400_valvulas_aire'));
          setTuberia400Uniones(equipoDesde(visita.tuberia_400_uniones_elastomericas, 'tuberia_400_uniones_elastomericas'));
          setTuberia600ValvulasAire(equipoDesde(visita.tuberia_600_valvulas_aire, 'tuberia_600_valvulas_aire'));
          setTuberia600Uniones(equipoDesde(visita.tuberia_600_uniones_elastomericas, 'tuberia_600_uniones_elastomericas'));
          setCerramientoSeguridad({
            estado: '',
            observaciones: visita.cerramiento_observaciones ?? '',
            fotos: fotosPorSeccion('cerramiento_seguridad'),
          });
          setJardineras({
            estado: '',
            observaciones: visita.jardineras_observaciones ?? '',
            fotos: fotosPorSeccion('jardineras'),
          });
          setPatiosManiobras({
            estado: '',
            observaciones: visita.patios_maniobras_observaciones ?? '',
            fotos: fotosPorSeccion('patios_maniobras'),
          });
        }
      }

      setRegistrosBombas(iniciales);
      setCargandoDatos(false);
    }
    cargar();
  }, [estacionId, visitaId]);

  /** Primer campo obligatorio que falte completar (o null si están todos completos). No incluye
   * el aviso de "vas a modificar el custodio/SIGAME" (es una confirmación aparte, no un campo
   * faltante) ni las validaciones "blandas" de `validar()` (voltaje/amperaje/observaciones), que
   * sí admiten "Guardar de todas formas". Se usa en `manejarGuardar` (para bloquear antes de
   * guardar) y en `manejarClickGuardar` (para no ofrecer "Guardar de todas formas" cuando en
   * realidad va a quedar bloqueado igual por esto — antes eso se descubría recién después de
   * confirmar dos veces, y parecía que el botón no guardaba nada). */
  function primerCampoObligatorioFaltante(): string | null {
    if (!esLineaConduccion && estadoEstacion === '') {
      return 'Selecciona el estado general de la estación antes de guardar.';
    }

    // Antes esto era "blando" (se podía "Guardar de todas formas" sin escribir nada) — el usuario
    // pidió que se vuelva obligatorio de verdad porque los operadores lo estaban saltando. Solo en
    // visitas NUEVAS (!modoEdicion): exigir esto también al editar bloquearía para siempre
    // cualquier visita vieja (de antes de este cambio) que haya quedado sin esa observación —
    // nadie puede "retroactivamente" escribirla como si estuviera ahí de nuevo. Mismo criterio
    // que ya usa el chequeo de ubicación por GPS (requiereUbicacion, más abajo), que tampoco
    // aplica al editar.
    if (!modoEdicion && !esLineaConduccion && estadoEstacion !== '' && estadoEstacion !== 'operativa' && !observaciones.trim()) {
      return 'La estación no está operativa: agrega observaciones generales antes de guardar.';
    }

    if (!esLineaConduccion && !esFueraDeServicio && nivelTanque === '') {
      return 'Selecciona el nivel del tanque de almacenamiento antes de guardar.';
    }

    if (!esLineaConduccion && !esFueraDeServicio) {
      const bombaSinEstado = Object.values(registrosBombas).find(
        (b) => bombasSeleccionadas.has(b.bomba_id) && b.estado === '',
      );
      if (bombaSinEstado) {
        return `Selecciona el estado de la bomba ${bombaSinEstado.numero_bomba} antes de guardar.`;
      }
      // Observaciones y al menos 1 foto, en TODAS las bombas seleccionadas, sea cual sea su
      // estado (antes solo se pedía si el estado indicaba un problema) — pedido explícito del
      // usuario, otra vez, porque los operadores seguían sin registrar nada. Solo en visitas
      // NUEVAS (ver comentario más arriba sobre por qué no en modoEdicion — no se puede
      // retroactivamente tomar una foto de algo que ya pasó).
      const bombaSinObservaciones = !modoEdicion
        ? Object.values(registrosBombas).find((b) => bombasSeleccionadas.has(b.bomba_id) && !b.observaciones?.trim())
        : undefined;
      if (bombaSinObservaciones) {
        return `Agrega observaciones para la bomba ${bombaSinObservaciones.numero_bomba} antes de guardar.`;
      }
      const bombaSinFoto = !modoEdicion
        ? Object.values(registrosBombas).find((b) => bombasSeleccionadas.has(b.bomba_id) && b.fotos.length === 0)
        : undefined;
      if (bombaSinFoto) {
        return `Agrega al menos una foto para la bomba ${bombaSinFoto.numero_bomba} antes de guardar.`;
      }
    }

    const equiposActivos: Array<{ titulo: string; valor: RegistroEquipo }> = esLineaConduccion
      ? [
          { titulo: 'Tubería 400mm — Válvulas de aire', valor: tuberia400ValvulasAire },
          { titulo: 'Tubería 400mm — Uniones elastoméricas', valor: tuberia400Uniones },
          { titulo: 'Tubería 600mm — Válvulas de aire', valor: tuberia600ValvulasAire },
          { titulo: 'Tubería 600mm — Uniones elastoméricas', valor: tuberia600Uniones },
        ]
      : esFueraDeServicio
      ? []
      : [
          { titulo: 'Líneas de impulsión', valor: lineasImpulsion },
          { titulo: 'Guías de izado de bombas', valor: guiasIzado },
          { titulo: 'Válvulas de compuerta', valor: valvulasCompuerta },
          { titulo: 'Válvulas check', valor: valvulasCheck },
          ...(valvulaAire.tiene === true ? [{ titulo: 'Válvula de aire', valor: valvulaAire }] : []),
          { titulo: 'Tablero de distribución', valor: tableroDistribucion },
          ...(variador.tiene === true ? [{ titulo: 'Variadores de frecuencia', valor: variador }] : []),
          { titulo: 'Cámara de llegada — Rejilla', valor: camaraRejilla },
          ...(camaraValvulaCompuerta.tiene === true
            ? [{ titulo: 'Cámara de llegada — Compuerta', valor: camaraValvulaCompuerta }]
            : []),
        ];
    const equipoSinEstado = equiposActivos.find((e) => e.valor.estado === '');
    if (equipoSinEstado) {
      return `Selecciona el estado de "${equipoSinEstado.titulo}" antes de guardar.`;
    }

    // Observaciones y al menos 1 foto en TODOS los campos que los llevan — no solo los equipos
    // con estado (antes solo se pedía si el estado indicaba un problema), sino también
    // Cerramiento y seguridad/Jardineras/Patios de maniobras (sin estado, siempre visibles) y
    // Descarga de emergencia cuando "Sí tiene". Pedido explícito del usuario, ampliando el
    // primer intento porque los operadores seguían sin registrar nada en varios campos. Solo en
    // visitas NUEVAS (ver comentario más arriba sobre por qué no en modoEdicion).
    if (!modoEdicion) {
      const camposConObservacionYFoto: Array<{ titulo: string; valor: RegistroEquipo }> = [
        ...equiposActivos,
        ...(!esLineaConduccion && !esFueraDeServicio
          ? [
              { titulo: 'Cerramiento y seguridad', valor: cerramientoSeguridad },
              { titulo: 'Jardineras y áreas verdes', valor: jardineras },
              { titulo: 'Patios de maniobras', valor: patiosManiobras },
              ...(descargaEmergencia.tiene === true ? [{ titulo: 'Descarga de emergencia', valor: descargaEmergencia }] : []),
            ]
          : []),
      ];
      const campoSinObservaciones = camposConObservacionYFoto.find((e) => !e.valor.observaciones?.trim());
      if (campoSinObservaciones) {
        return `Agrega observaciones para "${campoSinObservaciones.titulo}" antes de guardar.`;
      }
      const campoSinFoto = camposConObservacionYFoto.find((e) => e.valor.fotos.length === 0);
      if (campoSinFoto) {
        return `Agrega al menos una foto para "${campoSinFoto.titulo}" antes de guardar.`;
      }
    }

    if (!esLineaConduccion && !esFueraDeServicio && descargaEmergencia.tiene == null) {
      return 'Indica si la estación tiene descarga de emergencia antes de guardar.';
    }

    if (!esLineaConduccion && !esFueraDeServicio && valvulaAire.tiene == null) {
      return 'Indica si la estación tiene válvula de aire antes de guardar.';
    }

    if (!esLineaConduccion && !esFueraDeServicio && camaraValvulaCompuerta.tiene == null) {
      return 'Indica si la cámara de llegada tiene compuerta antes de guardar.';
    }

    if (!esLineaConduccion && !esFueraDeServicio && variador.tiene == null) {
      return 'Indica si la estación tiene variadores de frecuencia antes de guardar.';
    }

    return null;
  }

  async function manejarGuardar() {
    if (!estacion || !usuario) return;

    const campoFaltante = primerCampoObligatorioFaltante();
    if (campoFaltante) {
      setMensaje(campoFaltante);
      return;
    }

    if (!esLineaConduccion) {
      const bombasConCustodioModificado = bombas.filter((b) => {
        const actual = registrosBombas[b.id];
        if (!actual) return false;
        const custodioCambio = (actual.custodio ?? '') !== (b.custodio ?? '') && (b.custodio ?? '').trim() !== '';
        const sigameCambio =
          (actual.codigo_sigame ?? '') !== (b.codigo_sigame ?? '') && (b.codigo_sigame ?? '').trim() !== '';
        return custodioCambio || sigameCambio;
      });
      for (const b of bombasConCustodioModificado) {
        const continuar = window.confirm(
          `Vas a modificar el custodio/código SIGAME ya registrado para la Bomba ${b.numero_bomba} ` +
            `(actual: ${b.custodio || '-'} / ${b.codigo_sigame || '-'}). ¿Confirmas el cambio?`,
        );
        if (!continuar) return;
      }
    }

    const fotosPendientes = esLineaConduccion
      ? [tuberia400ValvulasAire, tuberia400Uniones, tuberia600ValvulasAire, tuberia600Uniones].flatMap((eq) => eq.fotos)
      : [
          ...fotos,
          ...[
            lineasImpulsion, guiasIzado, valvulasCompuerta, valvulasCheck, valvulaAire, camaraRejilla, camaraValvulaCompuerta,
            tableroDistribucion, variador, descargaEmergencia, cerramientoSeguridad, jardineras, patiosManiobras,
          ].flatMap((eq) => eq.fotos),
          ...Object.values(registrosBombas)
            .filter((b) => bombasSeleccionadas.has(b.bomba_id))
            .flatMap((b) => b.fotos),
        ];
    const fotoDeOtroDia = fotosPendientes.find((f) => f.blob && !esMismoDia(f.tomada_en, horaLlegada));
    if (fotoDeOtroDia) {
      const continuar = window.confirm(
        `Estás a punto de guardar esta visita con una foto tomada el ${formatearFechaHoraFoto(
          fotoDeOtroDia.tomada_en,
        )}, un día distinto al de la visita (${formatearFechaHoraFoto(horaLlegada)}). ¿Deseas continuar de todas formas?`,
      );
      if (!continuar) return;
    }

    setGuardando(true);
    setMensaje(null);

    // Las estaciones tipo línea de conducción no tienen selector de estado propio:
    // se deriva del estado de sus tuberías.
    const estadoDerivado: EstadoEstacion = esLineaConduccion
      ? [tuberia400ValvulasAire, tuberia400Uniones, tuberia600ValvulasAire, tuberia600Uniones].some(
          (eq) => eq.estado !== 'operativo'
        )
        ? 'mantenimiento_correctivo'
        : 'operativa'
      : (estadoEstacion as EstadoEstacion);

    const payload: VisitaInput = {
      id: modoEdicion ? visitaId : undefined,
      cliente_uuid: generarUUID(),
      estacion_id: estacion.id,
      operador_id: usuario.id,
      fecha_hora_llegada: horaLlegada,
      fecha_hora_salida: modoEdicion ? fechaSalidaOriginal : new Date().toISOString(),
      estado_estacion: estadoDerivado,
      nivel_tanque: esLineaConduccion || esFueraDeServicio ? 'medio' : (nivelTanque as NivelTanque),
      olores_anormales: false,
      olores_descripcion: null,
      ruidos_extranos: false,
      ruidos_descripcion: null,
      cerramiento_ok: true,
      cerramiento_observaciones: esLineaConduccion || esFueraDeServicio ? null : (cerramientoSeguridad.observaciones || null),
      cerramiento_seguridad: esLineaConduccion || esFueraDeServicio ? null : cerramientoSeguridad,
      jardineras_observaciones: esLineaConduccion || esFueraDeServicio ? null : (jardineras.observaciones || null),
      jardineras: esLineaConduccion || esFueraDeServicio ? null : jardineras,
      patios_maniobras_observaciones: esLineaConduccion || esFueraDeServicio ? null : (patiosManiobras.observaciones || null),
      patios_maniobras: esLineaConduccion || esFueraDeServicio ? null : patiosManiobras,
      observaciones_generales: esLineaConduccion ? null : observaciones || null,
      bombas:
        esLineaConduccion || esFueraDeServicio
          ? []
          : Object.values(registrosBombas).filter((b) => bombasSeleccionadas.has(b.bomba_id)),
      fotos: esLineaConduccion ? [] : fotos,
      lineas_impulsion: esLineaConduccion || esFueraDeServicio ? null : lineasImpulsion,
      guias_izado: esLineaConduccion || esFueraDeServicio ? null : guiasIzado,
      valvulas_compuerta: esLineaConduccion || esFueraDeServicio ? null : valvulasCompuerta,
      valvulas_check: esLineaConduccion || esFueraDeServicio ? null : valvulasCheck,
      valvula_aire: esLineaConduccion || esFueraDeServicio ? null : valvulaAire,
      camara_rejilla: esLineaConduccion || esFueraDeServicio ? null : camaraRejilla,
      camara_valvula_compuerta: esLineaConduccion || esFueraDeServicio ? null : camaraValvulaCompuerta,
      tablero_distribucion: esLineaConduccion || esFueraDeServicio ? null : tableroDistribucion,
      variador: esLineaConduccion || esFueraDeServicio ? null : variador,
      descarga_emergencia: esLineaConduccion || esFueraDeServicio ? null : descargaEmergencia,
      tuberia_400_valvulas_aire: esLineaConduccion ? tuberia400ValvulasAire : null,
      tuberia_400_uniones_elastomericas: esLineaConduccion ? tuberia400Uniones : null,
      tuberia_600_valvulas_aire: esLineaConduccion ? tuberia600ValvulasAire : null,
      tuberia_600_uniones_elastomericas: esLineaConduccion ? tuberia600Uniones : null,
    };

    try {
      // Si hay estado actual de la estación distinto, lo actualizamos también.
      const { error: errorEstacion } = await supabase
        .from('estaciones_ebar')
        .update({ estado_actual: estadoDerivado })
        .eq('id', estacion.id);
      if (errorEstacion) throw errorEstacion;

      // Custodio / código SIGAME son datos del bien (persisten entre visitas), no de la
      // visita puntual: se guardan en `bombas`, no en `registros_bombas`.
      if (!esLineaConduccion) {
        for (const b of bombas) {
          const actual = registrosBombas[b.id];
          if (!actual) continue;
          if ((actual.custodio ?? '') === (b.custodio ?? '') && (actual.codigo_sigame ?? '') === (b.codigo_sigame ?? '')) {
            continue;
          }
          const { error: errorCustodio } = await supabase.rpc('actualizar_custodio_bomba', {
            p_bomba_id: b.id,
            p_custodio: actual.custodio || null,
            p_codigo_sigame: actual.codigo_sigame || null,
          });
          if (errorCustodio) throw errorCustodio;
        }
      }

      const camposVisita = {
        estacion_id: payload.estacion_id,
        operador_id: payload.operador_id,
        fecha_hora_llegada: payload.fecha_hora_llegada,
        fecha_hora_salida: payload.fecha_hora_salida,
        estado_estacion: payload.estado_estacion,
        nivel_tanque: payload.nivel_tanque,
        olores_anormales: payload.olores_anormales,
        olores_descripcion: payload.olores_descripcion,
        ruidos_extranos: payload.ruidos_extranos,
        ruidos_descripcion: payload.ruidos_descripcion,
        cerramiento_ok: payload.cerramiento_ok,
        cerramiento_observaciones: payload.cerramiento_observaciones,
        jardineras_observaciones: payload.jardineras_observaciones,
        patios_maniobras_observaciones: payload.patios_maniobras_observaciones,
        observaciones_generales: payload.observaciones_generales,
        lineas_impulsion: equipoParaBD(payload.lineas_impulsion),
        guias_izado: equipoParaBD(payload.guias_izado),
        valvulas_compuerta: equipoParaBD(payload.valvulas_compuerta),
        valvulas_check: equipoParaBD(payload.valvulas_check),
        valvula_aire: equipoParaBD(payload.valvula_aire),
        camara_rejilla: equipoParaBD(payload.camara_rejilla),
        camara_valvula_compuerta: equipoParaBD(payload.camara_valvula_compuerta),
        tablero_distribucion: equipoParaBD(payload.tablero_distribucion),
        variador: equipoParaBD(payload.variador),
        descarga_emergencia: equipoParaBD(payload.descarga_emergencia),
        tuberia_400_valvulas_aire: equipoParaBD(payload.tuberia_400_valvulas_aire),
        tuberia_400_uniones_elastomericas: equipoParaBD(payload.tuberia_400_uniones_elastomericas),
        tuberia_600_valvulas_aire: equipoParaBD(payload.tuberia_600_valvulas_aire),
        tuberia_600_uniones_elastomericas: equipoParaBD(payload.tuberia_600_uniones_elastomericas),
      };

      if (navigator.onLine) {
        // Intento directo; si falla, cae a la cola offline para no perder el registro.
        if (modoEdicion && visitaId) {
          const { error: errorVisita } = await supabase.from('visitas').update(camposVisita).eq('id', visitaId);
          if (errorVisita) throw errorVisita;
          await encolarEdicionVisita(visitaId, payload); // reutiliza la cola para subir bombas/fotos de forma consistente
        } else {
          const { error: errorVisita } = await supabase
            .from('visitas')
            .insert({ cliente_uuid: payload.cliente_uuid, ...camposVisita });
          if (errorVisita) throw errorVisita;
          await encolarVisita(payload);
        }
        await sincronizarPendientes();
      } else if (modoEdicion && visitaId) {
        await encolarEdicionVisita(visitaId, payload);
      } else {
        await encolarVisita(payload);
      }

      guardadoRef.current = true;
      await eliminarBorradorVisita(claveBorrador());
      setMensaje(modoEdicion ? 'Visita actualizada correctamente.' : 'Visita registrada correctamente.');
      setTimeout(() => navigate(`/estaciones/${estacion.id}`), 800);
    } catch (err: any) {
      // Conexión inestable a mitad de carga: igual se guarda localmente.
      try {
        if (modoEdicion && visitaId) await encolarEdicionVisita(visitaId, payload);
        else await encolarVisita(payload);
        guardadoRef.current = true;
        await eliminarBorradorVisita(claveBorrador());
        setMensaje('Sin conexión estable: los cambios se guardaron en el dispositivo y se sincronizarán automáticamente.');
        setTimeout(() => navigate(`/estaciones/${estacion.id}`), 1500);
      } catch (errGuardadoLocal: any) {
        // Esto NO debe quedar en silencio: si ni siquiera el guardado local funcionó (por
        // ejemplo, ese celular/navegador no puede guardar fotos en su almacenamiento local),
        // la alternativa es que el operador crea que guardó y en realidad se perdió todo sin
        // ningún aviso — el caso que motivó este cambio.
        setMensaje(
          `No se pudo guardar la visita en este celular. Avisa a soporte con este mensaje: "${
            errGuardadoLocal?.message ?? String(errGuardadoLocal)
          }".`,
        );
      }
    } finally {
      setGuardando(false);
    }
  }

  // El bloqueo por ubicación solo aplica al registrar una visita nueva (no al editar una ya
  // guardada, que puede corregirse después desde cualquier lado), solo a operadores (admin y
  // supervisor quedan exentos, igual que la vinculación de celular) y solo si la estación tiene
  // coordenadas registradas (si no las tiene, no hay contra qué comparar y el formulario funciona
  // como siempre).
  const requiereUbicacion =
    !!estacion && !modoEdicion && usuario?.rol === 'operador' && estacion.latitud != null && estacion.longitud != null;
  const ubicacion = useUbicacionActual(requiereUbicacion);
  // Se descuenta el margen de precisión (`accuracy`) del GPS antes de comparar: cerca de
  // estructuras de concreto/metal el celular puede reportar 50-150 m de margen de error, y sin
  // esto un operador parado justo en el borde de los 300 m podía quedar bloqueado por error.
  // El margen que se resta tiene un tope (MARGEN_GPS_MAXIMO_METROS): si no lo tuviera, un celular
  // con "Ubicación exacta" desactivada (común en iPhone) reporta un margen de error de varios
  // kilómetros y la resta anula el bloqueo por completo, sin importar dónde esté el operador.
  const distanciaEfectiva =
    requiereUbicacion && ubicacion.tipo === 'ok'
      ? Math.max(
          0,
          distanciaMetros(ubicacion.lat, ubicacion.lon, estacion!.latitud!, estacion!.longitud!) -
            Math.min(ubicacion.precision, MARGEN_GPS_MAXIMO_METROS),
        )
      : null;
  // Mientras el GPS todavía no da su primera lectura no se bloquea (se trata como una carga
  // normal, sin mostrar el aviso) — así se evita el falso "no estás en el sitio" mientras el
  // celular sigue ubicándose, sobre todo en EBAR sin señal de datos donde tarda más.
  const bloqueadoPorUbicacion =
    requiereUbicacion &&
    (ubicacion.tipo === 'error' || (ubicacion.tipo === 'ok' && distanciaEfectiva! > DISTANCIA_MAXIMA_METROS));
  const ubicandoAun = requiereUbicacion && ubicacion.tipo === 'buscando';

  if (cargandoDatos || ubicandoAun) return <p className="text-slate-600">Cargando…</p>;

  if (!estacion) {
    return (
      <p className="text-slate-600">
        No se pudo cargar esta estación sin conexión. Para poder usarla sin señal, entra una vez a
        la lista de "Estaciones EBAR" mientras tengas conexión — puede ser en cualquier lugar
        (casa, oficina, en el camino), no hace falta estar en la EBAR — así queda guardada en el
        celular junto con el resto de tus estaciones asignadas.
      </p>
    );
  }

  if (asignacion && !asignacion.asignadaHoy) {
    return (
      <div className="tarjeta p-6 border-2 border-gauge-danger/60 bg-gauge-danger/10 text-center space-y-3">
        <p className="text-4xl">🚫</p>
        <h1 className="text-lg font-bold uppercase tracking-wide text-gauge-danger">
          Esta estación no está asignada a ti hoy
        </h1>
        <p className="text-sm text-slate-700">
          No puedes registrar una visita en {estacion.nombre} porque no está entre tus EBAR
          asignadas para hoy. Si crees que es un error, contacta a tu administrador o supervisor.
        </p>
        <button
          type="button"
          className="text-xs text-slate-600 hover:text-slate-900 underline"
          onClick={() => navigate(`/estaciones/${estacionId}`)}
        >
          ← Volver a la estación
        </button>
      </div>
    );
  }

  if (bloqueadoPorUbicacion) {
    // Un solo mensaje genérico para los 3 casos (GPS apagado, permiso denegado, fuera de rango)
    // a propósito: no debe distinguir la causa ni mostrar distancias/coordenadas, para no darle
    // al operador ninguna pista de que se está verificando su ubicación por GPS.
    return (
      <div className="tarjeta p-6 border-2 border-gauge-danger/60 bg-gauge-danger/10 text-center space-y-3">
        <p className="text-4xl">🚫</p>
        <h1 className="text-lg font-bold uppercase tracking-wide text-gauge-danger">
          No se puede registrar la visita
        </h1>
        <p className="text-sm text-slate-700">
          No es posible registrar esta visita porque no te encuentras en las instalaciones de la estación EBAR.
        </p>
        <button
          type="button"
          className="text-xs text-slate-600 hover:text-slate-900 underline"
          onClick={() => navigate(`/estaciones/${estacionId}`)}
        >
          ← Volver a la estación
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="titulo-pantalla">{modoEdicion ? 'Editar visita' : 'Nueva visita'}</h1>
          <p className="text-sm text-slate-600">{estacion.nombre}</p>
        </div>
        <div className="text-right flex-shrink-0">
          {modoEdicion ? (
            <>
              <p className="text-xs text-slate-500">
                Llegada {new Date(horaLlegada).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
              {fechaSalidaOriginal && (
                <p className="text-xs text-slate-500">
                  Salida {new Date(fechaSalidaOriginal).toLocaleString('es-EC', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="text-xs text-slate-500">
                Llegada {new Date(horaLlegada).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit', hour12: false })}
              </p>
              <p className="text-sm font-semibold text-gauge-ok tabular-nums">{tiempoEnSitio}</p>
            </>
          )}
          {/* Botones de verdad (borde+relleno clarito), no solo texto subrayado — pedido
              explícito del usuario, con captura, para que se noten como algo tocable. */}
          <div className="flex flex-col items-end gap-1.5 mt-2">
            <button
              type="button"
              className="text-xs font-semibold text-gauge-ok border border-gauge-ok/40 bg-gauge-ok/10 hover:bg-gauge-ok/20 rounded-lg px-2.5 py-1.5 transition whitespace-nowrap"
              onClick={() => pausarYSalir(() => navigate(`/estaciones/${estacionId}`))}
            >
              ⏸ Pausar y continuar luego
            </button>
            {!modoEdicion && (
              <button
                type="button"
                className="text-xs font-semibold text-gauge-danger border border-gauge-danger/40 bg-gauge-danger/10 hover:bg-gauge-danger/20 rounded-lg px-2.5 py-1.5 transition whitespace-nowrap"
                onClick={descartarYSalir}
              >
                🚫 Descartar y salir
              </button>
            )}
            {modoEdicion && esAdministrador && (
              <button
                type="button"
                disabled={eliminandoVisita}
                className="text-xs font-semibold text-gauge-danger border border-gauge-danger/40 bg-gauge-danger/10 hover:bg-gauge-danger/20 rounded-lg px-2.5 py-1.5 transition whitespace-nowrap disabled:opacity-50"
                onClick={eliminarVisita}
              >
                {eliminandoVisita ? 'Eliminando…' : '🗑 Eliminar visita'}
              </button>
            )}
          </div>
        </div>
      </div>

      {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} sinBloques />}

      {esLineaConduccion ? (
        <>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Tubería de impulsión de 400mm</h2>
            <div className="space-y-3">
              <EquipoSection titulo="Válvulas de aire" valor={tuberia400ValvulasAire} onChange={setTuberia400ValvulasAire} />
              <EquipoSection titulo="Uniones elastoméricas" valor={tuberia400Uniones} onChange={setTuberia400Uniones} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Tubería de impulsión de 600mm</h2>
            <div className="space-y-3">
              <EquipoSection titulo="Válvulas de aire" valor={tuberia600ValvulasAire} onChange={setTuberia600ValvulasAire} />
              <EquipoSection titulo="Uniones elastoméricas" valor={tuberia600Uniones} onChange={setTuberia600Uniones} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Estado general de la estación</h2>
            <div className="tarjeta p-4 space-y-3">
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">Estado</h3>

                <div className="flex gap-2">
                  {ESTADOS_ESTACION.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => setEstadoEstacion(estadoEstacion === e.value ? '' : e.value)}
                      className={`flex-1 rounded-lg px-2 py-2 text-xs border transition ${
                        estadoEstacion === e.value ? e.claseActiva : 'bg-panel-900 border-panel-600 text-slate-700'
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>

                {esFueraDeServicio && (
                  <p className="text-xs text-slate-600 bg-panel-900 border border-panel-600 rounded-lg px-3 py-2">
                    La estación quedó marcada como <strong>Fuera de servicio</strong>: solo se
                    registran las observaciones y las fotos del motivo. El resto de la hoja de
                    visita (nivel de tanque, bombas, equipos) queda deshabilitado.
                  </p>
                )}

                {!esFueraDeServicio && (
                <div>
                  <label className="etiqueta">Nivel de tanque de almacenamiento</label>
                  <div className="flex gap-2">
                    {(['alto', 'medio', 'bajo'] as NivelTanque[]).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNivelTanque(nivelTanque === n ? '' : n)}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm border capitalize ${
                          nivelTanque === n ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-700'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>
                )}

                <div>
                  <label className="etiqueta">Observaciones generales / novedades</label>
                  <div className="relative">
                    <textarea
                      ref={observacionesRef}
                      className="campo pr-10 resize-none overflow-hidden"
                      rows={3}
                      value={observaciones}
                      onChange={(e) => setObservaciones(e.target.value)}
                    />
                    <BotonDictado valorActual={observaciones} onTexto={setObservaciones} />
                  </div>
                </div>

                <PhotoCapture fotos={fotos} onChange={setFotos} />
              </div>

              {!esFueraDeServicio && (
                <>
                  <EquipoSection
                    titulo="Cerramiento y seguridad"
                    valor={cerramientoSeguridad}
                    onChange={setCerramientoSeguridad}
                    sinEstado
                    placeholderObservaciones=""
                  />
                  <EquipoSection
                    titulo="Jardineras y áreas verdes"
                    valor={jardineras}
                    onChange={setJardineras}
                    sinEstado
                    placeholderObservaciones=""
                  />
                  <EquipoSection
                    titulo="Patios de maniobras"
                    valor={patiosManiobras}
                    onChange={setPatiosManiobras}
                    sinEstado
                    placeholderObservaciones=""
                  />
                </>
              )}
            </div>
          </div>

          {!esFueraDeServicio && (
          <>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Bombas</h2>
            <div className="space-y-3">
              {bombas.length > 1 && (
                <div className="tarjeta p-4 space-y-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">Bombas a reportar hoy</h3>
                  <div className="flex gap-2 flex-wrap">
                    {bombas.map((b) => {
                      const activa = bombasSeleccionadas.has(b.id);
                      return (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() =>
                            setBombasSeleccionadas((prev) => {
                              const next = new Set(prev);
                              if (next.has(b.id)) next.delete(b.id);
                              else next.add(b.id);
                              return next;
                            })
                          }
                          className={`rounded-lg px-3 py-2 text-sm border transition ${
                            activa ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'bg-panel-900 border-panel-600 text-slate-600'
                          }`}
                        >
                          Bomba {b.numero_bomba}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500">
                    Desmarca las bombas que no están instaladas o no vas a revisar hoy — no se te pedirán sus datos.
                  </p>
                </div>
              )}
              {bombas
                .filter((b) => bombasSeleccionadas.has(b.id))
                .map((b) => (
                  <PumpForm
                    key={b.id}
                    bomba={b}
                    valor={registrosBombas[b.id]}
                    onChange={(v) => setRegistrosBombas((prev) => ({ ...prev, [b.id]: v }))}
                  />
                ))}
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-800 mb-2">Estado de equipos</h2>
            <div className="space-y-3">
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">Líneas de impulsión y guías de izado de bombas</h3>
                <div className="space-y-3">
                  <EquipoSection
                    titulo="Líneas de impulsión"
                    valor={lineasImpulsion}
                    onChange={setLineasImpulsion}
                    cantidadNumerada={4}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                  />
                  <EquipoSection
                    titulo="Guías de izado de bombas"
                    valor={guiasIzado}
                    onChange={setGuiasIzado}
                    cantidadNumerada={4}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                  />
                </div>
              </div>
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">Válvulas</h3>
                <div className="space-y-3">
                  <EquipoSection
                    titulo="Válvulas de compuerta"
                    valor={valvulasCompuerta}
                    onChange={setValvulasCompuerta}
                    cantidadNumerada={5}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                  />
                  <EquipoSection
                    titulo="Válvulas check"
                    valor={valvulasCheck}
                    onChange={setValvulasCheck}
                    cantidadNumerada={4}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                  />
                  <EquipoSection
                    titulo="Válvula de aire"
                    valor={valvulaAire}
                    onChange={setValvulaAire}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                    tieneSelector
                    estadoSiTiene
                  />
                </div>
              </div>
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-800">Cámara de llegada al cárcamo de bombeo</h3>
                <div className="space-y-3">
                  <EquipoSection
                    titulo="Rejilla"
                    valor={camaraRejilla}
                    onChange={setCamaraRejilla}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                  />
                  <EquipoSection
                    titulo="Compuerta"
                    valor={camaraValvulaCompuerta}
                    onChange={setCamaraValvulaCompuerta}
                    opciones={ESTADOS_VALVULAS_LINEAS}
                    tieneSelector
                    estadoSiTiene
                  />
                </div>
              </div>
              <EquipoSection
                titulo="Tablero de distribución, contactores y breakers"
                valor={tableroDistribucion}
                onChange={setTableroDistribucion}
              />
              <EquipoSection
                titulo="Variadores de frecuencia"
                valor={variador}
                onChange={setVariador}
                cantidadNumerada={4}
                opciones={ESTADOS_VALVULAS_LINEAS}
                tieneSelector
                estadoSiTiene
              />
              <EquipoSection
                titulo="Descarga de emergencia"
                valor={descargaEmergencia}
                onChange={setDescargaEmergencia}
                tieneSelector
              />
            </div>
          </div>
          </>
          )}
        </>
      )}

      {mensaje && (
        <p
          className={`text-sm ${
            mensaje.includes('correctamente') || mensaje.includes('se guardaron en el dispositivo')
              ? 'text-gauge-ok'
              : 'text-gauge-danger'
          }`}
        >
          {mensaje}
        </p>
      )}

      {pasoConfirmacion === 0 && modoEdicion && !hayCambios && (
        <button type="button" onClick={() => navigate(`/estaciones/${estacionId}`)} className="boton-secundario w-full">
          Salir
        </button>
      )}

      {pasoConfirmacion === 0 && modoEdicion && hayCambios && (
        <div className="flex gap-2">
          <button type="button" onClick={salirSinGuardar} className="boton-secundario flex-1">
            Salir sin guardar
          </button>
          <button onClick={manejarClickGuardar} disabled={guardando} className="boton-primario flex-1">
            {guardando ? 'Guardando…' : 'Guardar cambios'}
          </button>
        </div>
      )}

      {pasoConfirmacion === 0 && !modoEdicion && (
        <button onClick={manejarClickGuardar} disabled={guardando} className="boton-primario w-full">
          {guardando ? 'Guardando…' : 'Guardar visita'}
        </button>
      )}

      {pasoConfirmacion === 1 && (
        <div className="tarjeta border-gauge-warn/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gauge-warn">Campos incompletos</p>
          <ul className="space-y-1">
            {errores.map((e) => (
              <li key={e} className="text-xs text-slate-700 flex gap-2">
                <span className="text-gauge-warn flex-shrink-0">·</span> {e}
              </li>
            ))}
          </ul>
          <div className="flex gap-2 pt-1">
            <button
              className="boton-secundario flex-1"
              onClick={() => setPasoConfirmacion(0)}
            >
              Volver a corregir
            </button>
            <button
              className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-warn/50 text-gauge-warn hover:bg-gauge-warn/10 transition"
              onClick={() => setPasoConfirmacion(2)}
            >
              Guardar de todas formas
            </button>
          </div>
        </div>
      )}

      {pasoConfirmacion === 2 && (
        <div className="tarjeta border-gauge-danger/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gauge-danger">¿Confirmas guardar con datos incompletos?</p>
          <p className="text-xs text-slate-600">
            Esta visita quedará registrada sin todos los campos requeridos. El informe puede ser incompleto.
          </p>
          <div className="flex gap-2 pt-1">
            <button
              className="boton-secundario flex-1"
              onClick={() => setPasoConfirmacion(0)}
            >
              Cancelar
            </button>
            <button
              disabled={guardando}
              className="flex-1 rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-danger/50 text-gauge-danger hover:bg-gauge-danger/10 transition"
              onClick={() => { setPasoConfirmacion(0); manejarGuardar(); }}
            >
              {guardando ? 'Guardando…' : 'Sí, guardar igual'}
            </button>
          </div>
        </div>
      )}

      {blocker.state === 'blocked' && (
        <>
          <div className="fixed inset-0 bg-black/50 z-20" />
          <div className="fixed inset-x-4 top-1/3 z-30 tarjeta border-gauge-warn/50 p-4 space-y-3 max-w-sm mx-auto">
            <p className="text-sm font-semibold text-gauge-warn">Esta visita tiene datos sin guardar</p>
            <p className="text-xs text-slate-600">
              ¿Vas a seguir trabajando en el sitio? Pausa el registro para continuarlo después sin perder nada.
            </p>
            <div className="flex flex-col gap-2 pt-1">
              <button className="boton-secundario" onClick={() => blocker.reset?.()}>
                Seguir editando
              </button>
              <button
                className="rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-ok/50 text-gauge-ok hover:bg-gauge-ok/10 transition"
                onClick={() => pausarYSalir(() => blocker.proceed?.())}
              >
                ⏸ Pausar y continuar luego
              </button>
              <button
                className="rounded-lg px-4 py-2.5 text-sm font-medium border border-gauge-danger/50 text-gauge-danger hover:bg-gauge-danger/10 transition"
                onClick={() => descartarBorrador(() => blocker.proceed?.())}
              >
                Descartar y salir
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
