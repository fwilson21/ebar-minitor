// Tipos del dominio EBAR Monitor — deben coincidir con el esquema SQL (0001_init.sql)

export type UserRole = 'operador' | 'administrador' | 'supervisor';
export type ZonaTipo = 'urbana' | 'rural';
export type EstadoEstacion = 'operativa' | 'mantenimiento_correctivo' | 'fuera_de_servicio';
export type EstadoBomba = 'encendida' | 'apagada' | 'en_falla' | 'retirado_para_mantenimiento';
export type NivelTanque = 'alto' | 'medio' | 'bajo';
export type TipoEstacion = 'ebar' | 'linea_conduccion';

export interface Usuario {
  id: string;
  nombre_completo: string;
  telefono?: string | null;
  rol: UserRole;
  whatsapp_numero?: string | null;
  activo: boolean;
  firma_url?: string | null;
  device_id?: string | null;
  nombre_usuario?: string | null;
  cedula?: string | null;
  cargo?: string | null;
}

export interface AsignacionEstacion {
  id: string;
  operador_id: string;
  estacion_id: string;
  /** null = asignación por defecto (permanente); con valor = solo para ese día puntual. */
  fecha: string | null;
  /** Si vino de un turno de fin de semana/feriado (ver TurnoCalendario), su id. Null si se cargó a mano. */
  turno_id?: string | null;
}

export interface TurnoCalendario {
  id: string;
  operador_id: string;
  fecha: string;
  creado_por?: string | null;
  created_at?: string;
}

export interface EstacionEbar {
  id: string;
  codigo: string;
  nombre: string;
  zona: ZonaTipo;
  direccion?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  descripcion?: string | null;
  foto_url?: string | null;
  numero_bombas: number;
  estado_actual: EstadoEstacion;
  activa: boolean;
  tipo: TipoEstacion;
}

export interface PlanillaHorasExtras {
  id: string;
  operador_id?: string | null;
  nombre_trabajador: string;
  cargo_trabajador: string;
  direccion: string;
  area: string;
  fecha_presentacion?: string | null;
  fecha_desde: string;
  fecha_hasta: string;
  jornada_inicio_manana: string;
  jornada_fin_manana: string;
  jornada_inicio_tarde: string;
  jornada_fin_tarde: string;
  revisado_nombre: string;
  revisado_cargo: string;
  aprobado_nombre: string;
  aprobado_cargo: string;
  creado_por?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ConfiguracionPlanillaHorasExtras {
  revisado_nombre: string;
  revisado_cargo: string;
  aprobado_nombre: string;
  aprobado_cargo: string;
}

export interface FilaPlanillaHorasExtras {
  id: string;
  planilla_id: string;
  fecha: string;
  descripcion_actividades?: string | null;
  numero_memorando?: string | null;
  entrada_manana?: string | null;
  salida_manana?: string | null;
  entrada_tarde?: string | null;
  salida_tarde?: string | null;
  horas_manana?: number | null;
  horas_tarde?: number | null;
  horas_extra?: number | null;
}

export interface Bomba {
  id: string;
  estacion_id: string;
  numero_bomba: number;
  marca?: string | null;
  modelo?: string | null;
  potencia_hp?: number | null;
  voltaje_nominal?: number | null;
  amperaje_nominal?: number | null;
  activa: boolean;
  custodio?: string | null;
  codigo_sigame?: string | null;
}

export interface RegistroBombaInput {
  bomba_id: string;
  numero_bomba: number;
  estado: EstadoBomba | '';
  voltaje?: number | null;
  amperaje?: number | null;
  horas_operacion_acumuladas?: number | null;
  observaciones?: string | null;
  custodio?: string | null;
  codigo_sigame?: string | null;
  fotos: FotoLocal[];
}

export interface VisitaInput {
  id?: string; // presente cuando viene de la cola offline (cliente_uuid)
  cliente_uuid: string;
  estacion_id: string;
  operador_id: string;
  fecha_hora_llegada: string; // ISO
  fecha_hora_salida?: string | null;
  estado_estacion: EstadoEstacion;
  nivel_tanque: NivelTanque;
  olores_anormales: boolean;
  olores_descripcion?: string | null;
  ruidos_extranos: boolean;
  ruidos_descripcion?: string | null;
  cerramiento_ok: boolean;
  cerramiento_observaciones?: string | null;
  cerramiento_seguridad?: RegistroEquipo | null;
  jardineras_observaciones?: string | null;
  jardineras?: RegistroEquipo | null;
  patios_maniobras_observaciones?: string | null;
  patios_maniobras?: RegistroEquipo | null;
  observaciones_generales?: string | null;
  bombas: RegistroBombaInput[];
  fotos: FotoLocal[];
  lineas_impulsion?: RegistroEquipo | null;
  guias_izado?: RegistroEquipo | null;
  valvulas_compuerta?: RegistroEquipo | null;
  valvulas_check?: RegistroEquipo | null;
  valvula_aire?: RegistroEquipo | null;
  camara_rejilla?: RegistroEquipo | null;
  camara_valvula_compuerta?: RegistroEquipo | null;
  tablero_distribucion?: RegistroEquipo | null;
  variador?: RegistroEquipo | null;
  descarga_emergencia?: RegistroEquipo | null;
  tuberia_400_valvulas_aire?: RegistroEquipo | null;
  tuberia_400_uniones_elastomericas?: RegistroEquipo | null;
  tuberia_600_valvulas_aire?: RegistroEquipo | null;
  tuberia_600_uniones_elastomericas?: RegistroEquipo | null;
}

export interface FotoLocal {
  id: string;            // uuid generado en cliente
  blob?: Blob;           // dato binario mientras está pendiente de subir
  descripcion?: string;
  tomada_en: string;
  estado_subida: 'pendiente' | 'subiendo' | 'subida' | 'error';
  drive_file_id?: string;
  url_publica?: string;
}

export type EstadoEquipo = 'operativo' | 'en_falla' | 'requiere_mantenimiento';

export interface RegistroEquipo {
  estado: EstadoEquipo | '';
  observaciones?: string | null;
  fotos: FotoLocal[];
  /** Números de unidad afectados por el estado elegido (ej. válvula de compuerta 2 y 4 en falla). */
  numeros_afectados?: number[] | null;
  /** Para equipos opcionales (ej. Descarga de emergencia): si la estación cuenta con ese equipo. */
  tiene?: boolean | null;
}

export interface DashboardResumen {
  fecha: string;
  total_visitas: number;
  estaciones_con_problemas: number;
  alertas_voltaje: number;
  estaciones_sin_visitar: number;
  equipos_con_alerta: number;
}

// Rango de voltaje aceptable usado para resaltar alertas en la UI.
// Debe reflejar el mismo umbral usado en la columna generada `voltaje_fuera_rango` del SQL.
export const VOLTAJE_MIN = 200;
export const VOLTAJE_MAX = 240;
