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
