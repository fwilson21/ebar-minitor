# EBAR Monitor

Aplicación web (PWA, mobile-first) para que operadores registren visitas técnicas a
estaciones de bombeo de aguas residuales (EBAR) y para que administradores/supervisores
generen reportes consolidados en PDF y los envíen por WhatsApp.

## 1. Arquitectura

```
ebar-app/
├── supabase/
│   ├── migrations/0001_init.sql      # Esquema completo: tablas, RLS, RPCs, triggers
│   └── functions/
│       ├── upload-to-drive/          # Edge Function: sube fotos a Google Drive
│       └── send-whatsapp/            # Edge Function: envía PDF por WhatsApp Cloud API
├── src/
│   ├── lib/
│   │   ├── supabase.ts               # Cliente Supabase
│   │   ├── types.ts                  # Tipos del dominio
│   │   ├── offline.ts                # Cola IndexedDB (Dexie) + sincronización
│   │   └── pdf.ts                    # Generación de PDF con pdfmake
│   ├── contexts/AuthContext.tsx      # Sesión y rol del usuario
│   ├── components/                   # AppShell, PumpForm, PhotoCapture, etc.
│   └── pages/                        # Login, Dashboard, Stations, VisitForm, Reports
└── README.md
```

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + React Router.
- **Backend:** Supabase (Postgres, Auth, Storage, Edge Functions, RLS).
- **Fotos:** capturadas con la cámara del dispositivo → subidas a Google Drive vía Edge
  Function con cuenta de servicio (organizadas en `RAÍZ/AAAA-MM-DD/CÓDIGO_ESTACIÓN/`).
- **PDF:** generado **en el cliente** con `pdfmake` (no requiere servidor).
- **WhatsApp:** envío vía Edge Function usando la **WhatsApp Cloud API** oficial de Meta.
- **Offline:** las visitas se guardan primero en IndexedDB (vía Dexie) y se sincronizan
  automáticamente al recuperar conexión, usando `cliente_uuid` como clave idempotente
  para evitar duplicados.

## 2. Puesta en marcha

### 2.1 Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En la configuración del proyecto, habilita Realtime para las tablas `estaciones_ebar`, `visitas`, `registros_bombas`, `fotos` y `reportes`.
3. Ejecuta la migración:
   ```bash
   supabase link --project-ref TU_PROJECT_REF
   supabase db push
   ```
   o pega el contenido de `supabase/migrations/0001_init.sql` en el SQL Editor del
   dashboard.
4. Copia [.env.example](.env.example) a `.env` y completa:
   ```bash
   VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=tu-anon-key
   ```
5. Crea el primer usuario administrador:
   - Regístralo desde el dashboard de Auth o con `supabase.auth.signUp`.
   - Luego, en la tabla `usuarios`, actualiza su `rol` a `'administrador'` manualmente
     (el trigger crea todo usuario nuevo como `'operador'` por defecto).
6. Despliega las Edge Functions:
   ```bash
   supabase functions deploy upload-to-drive
   supabase functions deploy send-whatsapp
   ```

### 2.1.1 Datos iniciales recomendados

Antes de empezar a usar la app, carga al menos:

```sql
insert into estaciones_ebar (codigo, nombre, zona, direccion, latitud, longitud, numero_bombas, estado_actual)
values
  ('EBAR-001', 'Estación El Pintado', 'urbana', 'Av. Maldonado y Pintado', -0.2870, -78.5380, 2, 'operativa'),
  ('EBAR-002', 'Estación La Merced', 'rural', 'Vía a La Merced', -0.3200, -78.6100, 3, 'operativa');

insert into bombas (estacion_id, numero_bomba, voltaje_nominal, amperaje_nominal)
select id, 1, 220, 15 from estaciones_ebar where codigo = 'EBAR-001'
union all
select id, 2, 220, 15 from estaciones_ebar where codigo = 'EBAR-001'
union all
select id, 1, 220, 15 from estaciones_ebar where codigo = 'EBAR-002'
union all
select id, 2, 220, 15 from estaciones_ebar where codigo = 'EBAR-002'
union all
select id, 3, 220, 15 from estaciones_ebar where codigo = 'EBAR-002';
```

### 2.2 Google Drive (almacenamiento de fotos)

1. En Google Cloud Console, crea un proyecto y habilita la **Google Drive API**.
2. Crea una **cuenta de servicio** y descarga su JSON de credenciales.
3. En Google Drive, crea una carpeta raíz para los reportes y **compártela** con el
   correo de la cuenta de servicio (campo `client_email` del JSON) con permiso Editor.
4. Configura los secretos en Supabase:
   ```bash
   supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
   supabase secrets set GOOGLE_DRIVE_ROOT_FOLDER_ID='id_de_la_carpeta_raiz'
   ```

### 2.3 WhatsApp (envío de reportes)

