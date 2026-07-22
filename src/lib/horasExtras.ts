// Cálculo de horas para la Planilla de horas extras. Las horas "Mañana"/"Tarde"/"Extras" se
// sugieren automáticamente a partir del horario marcado, pero siempre quedan editables porque en
// la práctica no siempre coinciden con la resta exacta del reloj (dependen de lo que autorice el
// memorando) — ver PanelPlanillaHorasExtras.tsx.

export interface JornadaReferencia {
  jornada_inicio_manana: string;
  jornada_fin_manana: string;
  jornada_inicio_tarde: string;
  jornada_fin_tarde: string;
}

export interface HorarioFila {
  entrada_manana?: string | null;
  salida_manana?: string | null;
  entrada_tarde?: string | null;
  salida_tarde?: string | null;
}

/** Redondea a 2 decimales — evita el ruido de coma flotante de dividir minutos entre 60
 * (ej. 230/60 = 3.8333333333333335), que se veía feo en los campos numéricos de la tabla. */
function redondear2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "08:30" (o "08:30:00") → 510 minutos desde medianoche. Null/vacío → null. */
function aMinutos(hora?: string | null): number | null {
  if (!hora) return null;
  const [h, m] = hora.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Horas decimales → "HH:MM" (permite pasar de 24, ej. 42.5 → "42:30", para el total del período).
 * null/undefined (bloque sin dato, no se sabe cuánto es) → "-", distinto de 0 (se sabe que fue cero). */
export function formatHoras(horas?: number | null): string {
  if (horas === null || horas === undefined) return '-';
  if (horas <= 0) return '00:00';
  const totalMinutos = Math.round(horas * 60);
  const h = Math.floor(totalMinutos / 60);
  const m = totalMinutos % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Horas de un bloque (mañana o tarde) recortadas contra su jornada de referencia: si la marcación
 * de entrada es más temprano que la jornada, no cuenta (se toma la hora de la jornada); si es más
 * tarde, se descuenta (se toma la hora marcada). Simétrico para la salida: si es más tarde que la
 * jornada no cuenta de más, si es más temprano se descuenta. Negativo → 0.
 */
function horasRecortadas(entrada: string, salida: string, refInicio: string, refFin: string): number {
  const inicioEfectivo = Math.max(aMinutos(entrada)!, aMinutos(refInicio)!);
  const finEfectivo = Math.min(aMinutos(salida)!, aMinutos(refFin)!);
  return redondear2(Math.max(0, finEfectivo - inicioEfectivo) / 60);
}

/** Duración de un bloque completo de la jornada de referencia (ej. 08:00 a 12:00 → 4 horas). */
function duracionJornada(inicio: string, fin: string): number {
  return redondear2(Math.max(0, aMinutos(fin)! - aMinutos(inicio)!) / 60);
}

/** Valida que Entrada/Sale de mañana y tarde vayan en orden ascendente a lo largo del día
 * (entra mañana < sale mañana <= entra tarde < sale tarde). null si no hay ningún problema. */
export function validarOrdenHorario(fila: HorarioFila): string | null {
  const { entrada_manana, salida_manana, entrada_tarde, salida_tarde } = fila;
  if (entrada_manana && salida_manana && salida_manana <= entrada_manana) {
    return 'La salida de la mañana debe ser después de la entrada.';
  }
  if (entrada_tarde && salida_tarde && salida_tarde <= entrada_tarde) {
    return 'La salida de la tarde debe ser después de la entrada.';
  }
  if (salida_manana && entrada_tarde && entrada_tarde < salida_manana) {
    return 'La entrada de la tarde no puede ser antes de la salida de la mañana.';
  }
  return null;
}

const TOLERANCIA_ALMUERZO_MIN = 15;

export interface AvisoAlmuerzo {
  mensaje: string;
  salidaManana: boolean;
  entradaTarde: boolean;
}

/**
 * Avisa (sin bloquear) cuando la salida a almorzar o el regreso se alejan bastante de la jornada
 * normal (jornada_fin_manana / jornada_inicio_tarde) — con más de 15 minutos de diferencia —, aunque
 * el orden de las horas sea válido, para que el operador confirme que no es un error de tipeo antes
 * de dar por buena una fila con un almuerzo mucho más largo de lo normal.
 */
export function avisoAlmuerzoLargo(fila: HorarioFila, jornada: JornadaReferencia): AvisoAlmuerzo | null {
  const { salida_manana, entrada_tarde } = fila;
  const finManana = aMinutos(jornada.jornada_fin_manana)!;
  const inicioTarde = aMinutos(jornada.jornada_inicio_tarde)!;

  const salidaTardia = !!salida_manana && aMinutos(salida_manana)! > finManana + TOLERANCIA_ALMUERZO_MIN;
  const entradaTardia = !!entrada_tarde && aMinutos(entrada_tarde)! > inicioTarde + TOLERANCIA_ALMUERZO_MIN;
  if (!salidaTardia && !entradaTardia) return null;

  const partes: string[] = [];
  if (salidaTardia) partes.push(`salió a almorzar a las ${salida_manana} (jornada: ${jornada.jornada_fin_manana})`);
  if (entradaTardia) partes.push(`volvió a las ${entrada_tarde} (jornada: ${jornada.jornada_inicio_tarde})`);
  return {
    mensaje: `Almuerzo más largo de lo normal: ${partes.join(' y ')}. Revisa que esté bien.`,
    salidaManana: salidaTardia,
    entradaTarde: entradaTardia,
  };
}

export interface ResultadoHoras {
  horas_manana: number | null;
  horas_tarde: number | null;
  horas_extra: number;
  /** true si ese bloque no tiene sus dos marcaciones y su valor es una suposición (jornada normal
   * completa) en vez de un cálculo real — ver PanelPlanillaHorasExtras.tsx: en ese caso no se aplica
   * solo, se le pide confirmación al operador ("Calcular igual"). */
  manana_asumida: boolean;
  tarde_asumida: boolean;
}

/**
 * Sugiere Mañana/Tarde/Extras para una fila según su horario, recortado contra la jornada normal
 * del trabajador (ej. 08:00-12:00/13:00-17:00):
 * - Con marcación completa de un bloque (mañana y/o tarde): se recorta contra su propia jornada de
 *   referencia.
 * - Si el otro bloque quedó a medias (solo entrada o solo salida, ej. no marcó la salida a
 *   almorzar): no se sabe su hora exacta, así que se asume la jornada normal completa de ese bloque
 *   (ej. 4 horas) y se suma al bloque que sí está completo — y viceversa. Ese bloque queda marcado
 *   como "asumido".
 * - Si el otro bloque no tiene ningún dato: queda en null (se muestra como "-"), sin sumar nada.
 * - Sin ninguna marcación de mediodía (solo entrada de la mañana y salida de la tarde, ej. 08:00 a
 *   17:00): no se sabe cuánto corresponde a mañana y cuánto a tarde, así que no se reparte — Mañana
 *   y Tarde quedan en null y el total (recortando esos dos extremos contra la jornada completa,
 *   menos 1 hora de almuerzo) va solo en Extras.
 */
export function calcularHorasFila(fila: HorarioFila, jornada: JornadaReferencia): ResultadoHoras {
  const { entrada_manana, salida_manana, entrada_tarde, salida_tarde } = fila;
  const tieneManana = !!(entrada_manana && salida_manana);
  const tieneTarde = !!(entrada_tarde && salida_tarde);
  const algoManana = !!(entrada_manana || salida_manana);
  const algoTarde = !!(entrada_tarde || salida_tarde);

  if (tieneManana || tieneTarde) {
    let manana: number | null = null;
    let mananaAsumida = false;
    if (tieneManana) {
      manana = horasRecortadas(entrada_manana!, salida_manana!, jornada.jornada_inicio_manana, jornada.jornada_fin_manana);
    } else if (tieneTarde && algoManana) {
      manana = duracionJornada(jornada.jornada_inicio_manana, jornada.jornada_fin_manana);
      mananaAsumida = true;
    }

    let tarde: number | null = null;
    let tardeAsumida = false;
    if (tieneTarde) {
      tarde = horasRecortadas(entrada_tarde!, salida_tarde!, jornada.jornada_inicio_tarde, jornada.jornada_fin_tarde);
    } else if (tieneManana && algoTarde) {
      tarde = duracionJornada(jornada.jornada_inicio_tarde, jornada.jornada_fin_tarde);
      tardeAsumida = true;
    }

    return {
      horas_manana: manana,
      horas_tarde: tarde,
      horas_extra: redondear2((manana ?? 0) + (tarde ?? 0)),
      manana_asumida: mananaAsumida,
      tarde_asumida: tardeAsumida,
    };
  }

  if (entrada_manana && salida_tarde) {
    const inicioEfectivo = Math.max(aMinutos(entrada_manana)!, aMinutos(jornada.jornada_inicio_manana)!);
    const finEfectivo = Math.min(aMinutos(salida_tarde)!, aMinutos(jornada.jornada_fin_tarde)!);
    // Se descuenta 1 hora de almuerzo (nadie marcó al mediodía, pero igual sale a almorzar).
    // No se sabe cuánto de eso es mañana y cuánto es tarde, así que el total va directo a Extras.
    const total = redondear2(Math.max(0, (finEfectivo - inicioEfectivo) / 60 - 1));
    return { horas_manana: null, horas_tarde: null, horas_extra: total, manana_asumida: false, tarde_asumida: false };
  }

  return { horas_manana: null, horas_tarde: null, horas_extra: 0, manana_asumida: false, tarde_asumida: false };
}

export function sumarHorasExtra(filas: Array<{ horas_extra?: number | null }>): number {
  return filas.reduce((acc, f) => acc + (f.horas_extra ?? 0), 0);
}

/** Inverso de formatHoras: "HH:MM" (o solo "HH") → horas decimales. Vacío o "-" → null (sin dato,
 * como lo muestra formatHoras). Cualquier otro texto inválido → 0. */
export function parseHorasHHMM(texto: string): number | null {
  const limpio = texto.trim();
  if (limpio === '' || limpio === '-') return null;
  const match = limpio.match(/^(\d{1,3}):?(\d{0,2})$/);
  if (!match) return 0;
  const h = Number(match[1] || 0);
  const m = Math.min(59, Number(match[2] || 0));
  return redondear2(h + m / 60);
}
