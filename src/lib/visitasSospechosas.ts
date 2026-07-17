import { distanciaMetros } from './useUbicacion';

// Si un mismo operador registra dos visitas en estaciones distintas y la distancia entre ellas
// exigiría viajar a más de esta velocidad promedio, se marca como sospechosa (no se bloquea nada,
// es una señal para que el supervisor la revise). 80 km/h es generoso a propósito — son estaciones
// dentro de un mismo municipio, no viajes entre ciudades — para no generar falsas alarmas por
// tráfico/rutas indirectas.
const VELOCIDAD_MAXIMA_PLAUSIBLE_KMH = 80;

export type VisitaParaChequeo = {
  id: string;
  operador_id: string;
  operador_nombre: string;
  estacion_id: string;
  estacion_nombre: string;
  fecha_hora_llegada: string;
  lat: number | null;
  lon: number | null;
};

export type ParSospechoso = {
  operador_nombre: string;
  visitaAnterior: VisitaParaChequeo;
  visitaSiguiente: VisitaParaChequeo;
  minutos: number;
  km: number;
  velocidadKmh: number;
};

/** Compara visitas consecutivas de un mismo operador en estaciones distintas y marca las que
 * exigirían una velocidad de traslado implausible entre una y otra. Requiere que ambas
 * estaciones tengan coordenadas cargadas (si falta alguna, ese par se omite, no se puede evaluar). */
export function detectarVisitasSospechosas(visitas: VisitaParaChequeo[]): ParSospechoso[] {
  const porOperador = new Map<string, VisitaParaChequeo[]>();
  for (const v of visitas) {
    if (v.lat == null || v.lon == null) continue;
    const lista = porOperador.get(v.operador_id) ?? [];
    lista.push(v);
    porOperador.set(v.operador_id, lista);
  }

  const resultado: ParSospechoso[] = [];
  for (const lista of porOperador.values()) {
    lista.sort((a, b) => new Date(a.fecha_hora_llegada).getTime() - new Date(b.fecha_hora_llegada).getTime());
    for (let i = 1; i < lista.length; i++) {
      const anterior = lista[i - 1];
      const siguiente = lista[i];
      if (anterior.estacion_id === siguiente.estacion_id) continue;

      const minutos =
        (new Date(siguiente.fecha_hora_llegada).getTime() - new Date(anterior.fecha_hora_llegada).getTime()) / 60000;
      const km = distanciaMetros(anterior.lat!, anterior.lon!, siguiente.lat!, siguiente.lon!) / 1000;
      // Piso de 1 minuto para el cálculo: evita dividir por ~0 en visitas casi simultáneas (esos
      // casos ya son sospechosos de por sí, con cualquier distancia apreciable entre estaciones).
      const velocidadKmh = km / (Math.max(minutos, 1) / 60);

      if (velocidadKmh > VELOCIDAD_MAXIMA_PLAUSIBLE_KMH) {
        resultado.push({
          operador_nombre: siguiente.operador_nombre,
          visitaAnterior: anterior,
          visitaSiguiente: siguiente,
          minutos,
          km,
          velocidadKmh,
        });
      }
    }
  }
  return resultado;
}
