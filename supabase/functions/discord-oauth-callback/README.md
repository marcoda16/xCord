# Pantalla final del callback OAuth

`index.ts` hace todo el OAuth y **no devuelve HTML**: redirige a una página estática publicada
en GitHub Pages. Los textos y el contrato de la redirección viven en `../_shared/oauth-outcomes.ts`;
el HTML lo genera `../_shared/oauth-page.ts`.

## Por qué una redirección y no la página

El gateway de Supabase reescribe las respuestas `text/html` de los proyectos **sin dominio propio**
a `text/plain` con CSP `sandbox` — una defensa antiphishing del dominio compartido `*.supabase.co`:

```
Content-Type: text/plain
content-security-policy: default-src 'none'; sandbox
```

El navegador enseña el código fuente en vez de la página, y ninguna cabecera que mande la función
sobrevive. Fuera de ese dominio el HTML se renderiza con normalidad. Las alternativas eran el
add-on de dominio propio (de pago) o sacar la página a un host estático; se eligió lo segundo.

## Contrato de la redirección

`302` a `https://marcoda16.github.io/xCord/oauth/<desenlace>.html`, con `?ref=<8 hex>` en los
errores. En la URL **solo** viajan esos dos datos. La respuesta lleva `Referrer-Policy: no-referrer`
para que la página de destino tampoco reciba como referente la URL del callback, que sí contiene
el `code`.

| Caso | Desenlace | Título |
|---|---|---|
| Falta `state` | `incomplete` | Enlace de vinculación incompleto |
| Usuario cancela (`?error=`) | `cancelled` | Vinculación cancelada |
| Sin `code` | `expired` | El enlace ya no es válido |
| Falla el token o `users/@me` | `discord` | Discord no respondió como esperábamos |
| Falla el claim, o excepción | `failed` | No pudimos completar la vinculación |
| Éxito | `ok` | Cuenta vinculada correctamente |

La página no intenta cerrar la pestaña ni muestra un botón para hacerlo: los navegadores bloquean
`window.close()` cuando la pestaña no fue creada por JavaScript. El plugin no depende del cierre;
termina la vinculación sondeando `discord-oauth-poll`.

## Referencia de error

Cada petición genera un `requestId` de 8 hex. Va en `?ref=` y se antepone al campo `error` de la
fila de sesión (`[a1b2c3d4] Token: 400 …`). Permite casar lo que vio el usuario con el detalle real
sin exponer nada de ese detalle. El éxito no lleva referencia: no hay nada que diagnosticar.

Nunca debe llegar a la página el `code`, el `state`, el secreto del claim, el token de Discord, el
correo ni el texto de una excepción. Las pruebas lo comprueban estáticamente sobre `index.ts`: cada
llamada a `oauthRedirect` solo puede pasar un desenlace conocido y, como mucho, `requestId`.

Tampoco llega ya el nombre de usuario de Discord: la página es estática y meterlo en la URL sería
publicar la identidad en el historial del navegador. El recuadro de identidad sigue existiendo en
el renderer y lo usa la vista previa.

## Pruebas, vista previa y publicación

```bash
node supabase/functions/_shared/oauth-page.test.mjs
```

```bash
node supabase/functions/_shared/oauth-page.preview.mjs
```

La vista previa lista los seis desenlaces en `http://127.0.0.1:4179/` y sirve cada uno igual que
la versión publicada, incluido `?ref=`.

Al cambiar `oauth-page.ts` u `oauth-outcomes.ts` hay que **regenerar y commitear** el sitio en el
repo del plugin, que es de donde sirve GitHub Pages:

```bash
node supabase/functions/_shared/oauth-page.build.mjs docs/oauth
```

## Despliegue de la función

```bash
supabase functions deploy discord-oauth-callback --project-ref reiszfgtqtyumfaatajl --no-verify-jwt
```

`--no-verify-jwt` es obligatorio: Discord redirige aquí el navegador del usuario, que no puede
enviar un token de Supabase. El `DISCORD_CLIENT_SECRET` sigue viviendo solo como variable de
entorno de la función.
