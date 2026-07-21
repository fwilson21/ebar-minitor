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

/** "08:30" (o "08:30:00") → 510 minutos desde medianoche. Null/vacío → null. */
function aMinutos(hora?: string | null): number | null {
  if (!hora) return null;
  const [h, m] = hora.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

/** Diferencia en horas decimales entre dos horas "HH:MM". Negativa o inválida → 0. */
function diffHoras(inicio?: string | null, fin?: string | null): number {
  const a = aMinutos(inicio);
  const b = aMinutos(fin);
  if (a === null || b === null || b <= a) return 0;
  return (b - a) / 60;
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
 * Sugiere Mañana/Tarde/Extras para una fila según su horario:
 * - Con las 4 marcaciones (entrada/salida de mañana y tarde): resta directa de cada bloque.
 * - Sin marcación de mediodía (solo entrada de mañana y salida de tarde, ej. 08:00 a 17:00): el
 *   total sale de restar esas dos directamente; Mañana/Tarde se reparten solo para mostrar en la
 *   tabla, usando el corte de la jornada de referencia (jornada_fin_manana) como límite.
 */
export function calcularHorasFila(fila: HorarioFila, jornada: JornadaReferencia) {
  const { entrada_manana, salida_manana, entrada_tarde, salida_tarde } = fila;

  if (entrada_manana && salida_manana && entrada_tarde && salida_tarde) {
    const manana = diffHoras(entrada_manana, salida_manana);
    const tarde = diffHoras(entrada_tarde, salida_tarde);
    return { horas_manana: manana, horas_tarde: tarde, horas_extra: manana + tarde };
  }

  if (entrada_manana && salida_tarde && !salida_manana && !entrada_tarde) {
    const total = diffHoras(entrada_manana, salida_tarde);
    const manana = Math.max(0, Math.min(diffHoras(entrada_manana, jornada.jornada_fin_manana), total));
    const tarde = Math.max(0, total - manana);
    return { horas_manana: manana, horas_tarde: tarde, horas_extra: total };
  }

  return { horas_manana: 0, horas_tarde: 0, horas_extra: 0 };
}

export function sumarHorasExtra(filas: Array<{ horas_extra?: number | null }>): number {
  return filas.reduce((acc, f) => acc + (f.horas_extra ?? 0), 0);
}
