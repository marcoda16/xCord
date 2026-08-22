/**
 * Almacén de perfiles.
 *
 * Dos niveles: el perfil propio vive en los settings de Vencord (persistente,
 * editable); los ajenos se piden al servidor y se cachean en memoria con TTL.
 * Todo funciona sin servidor — simplemente no verás los perfiles de otros.
 */

import type { PluginNative } from "@utils/types";

import { buildProfileCss, GLOBAL_KEYFRAMES, NS } from "./css";
import { type XcordProfile, SCHEMA_VERSION } from "../types";

const Native = VencordNative.pluginHelpers.xcord as PluginNative<typeof import("../native")>;

const CACHE_TTL = 5 * 60 * 1000;
/** Usuarios que ya consultamos y no tienen perfil: no volvemos a preguntar tan pronto. */
const NEGATIVE_TTL = 30 * 60 * 1000;

interface CacheEntry {
    profile: XcordProfile | null;
    fetchedAt: number;
}

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<XcordProfile | null>>();

/**
 * El borrador sin guardar del editor, mientras está abierto.
 *
 * `profileHook` en index.tsx lee esto antes que el perfil guardado. Sin este
 * puente, cosas que dependen del store —banner, tema de color, efecto de
 * perfil, borde— no se veían en el preview hasta pulsar Guardar: solo el CSS
 * (degradados de texto) se actualizaba en vivo, porque ese sí se reinyecta en
 * cada cambio. Esto le da la misma inmediatez a lo que no es CSS.
 */
let draftOverride: XcordProfile | null = null;

/**
 * Sube con cada cambio del borrador y con cada guardado.
 *
 * Los `useMemo` de Discord que parcheamos solo recalculan si cambian sus
 * dependencias —el usuario, el servidor—, y ninguna cambia al elegir otra
 * placa. Este contador entra como dependencia extra para forzar el recálculo.
 */
let profileVersion = 0;

export function bumpProfileVersion() {
    profileVersion++;
}

export function getProfileVersion(): number {
    return profileVersion;
}

export function setDraftOverride(profile: XcordProfile | null) {
    draftOverride = profile;
    // El preview del editor lee el borrador, no lo guardado: sin esto, el
    // useMemo seguiría devolviendo lo de antes mientras editas.
    profileVersion++;
}

export function getDraftOverride(): XcordProfile | null {
    return draftOverride;
}

let styleEl: HTMLStyleElement | null = null;
/** CSS ya inyectado, por usuario, para poder reemplazarlo sin reconstruir todo. */
const injected = new Map<string, string>();

function ensureStyleElement(): HTMLStyleElement {
    if (styleEl?.isConnected) return styleEl;
    styleEl = document.createElement("style");
    styleEl.id = `${NS}-styles`;
    document.head.appendChild(styleEl);
    return styleEl;
}

function flush() {
    ensureStyleElement().textContent = [GLOBAL_KEYFRAMES, ...injected.values()].join("\n");
}

/** Aplica (o reemplaza) los estilos de un usuario en el documento. */
export function applyProfile(profile: XcordProfile) {
    const scope = `[data-${NS}-user="${profile.userId}"]`;
    injected.set(profile.userId, buildProfileCss(profile, scope));
    flush();
}

/** Clave reservada para el preview del editor; no es un id de usuario válido. */
const PREVIEW_KEY = "__preview";

/** Clase del contenedor del preview. El CSS del editor se acota aquí. */
export const PREVIEW_CLASS = `${NS}-preview`;

/**
 * Pinta un perfil sin guardarlo, acotado al contenedor del editor.
 *
 * Usa el mismo generador que la capa real — solo cambia el scope. Por eso el
 * preview no puede mentir: si difiere del resultado final, el bug está en el
 * generador y afecta a ambos por igual.
 */
export function applyPreview(profile: XcordProfile) {
    injected.set(PREVIEW_KEY, buildProfileCss(profile, `.${PREVIEW_CLASS}`));
    flush();
}

export function clearPreview() {
    if (injected.delete(PREVIEW_KEY)) flush();
}

export function clearProfile(userId: string) {
    if (injected.delete(userId)) flush();
}

export function teardown() {
    injected.clear();
    styleEl?.remove();
    styleEl = null;
    cache.clear();
}

function isValid(p: unknown): p is XcordProfile {
    return !!p && typeof p === "object"
        && (p as XcordProfile).version === SCHEMA_VERSION
        && typeof (p as XcordProfile).userId === "string";
}

/**
 * Devuelve el perfil cacheado de un usuario, o `undefined` si aún no lo tenemos.
 * Es síncrono a propósito: el render nunca espera por la red.
 */
export function getCached(userId: string): XcordProfile | null | undefined {
    const entry = cache.get(userId);
    if (!entry) return undefined;
    const ttl = entry.profile ? CACHE_TTL : NEGATIVE_TTL;
    if (Date.now() - entry.fetchedAt > ttl) {
        cache.delete(userId);
        return undefined;
    }
    return entry.profile;
}

/**
 * Pide el perfil de un usuario a Supabase. Deduplica peticiones concurrentes
 * para el mismo usuario — abrir un popout dispara varios renders.
 *
 * Va por el proceso principal (`Native.fetchRemoteProfile`): la CSP del
 * renderer bloquea peticiones a dominios externos, y `supabase.co` es uno.
 */
export function fetchProfile(userId: string): Promise<XcordProfile | null> {
    const cached = getCached(userId);
    if (cached !== undefined) return Promise.resolve(cached);

    const existing = inFlight.get(userId);
    if (existing) return existing;

    const request = (async () => {
        try {
            const result = await Native.fetchRemoteProfile(userId);
            const body = result.ok ? result.profile?.profile ?? null : null;
            const profile = isValid(body) ? body : null;
            cache.set(userId, { profile, fetchedAt: Date.now() });
            if (profile) applyProfile(profile);
            return profile;
        } catch {
            // Sin red: cacheamos el fallo brevemente para no martillear el servidor.
            cache.set(userId, { profile: null, fetchedAt: Date.now() });
            return null;
        } finally {
            inFlight.delete(userId);
        }
    })();

    inFlight.set(userId, request);
    return request;
}
