# Jahapy Backend

API REST del backend de **Jahapy** (app de transporte + delivery, Paraguay).
Primera fase: servidor, base de datos y autenticacion.

> Modulo: **CommonJS**. ORM: **Prisma**. DB: **PostgreSQL**.
> Auth: **JWT** + **bcryptjs**. CORS configurable por env (`CORS_ORIGIN`).

## Requisitos
- Node 18+ (probado con Node 24).

## Instalacion y arranque (desarrollo)

Requiere un PostgreSQL accesible (local con Docker, o el de Render).

```bash
npm install
cp .env.example .env          # editar JWT_SECRET y DATABASE_URL (Postgres)
npm run prisma:generate       # genera el cliente Prisma
npm run prisma:push           # sincroniza el schema con la base (crea las tablas)
npm run dev                   # nodemon -> http://localhost:4000
# o: npm start
```

El puerto se configura con `PORT` (default 4000). **No usar 5173 ni 4173** (los usa el frontend en preview).

## Variables de entorno (`.env`)
- `PORT` - puerto del server (default 4000).
- `JWT_SECRET` - secreto para firmar los JWT.
- `JWT_EXPIRES_IN` - expiracion del token (default `7d`).
- `DATABASE_URL` - conexion a PostgreSQL (`postgresql://user:pass@host:5432/db?schema=public`).
- `CORS_ORIGIN` - origenes permitidos (lista separada por comas). Default: localhost:5173/4173 + el frontend en Netlify.

## Endpoints

| Metodo | Ruta                 | Auth | Descripcion                              |
|--------|----------------------|------|------------------------------------------|
| GET    | `/health`            | No   | `{ ok: true }`                           |
| POST   | `/api/auth/register` | No   | Crea usuario. Devuelve `{ token, user }` |
| POST   | `/api/auth/login`    | No   | Login. Devuelve `{ token, user }`        |
| GET    | `/api/me`            | Si   | Usuario actual (Bearer token)            |
| GET    | `/api/rides/mine`    | Si   | Viajes del usuario (pasajero o conductor), desc |
| GET    | `/api/rides/active`  | Si   | Viaje activo del usuario (o `null`)      |
| GET    | `/api/rides/:id`     | Si   | Detalle de un viaje (solo si es parte de el) |

`register` body: `{ fullName, email, password, phone?, role?, city? }`
(`role` ∈ `PASSENGER | DRIVER | COURIER | ADMIN`, default `PASSENGER`).

Errores en espanol: `400` validacion, `401` credenciales/token, `403` no autorizado, `409` duplicado.

## Tiempo real (Socket.IO) - viajes de transporte

El server expone Socket.IO en el mismo puerto (`http://localhost:4000`). El cliente debe
autenticarse pasando el JWT en el handshake:

```js
const socket = io('http://localhost:4000', { auth: { token } });
```

Se valida con el mismo `JWT_SECRET` del REST; el socket queda con `userId` y `role`.
Los eventos dirigidos a un viaje usan una sala (`room`) por `rideId`.

### Estados de un viaje (`status`)
`REQUESTED → ACCEPTED → ARRIVING → ARRIVED → IN_PROGRESS → COMPLETED` (o `CANCELLED`).
Las transiciones del conductor se validan en el servidor.

### Eventos que ENVIA el cliente

| Evento            | Rol       | Payload                                                                 | Efecto |
|-------------------|-----------|-------------------------------------------------------------------------|--------|
| `driver:online`   | DRIVER    | `{ lat, lng }`                                                          | Marca al conductor en linea (Map en memoria) |
| `driver:location` | DRIVER    | `{ lat, lng }`                                                          | Actualiza ubicacion; si tiene viaje activo, reenvia al pasajero |
| `driver:offline`  | DRIVER    | `-`                                                                     | Lo saca del Map de en linea |
| `ride:accept`     | DRIVER    | `{ rideId }`                                                            | Toma el viaje si sigue en REQUESTED |
| `ride:status`     | DRIVER    | `{ rideId, status }`                                                    | Avanza el estado (validado) |
| `ride:request`    | PASSENGER | `{ rideType, origin:{lat,lng,label}, dest:{...}, distanceKm, durationMin, fare }` | Crea el viaje y notifica a conductores cercanos |
| `ride:cancel`     | ambos     | `{ rideId, reason? }`                                                   | Cancela el viaje (si no finalizo) |

Todos los eventos del cliente aceptan un callback de ACK opcional (3er argumento):
`socket.emit('ride:accept', { rideId }, (resp) => { ... })` → `{ ok, ... }`.

### Eventos que RECIBE el cliente

