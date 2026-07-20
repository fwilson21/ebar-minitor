// Muestra solo nombre y apellido (no el nombre completo con 2 nombres/2 apellidos que suelen
// usarse en Ecuador) — para nombres de 4 palabras asume "Nombre1 Nombre2 Apellido1 Apellido2" y
// se queda con la 1ª y la 3ª; para 3 palabras se queda con la 1ª y la última.
export function nombreCorto(nombreCompleto: string): string {
  const partes = nombreCompleto.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(' ');
  const indiceApellido = Math.ceil(partes.length / 2);
  return `${partes[0]} ${partes[indiceApellido]}`;
}
