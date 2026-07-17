import { useEffect, useRef, useState } from 'react';
import { useBlocker, useNavigate, useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import {
  encolarEdicionVisita, encolarVisita, sincronizarPendientes,
  guardarBorradorVisita, obtenerBorradorVisita, eliminarBorradorVisita,
} from '../lib/offline';
import { esMismoDia, formatearFechaHoraFoto, urlMiniaturaDrive } from '../lib/fotos';
import { useAutoResizeTextarea } from '../lib/useAutoResizeTextarea';
import { distanciaMetros, useUbicacionActual } from '../lib/useUbicacion';
import { PumpForm } from '../components/PumpForm';
import { PhotoCapture } from '../components/PhotoCapture';
import { EquipoSection } from '../components/EquipoSection';
import { BotonDictado } from '../components/BotonDictado';
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
  const { usuario } = useAuth();
  const navigate = useNavigate();
  const modoEdicion = !!visitaId;

  const [estacion, setEstacion] = useState<EstacionEbar | null>(null);
  const [bombas, setBombas] = useState<Bomba[]>([]);
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
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  const [pasoConfirmacion, setPasoConfirmacion] = useState<0 | 1 | 2>(0);
  const guardadoRef = useRef(false);
  const esLineaConduccion = estacion?.tipo === 'linea_conduccion';

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
    if (esLineaConduccion) return [];
    const lista: string[] = [];
    for (const b of Object.values(registrosBombas)) {
      if (!bombasSeleccionadas.has(b.bomba_id)) continue;
      if (b.estado === 'encendida') {
        if (b.voltaje == null) lista.push(`Bomba ${b.numero_bomba}: voltaje no ingresado`);
        if (b.amperaje == null) lista.push(`Bomba ${b.numero_bomba}: amperaje no ingresado`);
      }
    }
    if (estadoEstacion !== 'operativa' && !observaciones.trim()) {
      lista.push('Estación con problemas: agrega observaciones generales');
    }
    return lista;
  }

  useEffect(() => {
    const intervalo = setInterval(() => setAhora(Date.now()), 1000);
    return () => clearInterval(intervalo);
  }, []);

  const tiempoEnSitio = formatearDuracion(ahora - new Date(horaLlegada).getTime());

  function manejarClickGuardar() {
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
      setEstacion(est as EstacionEbar);
      const lista = (bombasData as Bomba[]) ?? [];
      setBombas(lista);

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

  async function manejarGuardar() {
    if (!estacion || !usuario) return;

    if (!esLineaConduccion && estadoEstacion === '') {
      setMensaje('Selecciona el estado general de la estación antes de guardar.');
      return;
    }

    if (!esLineaConduccion && nivelTanque === '') {
      setMensaje('Selecciona el nivel del tanque de almacenamiento antes de guardar.');
      return;
    }

    if (!esLineaConduccion) {
      const bombaSinEstado = Object.values(registrosBombas).find(
        (b) => bombasSeleccionadas.has(b.bomba_id) && b.estado === '',
      );
      if (bombaSinEstado) {
        setMensaje(`Selecciona el estado de la bomba ${bombaSinEstado.numero_bomba} antes de guardar.`);
        return;
      }

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

    const equiposActivos: Array<{ titulo: string; valor: RegistroEquipo }> = esLineaConduccion
      ? [
          { titulo: 'Tubería 400mm — Válvulas de aire', valor: tuberia400ValvulasAire },
          { titulo: 'Tubería 400mm — Uniones elastoméricas', valor: tuberia400Uniones },
          { titulo: 'Tubería 600mm — Válvulas de aire', valor: tuberia600ValvulasAire },
          { titulo: 'Tubería 600mm — Uniones elastoméricas', valor: tuberia600Uniones },
        ]
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
      setMensaje(`Selecciona el estado de "${equipoSinEstado.titulo}" antes de guardar.`);
      return;
    }

    if (!esLineaConduccion && descargaEmergencia.tiene == null) {
      setMensaje('Indica si la estación tiene descarga de emergencia antes de guardar.');
      return;
    }

    if (!esLineaConduccion && valvulaAire.tiene == null) {
      setMensaje('Indica si la estación tiene válvula de aire antes de guardar.');
      return;
    }

    if (!esLineaConduccion && camaraValvulaCompuerta.tiene == null) {
      setMensaje('Indica si la cámara de llegada tiene compuerta antes de guardar.');
      return;
    }

    if (!esLineaConduccion && variador.tiene == null) {
      setMensaje('Indica si la estación tiene variadores de frecuencia antes de guardar.');
      return;
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
      cliente_uuid: crypto.randomUUID(),
      estacion_id: estacion.id,
      operador_id: usuario.id,
      fecha_hora_llegada: horaLlegada,
      fecha_hora_salida: modoEdicion ? fechaSalidaOriginal : new Date().toISOString(),
      estado_estacion: estadoDerivado,
      nivel_tanque: esLineaConduccion ? 'medio' : (nivelTanque as NivelTanque),
      olores_anormales: false,
      olores_descripcion: null,
      ruidos_extranos: false,
      ruidos_descripcion: null,
      cerramiento_ok: true,
      cerramiento_observaciones: esLineaConduccion ? null : (cerramientoSeguridad.observaciones || null),
      cerramiento_seguridad: esLineaConduccion ? null : cerramientoSeguridad,
      jardineras_observaciones: esLineaConduccion ? null : (jardineras.observaciones || null),
      jardineras: esLineaConduccion ? null : jardineras,
      patios_maniobras_observaciones: esLineaConduccion ? null : (patiosManiobras.observaciones || null),
      patios_maniobras: esLineaConduccion ? null : patiosManiobras,
      observaciones_generales: esLineaConduccion ? null : observaciones || null,
      bombas: esLineaConduccion
        ? []
        : Object.values(registrosBombas).filter((b) => bombasSeleccionadas.has(b.bomba_id)),
      fotos: esLineaConduccion ? [] : fotos,
      lineas_impulsion: esLineaConduccion ? null : lineasImpulsion,
      guias_izado: esLineaConduccion ? null : guiasIzado,
      valvulas_compuerta: esLineaConduccion ? null : valvulasCompuerta,
      valvulas_check: esLineaConduccion ? null : valvulasCheck,
      valvula_aire: esLineaConduccion ? null : valvulaAire,
      camara_rejilla: esLineaConduccion ? null : camaraRejilla,
      camara_valvula_compuerta: esLineaConduccion ? null : camaraValvulaCompuerta,
      tablero_distribucion: esLineaConduccion ? null : tableroDistribucion,
      variador: esLineaConduccion ? null : variador,
      descarga_emergencia: esLineaConduccion ? null : descargaEmergencia,
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
      if (modoEdicion && visitaId) await encolarEdicionVisita(visitaId, payload);
      else await encolarVisita(payload);
      guardadoRef.current = true;
      await eliminarBorradorVisita(claveBorrador());
      setMensaje('Sin conexión estable: los cambios se guardaron en el dispositivo y se sincronizarán automáticamente.');
      setTimeout(() => navigate(`/estaciones/${estacion.id}`), 1500);
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
  const distanciaEfectiva =
    requiereUbicacion && ubicacion.tipo === 'ok'
      ? Math.max(0, distanciaMetros(ubicacion.lat, ubicacion.lon, estacion!.latitud!, estacion!.longitud!) - ubicacion.precision)
      : null;
  // Mientras el GPS todavía no da su primera lectura no se bloquea (se trata como una carga
  // normal, sin mostrar el aviso) — así se evita el falso "no estás en el sitio" mientras el
  // celular sigue ubicándose, sobre todo en EBAR sin señal de datos donde tarda más.
  const bloqueadoPorUbicacion =
    requiereUbicacion &&
    (ubicacion.tipo === 'error' || (ubicacion.tipo === 'ok' && distanciaEfectiva! > DISTANCIA_MAXIMA_METROS));
  const ubicandoAun = requiereUbicacion && ubicacion.tipo === 'buscando';

  if (!estacion || cargandoDatos || ubicandoAun) return <p className="text-slate-400">Cargando…</p>;

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
        <p className="text-sm text-slate-300">
          No es posible registrar esta visita porque no te encuentras en las instalaciones de la estación EBAR.
        </p>
        <button
          type="button"
          className="text-xs text-slate-400 hover:text-slate-100 underline"
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
          <h1 className="text-xl font-bold uppercase tracking-wide">{modoEdicion ? 'Editar visita' : 'Nueva visita'}</h1>
          <p className="text-sm text-slate-400">{estacion.nombre} · {estacion.codigo}</p>
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
          <button
            type="button"
            className="text-xs text-slate-400 hover:text-slate-100 underline mt-1"
            onClick={() => pausarYSalir(() => navigate(`/estaciones/${estacionId}`))}
          >
            ⏸ Pausar y continuar luego
          </button>
        </div>
      </div>

      {esLineaConduccion ? (
        <>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-200 mb-2">Tubería de impulsión de 400mm</h2>
            <div className="space-y-3">
              <EquipoSection titulo="Válvulas de aire" valor={tuberia400ValvulasAire} onChange={setTuberia400ValvulasAire} />
              <EquipoSection titulo="Uniones elastoméricas" valor={tuberia400Uniones} onChange={setTuberia400Uniones} />
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-200 mb-2">Tubería de impulsión de 600mm</h2>
            <div className="space-y-3">
              <EquipoSection titulo="Válvulas de aire" valor={tuberia600ValvulasAire} onChange={setTuberia600ValvulasAire} />
              <EquipoSection titulo="Uniones elastoméricas" valor={tuberia600Uniones} onChange={setTuberia600Uniones} />
            </div>
          </div>
        </>
      ) : (
        <>
          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-200 mb-2">Estado general de la estación</h2>
            <div className="tarjeta p-4 space-y-3">
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-200">Estado</h3>

                <div className="flex gap-2">
                  {ESTADOS_ESTACION.map((e) => (
                    <button
                      key={e.value}
                      type="button"
                      onClick={() => setEstadoEstacion(estadoEstacion === e.value ? '' : e.value)}
                      className={`flex-1 rounded-lg px-2 py-2 text-xs border transition ${
                        estadoEstacion === e.value ? e.claseActiva : 'bg-panel-900 border-panel-600 text-slate-300'
                      }`}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>

                <div>
                  <label className="etiqueta">Nivel de tanque de almacenamiento</label>
                  <div className="flex gap-2">
                    {(['alto', 'medio', 'bajo'] as NivelTanque[]).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setNivelTanque(nivelTanque === n ? '' : n)}
                        className={`flex-1 rounded-lg px-3 py-2 text-sm border capitalize ${
                          nivelTanque === n ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-300'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

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
            </div>
          </div>

          <div>
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-200 mb-2">Bombas</h2>
            <div className="space-y-3">
              {bombas.length > 1 && (
                <div className="tarjeta p-4 space-y-2">
                  <h3 className="text-base font-bold uppercase tracking-wide text-slate-200">Bombas a reportar hoy</h3>
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
                            activa ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'bg-panel-900 border-panel-600 text-slate-400'
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
            <h2 className="text-lg font-bold uppercase tracking-wide text-slate-200 mb-2">Estado de equipos</h2>
            <div className="space-y-3">
              <div className="tarjeta p-4 space-y-3">
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-200">Líneas de impulsión y guías de izado de bombas</h3>
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
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-200">Válvulas</h3>
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
                <h3 className="text-base font-bold uppercase tracking-wide text-slate-200">Cámara de llegada al cárcamo de bombeo</h3>
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

      {mensaje && <p className="text-sm text-gauge-ok">{mensaje}</p>}

      {pasoConfirmacion === 0 && (
        <button onClick={manejarClickGuardar} disabled={guardando} className="boton-primario w-full">
          {guardando ? 'Guardando…' : modoEdicion ? 'Guardar cambios' : 'Guardar visita'}
        </button>
      )}

      {pasoConfirmacion === 1 && (
        <div className="tarjeta border-gauge-warn/50 p-4 space-y-3">
          <p className="text-sm font-semibold text-gauge-warn">Campos incompletos</p>
          <ul className="space-y-1">
            {errores.map((e) => (
              <li key={e} className="text-xs text-slate-300 flex gap-2">
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
          <p className="text-xs text-slate-400">
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
            <p className="text-xs text-slate-400">
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
                onClick={() => blocker.proceed?.()}
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
