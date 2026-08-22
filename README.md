# xcord

Capa de personalización visual para Discord, como plugin de [Vencord](https://vencord.dev).

Degradados, GIFs en avatar y banner, fuentes personalizadas y efectos de texto — con preview
en vivo y, opcionalmente, visibles para otros usuarios de xcord.

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

## Instalación (para probar el plugin)

Requiere [Vencord clonado y compilando desde fuente](https://docs.vencord.dev/installing/):

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