| Evento                     | Lo recibe | Cuando |
|----------------------------|-----------|--------|
| `ride:incoming`            | DRIVER    | Hay un nuevo viaje cerca disponible |
| `ride:taken`               | DRIVER    | Otro conductor tomo un viaje que le habia llegado |
| `ride:unavailable`         | DRIVER    | Intento aceptar un viaje ya tomado |
| `ride:accepted`            | PASSENGER | Un conductor acepto (incluye datos del conductor) |
| `ride:driver_location`     | PASSENGER | Nueva ubicacion del conductor `{ rideId, lat, lng, updatedAt }` |
| `ride:status`              | PASSENGER | Cambio de estado del viaje |
| `ride:no_drivers`          | PASSENGER | No habia conductores en linea |
| `ride:cancelled`           | ambos     | El viaje fue cancelado |
| `ride:driver_disconnected` | PASSENGER | El conductor del viaje se desconecto |

> El estado de conductores en linea vive en memoria (`src/realtime/onlineDrivers.js`):
> para el MVP no se persiste. La busqueda de cercania usa haversine (`src/lib/geo.js`).

## Prueba end-to-end
Con el server corriendo en otra terminal:

```bash
npm run test:flow       # REST: health -> register -> login -> me
npm run test:realtime   # 2 dispositivos: pasajero + conductor, flujo de viaje completo via Socket.IO
```

## Desplegar en Render

El backend usa **PostgreSQL** y sincroniza el schema con **`prisma db push`** (no usa
archivos de migracion). El script `build` corre `prisma generate && prisma db push`.

### Opcion A: Blueprint (render.yaml, automatico)
Hay un `render.yaml` en la raiz que declara el Web Service + un Postgres. En Render:
**New > Blueprint** > conectar el repo de GitHub. Render crea la base, el servicio,
genera `JWT_SECRET` y cablea `DATABASE_URL` solo. Revisar `CORS_ORIGIN` si el frontend
cambia de URL.

### Opcion B: Manual (panel de Render)
1. **Crear la base**: New > PostgreSQL. Plan Free. Anotar la *Internal Database URL*.
2. **Crear el servicio**: New > Web Service > conectar el repo de GitHub.
   - Runtime: **Node**
   - Build Command: `npm install && npm run build`
   - Start Command: `npm start`
   - Health Check Path: `/health`
3. **Variables de entorno** del servicio:
   - `DATABASE_URL` = Internal Database URL del Postgres del paso 1.
   - `JWT_SECRET` = cadena larga y aleatoria.
   - `JWT_EXPIRES_IN` = `7d` (opcional).
   - `CORS_ORIGIN` = `http://localhost:5173,http://localhost:4173,https://jocular-cat-10b938.netlify.app`
     (la URL del frontend desplegado; lista separada por comas).
   - `PORT` **no** hace falta: Render lo inyecta y el server escucha en `0.0.0.0:$PORT`.
4. Deploy. En el build, `prisma db push` crea las tablas (User, Ride, FoodOrder) en Postgres.

No hay que tocar codigo de la app para deployar.

> Nota: se usa `prisma db push` (no `migrate deploy`) porque no hay migraciones por
> proveedor commiteadas; `db push` sincroniza el schema directo contra la base.
>
> Nota: `role` se guarda como `String` y se valida en la app. En Postgres es opcional
> convertirlo a un `enum` nativo; no es necesario.

## Estructura
```
src/
  server.js            arranque (http server compartido por Express + Socket.IO)
  app.js               express app, CORS, rutas, manejo de errores
  routes/
    auth.js            /api/auth/register, /login
    user.js            /api/me
    rides.js           /api/rides/mine, /active, /:id
  controllers/
    authController.js  register / login
    userController.js  me
    rideController.js  listMine / active / getOne
  services/
    rideService.js     logica de viajes (BD, transiciones de estado)
  realtime/
    index.js           Socket.IO: auth handshake + eventos de viaje
    onlineDrivers.js   Map en memoria de conductores en linea + cercania
  middleware/
    auth.js            requireAuth (verifica JWT)
    errorHandler.js    errorHandler + notFound
  lib/
    prisma.js          cliente Prisma (singleton)
    token.js           sign/verify JWT
    sanitizeUser.js    quita passwordHash de las respuestas
    geo.js             haversine (distancia entre coordenadas)
prisma/
  schema.prisma        modelos User + Ride (+ notas de fases futuras)
scripts/
  test-flow.js         prueba e2e del flujo de auth
  test-realtime.js     prueba e2e de viajes en tiempo real (2 dispositivos)
```

## Proximas fases
DriverProfile, Vehicle, Ride, FoodOrder, Wallet, sockets en tiempo real (ver notas en `schema.prisma`).
