// Calendario de feriados de Ecuador (nacionales) + los 2 locales del cantón/provincia de
// Orellana, calculado automáticamente. Se usa para exceptuar el mínimo de 2 visitas diarias
// (además de sábados/domingos, que se detectan aparte por día de la semana).
//
// Fuente de la regla de traslado (Ley Orgánica reformatoria al Código del Trabajo, R.O. 906,
// 2016-12-20): si el feriado cae martes se traslada al lunes anterior; si cae miércoles o
// jueves, se traslada al viernes de esa semana; si cae sábado, al viernes anterior; si cae
// domingo, al lunes siguiente; si cae viernes o lunes, no se traslada. Año Nuevo (1-ene),
// Navidad (25-dic) y Martes de Carnaval NUNCA se trasladan.
//
// Día de los Difuntos (2-nov) e Independencia de Cuenca (3-nov) SIEMPRE caen pegados, así que se
// tratan como un BLOQUE de 2 días seguidos que se mueve entero hacia el fin de semana más cercano
// (ver `bloqueNoviembre`) — antes cada uno se trasladaba por separado y en 2026 (lunes 2 / martes
// 3) el martes 3 se "trasladaba" al lunes 2 y el 3 de noviembre desaparecía del calendario
// (reportado por el usuario 2026-09-30). Resultados que coinciden con los calendarios oficiales:
// 2023 jue 2 + vie 3, 2024 vie 1 + lun 4, 2025 lun 3 + mar 4, 2026 lun 2 + mar 3. Si algún año la
// resolución oficial difiere, para eso está la pantalla de "Feriados adicionales", donde el
// administrador/supervisor puede agregar o corregir una fecha puntual.

const NUNCA_TRASLADABLES = new Set(['01-01', '12-25']); // MM-DD

interface FeriadoBase {
  mes: number; // 1-12
  dia: number;
  nombre: string;
  trasladable: boolean;
}

const FERIADOS_FIJOS: FeriadoBase[] = [
  { mes: 1, dia: 1, nombre: 'Año Nuevo', trasladable: false },
  { mes: 4, dia: 30, nombre: 'Cantonización de Francisco de Orellana', trasladable: true },
  { mes: 5, dia: 1, nombre: 'Día del Trabajo', trasladable: true },
  { mes: 5, dia: 24, nombre: 'Batalla de Pichincha', trasladable: true },
  { mes: 7, dia: 30, nombre: 'Provincialización de Orellana', trasladable: true },
  { mes: 8, dia: 10, nombre: 'Primer Grito de Independencia', trasladable: true },
  { mes: 10, dia: 9, nombre: 'Independencia de Guayaquil', trasladable: true },
  { mes: 12, dia: 25, nombre: 'Navidad', trasladable: false },
];

function sumarDias(fecha: Date, dias: number): Date {
  const copia = new Date(fecha);
  copia.setDate(copia.getDate() + dias);
  return copia;
}

function aIso(fecha: Date): string {
  return fecha.toISOString().slice(0, 10);
}

/** Algoritmo del Domingo de Pascua (Anonymous Gregorian / Meeus). */
function domingoPascua(anio: number): Date {
  const a = anio % 19;
  const b = Math.floor(anio / 100);
  const c = anio % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(anio, mes - 1, dia);
}

/** Traslada un feriado según la regla de un solo día (ver nota de cabecera). */
function trasladar(fecha: Date): Date {
  const diaSemana = fecha.getDay(); // 0=domingo … 6=sábado
  if (diaSemana === 2) return sumarDias(fecha, -1); // martes → lunes anterior
  if (diaSemana === 3) return sumarDias(fecha, 2); // miércoles → viernes
  if (diaSemana === 4) return sumarDias(fecha, 1); // jueves → viernes
  if (diaSemana === 6) return sumarDias(fecha, -1); // sábado → viernes anterior
  if (diaSemana === 0) return sumarDias(fecha, 1); // domingo → lunes siguiente
  return fecha; // viernes o lunes: sin traslado
}

/** Fechas finales del bloque 2-nov (Difuntos) + 3-nov (Independencia de Cuenca), según el día de
 * la semana en que cae el 2-nov — ver nota de cabecera. */
