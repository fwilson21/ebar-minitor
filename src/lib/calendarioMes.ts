// Utilidades de grilla de calendario (mes → celdas de 7 columnas, lunes primero) — compartidas
// entre Calendario de turnos y el selector de días del Reporte "Solo fines de semana y feriados"
// (ver Reports.tsx / SelectorDiasReporte.tsx). Antes vivían solo dentro de CalendarioTurnos.tsx.

/** "2026-09" del mes actual, según el reloj del dispositivo. */
export function mesActualISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Suma (o resta, con delta negativo) meses a un "AAAA-MM". */
export function sumarMeses(mes: string, delta: number): string {
  const [anio, mesNum] = mes.split('-').map(Number);
  const d = new Date(anio, mesNum - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Celdas del mes para una grilla de 7 columnas (lunes primero): null = relleno fuera de mes. */
export function generarCeldasMes(mes: string): (string | null)[] {
  const [anioStr, mesStr] = mes.split('-');
  const anio = Number(anioStr);
  const mesNum = Number(mesStr);
  const primerDia = new Date(anio, mesNum - 1, 1);
  const ultimoDiaNum = new Date(anio, mesNum, 0).getDate();
  const offset = (primerDia.getDay() + 6) % 7; // getDay(): 0=domingo → acá 0=lunes
  const celdas: (string | null)[] = Array(offset).fill(null);
  for (let d = 1; d <= ultimoDiaNum; d++) celdas.push(`${anioStr}-${mesStr}-${String(d).padStart(2, '0')}`);
  while (celdas.length % 7 !== 0) celdas.push(null);
  return celdas;
}
