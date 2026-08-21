import { useEffect, useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { suscribirseCambios } from '../lib/realtime';
import { useAuth } from '../contexts/AuthContext';
import type { EstacionEbar, TipoEstacion, ZonaTipo } from '../lib/types';
import { StationCard } from '../components/StationCard';
import { guardarCacheLocal, leerCacheLocal } from '../lib/cacheLocal';
import { GridEditable } from '../components/GridEditable';
import { BarraDistribucion } from '../components/BarraDistribucion';
import { PANTALLAS_EDITABLES } from '../lib/pantallasEditables';
import { useEditorDistribucion } from '../hooks/useEditorDistribucion';
import { hoyLocal } from '../lib/fecha';

const CLAVE_CACHE_ESTACIONES = 'ebar_cache_estaciones';

export function Stations() {
  const { usuario, tienePermiso } = useAuth();
  const esAdmin = usuario?.rol === 'administrador';
  // Ambas delegables por permiso (ver /permisos) además del administrador real — antes eran
  // esAdmin a secas.
  const puedeCrearEstaciones = esAdmin || tienePermiso('crear_estaciones');
  const puedeEditarDistribucion = esAdmin || tienePermiso('editar_distribucion');
  const [estaciones, setEstaciones] = useState<EstacionEbar[]>([]);
  const [ultimasVisitas, setUltimasVisitas] = useState<Record<string, string>>({});
  const [filtroZona, setFiltroZona] = useState<ZonaTipo | 'todas'>('todas');
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [sinConexion, setSinConexion] = useState(false);
  const editorDistribucion = useEditorDistribucion('estaciones');

  useEffect(() => {
    async function cargar() {
      const { data } = await supabase
        .from('estaciones_ebar')
        .select('*')
        .eq('activa', true)
        .order('nombre');

      let lista: EstacionEbar[];
      if (data) {
        lista = data as EstacionEbar[];
        guardarCacheLocal(CLAVE_CACHE_ESTACIONES, lista);
        setSinConexion(false);
      } else {
        // Sin conexión (u otro error de red): usar la última lista de estaciones que se haya
        // cargado con éxito en este dispositivo, en vez de mostrar la lista vacía.
        lista = leerCacheLocal<EstacionEbar[]>(CLAVE_CACHE_ESTACIONES) ?? [];
        setSinConexion(true);
      }
      // Un operador solo ve en esta lista las EBAR que tiene asignadas hoy (por defecto o
      // especial) — si todavía no tiene ninguna, no ve ninguna estación: la asignación la
      // controla exclusivamente el administrador/supervisor desde "Asignar". Si no hay señal
      // para verificarlo (la consulta falla y devuelve null), no se filtra nada — la lista ya
      // viene de la copia guardada en el dispositivo tal cual.
      if (usuario?.rol === 'operador') {
        const hoy = hoyLocal();
        const { data: asignadasHoy } = await supabase
          .from('asignaciones_estacion')
          .select('estacion_id')
          .eq('operador_id', usuario.id)
          .or(`fecha.is.null,fecha.eq.${hoy}`);
        if (asignadasHoy !== null) {
          const idsAsignados = new Set(asignadasHoy.map((a) => a.estacion_id));
          lista = lista.filter((e) => idsAsignados.has(e.id));
        }
      }

      setEstaciones(lista);

      if (lista.length > 0) {
        const { data: visitas } = await supabase
          .from('visitas')
          .select('estacion_id, fecha_hora_llegada')
          .in('estacion_id', lista.map((e) => e.id))
          .order('fecha_hora_llegada', { ascending: false });

        const mapa: Record<string, string> = {};
        for (const v of visitas ?? []) {
          if (!mapa[v.estacion_id]) mapa[v.estacion_id] = v.fecha_hora_llegada;
        }
        setUltimasVisitas(mapa);
      }

      setCargando(false);
    }

    cargar();

    const detener = suscribirseCambios({
      channelName: 'stations-realtime',
      table: 'estaciones_ebar',
      callback: cargar,
    });

    return () => detener();
  }, []);

  const filtradas = estaciones.filter((e) => {
    if (filtroZona !== 'todas' && e.zona !== filtroZona) return false;
    if (busqueda && !`${e.nombre} ${e.codigo}`.toLowerCase().includes(busqueda.toLowerCase())) return false;
    return true;
  });

  // Digitador no tiene esta pantalla (su trabajo es Turnos/Reportes, no monitoreo de estaciones).
  if (usuario?.rol === 'digitador') return <Navigate to="/calendario-turnos" replace />;

  return (
    <div className="space-y-4">
      {/* Título fijo arriba a la izquierda: no es parte de ningún bloque movible, para que no
          importe cómo se acomoden los bloques con "Editar distribución" (ver GridEditable) —
          siempre se sabe en qué pantalla se está. Mismo patrón que Reportes/Asignar/Turnos/Permisos/Usuarios. */}
      <h1 className="titulo-pantalla">Estaciones EBAR</h1>

      {/* Celular: exactamente el mismo apilado de siempre, sin GridEditable. */}
      <div className="lg:hidden space-y-4">
        <BloqueEncabezadoForm esAdmin={puedeCrearEstaciones} />
        {sinConexion && (
          <p className="text-xs text-gauge-warn bg-gauge-warn/10 border border-gauge-warn/30 rounded-lg px-3 py-2">
            Sin conexión — mostrando la última lista guardada en este dispositivo.
          </p>
        )}
        <BloqueFiltros busqueda={busqueda} setBusqueda={setBusqueda} filtroZona={filtroZona} setFiltroZona={setFiltroZona} />
        <BloqueListaEstaciones
          cargando={cargando}
          filtradas={filtradas}
          sinConexion={sinConexion}
          rolOperador={usuario?.rol === 'operador'}
          ultimasVisitas={ultimasVisitas}
        />
      </div>

      {/* Escritorio (lg+): mismos bloques, acomodados según lo guardado (o el acomodo por
          defecto) — solo el administrador puede tocar "Editar distribución". */}
      <div className="hidden lg:block space-y-3">
        {puedeEditarDistribucion && <BarraDistribucion editor={editorDistribucion} />}
        {sinConexion && (
          <p className="text-xs text-gauge-warn bg-gauge-warn/10 border border-gauge-warn/30 rounded-lg px-3 py-2">
            Sin conexión — mostrando la última lista guardada en este dispositivo.
          </p>
        )}
        <GridEditable
          pantallaId="estaciones"
          bloques={PANTALLAS_EDITABLES.find((p) => p.id === 'estaciones')!.bloques}
          modoEdicion={puedeEditarDistribucion && editorDistribucion.modoEdicion}
          resetSignal={editorDistribucion.resetSignal}
          objetivoEdicion={editorDistribucion.objetivoActivo}
          onGuardar={editorDistribucion.guardar}
          renderBloque={(bloqueId) => {
            switch (bloqueId) {
              case 'encabezado_form':
                return <BloqueEncabezadoForm esAdmin={puedeCrearEstaciones} />;
              case 'filtros':
                return (
                  <BloqueFiltros busqueda={busqueda} setBusqueda={setBusqueda} filtroZona={filtroZona} setFiltroZona={setFiltroZona} />
                );
              case 'lista_estaciones':
                return (
                  <BloqueListaEstaciones
                    cargando={cargando}
                    filtradas={filtradas}
                    sinConexion={sinConexion}
                    rolOperador={usuario?.rol === 'operador'}
                    ultimasVisitas={ultimasVisitas}
                  />
                );
              default:
                return null;
            }
          }}
        />
        {editorDistribucion.guardando && <p className="text-xs text-slate-500">Guardando…</p>}
      </div>
    </div>
  );
}

function BloqueEncabezadoForm({ esAdmin: puedeCrear }: { esAdmin: boolean }) {
  if (!puedeCrear) return null;
  return (
    <div className="space-y-4 lg:h-full lg:overflow-auto">
      <h2 className="text-sm font-semibold text-slate-700">Nueva estación</h2>
      <FormularioNuevaEstacion />
    </div>
  );
}

function BloqueFiltros({
  busqueda,
  setBusqueda,
  filtroZona,
  setFiltroZona,
}: {
  busqueda: string;
  setBusqueda: (v: string) => void;
  filtroZona: ZonaTipo | 'todas';
  setFiltroZona: (v: ZonaTipo | 'todas') => void;
}) {
  return (
    <div className="space-y-3 lg:h-full lg:flex lg:flex-col lg:justify-center">
      <input
        className="campo"
        placeholder="Buscar por nombre o código…"
        value={busqueda}
        onChange={(e) => setBusqueda(e.target.value)}
      />
      <div className="flex gap-2">
        {(['todas', 'urbana', 'rural'] as const).map((z) => (
          <button
            key={z}
            onClick={() => setFiltroZona(z)}
            className={`text-sm px-3 py-1.5 rounded-full border ${
              filtroZona === z ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-600'
            }`}
          >
            {z === 'todas' ? 'Todas' : z === 'urbana' ? 'Urbanas' : 'Rurales'}
          </button>
        ))}
      </div>
    </div>
  );
}

function BloqueListaEstaciones({
  cargando,
  filtradas,
  sinConexion,
  rolOperador,
  ultimasVisitas,
}: {
  cargando: boolean;
  filtradas: EstacionEbar[];
  sinConexion: boolean;
  rolOperador: boolean;
  ultimasVisitas: Record<string, string>;
}) {
  return (
    <div className="lg:h-full lg:overflow-auto">
      {cargando ? (
        <p className="text-slate-600">Cargando…</p>
      ) : filtradas.length === 0 ? (
        <p className="text-slate-600">
          {sinConexion
            ? 'No hay ninguna estación guardada todavía en este dispositivo. Conéctate al menos una vez para poder verlas sin señal.'
            : rolOperador
              ? 'Todavía no tienes estaciones asignadas. Habla con tu administrador o supervisor.'
              : 'No se encontraron estaciones.'}
        </p>
      ) : (
        <div className="space-y-2">
          {filtradas.map((e) => (
            <StationCard key={e.id} estacion={e} ultimaVisita={ultimasVisitas[e.id]} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormularioNuevaEstacion() {
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [zona, setZona] = useState<ZonaTipo>('urbana');
  const [tipo, setTipo] = useState<TipoEstacion>('ebar');
  const [direccion, setDireccion] = useState('');
  const [latitud, setLatitud] = useState('');
  const [longitud, setLongitud] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function manejarSubmit(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setMensaje(null);
    try {
      const { error } = await supabase.from('estaciones_ebar').insert({
        codigo: codigo.trim(),
        nombre: nombre.trim(),
        zona,
        tipo,
        direccion: direccion.trim() || null,
        latitud: latitud ? Number(latitud) : null,
        longitud: longitud ? Number(longitud) : null,
        descripcion: descripcion.trim() || null,
        numero_bombas: 0,
        estado_actual: 'operativa',
        activa: true,
      });
      if (error) throw error;

      setMensaje('Estación creada.');
      setCodigo('');
      setNombre('');
      setDireccion('');
      setLatitud('');
      setLongitud('');
      setDescripcion('');
    } catch (err: any) {
      const duplicado = err.message?.includes('duplicate key') || err.code === '23505';
      setMensaje(duplicado ? `Ya existe una estación con el código "${codigo}".` : `No se pudo crear: ${err.message ?? err}`);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <form onSubmit={manejarSubmit} className="tarjeta p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Código</label>
          <input className="campo" required value={codigo} onChange={(e) => setCodigo(e.target.value)} placeholder="EBAR-002" />
        </div>
        <div>
          <label className="etiqueta">Tipo</label>
          <select className="campo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoEstacion)}>
            <option value="ebar">EBAR (con bombas)</option>
            <option value="ptar">PTAR (planta de tratamiento)</option>
            <option value="linea_conduccion">Línea de conducción (sin bombas)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="etiqueta">Nombre</label>
        <input className="campo" required value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Estación..." />
      </div>

      <div>
        <label className="etiqueta">Zona</label>
        <div className="flex gap-2">
          {(['urbana', 'rural'] as const).map((z) => (
            <button
              key={z}
              type="button"
              onClick={() => setZona(z)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm border capitalize ${
                zona === z ? 'bg-gauge-ok/15 border-gauge-ok text-gauge-ok' : 'border-panel-600 text-slate-700'
              }`}
            >
              {z}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="etiqueta">Dirección (opcional)</label>
        <input className="campo" value={direccion} onChange={(e) => setDireccion(e.target.value)} />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="etiqueta">Latitud (opcional)</label>
          <input className="campo" type="number" step="any" value={latitud} onChange={(e) => setLatitud(e.target.value)} />
        </div>
        <div>
          <label className="etiqueta">Longitud (opcional)</label>
          <input className="campo" type="number" step="any" value={longitud} onChange={(e) => setLongitud(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="etiqueta">Descripción (opcional)</label>
        <textarea className="campo" rows={2} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} />
      </div>

      {mensaje && (
        <p className={`text-sm ${mensaje === 'Estación creada.' ? 'text-gauge-ok' : 'text-gauge-danger'}`}>{mensaje}</p>
      )}

      <button type="submit" disabled={guardando} className="boton-primario w-full">
        {guardando ? 'Creando…' : 'Crear estación'}
      </button>
      {tipo === 'ebar' && (
        <p className="text-xs text-slate-500">
          Se crea sin bombas — agrégalas después desde la página de la estación, en "Gestión de bombas".
        </p>
      )}
    </form>
  );
}
