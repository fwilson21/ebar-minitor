// Tipos del dominio EBAR Monitor — deben coincidir con el esquema SQL (0001_init.sql)

export type UserRole = 'operador' | 'administrador' | 'supervisor';
export type ZonaTipo = 'urbana' | 'rural';
export type EstadoEstacion = 'operativa' | 'mantenimiento_correctivo' | 'fuera_de_servicio';
export type EstadoBomba = 'encendida' | 'apagada' | 'en_reposo';
export type NivelTanque = 'alto' | 'medio' | 'bajo';

export interface Usuario {
  id: string;
  nombre_completo: string;
  telefono?: string | null;
  rol: UserRole;
  whatsapp_numero?: string | null;
  activo: boolean;
  firma_url?: string | null;
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
}

export interface RegistroBombaInput {
  bomba_id: string;
  numero_bomba: number;
  estado: EstadoBomba;
  voltaje?: number | null;
  amperaje?: number | null;
  horas_operacion_acumuladas?: number | null;
  observaciones?: string | null;
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
  observaciones_generales?: string | null;
  bombas: RegistroBombaInput[];
  fotos: FotoLocal[];
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

export interface DashboardResumen {
  fecha: string;
  total_visitas: number;
  estaciones_con_problemas: number;
  alertas_voltaje: number;
  estaciones_sin_visitar: number;
}

// Rango de voltaje aceptable usado para resaltar alertas en la UI.
// Debe reflejar el mismo umbral usado en la columna generada `voltaje_fuera_rango` del SQL.
export const VOLTAJE_MIN = 200;
export const VOLTAJE_MAX = 240;
