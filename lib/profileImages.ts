/**
 * Convierte las imágenes locales de un perfil en URL de Supabase Storage.
 *
 * El editor deja elegir un archivo del disco y lo guarda como `data:` URI, que
 * es la única forma de previsualizarlo sin subir nada: el renderer de Discord
 * bloquea `file://`. Eso está bien mientras el perfil no sale del equipo, pero
 * publicar así metía la imagen entera en base64 dentro del jsonb — un banner
 * medido ocupaba 65 kB, el 99% de ese perfil, frente a los 80 bytes que ocupa
 * un enlace.
 *
 * Así que el perfil local conserva el `data:` URI —la vista previa sigue
 * siendo instantánea y funciona sin conexión— y solo la copia que viaja al
 * servidor lleva URL. A Postgres no llega base64 nunca.
 */

import type { XcordProfile } from "../types";

/**
 * Ruta fija por usuario y tipo. Volver a subir pisa el objeto anterior en vez
 * de acumular copias, y la Edge Function borra los tipos que ya no aparecen.
 */
export type ImageKind = "avatar" | "banner" | "widget-hero" | `widget-link-${string}`;

export interface LocalImage {
    kind: ImageKind;
    contentType: string;
    /** Carga útil en base64, ya sin el prefijo `data:<mime>;base64,`. */
    data: string;
}

/** Lo que el bucket acepta. Un BMP o un SVG se rechazan aquí, no al publicar. */
export const SUPPORTED_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export const isDataUri = (value: unknown): value is string =>
    typeof value === "string" && value.startsWith("data:");

/** `data:image/png;base64,iVBOR…` → `{ contentType, data }`. */
export function parseDataUri(uri: string): { contentType: string; data: string; } | null {
    const match = /^data:([a-z]+\/[a-z0-9+.-]+);base64,(.+)$/i.exec(uri);
    if (!match) return null;
    return { contentType: match[1].toLowerCase(), data: match[2] };
}

/**
 * Las cuatro posiciones del perfil donde puede haber una imagen, cada una con
 * su tipo. Devolver accesores en vez de recorrer a mano evita que la lectura y
 * la escritura se desincronicen.
 */
interface ImageSlot {
    kind: ImageKind;
    value: string | undefined;
    /**
     * El id de la tarjeta forma parte de la ruta en Storage. Si no es seguro
     * para una URL no hay dónde subir la imagen, y se trata igual que un
     * formato no admitido: se avisa y no se publica. Nunca se descarta en
     * silencio, porque entonces la copia remota perdería la imagen sin que
     * nadie se enterara.
     */
    uploadable: boolean;
}

function imageSlots(profile: XcordProfile): ImageSlot[] {
    const slots: ImageSlot[] = [
        { kind: "avatar", value: profile.avatar?.image?.url, uploadable: true },
        { kind: "banner", value: profile.banner?.image?.url, uploadable: true },
        { kind: "widget-hero", value: profile.widgets?.hero?.imageUrl, uploadable: true }
    ];

    for (const link of profile.widgets?.links ?? []) {
        slots.push({
            kind: `widget-link-${link.id}`,
            value: link.imageUrl,
            uploadable: /^[A-Za-z0-9_-]{1,32}$/.test(link.id)
        });
    }

    return slots;
}

/** Los tipos que el perfil usa como imagen local, y que hay que subir. */
export function collectLocalImages(profile: XcordProfile): { ok: LocalImage[]; unsupported: ImageKind[]; } {
    const ok: LocalImage[] = [];
    const unsupported: ImageKind[] = [];

    for (const { kind, value, uploadable } of imageSlots(profile)) {
        if (!isDataUri(value)) continue;

        const parsed = parseDataUri(value);
        if (!uploadable || !parsed || !SUPPORTED_TYPES.includes(parsed.contentType)) {
            unsupported.push(kind);
            continue;
        }

        ok.push({ kind, contentType: parsed.contentType, data: parsed.data });
    }

    return { ok, unsupported };
}

/**
 * Copia del perfil con cada `data:` URI sustituido por su URL. Si falta alguna
 * URL devuelve `null`: publicar a medias dejaría base64 en el servidor, que es
 * justo lo que esto existe para evitar.
 */
export function withUploadedImages(
    profile: XcordProfile,
    urls: Record<string, string>
): XcordProfile | null {
    const remote: XcordProfile = structuredClone(profile);
    const missing = (kind: ImageKind) => !urls[kind];

    if (isDataUri(remote.avatar?.image?.url)) {
        if (missing("avatar")) return null;
        remote.avatar!.image!.url = urls.avatar;
    }

    if (isDataUri(remote.banner?.image?.url)) {
        if (missing("banner")) return null;
        remote.banner!.image!.url = urls.banner;
    }

    if (isDataUri(remote.widgets?.hero?.imageUrl)) {
        if (missing("widget-hero")) return null;
        remote.widgets!.hero!.imageUrl = urls["widget-hero"];
    }

    for (const link of remote.widgets?.links ?? []) {
        if (!isDataUri(link.imageUrl)) continue;
        const kind: ImageKind = `widget-link-${link.id}`;
        if (missing(kind)) return null;
        link.imageUrl = urls[kind];
    }

    return remote;
}

/**
 * Ocho hex del contenido, idénticos a los que calcula la Edge Function. Sirven
 * para dos cosas: saltarse la subida cuando la imagen no ha cambiado, y viajar
 * en `?v=` para que sustituirla invalide la caché del CDN.
 */
export async function imageTag(base64: string): Promise<string> {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest).slice(0, 4), b => b.toString(16).padStart(2, "0")).join("");
}
