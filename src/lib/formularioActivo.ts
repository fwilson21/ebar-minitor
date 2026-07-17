// Permite que la pantalla activa (VisitForm, Asignaciones) le avise al header (AppShell, botón
// "Salir") que hay datos sin guardar, para poder ofrecer guardarlos antes de cerrar sesión. La
// navegación DENTRO de la app ya está cubierta por el `useBlocker` de VisitForm, pero "Salir" no
// navega entre rutas (cierra la sesión), así que ese blocker no se entera solo.
interface FormularioActivo {
  hayCambios: boolean;
  /** Guarda lo pendiente antes de salir — en VisitForm es pausar la visita como borrador; en
   * Asignaciones es guardar de una vez los cambios reales (no hay concepto de "borrador" ahí). */
  guardar: () => Promise<void>;
}

let activo: FormularioActivo | null = null;

export function registrarFormularioActivo(estado: FormularioActivo) {
  activo = estado;
}

export function desregistrarFormularioActivo() {
  activo = null;
}

export function hayCambiosSinGuardar(): boolean {
  return activo?.hayCambios ?? false;
}

export async function guardarCambiosDelFormularioActivo(): Promise<void> {
  await activo?.guardar();
}