function bloqueNoviembre(anio: number): [Date, Date] {
  const difuntos = new Date(anio, 10, 2);
  const cuenca = new Date(anio, 10, 3);
  switch (difuntos.getDay()) {
    case 2: // mar/mié → lun/mar
      return [sumarDias(difuntos, -1), sumarDias(cuenca, -1)];
    case 3: // mié/jue → jue/vie
      return [sumarDias(difuntos, 1), sumarDias(cuenca, 1)];
    case 5: // vie/sáb → jue/vie
      return [sumarDias(difuntos, -1), sumarDias(cuenca, -1)];
    case 6: // sáb/dom → vie/lun
      return [sumarDias(difuntos, -1), sumarDias(cuenca, 1)];
    case 0: // dom/lun → lun/mar
      return [sumarDias(difuntos, 1), sumarDias(cuenca, 1)];
    default: // lun/mar y jue/vie ya quedan pegados a un fin de semana: sin traslado
      return [difuntos, cuenca];
  }
}

/** Calcula el calendario de feriados (fecha ISO → nombre(s)) para un año dado. Cuando dos
 * feriados distintos se trasladan al mismo día (pasa, ej. en 2026 con Cantonización + Día del
 * Trabajo), se acumulan ambos nombres en vez de que uno pise al otro. */
export function calcularFeriados(anio: number): Map<string, string[]> {
  const mapa = new Map<string, string[]>();
  const agregar = (fecha: Date, nombre: string) => {
    const clave = aIso(fecha);
    mapa.set(clave, [...(mapa.get(clave) ?? []), nombre]);
  };

  for (const f of FERIADOS_FIJOS) {
    const original = new Date(anio, f.mes - 1, f.dia);
    const claveMD = `${String(f.mes).padStart(2, '0')}-${String(f.dia).padStart(2, '0')}`;
    const final = f.trasladable && !NUNCA_TRASLADABLES.has(claveMD) ? trasladar(original) : original;
    agregar(final, f.nombre);
  }

  const [difuntos, cuenca] = bloqueNoviembre(anio);
  agregar(difuntos, 'Día de los Difuntos');
  agregar(cuenca, 'Independencia de Cuenca');

  const pascua = domingoPascua(anio);
  agregar(sumarDias(pascua, -48), 'Lunes de Carnaval');
  agregar(sumarDias(pascua, -47), 'Martes de Carnaval'); // nunca se traslada
  agregar(sumarDias(pascua, -2), 'Viernes Santo'); // ya cae viernes, no aplica traslado

  return mapa;
}

/** true si la fecha (YYYY-MM-DD) es sábado o domingo. */
export function esFinDeSemana(fechaIso: string): boolean {
  const dia = new Date(`${fechaIso}T12:00:00`).getDay();
  return dia === 0 || dia === 6;
}

/** true si la fecha (YYYY-MM-DD) es un feriado calculado (no incluye los agregados a mano). */
export function esFeriadoCalculado(fechaIso: string): boolean {
  const anio = Number(fechaIso.slice(0, 4));
  return calcularFeriados(anio).has(fechaIso);
}

export function nombreFeriadoCalculado(fechaIso: string): string | undefined {
  const anio = Number(fechaIso.slice(0, 4));
  return calcularFeriados(anio).get(fechaIso)?.join(' + ');
}

/** true si la fecha es fin de semana, feriado calculado, o está en la lista de feriados
 * adicionales cargados a mano (ver tabla feriados_adicionales). */
export function esDiaNoRegular(fechaIso: string, feriadosAdicionales: Set<string>): boolean {
  return esFinDeSemana(fechaIso) || esFeriadoCalculado(fechaIso) || feriadosAdicionales.has(fechaIso);
}

/** null = día regular; si no, el motivo a mostrar (nombre del feriado, o "Fin de semana") — mismo
 * criterio que esDiaNoRegular, pero con el texto para pintar una celda de calendario (Calendario
 * de turnos, SelectorDiasReporte). `feriadosAdicionales` acá es un Map fecha→descripción (a
 * diferencia del Set de esDiaNoRegular) porque además de decidir SI es feriado, hace falta el
 * texto que escribió quien lo cargó. */
export function motivoDia(fechaIso: string, feriadosAdicionales: Map<string, string>): string | null {
  if (esFeriadoCalculado(fechaIso)) return nombreFeriadoCalculado(fechaIso) ?? 'Feriado';
  if (feriadosAdicionales.has(fechaIso)) return feriadosAdicionales.get(fechaIso)!;
  if (esFinDeSemana(fechaIso)) return 'Fin de semana';
  return null;
}
