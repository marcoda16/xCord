# Imágenes de perfil en Storage

El perfil viaja a Postgres como jsonb. Una imagen elegida del disco se guardaba dentro como
`data:` URI en base64, y eso disparaba el tamaño: un banner medido ocupaba **65 kB, el 99% de
su perfil**, frente a los ~80 bytes de un enlace. Y base64 añade un 33% sobre el archivo real.

Ahora las imágenes van a Storage y el perfil guarda la URL. **A Postgres no llega base64 nunca.**

## Reparto

- El perfil **local** conserva el `data:` URI. La vista previa es instantánea y funciona sin
  conexión, y si nunca publicas, no se sube nada.
- La copia **remota** lleva URL. `publishOwnProfile()` sube lo que haga falta, sustituye, y solo
  entonces publica. Si una subida falla, no se publica nada.

## Rutas

`<discord_user_id>/<tipo>`, con tipo en `avatar`, `banner`, `widget-hero`,
`widget-link-<id de la tarjeta>`. Fijas a propósito: volver a subir pisa el objeto en vez de
acumular copias. No llevan extensión — el formato va en el `Content-Type` del objeto, así que
cambiar de PNG a JPEG tampoco deja huérfanos.

Lo que el perfil deja de usar se borra: el plugin manda en `keep` los tipos que siguen vivos y la
función elimina el resto bajo el prefijo del usuario.

La URL termina en `?v=<8 hex del contenido>`. El objeto se sirve `immutable` durante un año, así
que sin esa marca sustituir una imagen dejaría la vieja cacheada. Esa misma huella la guarda el
plugin en `syncImages` para no resubir lo que no ha cambiado.

## Autorización

Escribir en el bucket exige la service role key, que no puede salir del servidor. El plugin manda
el secreto del claim —el mismo que ya necesita para publicar— y la función lo comprueba con
`xcord_verify_secret`, que solo puede ejecutar `service_role`. Si se expusiera a `anon`, serviría
de oráculo para adivinar secretos.

Comprobaciones antes de escribir: el id debe ser solo dígitos (cierra el paso a `..` y `/`), el
tipo debe estar en la lista, y los **magic bytes** deben coincidir con el tipo declarado — si no,
el bucket aceptaría cualquier cosa etiquetada como imagen.

## Límites

4 MB por imagen y 8 imágenes por publicación, en la función y también en el propio bucket
(`file_size_limit`, `allowed_mime_types`). El editor solo deja elegir PNG, JPEG, GIF y WebP, para
que el fallo salga al elegir el archivo y no al publicar.

## Despliegue

```bash
supabase functions deploy xcord-images --project-ref reiszfgtqtyumfaatajl
```

## Migración

Los perfiles publicados antes de esto tenían base64 dentro. Se convirtieron con una función
temporal, `xcord-migrate-images`, que ya está vacía y puede borrarse desde el panel. Tres
imágenes migradas; los dos perfiles afectados pasaron de 65.666 y 28.363 bytes a 818 y 1.177.
