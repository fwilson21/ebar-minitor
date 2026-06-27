import type { EstadoEstacion } from '../lib/types';

const CONFIG: Record<EstadoEstacion, { label: string; className: string }> = {
  operativa: { label: 'Operativa', className: 'bg-gauge-ok/15 text-gauge-ok border-gauge-ok/30' },
  mantenimiento_correctivo: {
    label: 'Mant. correctivo',
    className: 'bg-gauge-warn/15 text-gauge-warn border-gauge-warn/30',
  },
  fuera_de_servicio: {
    label: 'Fuera de servicio',
    className: 'bg-gauge-danger/15 text-gauge-danger border-gauge-danger/30',
  },
};

export function EstadoBadge({ estado }: { estado: EstadoEstacion }) {
  const c = CONFIG[estado];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border ${c.className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {c.label}
    </span>
  );
}
