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

/** Horas decimales → "HH:MM" (permite pasar de 24, ej. 42.5 → "42:30", para el total del período). */
export function formatHoras(horas?: number | null): string {
  if (!horas || horas <= 0) return '00:00';
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

/**
 * Sugiere Mañana/Tarde/Extras para una fila según su horario, recortado contra la jornada normal
 * del trabajador (ej. 08:00-12:00/13:00-17:00):
 * - Con marcación completa de un bloque (mañana y/o tarde): cada uno se recorta contra su propia
 *   jornada de referencia, sin importar si el otro bloque tiene datos o no.
 * - Sin ninguna marcación de mediodía (solo entrada de la mañana y salida de la tarde, ej. 08:00 a
 *   17:00): el total sale de recortar esos dos extremos contra la jornada completa, menos 1 hora de
 *   almuerzo. Mañana/Tarde se reparten solo para mostrar en la tabla, usando el corte de la jornada
 *   (jornada_fin_manana) como límite.
 */
export function calcularHorasFila(fila: HorarioFila, jornada: JornadaReferencia) {
  const { entrada_manana, salida_manana, entrada_tarde, salida_tarde } = fila;
  const tieneManana = !!(entrada_manana && salida_manana);
  const tieneTarde = !!(entrada_tarde && salida_tarde);

  if (tieneManana || tieneTarde) {
    const manana = tieneManana
      ? horasRecortadas(entrada_manana!, salida_manana!, jornada.jornada_inicio_manana, jornada.jornada_fin_manana)
      : 0;
    const tarde = tieneTarde
      ? horasRecortadas(entrada_tarde!, salida_tarde!, jornada.jornada_inicio_tarde, jornada.jornada_fin_tarde)
      : 0;
    return { horas_manana: manana, horas_tarde: tarde, horas_extra: redondear2(manana + tarde) };
  }

  if (entrada_manana && salida_tarde) {
    const inicioEfectivo = Math.max(aMinutos(entrada_manana)!, aMinutos(jornada.jornada_inicio_manana)!);
    const finEfectivo = Math.min(aMinutos(salida_tarde)!, aMinutos(jornada.jornada_fin_tarde)!);
    const corte = aMinutos(jornada.jornada_fin_manana)!;
    const mananaBruto = Math.max(0, Math.min(finEfectivo, corte) - inicioEfectivo) / 60;
    const tardeBruto = Math.max(0, finEfectivo - Math.max(inicioEfectivo, corte)) / 60;
    // Se descuenta 1 hora de almuerzo (nadie marcó al mediodía, pero igual sale a almorzar):
    // se resta primero de la tarde y, si no alcanza, el resto de la mañana.
    const tarde = redondear2(Math.max(0, tardeBruto - 1));
    const manana = redondear2(Math.max(0, mananaBruto - Math.max(0, 1 - tardeBruto)));
    return { horas_manana: manana, horas_tarde: tarde, horas_extra: redondear2(manana + tarde) };
  }

  return { horas_manana: 0, horas_tarde: 0, horas_extra: 0 };
}

export function sumarHorasExtra(filas: Array<{ horas_extra?: number | null }>): number {
  return filas.reduce((acc, f) => acc + (f.horas_extra ?? 0), 0);
}

/** Inverso de formatHoras: "HH:MM" (o solo "HH") → horas decimales. Texto inválido/vacío → 0. */
export function parseHorasHHMM(texto: string): number {
  const match = texto.trim().match(/^(\d{1,3}):?(\d{0,2})$/);
  if (!match) return 0;
  const h = Number(match[1] || 0);
  const m = Math.min(59, Number(match[2] || 0));
  return redondear2(h + m / 60);
}
