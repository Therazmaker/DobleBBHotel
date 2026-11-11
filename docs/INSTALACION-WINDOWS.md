# Instalación en el servidor del hotel (Windows Server)

El Respaldo PMS corre en el servidor del hotel. Cada 10 minutos copia los datos de NewHotel a una base
local (`data\hotel.db`), y los PCs de recepción lo abren desde el navegador por la red interna. Si NewHotel
o internet se caen, la copia sigue disponible en la red del hotel.

## Lo que hace falta

- El servidor Windows, siempre encendido, con SAI e **IP fija**.
- Salida a internet hacia `api-am.newhotelcloud.com` (para la sincronización) y, solo durante la
  instalación, hacia `registry.npmjs.org` y `nodejs.org`.
- Un usuario de NewHotel para la sincronización: sin doble factor y, a ser posible, solo de consulta.
- Una cuenta de administrador en el servidor.

## 1. IP fija del servidor

Panel de control → Centro de redes → adaptador → Propiedades → *Protocolo de Internet versión 4* →
*Usar la siguiente dirección IP*. Pon la IP que ya usa ahora, la máscara, la puerta de enlace y los DNS
(si el router reparte IPs por DHCP, reserva esa IP en el router para que no se la dé a otro equipo).

## 2. Instalar Node.js

Descarga la versión **LTS** (22.12 o superior) de <https://nodejs.org> → instalador `.msi` de Windows x64.
Acepta las opciones por defecto. Cierra y vuelve a abrir PowerShell y comprueba:

```powershell
node -v
```

## 3. Copiar el proyecto al servidor

Una de estas dos:

- **Con git** (recomendado: luego se actualiza con un comando): instala Git para Windows y
  `git clone https://github.com/Therazmaker/DobleBBHotel.git C:\RespaldoPMS` (pedirá entrar con la
  cuenta de GitHub que tiene acceso al repo).
- **Sin git**: en GitHub, *Code → Download ZIP* y descomprímelo en `C:\RespaldoPMS`.

## 4. Instalar

PowerShell **como administrador**:

```powershell
cd C:\RespaldoPMS
powershell -ExecutionPolicy Bypass -File scripts\windows\instalar.ps1
```

Te preguntará:

| Pregunta | Qué poner |
|---|---|
| Usuario y contraseña de NewHotel | Los del usuario de sincronización. Se guardan en `C:\RespaldoPMS\.env`, que solo pueden leer los administradores. |
| ID del hotel | Enter, salvo que la cuenta tenga varios hoteles. |
| Puerto | Enter (3000). |
| Qué equipos pueden abrir la app | Enter = la misma red que el servidor. Si la wifi de huéspedes está en esa misma red, pon solo las IPs de los PCs de recepción, separadas por comas. |
| Carpeta de copias | Enter (`data\backups`) u otro disco, p. ej. `D:\RespaldoPMS\copias`. |

Al terminar muestra la dirección para recepción, p. ej. `http://192.168.1.10:3000`. Ábrela en cada PC de
recepción y créale un acceso directo o un favorito. **No hay login**: entra cualquiera desde las redes
permitidas, y desde cualquier otra red la app responde "Este equipo no tiene acceso".

## Qué queda instalado

- Tarea programada **"Respaldo PMS"** (Programador de tareas): arranca con Windows como SYSTEM, sin
  límite de tiempo, y si el servidor se cae lo vuelve a levantar.
- Regla de firewall **"Respaldo PMS"** para el puerto.
- Registro en `C:\RespaldoPMS\logs\servidor.log` (se rota a los 10 MB).
- **Copia de seguridad diaria** de la base: `hotel-AAAA-MM-DD.db`, se guardan 30 días. En la pantalla
  *Respaldo › Sincronización* se ve la hora de la última sincronización y de la última copia.

Las copias son más útiles fuera del disco principal (otro disco o un USB). Una carpeta compartida de otro
equipo también vale, pero como la tarea corre como SYSTEM, esa carpeta tiene que dar permiso de escritura
a la cuenta del equipo servidor (`DOMINIO\NOMBRE-SERVIDOR$`).

## Mantenimiento

| Para | Ejecutar (PowerShell como administrador, en `C:\RespaldoPMS`) |
|---|---|
| Actualizar a una versión nueva | `powershell -ExecutionPolicy Bypass -File scripts\windows\actualizar.ps1` |
| Reiniciar (p. ej. tras editar `.env`) | `powershell -ExecutionPolicy Bypass -File scripts\windows\reiniciar.ps1` |
| Hacer una copia ahora | `npm run backup` |
| Quitar la tarea y el firewall | `powershell -ExecutionPolicy Bypass -File scripts\windows\desinstalar.ps1` |

Si cambia la contraseña del usuario de NewHotel de la sincronización, edita `NEWHOTEL_PASSWORD` en `.env`
(entre comillas simples) y reinicia.

## Restaurar una copia

1. Para la tarea *Respaldo PMS* en el Programador de tareas (clic derecho → Finalizar).
2. Copia la copia elegida encima de `data\hotel.db` (y borra `data\hotel.db-wal` y `data\hotel.db-shm` si existen).
3. `scripts\windows\reiniciar.ps1`.