1. Crea una app de tipo "Business" en [Meta for Developers](https://developers.facebook.com)
   y agrega el producto **WhatsApp**.
2. Obtén el **Phone Number ID** y genera un **token permanente** (System User con
   permiso `whatsapp_business_messaging`).
3. Configura los secretos:
   ```bash
   supabase secrets set WHATSAPP_CLOUD_API_TOKEN='tu_token'
   supabase secrets set WHATSAPP_PHONE_NUMBER_ID='tu_phone_number_id'
   supabase secrets set WHATSAPP_DEFAULT_GROUP_ID='numero_o_lista_de_difusion'
   ```
   > **Importante:** la Cloud API oficial de Meta no permite enviar a "grupos" de
   > WhatsApp normales, solo a números individuales o listas de difusión. La opción
   > "Enviar al grupo" en la app envía al número/lista configurado en
   > `WHATSAPP_DEFAULT_GROUP_ID`. Si se requiere un grupo real de WhatsApp, es necesario
   > usar una librería no oficial (ej. `whatsapp-web.js`) bajo tu propia infraestructura,
   > lo cual implica riesgo de bloqueo de número por parte de WhatsApp.
4. Cada supervisor/administrador debe tener su número en `usuarios.whatsapp_numero`
   (formato internacional, ej. `593999999999`) para recibir reportes individuales.

### 2.4 Frontend

```bash
cp .env.example .env
# completa VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY
npm install
npm run dev       # desarrollo
npm run build     # producción → carpeta dist/
```

Despliega la carpeta `dist/` en Vercel, Netlify, Cloudflare Pages o cualquier hosting
estático. Para instalación como PWA en los celulares de los operadores, sirve la app
sobre HTTPS (requisito de la cámara y del modo offline).

### 2.5 Despliegue en producción

1. Asegura que el proyecto real de Supabase esté activo y que las variables de entorno del frontend estén configuradas.
2. Compila la app:
   ```bash
   npm run build
   ```
3. Sube el contenido de `dist/` a tu hosting estático.
4. En Vercel/Netlify/Cloudflare, configura el dominio y habilita HTTPS.
5. Prueba la app en producción con usuarios reales y valida Realtime, reportes y carga de fotos.

## 3. Carga inicial de datos

Antes de que los operadores empiecen a trabajar, un administrador debe:

1. Insertar las estaciones en `estaciones_ebar` (puede hacerse desde el SQL Editor o
   construyendo una pantalla de administración adicional — no incluida en esta primera
   versión, ver sección 5).
2. Insertar las bombas de cada estación en `bombas` (1 a 4 filas por estación, columna
   `numero_bomba` de 1 a `numero_bombas`).
3. Crear las cuentas de los operadores (Auth) y asignarles `rol = 'operador'`.

Ejemplo de inserción rápida vía SQL:

```sql
insert into estaciones_ebar (codigo, nombre, zona, direccion, latitud, longitud, numero_bombas)
values ('EBAR-001', 'Estación El Pintado', 'urbana', 'Av. Maldonado y Pintado', -0.2870, -78.5380, 2);

insert into bombas (estacion_id, numero_bomba, voltaje_nominal, amperaje_nominal)
select id, 1, 220, 15 from estaciones_ebar where codigo = 'EBAR-001'
union all
select id, 2, 220, 15 from estaciones_ebar where codigo = 'EBAR-001';
```

## 4. Manual de usuario (resumen)

**Operador**
1. Inicia sesión con tu correo y contraseña.
2. En "Estaciones", elige la EBAR que vas a visitar.
3. Toca "Registrar visita": indica estado de la estación, nivel de tanque, llena los
   datos de cada bomba (estado, voltaje, amperaje, horas), responde sobre olores/ruidos/
   cerramiento, toma fotos y guarda.
4. Si no hay señal, la visita se guarda en el dispositivo y se sincroniza solo cuando
   vuelva la conexión (verás un contador de pendientes en la parte superior).

**Administrador / Supervisor**
1. En "Inicio" verás el resumen del día: visitas registradas, estaciones con problemas,
   alertas de voltaje fuera de rango, estaciones sin visitar.
2. En "Reportes", elige el tipo (diario por operador, consolidado por fecha, o
   individual por estación), la fecha, y genera el PDF.
3. Desde la misma pantalla puedes enviar el PDF generado por WhatsApp al grupo
   configurado o a los supervisores individuales.

## 5. Próximos pasos sugeridos (no incluidos en esta versión)

El modelo de datos y la arquitectura ya contemplan estas expansiones:

- **Alertas automáticas de voltaje:** la columna generada `voltaje_fuera_rango` en
  `registros_bombas` ya marca cada lectura fuera de rango; falta conectar un disparador
  (Edge Function + cron, o `pg_net`) que notifique por WhatsApp/email en tiempo real.
- **Rutas de visita programadas:** agregar tabla `rutas_visita` (estación, día de la
  semana, operador asignado) y un calendario en el dashboard.
- **Mantenimiento preventivo e inventario de repuestos:** agregar tablas
  `planes_mantenimiento`, `repuestos`, `movimientos_inventario`.
- **Gráficos de consumo eléctrico:** ya hay histórico de voltaje/amperaje/horas por
  bomba; solo falta una vista con una librería de gráficos (ej. Recharts).
- **Sensores IoT:** se puede insertar directamente en `registros_bombas` desde un
  gateway IoT autenticado con una clave de servicio, sin pasar por la UI.
- **Pantalla de administración de estaciones/bombas/usuarios** desde la propia app
  (hoy se gestiona vía SQL Editor de Supabase).

## 6. Notas de seguridad

- Row Level Security está activo en todas las tablas: un operador solo ve/edita sus
  propias visitas; administradores y supervisores ven todo.
- Las Edge Functions usan la `service_role` key de Supabase (nunca expuesta al
  frontend) para resolver destinatarios de WhatsApp y metadatos de la visita.
- Las credenciales de Google y WhatsApp se guardan como secretos de Supabase, nunca en
  el código ni en el repositorio.
