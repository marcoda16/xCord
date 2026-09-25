/**
 * Aviso de actualizaciones.
 *
 * xcord se instala clonando el repositorio, así que no hay tienda ni gestor
 * que avise de nada: sin esto, alguien puede quedarse meses con una versión
 * vieja sin enterarse. Y eso ya ha tenido consecuencias visibles — las
 * imágenes alojadas en Storage se ven negras hasta que el cliente actualiza.
 *
 * Aquí solo vive la lógica pura, sin red ni interfaz, para poder probarla.
 */

/**
 * Versión del plugin. Nada que ver con SCHEMA_VERSION de `types.ts`, que
 * describe el formato del perfil y solo cambia cuando ese formato cambia.
 * Esta sube en cada publicación, aunque el perfil siga igual.
 */
export const XCORD_VERSION = "1.0.1";

/** Dónde se publica el manifiesto, junto a las páginas del OAuth. */
export const MANIFEST_URL = "https://marcoda16.github.io/xCord/version.json";

/** Como mucho una consulta al día. */
export const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Margen tras arrancar, para no competir con la carga del cliente. */
export const CHECK_DELAY_MS = 8000;

/**
 * El destino del botón solo puede estar en estos hosts. El manifiesto es un
 * archivo remoto, y de ahí sale una URL que se abre en el navegador del
 * usuario: sin esta lista, quien controlara el archivo elegiría a qué página
 * se le manda.
 */
const ALLOWED_HOSTS = ["github.com", "www.github.com", "marcoda16.github.io"];

const MAX_TITLE = 80;
const MAX_MESSAGE = 300;
const MAX_NOTES = 6;
const MAX_NOTE = 120;

export interface UpdateManifest {
    latest: string;
    title: string;
    message: string;
    downloadUrl: string;
    /** Viñetas opcionales para el modal, además del mensaje. */
    notes: string[];
}

/** `"1.10.0"` → `[1, 10, 0]`. Devuelve null si no es una versión reconocible. */
export function parseVersion(value: unknown): number[] | null {
    if (typeof value !== "string") return null;

    const core = value.trim().replace(/^v/i, "").split(/[-+]/)[0];
    if (!/^\d+(\.\d+)*$/.test(core)) return null;

    const parts = core.split(".").map(Number);
    return parts.length && parts.every(Number.isFinite) ? parts : null;
}

/**
 * Comparación numérica por componentes, no alfabética: como texto, "1.10.0"
 * es menor que "1.9.0" y el aviso nunca aparecería.
 *
 * Una versión con sufijo (`1.2.0-beta`) se considera anterior a la misma sin
 * él, que es la convención de semver.
 */
export function compareVersions(a: string, b: string): number {
    const pa = parseVersion(a);
    const pb = parseVersion(b);
    if (!pa || !pb) return 0;

    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (diff !== 0) return diff > 0 ? 1 : -1;
    }

    const preA = /[-+]/.test(a);
    const preB = /[-+]/.test(b);
    if (preA === preB) return 0;
    return preA ? -1 : 1;
}

export const isNewer = (latest: string, current: string): boolean =>
    compareVersions(latest, current) > 0;

const text = (value: unknown, max: number): string =>
    typeof value === "string" ? value.trim().slice(0, max) : "";

/**
 * Valida el manifiesto descargado. Devuelve null ante cualquier cosa rara: es
 * un archivo remoto, y preferimos no avisar de nada antes que avisar mal.
 */
export function parseManifest(value: unknown): UpdateManifest | null {
    if (!value || typeof value !== "object") return null;

    const raw = value as Record<string, unknown>;
    if (!parseVersion(raw.latest)) return null;

    let downloadUrl: string;
    try {
        const url = new URL(String(raw.downloadUrl ?? ""));
        if (url.protocol !== "https:" || !ALLOWED_HOSTS.includes(url.host)) return null;
        downloadUrl = url.href;
    } catch {
        return null;
    }

    const notes = Array.isArray(raw.notes)
        ? raw.notes.map(n => text(n, MAX_NOTE)).filter(Boolean).slice(0, MAX_NOTES)
        : [];

    return {
        latest: String(raw.latest).trim().replace(/^v/i, ""),
        title: text(raw.title, MAX_TITLE) || "Nueva versión de xcord",
        message: text(raw.message, MAX_MESSAGE),
        downloadUrl,
        notes
    };
}

/** ¿Toca consultar? El manual se salta el intervalo; el automático no. */
export function shouldCheck(lastCheck: unknown, now: number): boolean {
    const previous = Number(lastCheck);
    if (!Number.isFinite(previous) || previous <= 0) return true;

    // Un reloj adelantado y luego corregido dejaría una marca en el futuro, y
    // sin esto no se volvería a consultar nunca.
    if (previous > now) return true;

    return now - previous >= CHECK_INTERVAL_MS;
}

/** ¿Hay que enseñar el aviso? Solo si es más nueva y no se descartó ya. */
export function shouldNotify(
    manifest: UpdateManifest,
    current: string,
    dismissed: unknown
): boolean {
    if (!isNewer(manifest.latest, current)) return false;

    // Se descarta una versión concreta, no el aviso en general: si sale una
    // posterior, vuelve a aparecer.
    //
    // Ojo con lo que NO es una versión: el ajuste vale "" mientras nadie haya
    // descartado nada, y tratar esa cadena como versión hacía que
    // compareVersions devolviera 0 y no se avisara nunca de nada.
    const seen = typeof dismissed === "string" && parseVersion(dismissed) ? dismissed : null;
    return !seen || compareVersions(manifest.latest, seen) > 0;
}
