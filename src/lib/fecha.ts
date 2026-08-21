// "Hoy" según el reloj del dispositivo (hora local), no UTC.
//
// `new Date().toISOString().slice(0, 10)` (usado antes en varios lugares) da la fecha en UTC.
// Ecuador está 5 horas atrás (UTC-5), así que desde las 19:00 hora local, `toISOString()` ya
// devuelve el día siguiente — la app pensaba que ya era "mañana" 5 horas antes de la medianoche
// real, y por eso el Dashboard del administrador y la lista de EBAR de los operadores cambiaban
// de día antes de tiempo. `hoyLocal()` arma la fecha con los métodos locales de `Date`
// (getFullYear/getMonth/getDate), que respetan la zona horaria del dispositivo — el día solo
// cambia cuando realmente pasa la medianoche local.
export function hoyLocal(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
