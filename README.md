# xcord

Capa de personalización visual para Discord, como plugin de [Vencord](https://vencord.dev).

Degradados, GIFs en avatar y banner, fuentes personalizadas, efectos de texto y widgets con
enlaces — con preview en vivo y, opcionalmente, visibles para otros usuarios de xcord.

## Qué hace y qué no

**Sí:** pinta encima de lo que Discord ya renderiza, en tu cliente, con CSS acotado por usuario.

**No:** no modifica tu perfil real en Discord, no llama a la API de Discord, no suplanta
identidades ni toca datos de nadie. Si desinstalas xcord, todo vuelve a la normalidad.

**Aviso:** los client mods van contra los ToS de Discord. En la práctica no se banea por uso
cosmético, pero es tu decisión asumir ese riesgo.

## Estado

| Fase | Qué incluye | Estado |
|---|---|---|
| 1 | Schema de perfil + motor de CSS | ✅ hecho |
| 2 | Enganche al store + marcado del DOM | ✅ hecho |
| 3 | Editor con preview en vivo | ✅ hecho |
| 4 | Sincronización (Supabase) | ✅ hecho |

## Arquitectura

```
├─ types.ts        Schema del perfil. Fuente de verdad única.
├─ lib/css.ts      XcordProfile → hoja de estilos. Alimenta capa real Y preview.
├─ lib/store.ts    Perfil propio (settings) + ajenos (fetch con caché y TTL).
├─ index.tsx       Definición del plugin y patches.
├─ native.ts       Todo lo que llama a dominios externos (Catbox, Discord, Supabase) — corre en el proceso principal, no en el renderer.
└─ components/     Editor y preview.
```

El preview usa **el mismo generador de CSS** que la capa real. No hay dos implementaciones que
puedan divergir: si el preview miente, es un bug en `css.ts`, no una desincronización.

Todo el CSS generado va acotado a `[data-xcord-user="<id>"]`. Un perfil no puede filtrar
estilos fuera de su propio nodo — ni accidentalmente, ni a propósito.

## Sincronización

Proyecto Supabase: `reiszfgtqtyumfaatajl` (plan gratuito). Dos tablas —`xcord_profiles` (pública
en lectura) y `xcord_claims` (quién controla cada id de Discord, sin acceso público)— y cuatro
funciones de Postgres, ninguna alcanzable por REST directo salvo `xcord_publish_profile` y
`xcord_delete_profile`.

Publicar sin vincular reclama tu id con un secreto generado en tu equipo — funciona, pero
"quien reclama primero, gana". Vincular con Discord (botón en el editor) cierra ese hueco: abre
tu navegador al login real de Discord, y dos Edge Functions —`discord-oauth-callback` y
`discord-oauth-poll`— verifican tu identidad contra la API de Discord antes de emitir el
secreto. El client secret de la app de Discord vive solo como variable de entorno de la Edge
Function; nunca en este repositorio.

Client ID de la app de Discord (público): `1540619781378539601`. Redirect URI registrada:
`https://reiszfgtqtyumfaatajl.supabase.co/functions/v1/discord-oauth-callback`.

La pantalla final del callback se genera con un renderer aislado y sin recursos externos en
`supabase/functions/_shared/oauth-page.ts`, y se publica como sitio estático en GitHub Pages
(`docs/oauth/`). La Edge Function no devuelve HTML: redirige ahí con el desenlace y, en los
errores, una referencia opaca — el gateway de `*.supabase.co` reescribe el `text/html` de los
proyectos sin dominio propio a `text/plain`, y el navegador enseñaba el código fuente. Detalles,
pruebas y vista previa local en `supabase/functions/discord-oauth-callback/README.md`.

Las imágenes elegidas del disco no viajan dentro del perfil: al publicar se suben a Supabase
Storage y la copia remota lleva solo su URL. A Postgres no llega base64 nunca. Ver
`supabase/functions/xcord-images/README.md`.

## Instalación (para probar el plugin)

**La forma fácil (Windows):** descarga [`xcord.bat`](xcord.bat) y hazle doble clic. Si faltan
Git, Node.js o pnpm los instala solo (con `winget`, sin preguntar nada) y sigue de largo; en un
Windows sin `winget` disponible, en cambio, abre la página de descarga correspondiente y pide
volver a correr el script después de instalar a mano. Clona Vencord y xcord (o los actualiza si
ya los tenías), compila e inyecta.

**A mano:** requiere [Vencord clonado y compilando desde fuente](https://docs.vencord.dev/installing/):

```bash
git clone https://github.com/Vendicated/Vencord
cd Vencord
pnpm install
```

Clona este repo directamente dentro de `src/userplugins`:

```bash
git clone <url-de-este-repo> src/userplugins/xcord
```

Y compila e inyecta:

```bash
pnpm build
pnpm inject
```

Para seguir desarrollando con recompilación automática:

```bash
pnpm watch
```

**Importante:** los cambios en `native.ts` corren en el proceso principal de Electron, no en el
renderer — recompilar con `pnpm watch` no basta, hay que cerrar Discord por completo (desde la
bandeja del sistema) y volver a abrirlo para que se apliquen.
