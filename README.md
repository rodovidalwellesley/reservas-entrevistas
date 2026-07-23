# App de reservas de entrevistas — backend + feed ICS en vivo

Esta es la versión "de producción" de la app de reservas: un servidor real que
podés alojar en internet, con una URL fija que Apple Calendar (y por lo tanto
Structured) puede suscribir para traer las entrevistas agendadas automáticamente.

## Qué incluye

- **Web de reservas** (sin login para quien reserva) en `/`
- **Panel de Anfitrión** protegido con un token simple, en la misma web (pestaña "Anfitrión")
- **API pública** para reservar y consultar disponibilidad
- **Feed ICS en vivo** en `/feed/<token>.ics` — esta es la URL que suscribís en Apple Calendar
- Guarda todo en un archivo `data/db.json` (para el volumen de uso de reservar entrevistas, alcanza de sobra)

## Probarlo en tu computadora primero

```bash
npm install
cp .env.example .env
# Editá .env y poné tu propio ADMIN_TOKEN
npm start
```

Abrí `http://localhost:3000` en el navegador. La pestaña "Reservar" es pública.
La pestaña "Anfitrión" te va a pedir el token que pusiste en `ADMIN_TOKEN`.

## Cómo publicarlo en internet (para que la URL del feed sea real)

Necesitás un hosting que mantenga el proceso corriendo. Los más simples para este
tipo de proyecto (con **disco persistente**, importante porque `data/db.json` vive
en el disco):

### Opción recomendada: Render.com
1. Subí esta carpeta a un repositorio de GitHub.
2. En Render.com → New → Web Service → conectá el repo.
3. Build command: `npm install` — Start command: `npm start`.
4. En "Environment", agregá la variable `ADMIN_TOKEN` con tu propio valor secreto.
5. **Importante:** agregá un "Persistent Disk" montado en `/opt/render/project/src/data`
   (o la ruta equivalente que te muestre Render) para que las reservas no se
   borren en cada despliegue.
6. Al terminar te da una URL pública fija, tipo `https://tu-app.onrender.com`.

### Alternativas: Railway.app o Fly.io
Funcionan igual de bien — subís el repo, configurás `ADMIN_TOKEN` como variable
de entorno, y activás un volumen persistente para la carpeta `data/`.

⚠️ **Nota sobre Vercel/Netlify:** estos NO sirven para este proyecto tal cual está,
porque son "serverless" y no tienen disco persistente entre invocaciones — perderías
las reservas. Si en el futuro querés usarlos, habría que migrar `data/db.json` a una
base de datos externa (por ejemplo Supabase o Turso).

## Cómo obtener y suscribir la URL del feed ICS

1. Entrá a tu app publicada → pestaña "Anfitrión" → ingresá tu `ADMIN_TOKEN`.
2. Andá a la pestaña "Calendario". Ahí vas a ver la URL del feed, algo como:
   `https://tu-app.onrender.com/feed/9f3a...c21.ics`
3. En tu iPhone o Mac: Ajustes → Calendario → Cuentas → Agregar cuenta → Otra →
   **Agregar calendario suscripto**, y pegá esa URL.
4. Abrí Structured → Ajustes → Calendarios (sección Integraciones) → "Permitir acceso"
   → elegí **Acceso completo** (el permiso de "solo agregar eventos" no alcanza).
5. Seleccioná el calendario recién agregado — las entrevistas van a aparecer solas
   en tu timeline, y se van a ir actualizando (aunque con algo de demora: eso lo
   decide el sistema operativo, normalmente cada tantas horas).

Si en algún momento querés invalidar la URL (por ejemplo, se filtró), tocá
"Generar nueva URL" en esa misma pestaña — vas a tener que volver a suscribirla
en tus dispositivos.

## Seguridad — cosas a tener en cuenta

- El panel de Anfitrión usa un único token compartido, no un login de verdad.
  Alcanza para uso personal/una sola persona administrando; si varias personas
  necesitan acceso con permisos distintos, conviene sumar un sistema de usuarios real.
- La URL del feed ICS funciona como "contraseña": cualquiera que la tenga puede
  ver fecha, hora y nombre de los postulantes agendados (a propósito no incluye
  email ni teléfono). Tratala como algo privado.

## Próximos pasos posibles

- Envío automático de confirmación por email al postulante (por ejemplo con Resend
  o SendGrid) apenas se crea la reserva.
- Recordatorios por WhatsApp/SMS (por ejemplo con Twilio).
- Migrar `data/db.json` a una base de datos real si el volumen de reservas crece mucho.
