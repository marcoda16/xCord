# Páginas publicadas (GitHub Pages)

`oauth/*.html` son **archivos generados**. No los edites a mano: se producen desde
`supabase/functions/_shared/oauth-page.ts`, en este mismo repo, con

```bash
node supabase/functions/_shared/oauth-page.build.mjs docs/oauth
```

Son la pantalla final del login de Discord. La Edge Function `discord-oauth-callback`
hace todo el OAuth y redirige aquí con el desenlace (`ok`, `cancelled`, `expired`,
`incomplete`, `discord`, `failed`) y, en los errores, una referencia de 8 caracteres
en `?ref=`. Nunca llega aquí el `code`, el `state` ni ningún secreto.

Se publican fuera de Supabase porque el gateway de `*.supabase.co` reescribe las
respuestas `text/html` de los proyectos sin dominio propio a `text/plain`, y el
navegador enseñaba el código fuente en lugar de la página.

`.nojekyll` evita que GitHub Pages procese estos archivos con Jekyll.

## `version.json`

Manifiesto del aviso de actualizaciones. El plugin lo consulta unos segundos despues de arrancar,
como mucho una vez cada 24 h, y compara `latest` con su `XCORD_VERSION` (en `lib/updates.ts`).

**Para publicar una version nueva:** sube `XCORD_VERSION` en `lib/updates.ts`, etiqueta la release
en GitHub, y sube aqui `latest` al mismo numero. Mientras `latest` sea igual o menor que la version
instalada, nadie ve ningun aviso — que es el estado normal.

`notes` es opcional: una lista corta de vinetas que el modal muestra bajo el mensaje.

`downloadUrl` solo puede apuntar a `github.com` o `marcoda16.github.io`. El plugin lo valida dos
veces, en el renderer y en el proceso principal, porque de ahi sale una pagina que se abre en el
navegador del usuario.
