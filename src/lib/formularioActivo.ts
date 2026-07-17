// Permite que la pantalla activa (por ahora, solo VisitForm) le avise al header (AppShell,
// botón "Salir") que hay datos sin guardar, para poder ofrecer guardarlos antes de cerrar
// sesión. La navegación DENTRO de la app ya está cubierta por el `useBlocker` de VisitForm,
// pero "Salir" no navega entre rutas (cierra la sesión), así que ese blocker no se entera.
interface FormularioActivo {
  hayCambios: boolean;
  guardarBorrador: () => Promise<void>;
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

export async function guardarBorradorDelFormularioActivo(): Promise<void> {
  await activo?.guardarBorrador();
}
