/**
 * Los seis desenlaces posibles del callback. Cada uno es una página estática
 * pregenerada; el callback solo elige a cuál redirige.
 *
 * ¿Por qué no servir el HTML desde la propia Edge Function? Porque el gateway
 * de Supabase reescribe las respuestas `text/html` de los proyectos sin dominio
 * propio a `text/plain` con CSP `sandbox` —una medida antiphishing del dominio
 * compartido `*.supabase.co`—. El navegador enseña el código fuente en lugar de
 * la página, y ninguna cabecera que mandemos sobrevive. Fuera de ese dominio el
 * HTML se renderiza con normalidad.
 */
export const OAUTH_PAGE_BASE = "https://marcoda16.github.io/xCord/oauth";

export type OAuthOutcome =
    | "ok"
    | "cancelled"
    | "expired"
    | "incomplete"
    | "discord"
    | "failed";

// `as const` en vez de anotar con OAuthPageOptions: así este archivo no
// importa nada y el bundle de la Edge Function no arrastra el renderer, que
// solo hace falta en build y en la vista previa. El test comprueba que cada
// desenlace sigue siendo un OAuthPageOptions válido.
export const oauthOutcomes = {
    ok: {
        kind: "success",
        title: "Cuenta vinculada correctamente",
        message: "Ya puedes volver a Discord. xcord terminará la vinculación automáticamente."
    },
    cancelled: {
        kind: "error",
        title: "Vinculación cancelada",
        message: "No se realizó ningún cambio. Puedes volver a xcord e intentarlo cuando quieras."
    },
    expired: {
        kind: "error",
        title: "El enlace ya no es válido",
        message: "Por seguridad, los enlaces caducan y solo pueden utilizarse una vez. Inicia uno nuevo desde xcord."
    },
    incomplete: {
        kind: "error",
        title: "Enlace de vinculación incompleto",
        message: "Inicia la vinculación desde los ajustes de xcord para generar un enlace válido."
    },
    discord: {
        kind: "error",
        title: "Discord no respondió como esperábamos",
        message: "Espera un momento y vuelve a intentarlo desde xcord."
    },
    failed: {
        kind: "error",
        title: "No pudimos completar la vinculación",
        message: "Vuelve a xcord e inténtalo de nuevo. Si vuelve a fallar, espera un minuto."
    }
} as const;

/**
 * En la URL solo viaja el desenlace y la referencia de 8 hex. Nunca el `code`,
 * el `state`, el secreto ni la identidad. `Referrer-Policy: no-referrer` evita
 * además que la página de destino reciba la URL del callback —que sí lleva el
 * `code`— como referente.
 */
export function oauthRedirect(outcome: OAuthOutcome, requestId?: string): Response {
    const query = requestId ? `?ref=${encodeURIComponent(requestId)}` : "";
    return new Response(null, {
        status: 302,
        headers: {
            Location: `${OAUTH_PAGE_BASE}/${outcome}.html${query}`,
            "Cache-Control": "no-store, max-age=0",
            "Referrer-Policy": "no-referrer"
        }
    });
}
