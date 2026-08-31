/**
 * Editor de perfil con preview en vivo.
 *
 * El preview no es una réplica del perfil de Discord: es el componente real de
 * Discord, el mismo que ves al editar tu perfil, localizado en su bundle. Lo
 * renderizamos dentro de un contenedor con la clase de preview y le aplicamos
 * el CSS acotado ahí. Así el preview es exacto por construcción — no por
 * imitación cuidadosa que se desincroniza a la tercera actualización.
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { Flex } from "@components/Flex";
import { Margins } from "@utils/margins";
import { extractAndLoadChunksLazy, findComponentByCodeLazy } from "@webpack";
import { FormSwitch } from "@components/FormSwitch";
import { Button, Clickable, ColorPicker, Forms, RestAPI, Select, Slider, Text, TextInput, useEffect, useRef, useState } from "@webpack/common";
import type { User } from "@vencord/discord-types";
import { UserStore } from "@webpack/common";

import type { PluginNative } from "@utils/types";

import { fillToCss, fillToThemeColors } from "../lib/css";
import { applyPreview, clearPreview, PREVIEW_CLASS, setDraftOverride } from "../lib/store";
import type { CardBorder, CardBorderLayer, DynamicBackground, Fill, NativeEffectId, NativeNameEffect, XcordProfile } from "../types";
import { emptyProfile } from "../types";

interface ProfileModalProps {
    user: User;
    pendingThemeColors: [number, number];
    onAvatarChange: () => void;
    onBannerChange: () => void;
    canUsePremiumCustomization: boolean;
    hideExampleButton: boolean;
    hideFakeActivity: boolean;
    isTryItOut: boolean;
}

/**
 * El modal de edición de perfil de Discord. La firma de búsqueda está copiada
 * de FakeProfileThemes, un plugin mantenido: si Discord la cambia, se arregla
 * allí primero y aquí después.
 */
const ProfileModal = findComponentByCodeLazy<ProfileModalProps>(
    "isTryItOut:", "pendingThemeColors:", "pendingAvatarDecoration:", "EDIT_PROFILE_BANNER"
);

interface UserNameWithEffectsProps {
    userName: string;
    displayNameStyles?: { fontId: number; effectId: number; colors: number[]; };
    effectDisplayType?: number;
    loop?: boolean;
}

/**
 * El mismo componente que pinta el nombre con efectos en todo Discord
 * (perfil, mensajes, lista de miembros) — confirmado en vivo caminando el
 * fiber de React desde el preview nativo de la pantalla de personalización.
 * Reusarlo acá es lo único que garantiza que el degradado/prisma/etc. se vea
 * igual en nuestra vista previa que en el resto del cliente.
 */
const UserNameWithEffects = findComponentByCodeLazy<UserNameWithEffectsProps>("data-username-with-effects");

/** `2` = ANIMATED, confirmado leyendo `effectDisplayType` en el preview nativo real. */
const EFFECT_DISPLAY_TYPE_ANIMATED = 2;

const FILL_KINDS = [
    { label: "Color plano", value: "solid" },
    { label: "Degradado lineal", value: "linear" },
    { label: "Degradado cónico (arcoíris)", value: "conic" }
] as const;

const DEFAULT_STOPS = ["#ff00cc", "#3333ff"];

const DYNAMIC_SOURCES = [
    { label: "Reflejar el banner", value: "banner" },
    { label: "Degradado propio", value: "fill" }
] as const;

/** Punto de partida parecido al efecto nativo de Discord: tenue y muy difuso. */
const DEFAULT_DYNAMIC_BG: DynamicBackground = {
    source: "banner",
    blur: 40,
    opacity: 0.4,
    scale: 1.2
};

function defaultFill(kind: Fill["kind"]): Fill {
    switch (kind) {
        case "solid": return { kind: "solid", color: DEFAULT_STOPS[0] };
        // 180° es de arriba abajo, la misma dirección que usa Discord en su
        // degradado de perfil nativo. Así el CSS y el tema nativo coinciden.
        case "linear": return { kind: "linear", angle: 180, stops: [...DEFAULT_STOPS] };
        case "conic": return { kind: "conic", stops: [...DEFAULT_STOPS, "#00ffcc"] };
    }
}

const Native = VencordNative.pluginHelpers.xcord as PluginNative<typeof import("../native")>;

/** Tope de Catbox. Aquí el tamaño casi no importa: el archivo se va fuera. */
const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/**
 * Por encima de esto no dejamos incrustar. El archivo se guarda como texto
 * base64 dentro de settings.json, que Vencord lee y escribe constantemente;
 * un perfil de varios megas lo vuelve lento para todo lo demás.
 */
const MAX_EMBED_BYTES = 4 * 1024 * 1024;

/** Avisamos a partir de aquí, pero dejamos continuar. */
const WARN_EMBED_BYTES = 1024 * 1024;

function formatSize(bytes: number): string {
    return bytes < 1024 * 1024
        ? `${Math.round(bytes / 1024)} KB`
        : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * Abre el selector de archivos y devuelve la imagen como data-URI.
 *
 * No hay forma de referenciar un archivo local por ruta: el renderer de Discord
 * bloquea `file://`. Incrustarlo es la única vía, y por eso el límite de tamaño.
 */
function pickImageFile(maxBytes: number): Promise<{ dataUri: string; name: string; size: number; type: string; } | null> {
    return new Promise(resolve => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/*";

        input.onchange = () => {
            const file = input.files?.[0];
            if (!file) return resolve(null);

            if (file.size > maxBytes) {
                alert(`"${file.name}" pesa ${formatSize(file.size)} y el máximo aquí es ${formatSize(maxBytes)}.`);
                return resolve(null);
            }

            const reader = new FileReader();
            reader.onload = () => resolve({
                dataUri: reader.result as string,
                name: file.name,
                size: file.size,
                type: file.type || "application/octet-stream"
            });
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        };

        input.click();
    });
}

/** `#abc` → `#aabbcc`. El input nativo solo acepta la forma larga. */
function normalizeHex(hex: string): string {
    const h = hex.replace("#", "").trim();
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    return /^[0-9a-f]{6}$/i.test(full) ? `#${full}` : "#000000";
}

/** El ColorPicker de Discord habla en enteros; nuestro schema, en hex. */
function hexToInt(hex: string): number {
    return parseInt(normalizeHex(hex).slice(1), 16);
}

function intToHex(value: number): string {
    return "#" + (value >>> 0).toString(16).padStart(6, "0").slice(-6);
}

const SUGGESTED_COLORS = [
    "#ff00cc", "#3333ff", "#00ffcc", "#ffcc00",
    "#ff3366", "#33ff66", "#ffffff", "#000000"
];

/**
 * Fuerza la carga del chunk donde vive el selector de color de Discord.
 *
 * El componente no falta: Vencord lo captura con un patch sobre los ajustes de
 * personalización de perfil. Pero hasta que Discord carga ese chunk, la
 * referencia vale `() => null` y no se renderiza nada — que es justo lo que
 * pasaba al abrir el editor desde el perfil en vez de desde los ajustes.
 */
const requireColorPicker = extractAndLoadChunksLazy(
    ["#{intl::USER_SETTINGS_PROFILE_COLOR_SELECT_COLOR}),focusProps:"]
);

/**
 * Referencia al ColorPicker tal como está *antes* de forzar la carga.
 *
 * Mientras Vencord no lo haya capturado, vale `() => null`. Comparar contra esta
 * referencia es la única forma fiable de saber si de verdad hay un componente:
 * que el chunk cargue no garantiza que el patch de extracción haya corrido, y
 * renderizar el stub no falla — simplemente no pinta nada, que es peor porque
 * parece que el editor está roto.
 */
const colorPickerStub = ColorPicker;

/** true solo si hay un ColorPicker real, no el stub que no renderiza nada. */
function useDiscordColorPicker(): boolean {
    const [usable, setUsable] = useState(false);

    useEffect(() => {
        let alive = true;
        requireColorPicker()
            .then(() => alive && setUsable(ColorPicker !== colorPickerStub))
            // Si el chunk no carga, no es fatal: usamos el input nativo.
            .catch(() => alive && setUsable(false));
        return () => { alive = false; };
    }, []);

    return usable;
}

/**
 * Selector de color: el de Discord cuando está disponible, el del sistema si no.
 *
 * El campo de texto va siempre al lado para poder pegar un hex exacto.
 */
function ColorField({ value, onChange }: { value: string; onChange: (hex: string) => void; }) {
    const discordReady = useDiscordColorPicker();

    return (
        <Flex style={{ alignItems: "center", gap: "4px" }}>
            {discordReady ? (
                <ColorPicker
                    color={hexToInt(value)}
                    onChange={(v: number) => onChange(intToHex(v))}
                    suggestedColors={SUGGESTED_COLORS}
                    showEyeDropper
                />
            ) : (
                <input
                    type="color"
                    value={normalizeHex(value)}
                    onChange={e => onChange(e.currentTarget.value)}
                    title="Elegir color"
                    style={{
                        width: "40px",
                        height: "32px",
                        padding: "2px",
                        // Con `border: none` y fondo transparente el control se
                        // volvía invisible sobre el tema oscuro de Discord.
                        border: "1px solid var(--background-modifier-accent)",
                        borderRadius: "4px",
                        background: "var(--input-background)",
                        cursor: "pointer",
                        flexShrink: 0
                    }}
                />
            )}

            <TextInput
                value={value}
                onChange={onChange}
                style={{ width: "92px" }}
            />
        </Flex>
    );
}

/**
 * Vuelca en la consola los marcos y efectos que el cliente conoce.
 *
 * No mantenemos una lista fija: envejecería con cada colección nueva de la
 * tienda. Preguntamos al propio Discord, que ya tiene el catálogo cargado.
 *
 * Los nombres de estos stores no están garantizados entre versiones, así que
 * cada búsqueda va protegida y la función informa en vez de fallar.
 */
/**
 * Pide el catálogo de la tienda a través del cliente de Discord.
 *
 * `collectibles-categories` existe pero requiere autenticación: por HTTP directo
 * devuelve 401. `RestAPI` es la capa del propio cliente, que ya va autenticada,
 * así que no manejamos ningún token — se lo pedimos a Discord como haría
 * cualquier parte de su interfaz. Tampoco hay problema de CSP: es su origen.
 */
/**
 * El nombre de tipo que espera `/shop/search` para cada sección.
 *
 * Verificado probando varios candidatos: `collectibles-shop?tab=home` daba un
 * "destacado" que rota y a veces no incluye ningún borde o placa —de ahí que
 * el catálogo pareciera vacío sin estarlo—. `/shop/search` es la ruta
 * dedicada que usa la propia pantalla "Explora la tienda", paginada y
 * exhaustiva de verdad.
 */
const SHOP_ITEM_TYPES: Record<keyof Catalog, string> = {
    decorations: "AVATAR_DECORATION",
    effects: "PROFILE_EFFECT",
    borders: "PROFILE_FRAME",
    nameplates: "NAMEPLATE"
};

/** Cuántos elementos traer por sección. Cada uno cuesta una petición aparte. */
const CATALOG_PAGE_SIZE = 24;

/** CDN de las miniaturas de la tienda, visto en la pestaña Network. */
const SHOP_CDN = "https://cdn.discordapp.com/media/v1/collectibles-shop";

/**
 * `type` de una pieza dentro de un producto de coleccionables. Verificado con
 * cuatro ejemplos reales, dos por tipo:
 *
 *   0 — anillo de avatar. `asset` directo, formato `a_<hex>` si es animado.
 *   1 — efecto de perfil. Necesita el puntero `profileEffect` además de
 *       aparecer en `collectibles`.
 *   2 — nameplate (fondo del nombre). No implementado.
 *   3 — borde de tarjeta. En el perfil de un usuario con uno puesto, vivía
 *       solo como entrada en `collectibles`, sin puntero dedicado — es la
 *       hipótesis que estamos probando.
 *
 * `/users/@me/collectibles-purchases` es el único de nuestros endpoints que
 * trae marcos de avatar con su `asset` completo, pero son los que ya posees,
 * no el catálogo entero de la tienda.
 */
/** El mismo CDN que usa el patch de `getAvatarDecorationURL` en index.tsx. */
const DECORATION_CDN = "https://cdn.discordapp.com/avatar-decoration-presets";

const COLLECTIBLE_DECORATION = 0;
const COLLECTIBLE_EFFECT = 1;
const COLLECTIBLE_NAMEPLATE = 2;
const COLLECTIBLE_BORDER = 3;

/** Los recursos de la tienda se nombran con un hash de 64 caracteres. */
const ASSET_HASH = /^[0-9a-f]{64}$/;

export interface CatalogEntry {
    id: string;
    title: string;
    /** En marcos: el recurso sobre el avatar. En placas: la ruta del asset. */
    asset?: string;
    /** Solo placas: el esquema de color con el que Discord la pinta. */
    palette?: string;
    /** Hash de la imagen de vista previa, si el catálogo la trae. */
    thumbnail?: string;
    /**
     * Solo bordes: las mismas capas y medidas de desborde que ya pedimos al
     * elegir un borde de verdad (`fetchCardBorder`), pero capturadas acá
     * mismo durante el escaneo del catálogo — vienen en la misma respuesta,
     * así que arman el preview compuesto sin ninguna petición aparte.
     */
    frame?: { layers: CardBorderLayer[]; overflowTop: number; overflowBottom: number; overflowHorizontal: number; innerWidth: number; };
}

interface Catalog {
    effects: CatalogEntry[];
    borders: CatalogEntry[];
    /** Solo los que ya posees: es lo único que trae asset completo. */
    decorations: CatalogEntry[];
    nameplates: CatalogEntry[];
}

/**
 * La miniatura de un elemento de la tienda, ya como URL lista para usar.
 *
 * Discord la da hecha en `thumbnailPreviewSrc`. Mis dos intentos anteriores
 * fallaron por lo mismo: buscaba un hash suelto, y el hash viene dentro de una
 * URL completa. `reducedMotionSrc` es la variante estática, buen recambio.
 */
function findThumbnail(node: any): string | undefined {
    if (!node || typeof node !== "object") return undefined;

    const direct = node.thumbnailPreviewSrc ?? node.staticFrameSrc ?? node.reducedMotionSrc;
    if (typeof direct === "string" && direct.startsWith("https://")) return direct;

    // El paquete que envuelve la pieza trae su propia miniatura —del paquete
    // entero, no de la pieza suelta—, en `preview_assets`. Es lo único que
    // tienen la placa y el borde: ninguno de los dos trae imagen propia.
    const bundle = node.preview_assets?.bg_static ?? node.preview_assets?.fg_static;
    if (typeof bundle === "string") return bundle;

    // Algunos elementos dan el recurso como hash suelto; ahí sí toca componer.
    for (const value of Object.values(node)) {
        if (typeof value === "string" && ASSET_HASH.test(value))
            return `${SHOP_CDN}/${value}?size=128`;
    }
    return undefined;
}

/**
 * Recorre el JSON entero recogiendo efectos y marcos.
 *
 * Intenté adivinar cómo anida Discord los productos —`products[]`, `items[]`—
 * y fallé. Un recorrido en profundidad no necesita saberlo: busca objetos con
 * la forma de un efecto (`profile_effect` con id) o de un marco
 * (`avatar_decoration` con asset), estén donde estén. Sobrevive a que Discord
 * reorganice la respuesta, que es exactamente lo que nos ha estado costando.
 */
function scanCatalog(node: any, out: Catalog, depth = 0, title = "") {
    if (!node || typeof node !== "object" || depth > 8) return;

    if (Array.isArray(node)) {
        for (const item of node) scanCatalog(item, out, depth + 1, title);
        return;
    }

    // El nombre suele estar en el producto que envuelve al efecto, no en él.
    const label = node.name || node.summary || title;

    // Un producto de la tienda lleva sus piezas en `items[]`, y cada pieza dice
    // qué es con `type`. Es el mismo `type` que aparece en `collectibles`
    // dentro del perfil, así que basta con guardar el skuId — no hace falta
    // extraer nada más de la pieza.
    for (const item of Array.isArray(node.items) ? node.items : []) {
        const skuId = item?.sku_id ?? item?.skuId ?? node.sku_id;
        if (!skuId) continue;

        const bucket = item?.type === COLLECTIBLE_EFFECT ? out.effects
            : item?.type === COLLECTIBLE_BORDER ? out.borders
            : item?.type === COLLECTIBLE_DECORATION ? out.decorations
            : item?.type === COLLECTIBLE_NAMEPLATE ? out.nameplates
            : null;
        if (!bucket) continue;

        // Para placa y borde, `item?.title` suele ser una descripción larga
        // en vez de un nombre — el paquete que los envuelve (`label`) es lo
        // que de verdad identifica de qué colección son, y es más útil para
        // reconocerlos de un vistazo que su propia descripción.
        const title = item?.type === COLLECTIBLE_BORDER || item?.type === COLLECTIBLE_NAMEPLATE
            ? (label || item?.title || item?.label || String(skuId))
            : (item?.title || item?.label || label || String(skuId));
        // Las decoraciones dan un asset directamente pintable como imagen; el
        // de la placa es una ruta, no sabemos construir su URL de CDN
        // todavía, así que no forzamos una miniatura para ella — pero sí hay
        // que guardar la ruta, es lo que se aplica al elegirla.
        const asset = item?.type === COLLECTIBLE_DECORATION || item?.type === COLLECTIBLE_NAMEPLATE
            ? item?.asset
            : undefined;
        const palette = item?.type === COLLECTIBLE_NAMEPLATE ? item?.palette : undefined;
        // Para el borde probamos el mismo CDN que ya usamos para sus capas
        // individuales, pero sin capa —por si el propio sku sirve una imagen
        // ya compuesta del borde entero—. Si no existe, el <img> simplemente
        // no carga y cae al texto; no cuesta nada intentarlo.
        const borderGuess = item?.type === COLLECTIBLE_BORDER
            ? `${SHOP_CDN}/${skuId}/static`
            : undefined;

        // Las mismas capas y desbordes que ya pedíamos aparte al aplicar un
        // borde de verdad —confirmado con la respuesta real de
        // `/collectibles-products/{sku}`— ya vienen en esta misma respuesta.
        const frame = item?.type === COLLECTIBLE_BORDER && Array.isArray(item?.layers)
            ? {
                layers: item.layers.map((l: any) => ({
                    id: String(l.id),
                    anchor: l.anchor === "bottom" ? "bottom" as const : "top" as const,
                    order: l.order === "front" ? "front" as const : "back" as const
                })),
                overflowTop: Number(item.overflow_top) || 0,
                overflowBottom: Number(item.overflow_bottom) || 0,
                overflowHorizontal: Number(item.overflow_horizontal) || 0,
                innerWidth: Number(item.inner_width) || 1200
            }
            : undefined;

        const thumbnail = item?.type === COLLECTIBLE_DECORATION && asset
            ? `${DECORATION_CDN}/${asset}.png?size=80&passthrough=true`
            : findThumbnail(item) ?? findThumbnail(node) ?? borderGuess;

        if (!bucket.some(e => e.id === String(skuId)))
            bucket.push({ id: String(skuId), title, thumbnail, asset, palette, frame });
    }

    for (const value of Object.values(node)) scanCatalog(value, out, depth + 1, label);
}

/**
 * Pide el detalle completo de un producto para construir su `CardBorder`.
 *
 * El catálogo de la tienda solo trae el skuId y el título; las capas y los
 * márgenes de desbordamiento —lo que hace falta para posicionarlas— viven en
 * el detalle de cada producto, un pedido aparte.
 */
async function fetchCardBorder(skuId: string): Promise<CardBorder | null> {
    try {
        const { body } = await RestAPI.get({ url: `/collectibles-products/${skuId}` });
        const item = body?.items?.[0];
        const layers = item?.layers;

        if (!Array.isArray(layers) || !layers.length) {
            console.warn("[xcord] producto sin layers reconocibles:", body);
            return null;
        }

        return {
            skuId: String(body.sku_id ?? skuId),
            layers: layers.map((l: any) => ({
                id: String(l.id),
                anchor: l.anchor === "bottom" ? "bottom" : "top",
                order: l.order === "front" ? "front" : "back"
            })),
            overflowTop: Number(item.overflow_top) || 0,
            overflowBottom: Number(item.overflow_bottom) || 0,
            overflowHorizontal: Number(item.overflow_horizontal) || 0,
            innerWidth: Number(item.inner_width) || 1200
        };
    } catch (err) {
        console.error("[xcord] fallo al pedir el borde:", err);
        return null;
    }
}

/**
 * Carga el catálogo y aplica solo la parte que le corresponde a una sección.
 *
 * Las tres secciones comparten las mismas peticiones de red por debajo —el
 * catálogo entero sale de las mismas rutas—, pero cada botón "Cargar
 * catálogo" solo debe rellenar su propia cuadrícula, no las otras dos de
 * golpe: así el marco del avatar no aparece poblado solo porque pulsaste el
 * botón de efectos.
 */
/**
 * Carga una página del catálogo y la añade a lo que ya había, en vez de
 * reemplazarlo — así "Cargar más" no borra lo que ya elegiste ver.
 */
async function loadCatalogSection(
    key: keyof Catalog,
    offset: number,
    query: string,
    setLoading: (v: boolean) => void,
    setHasMore: (v: boolean) => void,
    entries: CatalogEntry[],
    apply: (entries: CatalogEntry[]) => void
) {
    setLoading(true);
    try {
        const page = await fetchCatalogSection(key, offset, query);
        console.log(`[xcord] catálogo de ${key} (offset ${offset}, búsqueda "${query}"):`, page);

        if (!page.entries.length && offset === 0) {
            alert(
                "Discord respondió, pero no reconocí nada en esta sección.\n\n" +
                "Mira la consola: dejé la respuesta cruda impresa para poder leer su forma."
            );
            return;
        }

        apply([...entries, ...page.entries]);
        setHasMore(page.hasMore);
    } catch (err) {
        // Sin esto la promesa se rechazaba en silencio y el botón parecía no
        // hacer nada en absoluto.
        console.error("[xcord] fallo al cargar el catálogo:", err);
        alert(`Fallo al cargar el catálogo: ${err}`);
    } finally {
        setLoading(false);
    }
}

/**
 * Trae una página del catálogo de una sola sección desde la tienda de verdad.
 *
 * En dos pasos: `/shop/search` da la lista de skus del tipo pedido para esa
 * página —paginada de verdad, no un "destacado" que rota—, y por cada sku se
 * pide su ficha completa en `/collectibles-products/<sku>`, la misma que ya
 * sabemos leer. Cuesta una petición extra por elemento, pero es la única
 * forma de tener un catálogo de verdad en vez de lo que hubiera quedado
 * featured hoy.
 */
async function fetchCatalogSection(
    key: keyof Catalog,
    offset: number,
    query: string
): Promise<{ entries: CatalogEntry[]; hasMore: boolean; }> {
    const itemType = SHOP_ITEM_TYPES[key];
    const q = query.trim();

    // Con texto de búsqueda, Discord pide sort_type=relevance —confirmado
    // viendo la petición real de su propia pantalla "Explora la tienda"—.
    // Sin texto, es la búsqueda de siempre por popularidad. Una búsqueda de
    // verdad contra su catálogo entero, no un filtro sobre lo ya cargado: sí
    // encuentra algo recién agregado aunque todavía no sea popular.
    const params = new URLSearchParams({
        item_types: itemType,
        limit: String(CATALOG_PAGE_SIZE),
        offset: String(offset),
        sort_type: q ? "relevance" : "popularity",
        sort_direction: "desc"
    });
    if (q) params.set("search", q);

    const { body: search } = await RestAPI.get({ url: `/shop/search?${params.toString()}` });
    const skus: string[] = search?.skus ?? [];
    console.log(`[xcord] ${itemType}: ${skus.length} de ${search?.pagination?.total ?? "?"} en total`);

    const products = await Promise.all(skus.map(async sku => {
        try {
            const { body } = await RestAPI.get({ url: `/collectibles-products/${sku}` });
            return body;
        } catch (err) {
            console.warn(`[xcord] no pude leer el producto ${sku}:`, err);
            return null;
        }
    }));

    const out: Catalog = { effects: [], borders: [], decorations: [], nameplates: [] };
    for (const product of products) {
        if (product) scanCatalog(product, out);
    }
    return { entries: out[key], hasMore: !!search?.pagination?.has_more };
}

/**
 * Acepta tanto un identificador suelto como la URL completa que da
 * «View Avatar Decoration» (`.../avatar-decoration-presets/<asset>.png?...`),
 * y devuelve solo el identificador. Así no hace falta recortarlo a mano.
 */
function extractDecorationAsset(input: string): string {
    const trimmed = input.trim();
    const match = /avatar-decoration-presets\/([^/?]+)/.exec(trimmed);
    return match ? match[1].replace(/\.\w+$/, "") : trimmed;
}

/** Quita el prefijo `data:<mime>;base64,` y deja solo la carga útil. */
function stripDataUri(dataUri: string): string {
    return dataUri.slice(dataUri.indexOf(",") + 1);
}

const FIT_OPTIONS = [
    { label: "Rellenar (recorta lo que sobre)", value: "cover" },
    { label: "Ajustar completo (puede dejar franjas)", value: "contain" }
] as const;

/**
 * Encuadre de una imagen (banner o avatar) arrastrando sobre una vista
 * previa, igual que el recorte nativo de Discord al subir una — salvo que
 * aquí no se recorta de verdad: solo cambia `background-position`, así que
 * sigue funcionando con GIFs animados y no hace falta reprocesar el archivo.
 */
/** Misma fórmula que `imageSizeCss` en css.ts — el preview no puede mentir. */
function previewBackgroundSize(fit: "cover" | "contain", zoom: number): string {
    return zoom > 1 ? `${Math.round(zoom * 100)}% auto` : fit;
}

function ImagePositionPicker({ url, fit, positionX, positionY, zoom, onChange, aspectRatio = "1200 / 468", round = false }: {
    url: string;
    fit: "cover" | "contain";
    positionX: number;
    positionY: number;
    zoom: number;
    onChange: (x: number, y: number) => void;
    /** "1200 / 468" para el banner de Discord, "1 / 1" para el avatar. */
    aspectRatio?: string;
    /** El avatar es circular; la vista previa lo refleja para no elegir a ciegas. */
    round?: boolean;
}) {
    const [dragging, setDragging] = useState(false);

    const updateFromEvent = (el: HTMLElement, clientX: number, clientY: number) => {
        const rect = el.getBoundingClientRect();
        const x = Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
        const y = Math.min(100, Math.max(0, ((clientY - rect.top) / rect.height) * 100));
        onChange(Math.round(x), Math.round(y));
    };

    return (
        <div
            onMouseDown={e => {
                setDragging(true);
                updateFromEvent(e.currentTarget, e.clientX, e.clientY);
            }}
            onMouseMove={e => {
                if (dragging) updateFromEvent(e.currentTarget, e.clientX, e.clientY);
            }}
            onMouseUp={() => setDragging(false)}
            onMouseLeave={() => setDragging(false)}
            style={{
                width: round ? "140px" : "100%",
                aspectRatio,
                borderRadius: round ? "50%" : "8px",
                cursor: dragging ? "grabbing" : "grab",
                backgroundImage: `url("${url}")`,
                backgroundSize: previewBackgroundSize(fit, zoom),
                backgroundPosition: `${positionX}% ${positionY}%`,
                backgroundRepeat: "no-repeat",
                backgroundColor: "var(--background-secondary)",
                border: "1px solid var(--background-modifier-accent)",
                position: "relative",
                userSelect: "none",
                overflow: "hidden"
            }}
        >
            <div
                style={{
                    position: "absolute",
                    left: `${positionX}%`,
                    top: `${positionY}%`,
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    background: "var(--brand-500)",
                    border: "2px solid white",
                    transform: "translate(-50%, -50%)",
                    pointerEvents: "none"
                }}
            />
        </div>
    );
}

/** Los cuatro ángulos que la gente usa el 90% del tiempo. */
const ANGLE_PRESETS = [
    { label: "↓ Arriba abajo", value: 180 },
    { label: "→ Izq. a der.", value: 90 },
    { label: "↘ Diagonal", value: 135 },
    { label: "↑ Abajo arriba", value: 0 }
];

/**
 * El ángulo, plegado tras un botón.
 *
 * La dirección por defecto (arriba abajo) es la que casi nadie va a cambiar, así
 * que ocupar sitio permanente con un control era ruido. Se despliega al pulsar.
 */
function AngleControl({ angle, onChange }: { angle: number; onChange: (a: number) => void; }) {
    const [open, setOpen] = useState(false);

    return (
        <div className={Margins.top8}>
            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.PRIMARY}
                onClick={() => setOpen(!open)}
            >{`Ángulo: ${angle}° ${open ? "▲" : "▼"}`}</Button>

            {open && (
                <div className={Margins.top8}>
                    <Flex style={{ flexWrap: "wrap", gap: "4px" }}>
                        {ANGLE_PRESETS.map(preset => (
                            <Button
                                key={preset.value}
                                size={Button.Sizes.SMALL}
                                color={angle === preset.value ? Button.Colors.BRAND : Button.Colors.PRIMARY}
                                onClick={() => onChange(preset.value)}
                            >{preset.label}</Button>
                        ))}
                    </Flex>

                    <div className={Margins.top8}>
                        <Slider
                            minValue={0}
                            maxValue={360}
                            initialValue={angle}
                            onValueChange={(v: number) => onChange(Math.round(v))}
                            markers={[0, 45, 90, 135, 180, 225, 270, 315, 360]}
                            onMarkerRender={(v: number) => `${v}°`}
                        />
                    </div>
                </div>
            )}
        </div>
    );
}

/**
 * Cuadrícula de elementos de la tienda con su miniatura.
 *
 * Los nombres por sí solos no dicen nada — «Aurora», «Nebulosa»— así que un
 * desplegable de texto obligaba a elegir a ciegas. Con la imagen delante se
 * elige mirando, que es como funciona la tienda de Discord.
 */
function CatalogGrid({ entries, selected, onSelect }: {
    entries: CatalogEntry[];
    /** El valor guardado: el `asset` en marcos, el `id` en efectos. */
    selected: string;
    onSelect: (value: string) => void;
}) {
    const valueOf = (entry: CatalogEntry) => entry.asset ?? entry.id;

    return (
        <div
            style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
                // Los marcos se salen del cuadrado de su propia casilla a
                // propósito —es la misma cuadrícula nativa de Discord la que
                // les deja aire alrededor en vez de recortarlos—; sin este
                // espacio de más, cada marco se pisaría con el de al lado.
                gap: "20px",
                maxHeight: "260px",
                overflowY: "auto",
                padding: "16px 4px"
            }}
        >
            <Clickable
                onClick={() => onSelect("")}
                style={{
                    aspectRatio: "1",
                    display: "grid",
                    placeItems: "center",
                    borderRadius: "6px",
                    fontSize: "11px",
                    border: `2px solid ${selected === "" ? "var(--brand-500)" : "transparent"}`,
                    background: "var(--background-secondary)"
                }}
            >Ninguno</Clickable>

            {entries.map(entry => (
                <CatalogTile
                    key={valueOf(entry)}
                    entry={entry}
                    selected={selected === valueOf(entry)}
                    onSelect={() => onSelect(valueOf(entry))}
                />
            ))}
        </div>
    );
}

/**
 * Miniatura compuesta de un borde de perfil: el avatar de muestra en el
 * centro con las capas del marco (frente/fondo, arriba/abajo) superpuestas.
 *
 * Reproduce el modelo real de Discord, confirmado con el CSS calculado del
 * `previewContainer` nativo: el contenedor reserva el desborde como
 * `padding` en sus cuatro lados —así el avatar de muestra ocupa
 * exactamente el área "segura"—, y cada capa mide el 100% de ese mismo
 * contenedor pero se desplaza hacia afuera con un `top`/`bottom` negativo,
 * empujándose hacia la zona reservada por el padding en vez de ensancharse.
 *
 * El propio Discord usa unidades de container query (`cqw`) para ese
 * desplazamiento en vez de porcentaje simple: en CSS, `top`/`bottom` en
 * porcentaje se calculan contra la ALTURA del contenedor, no el ancho, así
 * que sin esto el resultado se rompe en cuanto la casilla no es
 * perfectamente cuadrada. `cqw` fuerza que todo —alto y ancho— escale
 * contra el ancho del contenedor, que es lo que la matemática de Discord
 * (basada en `innerWidth`) espera en los cuatro lados.
 */
function BorderFramePreview({ entry }: { entry: CatalogEntry; }) {
    const frame = entry.frame!;
    const cqw = (v: number) => `${(v / frame.innerWidth) * 100}cqw`;
    // El avatar de muestra genérico de Discord vive en un recurso interno que
    // no es estable entre builds —la URL que sacamos del HTML del preview
    // nativo ya no cargaba—; el propio avatar del usuario es igual de válido
    // para la vista previa y no depende de ningún hash adivinado.
    const sampleAvatarUrl = UserStore.getCurrentUser()?.getAvatarURL?.(undefined, 80) ?? "";

    const renderLayer = (layer: CardBorderLayer) => (
        <img
            key={layer.id}
            src={`${SHOP_CDN}/${entry.id}/${layer.id}/static`}
            alt=""
            loading="lazy"
            style={{
                position: "absolute",
                left: 0,
                right: 0,
                width: "100%",
                [layer.anchor === "top" ? "top" : "bottom"]:
                    `-${cqw(layer.anchor === "top" ? frame.overflowTop : frame.overflowBottom)}`,
                zIndex: layer.order === "front" ? 2 : 0,
                pointerEvents: "none"
            }}
        />
    );

    return (
        <div style={{ position: "relative", width: "100%", height: "100%", overflow: "visible", containerType: "inline-size" } as any}>
            <div
                style={{
                    position: "relative",
                    width: "100%",
                    height: "100%",
                    boxSizing: "border-box",
                    paddingTop: cqw(frame.overflowTop),
                    paddingBottom: cqw(frame.overflowBottom),
                    paddingInline: cqw(frame.overflowHorizontal)
                }}
            >
                <img
                    src={sampleAvatarUrl}
                    alt=""
                    loading="lazy"
                    style={{
                        position: "relative",
                        zIndex: 1,
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: "4px"
                    }}
                />
                {frame.layers.map(renderLayer)}
            </div>
        </div>
    );
}

/**
 * Una casilla del catálogo, con su propio estado de "la imagen no cargó".
 *
 * Hace falta como componente aparte —no en línea dentro del `.map`— porque
 * `useState` necesita vivir en un componente propio para no compartirse entre
 * casillas. Algunas miniaturas son adivinadas (el borde, por ejemplo, prueba
 * un patrón de URL sin confirmar); si el servidor devuelve un 404, caemos al
 * texto en vez de mostrar el icono de imagen rota.
 */
function CatalogTile({ entry, selected, onSelect }: {
    entry: CatalogEntry;
    selected: boolean;
    onSelect: () => void;
}) {
    const [failed, setFailed] = useState(false);
    const showImage = entry.thumbnail && !failed;

    return (
        <Clickable
            onClick={onSelect}
            style={{
                aspectRatio: "1",
                borderRadius: "6px",
                // Los marcos se salen a propósito del cuadrado de su propia
                // casilla —confirmado con el HTML real de "Explora la
                // tienda": cada fila del grid nativo reserva ~12px de aire
                // alrededor de una casilla de 80px para que el dibujo no se
                // recorte—. Recortar acá tapaba justo la parte que hace que
                // el marco se vea completo.
                overflow: entry.frame ? "visible" : "hidden",
                border: `2px solid ${selected ? "var(--brand-500)" : "transparent"}`,
                background: "var(--background-secondary)"
            }}
        >
            {entry.frame ? (
                <BorderFramePreview entry={entry} />
            ) : showImage ? (
                <img
                    src={entry.thumbnail}
                    alt={entry.title}
                    title={entry.title}
                    loading="lazy"
                    onError={() => setFailed(true)}
                    style={{ width: "100%", height: "100%", objectFit: "contain" }}
                />
            ) : (
                // Sin miniatura en el catálogo: al menos el nombre.
                <div style={{
                    height: "100%",
                    display: "grid",
                    placeItems: "center",
                    fontSize: "10px",
                    padding: "4px",
                    textAlign: "center"
                }} title={entry.title}>{entry.title}</div>
            )}
        </Clickable>
    );
}

/** Editor de un relleno: color plano o lista de paradas de degradado. */
function FillEditor({ fill, onChange }: { fill: Fill; onChange: (f: Fill) => void; }) {
    const stops = fill.kind === "solid" ? [fill.color] : fill.stops;

    const setStop = (index: number, value: string) => {
        if (fill.kind === "solid") return onChange({ kind: "solid", color: value });
        const next = [...fill.stops];
        next[index] = value;
        onChange({ ...fill, stops: next });
    };

    return (
        <>
            <Select
                options={FILL_KINDS as unknown as Array<{ label: string; value: string; }>}
                select={(kind: string) => onChange(defaultFill(kind as Fill["kind"]))}
                isSelected={(kind: string) => kind === fill.kind}
                serialize={(kind: string) => kind}
                closeOnSelect
            />

            {/* Mismo bloque redondeado que el "gradientSwatch" nativo de
                Discord — usa el mismo generador de CSS que la capa real, así
                que lo que se ve acá es exactamente el resultado final. */}
            <div
                className={Margins.top8}
                style={{
                    height: "48px",
                    borderRadius: "8px",
                    background: fillToCss(fill)
                }}
            />

            <Flex className={Margins.top8} style={{ flexWrap: "wrap", gap: "8px" }}>
                {stops.map((stop, i) => (
                    <ColorField key={i} value={stop} onChange={hex => setStop(i, hex)} />
                ))}

                {fill.kind !== "solid" && (
                    <>
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            onClick={() => onChange({ ...fill, stops: [...fill.stops, "#ffffff"] })}
                        >+ color</Button>
                        {stops.length > 2 && (
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.RED}
                                onClick={() => onChange({ ...fill, stops: fill.stops.slice(0, -1) })}
                            >− color</Button>
                        )}
                    </>
                )}
            </Flex>

            {fill.kind === "linear" && (
                <AngleControl
                    angle={fill.angle}
                    onChange={angle => onChange({ ...fill, angle })}
                />
            )}
        </>
    );
}

/** Editor de un estilo de texto completo: relleno, efecto y fuente. */
/**
 * Los 8 efectos de nombre de Nitro, verificados contra `displayNameStyles`
 * real (id, nombre y cantidad de colores que Discord de verdad usa por
 * efecto — el resto del arreglo de 5 colores queda en 0/sin usar).
 */
const NATIVE_NAME_EFFECTS: Array<{ label: string; value: NativeEffectId; colors: number; }> = [
    { label: "Sólido", value: 1, colors: 1 },
    { label: "Degradado", value: 2, colors: 2 },
    { label: "Neón", value: 3, colors: 2 },
    { label: "Toon", value: 4, colors: 2 },
    { label: "Pop", value: 5, colors: 2 },
    { label: "Resplandor", value: 6, colors: 2 },
    { label: "Prisma (degradado animado)", value: 7, colors: 5 },
    { label: "Gomoso", value: 8, colors: 2 }
];

const DEFAULT_NAME_EFFECT_COLORS = ["#ff00cc", "#3333ff", "#00ffcc", "#ffcc00", "#ff3366"];

/**
 * Aproximación en CSS de cómo se va a ver el efecto, solo para el bloque de
 * vista previa del editor — el resultado real lo pinta el componente nativo
 * de Discord (`UserNameWithEffects`), esto es nomás una guía de colores.
 */
function nameEffectPreviewCss(colors: string[], count: number): string {
    const used = colors.slice(0, count).filter(Boolean);
    if (used.length <= 1) return used[0] ?? "#ffffff";
    return `linear-gradient(90deg, ${used.join(", ")})`;
}

/**
 * Vista previa de cómo se ve el efecto en un mensaje y en la lista de
 * miembros — los dos sitios que el preview de perfil (más abajo) no cubre.
 *
 * El nombre lo pinta `UserNameWithEffects`, el mismo componente que usa
 * Discord en esos dos sitios de verdad: por eso el degradado, el brillo o el
 * Prisma animado se ven exactamente iguales acá que en el resto del
 * cliente. El resto —avatar, burbuja, fila— es maquetado propio, liviano a
 * propósito: intentar reusar los componentes reales de mensaje y lista de
 * miembros exigiría los mismos datos de sesión real (canal, guild, store de
 * mensajes) que la propia pantalla de Discord, y no vale la pena solo para
 * un preview.
 */
function NativeNamePreview({ effect }: { effect: NativeNameEffect; }) {
    const user = UserStore.getCurrentUser();
    if (!user) return null;

    const colors = [0, 0, 0, 0, 0];
    effect.colors.slice(0, 5).forEach((hex, i) => { colors[i] = hexToInt(hex); });

    const nameProps = {
        userName: user.globalName || user.username,
        displayNameStyles: { fontId: effect.fontId ?? 0, effectId: effect.effectId, colors },
        effectDisplayType: EFFECT_DISPLAY_TYPE_ANIMATED,
        loop: true
    };
    const avatarUrl = user.getAvatarURL?.(undefined, 64) ?? "";

    return (
        <div className={Margins.top8} style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{
                display: "flex", gap: "12px", padding: "8px 12px",
                borderRadius: "8px", background: "var(--background-secondary)"
            }}>
                <img src={avatarUrl} alt="" style={{ width: "40px", height: "40px", borderRadius: "50%", flexShrink: 0 }} />
                <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                        <UserNameWithEffects {...nameProps} />
                        <Text variant="text-xs/normal" style={{ color: "var(--text-muted)" }}>
                            hoy a las 12:00
                        </Text>
                    </div>
                    <Text variant="text-sm/normal" style={{ color: "var(--text-normal)" }}>
                        Así se ve tu nombre en los mensajes
                    </Text>
                </div>
            </div>

            <div style={{
                display: "flex", alignItems: "center", gap: "8px", padding: "6px 8px",
                borderRadius: "8px", background: "var(--background-secondary)"
            }}>
                <img src={avatarUrl} alt="" style={{ width: "32px", height: "32px", borderRadius: "50%", flexShrink: 0 }} />
                <UserNameWithEffects {...nameProps} />
            </div>
        </div>
    );
}

/**
 * Editor del efecto nativo de nombre de Nitro.
 *
 * A diferencia del resto de los estilos de texto de xcord (CSS propio, solo
 * en el perfil), esto es el mismo dato que usa Discord
 * (`user.displayNameStyles`): un solo ajuste que se ve igual en el perfil,
 * los mensajes y la lista de miembros, porque lo renderiza el propio
 * Discord, no una capa de CSS nuestra.
 */
function NativeNameEffectEditor({ effect, onChange }: {
    effect: NativeNameEffect | undefined;
    onChange: (e: NativeNameEffect | undefined) => void;
}) {
    const enabled = !!effect;
    const current: NativeNameEffect = effect ?? { effectId: 2, colors: DEFAULT_NAME_EFFECT_COLORS.slice(0, 2) };
    const spec = NATIVE_NAME_EFFECTS.find(e => e.value === current.effectId) ?? NATIVE_NAME_EFFECTS[1];

    // Al cambiar de efecto, recorta o completa los colores a los que ese
    // efecto de verdad usa — conservando los que ya elegiste cuando alcanza.
    function setEffectId(id: NativeEffectId) {
        const need = NATIVE_NAME_EFFECTS.find(e => e.value === id)!.colors;
        const colors = Array.from({ length: need }, (_, i) => current.colors[i] ?? DEFAULT_NAME_EFFECT_COLORS[i]);
        onChange({ ...current, effectId: id, colors });
    }

    function setColor(i: number, hex: string) {
        const colors = [...current.colors];
        colors[i] = hex;
        onChange({ ...current, colors });
    }

    return (
        <section className={Margins.top16}>
            <FormSwitch
                title="Personalizar el nombre para mostrar"
                value={enabled}
                onChange={(on: boolean) => onChange(on ? current : undefined)}
                hideBorder
            />

            {enabled && (
                <div style={{ paddingLeft: "12px" }}>
                    <Text variant="text-xs/normal" className={Margins.bottom8}>
                        Es el mismo efecto de Nitro que usa Discord: se ve igual en el perfil,
                        los mensajes y la lista de miembros.
                    </Text>

                    <Forms.FormTitle tag="h5">Efecto</Forms.FormTitle>
                    <Select
                        options={NATIVE_NAME_EFFECTS}
                        select={setEffectId}
                        isSelected={(value: NativeEffectId) => value === current.effectId}
                        serialize={(value: number) => String(value)}
                        closeOnSelect
                    />

                    {/* Mismo bloque redondeado que el "gradientSwatch" nativo
                        de Discord, igual que el de FillEditor más abajo. */}
                    <div
                        className={Margins.top8}
                        style={{
                            height: "48px",
                            borderRadius: "8px",
                            background: nameEffectPreviewCss(current.colors, spec.colors)
                        }}
                    />

                    <Forms.FormTitle tag="h5" className={Margins.top8}>
                        {spec.colors === 1 ? "Color" : "Colores"}
                    </Forms.FormTitle>
                    <Flex style={{ gap: "8px", flexWrap: "wrap" }}>
                        {Array.from({ length: spec.colors }, (_, i) => (
                            <ColorField
                                key={i}
                                value={current.colors[i] ?? DEFAULT_NAME_EFFECT_COLORS[i]}
                                onChange={hex => setColor(i, hex)}
                            />
                        ))}
                    </Flex>

                    <Forms.FormTitle tag="h5" className={Margins.top16}>
                        Vista previa en mensajes y lista de miembros
                    </Forms.FormTitle>
                    <NativeNamePreview effect={current} />
                </div>
            )}
        </section>
    );
}

/**
 * Estado del editor, fuera del componente a propósito.
 *
 * El modal necesita poder guardar desde su barra de acciones, que se renderiza
 * por encima del formulario. Con el estado dentro de ProfileEditor no había
 * forma de llegar a él desde fuera, y el único botón de guardar quedaba
 * enterrado bajo todo el formulario.
 */
export interface DraftController {
    draft: XcordProfile;
    setDraft: (updater: XcordProfile | ((d: XcordProfile) => XcordProfile)) => void;
    /** Hay cambios sin guardar. */
    dirty: boolean;
    save: () => void;
    discard: () => void;
    resetAll: () => void;
}

export function useProfileDraft(initial: XcordProfile, onSave: (p: XcordProfile) => void): DraftController {
    const [draft, setDraft] = useState<XcordProfile>(initial);
    // Lo último guardado, no lo que había al abrir: tras guardar, el editor
    // sigue abierto y "sin cambios" tiene que volver a ser cierto.
    const [saved, setSaved] = useState<XcordProfile>(initial);

    // El preview se repinta con cada cambio y se limpia al cerrar el editor,
    // para que su CSS no quede colgando en el documento.
    useEffect(() => {
        applyPreview(draft);
        return () => clearPreview();
    }, [draft]);

    // El borrador también manda sobre lo que no es CSS —banner, tema, efecto,
    // borde—, para que el preview los muestre sin haber guardado. Se limpia al
    // cerrar el editor: a partir de ahí solo debe verse lo guardado de verdad.
    useEffect(() => {
        setDraftOverride(draft);
        return () => setDraftOverride(null);
    }, [draft]);

    return {
        draft,
        setDraft,
        dirty: JSON.stringify(draft) !== JSON.stringify(saved),
        save: () => {
            onSave(draft);
            setSaved(draft);
        },
        discard: () => setDraft(saved),
        resetAll: () => setDraft(emptyProfile(UserStore.getCurrentUser().id))
    };
}

interface CatalogSectionState {
    entries: CatalogEntry[];
    search: string;
    /** Actualiza el cuadro de texto y dispara la búsqueda real (con demora). */
    setSearch: (v: string) => void;
    loading: boolean;
    hasMore: boolean;
    /** Vuelve a empezar desde el principio, descartando lo ya cargado. */
    reload: () => void;
    /** Trae la siguiente página y la añade a lo que ya había. */
    loadMore: () => void;
}

/** Cuánto esperar tras la última tecla antes de preguntarle al servidor. */
const SEARCH_DEBOUNCE_MS = 400;

/** Estado y carga paginada de una sección del catálogo, sin repetir por cada una. */
function useCatalogSection(key: keyof Catalog): CatalogSectionState {
    const [entries, setEntries] = useState<CatalogEntry[]>([]);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(false);
    const [search, setSearch] = useState("");
    const debounceRef = useRef<number>();

    const load = (offset: number, base: CatalogEntry[], query: string) =>
        loadCatalogSection(key, offset, query, setLoading, setHasMore, base, setEntries);

    return {
        entries,
        search,
        setSearch: (v: string) => {
            setSearch(v);
            // Una búsqueda de verdad contra el servidor, no un filtro local —
            // por eso la demora: sin ella, cada tecla dispararía su propia
            // petición.
            window.clearTimeout(debounceRef.current);
            debounceRef.current = window.setTimeout(() => load(0, [], v), SEARCH_DEBOUNCE_MS);
        },
        loading,
        hasMore,
        reload: () => load(0, [], search),
        loadMore: () => load(entries.length, entries, search)
    };
}

/**
 * Buscador contra el catálogo real de Discord, no un filtro sobre lo ya
 * cargado — encuentra algo recién agregado aunque todavía no sea popular.
 * No hace falta "Cargar catálogo" primero: escribir aquí ya trae resultados.
 */
function CatalogSearchInput({ section }: { section: CatalogSectionState; }) {
    return (
        <div className={Margins.top8}>
            <TextInput
                value={section.search}
                placeholder="Buscar en la tienda…"
                onChange={(v: string) => section.setSearch(v)}
            />
        </div>
    );
}

/** "Cargar catálogo" la primera vez, "Cargar más" mientras queden páginas. */
function CatalogLoadButtons({ section }: { section: CatalogSectionState; }) {
    return (
        <Flex className={Margins.top8}>
            <Button
                size={Button.Sizes.SMALL}
                color={Button.Colors.PRIMARY}
                disabled={section.loading}
                onClick={section.reload}
            >
                {section.loading && !section.entries.length ? "Cargando…"
                    : `Cargar catálogo${section.entries.length ? ` (${section.entries.length})` : ""}`}
            </Button>

            {section.entries.length > 0 && section.hasMore && (
                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    disabled={section.loading}
                    onClick={section.loadMore}
                >{section.loading ? "Cargando…" : "Cargar más"}</Button>
            )}
        </Flex>
    );
}

export interface SyncActions {
    publish: () => Promise<{ ok: boolean; error?: string; }>;
    unpublish: () => Promise<{ ok: boolean; error?: string; }>;
    /** Abre el navegador para el login real de Discord. Tarda mientras apruebas ahí. */
    link: () => Promise<{ ok: boolean; error?: string; }>;
    /** Si el secreto actual viene de un login verificado, o de una reclamación local. */
    isVerified: () => boolean;
}

export function ProfileEditor({ controller, showActions = true, sync }: {
    controller: DraftController;
    /** El modal pone sus propias acciones arriba; aquí sobran. */
    showActions?: boolean;
    /**
     * Vive en index.tsx, no aquí: Editor.tsx no puede importar de index.tsx
     * sin crear un ciclo (index.tsx ya importa Editor.tsx). Se pasa como prop,
     * igual que `onSave`.
     */
    sync?: SyncActions;
}) {
    const { draft, setDraft, dirty } = controller;
    const [uploading, setUploading] = useState(false);
    const [loadingBorder, setLoadingBorder] = useState(false);
    const [syncing, setSyncing] = useState(false);
    // El catálogo de cada sección se pide bajo demanda, no al abrir el editor:
    // es una petición de red y la mayoría de las visitas no van a tocar
    // ninguna sección de la tienda.
    const decorations = useCatalogSection("decorations");
    const effects = useCatalogSection("effects");
    const borders = useCatalogSection("borders");
    const nameplates = useCatalogSection("nameplates");

    // Un data-URI no cabe en un campo de texto ni tiene sentido mostrarlo, así
    // que el input pasa a indicar el tamaño de lo incrustado.
    const bannerUrl = draft.banner?.image?.url ?? "";
    const isEmbedded = bannerUrl.startsWith("data:");
    // Base64 son 4 caracteres por cada 3 bytes; la cabecera es despreciable.
    const embeddedSize = isEmbedded ? Math.round(bannerUrl.length * 0.75) : 0;

    const avatarUrl = draft.avatar?.image?.url ?? "";
    const avatarIsEmbedded = avatarUrl.startsWith("data:");
    const avatarEmbeddedSize = avatarIsEmbedded ? Math.round(avatarUrl.length * 0.75) : 0;

    return (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "24px" }}>
            {/* Sin `alignItems: flex-start` a propósito: las dos columnas
                deben estirarse a la altura completa de la fila (el
                comportamiento por defecto de flex), o la de la derecha —más
                corta que la de controles— se queda sin espacio propio donde
                pegarse, y el `sticky` de más abajo deja de "sticky-ar" en
                cuanto el scroll pasa de su propia altura.

                Columna de controles. `minWidth: 0` es necesario para que un
                flex item pueda encogerse por debajo del ancho de su
                contenido —sin esto, texto largo empuja la columna entera y
                la vista previa termina apretada o se cae de la fila. */}
            <div style={{ flex: "1 1 380px", minWidth: 0 }}>
            <Forms.FormTitle tag="h3">Fondo del perfil</Forms.FormTitle>
            <FormSwitch
                title="Personalizar el fondo"
                value={!!draft.background}
                onChange={(on: boolean) => setDraft({
                    ...draft,
                    background: on ? { fill: defaultFill("linear") } : undefined
                })}
                hideBorder
            />
            {draft.background && (
                <div style={{ paddingLeft: "12px" }}>
                    <FillEditor
                        fill={draft.background.fill}
                        onChange={fill => setDraft({
                            ...draft,
                            background: { ...draft.background, fill }
                        })}
                    />

                    <Forms.FormTitle tag="h5" className={Margins.top8}>
                        Atenuar: {Math.round((draft.background.dim ?? 0) * 100)}%
                    </Forms.FormTitle>
                    <Text variant="text-xs/normal">
                        Discord pinta los colores del tema a plena saturación. Súbelo si el
                        fondo resulta demasiado brillante detrás del texto.
                    </Text>
                    <Slider
                        minValue={0}
                        maxValue={0.9}
                        initialValue={draft.background.dim ?? 0}
                        onValueChange={(v: number) => setDraft({
                            ...draft,
                            background: { ...draft.background!, dim: Number(v.toFixed(2)) }
                        })}
                        markers={[0, 0.2, 0.4, 0.6, 0.9]}
                        onMarkerRender={(v: number) => `${Math.round(v * 100)}%`}
                    />
                </div>
            )}

            <Forms.FormTitle tag="h3" className={Margins.top16}>Fondo dinámico</Forms.FormTitle>
            <Text variant="text-sm/normal">
                La capa ampliada y desenfocada detrás de la columna derecha del perfil.
            </Text>
            <FormSwitch
                title="Controlar el fondo dinámico"
                value={!!draft.dynamicBackground}
                onChange={(on: boolean) => setDraft({
                    ...draft,
                    dynamicBackground: on ? DEFAULT_DYNAMIC_BG : undefined
                })}
                hideBorder
            />

            {draft.dynamicBackground && (() => {
                const dyn = draft.dynamicBackground;
                const setDyn = (patch: Partial<DynamicBackground>) =>
                    setDraft({ ...draft, dynamicBackground: { ...dyn, ...patch } });

                return (
                    <div style={{ paddingLeft: "12px" }}>
                        <Select
                            options={DYNAMIC_SOURCES as unknown as Array<{ label: string; value: string; }>}
                            select={(v: string) => setDyn({
                                source: v as DynamicBackground["source"],
                                fill: v === "fill" ? (dyn.fill ?? defaultFill("linear")) : dyn.fill
                            })}
                            isSelected={(v: string) => v === dyn.source}
                            serialize={(v: string) => v}
                            closeOnSelect
                        />

                        {dyn.source === "fill" && (
                            <div className={Margins.top8}>
                                <FillEditor
                                    fill={dyn.fill ?? defaultFill("linear")}
                                    onChange={fill => setDyn({ fill })}
                                />
                            </div>
                        )}

                        <Forms.FormTitle tag="h5" className={Margins.top8}>
                            Desenfoque: {dyn.blur}px
                        </Forms.FormTitle>
                        <Slider
                            minValue={0}
                            maxValue={80}
                            initialValue={dyn.blur}
                            onValueChange={(v: number) => setDyn({ blur: Math.round(v) })}
                            markers={[0, 10, 20, 40, 60, 80]}
                            onMarkerRender={(v: number) => `${v}px`}
                        />

                        <Forms.FormTitle tag="h5" className={Margins.top8}>
                            Opacidad: {Math.round(dyn.opacity * 100)}%
                        </Forms.FormTitle>
                        <Slider
                            minValue={0}
                            maxValue={1}
                            initialValue={dyn.opacity}
                            onValueChange={(v: number) => setDyn({ opacity: Number(v.toFixed(2)) })}
                            markers={[0, 0.25, 0.5, 0.75, 1]}
                            onMarkerRender={(v: number) => `${Math.round(v * 100)}%`}
                        />

                        <Forms.FormTitle tag="h5" className={Margins.top8}>
                            Ampliación: {dyn.scale.toFixed(2)}×
                        </Forms.FormTitle>
                        <Text variant="text-xs/normal">
                            Súbela si con mucho desenfoque ves un halo en los bordes.
                        </Text>
                        <Slider
                            minValue={1}
                            maxValue={1.6}
                            initialValue={dyn.scale}
                            onValueChange={(v: number) => setDyn({ scale: Number(v.toFixed(2)) })}
                            markers={[1, 1.1, 1.2, 1.4, 1.6]}
                            onMarkerRender={(v: number) => `${v}×`}
                        />
                    </div>
                );
            })()}

            <Forms.FormTitle tag="h3" className={Margins.top16}>Nombre para mostrar</Forms.FormTitle>
            <NativeNameEffectEditor
                effect={draft.displayName}
                onChange={displayName => setDraft({ ...draft, displayName })}
            />

            <Forms.FormTitle tag="h3" className={Margins.top16}>Banner</Forms.FormTitle>
            <Text variant="text-sm/normal">
                Pega una URL o elige un archivo de tu equipo. Con URL lo renderiza Discord y anima
                mejor; un archivo local se incrusta en tus ajustes y lo pintamos nosotros.
            </Text>

            <TextInput
                value={isEmbedded ? "" : (draft.banner?.image?.url ?? "")}
                placeholder={isEmbedded ? `Archivo incrustado (${formatSize(embeddedSize)})` : "https://…/banner.gif"}
                onChange={(url: string) => setDraft({
                    ...draft,
                    banner: url ? { ...draft.banner, image: { ...draft.banner?.image, url } } : undefined
                })}
            />

            <Flex className={Margins.top8}>
                <Button
                    size={Button.Sizes.SMALL}
                    disabled={uploading}
                    onClick={async () => {
                        const picked = await pickImageFile(MAX_UPLOAD_BYTES);
                        if (!picked) return;

                        if (!confirm(
                            "Se subirá tu imagen a un servidor público. Tu imagen quedará " +
                            "accesible públicamente para quien tenga el enlace.\n\n¿Deseas continuar?"
                        )) return;

                        setUploading(true);
                        try {
                            const result = await Native.uploadFile(
                                stripDataUri(picked.dataUri), picked.name, picked.type
                            );

                            if (!result.ok || !result.url)
                                return void alert(`No se pudo subir: ${result.error}`);

                            setDraft(d => ({ ...d, banner: { ...d.banner, image: { ...d.banner?.image, url: result.url! } } }));
                        } finally {
                            setUploading(false);
                        }
                    }}
                >{uploading ? "Subiendo…" : "Subir archivo…"}</Button>

                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    disabled={uploading}
                    onClick={async () => {
                        const picked = await pickImageFile(MAX_EMBED_BYTES);
                        if (!picked) return;

                        if (picked.size > WARN_EMBED_BYTES && !confirm(
                            `"${picked.name}" pesa ${formatSize(picked.size)}. Incrustado ocupará ` +
                            `alrededor de ${formatSize(picked.size * 1.34)} en tus ajustes, que Vencord ` +
                            "lee y escribe a menudo.\n\n¿Continuar de todas formas?"
                        )) return;

                        setDraft({
                            ...draft,
                            banner: { ...draft.banner, image: { ...draft.banner?.image, url: picked.dataUri } }
                        });
                    }}
                >Incrustar local…</Button>

                {draft.banner && (
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={() => setDraft({ ...draft, banner: undefined })}
                    >Quitar banner</Button>
                )}
            </Flex>

            {draft.banner?.image?.url && (
                <div className={Margins.top8}>
                    <Text variant="text-xs/normal" className={Margins.bottom8}>
                        Arrastra para elegir qué parte del banner se ve.
                    </Text>
                    <ImagePositionPicker
                        url={draft.banner.image.url}
                        fit={draft.banner.image.fit ?? "cover"}
                        positionX={draft.banner.image.positionX ?? 50}
                        positionY={draft.banner.image.positionY ?? 50}
                        zoom={draft.banner.image.zoom ?? 1}
                        onChange={(positionX, positionY) => setDraft(d => ({
                            ...d,
                            banner: { ...d.banner, image: { ...d.banner!.image!, positionX, positionY } }
                        }))}
                    />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>
                        Zoom: {(draft.banner.image.zoom ?? 1).toFixed(2)}×
                    </Forms.FormTitle>
                    <Slider
                        minValue={1}
                        maxValue={3}
                        initialValue={draft.banner.image.zoom ?? 1}
                        onValueChange={(v: number) => setDraft(d => ({
                            ...d,
                            banner: { ...d.banner, image: { ...d.banner!.image!, zoom: Number(v.toFixed(2)) } }
                        }))}
                        markers={[1, 1.5, 2, 2.5, 3]}
                        onMarkerRender={(v: number) => `${v}×`}
                    />
                    <Flex className={Margins.top8} style={{ alignItems: "center", gap: "8px" }}>
                        <Text variant="text-xs/normal">Ajuste:</Text>
                        <Select
                            options={FIT_OPTIONS as unknown as Array<{ label: string; value: string; }>}
                            select={(fit: string) => setDraft(d => ({
                                ...d,
                                banner: { ...d.banner, image: { ...d.banner!.image!, fit: fit as "cover" | "contain" } }
                            }))}
                            isSelected={(fit: string) => fit === (draft.banner!.image!.fit ?? "cover")}
                            serialize={(fit: string) => fit}
                            closeOnSelect
                        />
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            onClick={() => setDraft(d => ({
                                ...d,
                                banner: { ...d.banner, image: { ...d.banner!.image!, positionX: 50, positionY: 50, zoom: 1 } }
                            }))}
                        >Centrar</Button>
                    </Flex>
                </div>
            )}

            <Forms.FormTitle tag="h3" className={Margins.top16}>Foto de perfil</Forms.FormTitle>
            <Text variant="text-sm/normal">
                Pega una URL o elige un archivo de tu equipo — igual que el banner. Reemplaza tu
                avatar solo en clientes con xcord; tu foto real en Discord no cambia.
            </Text>

            <TextInput
                value={avatarIsEmbedded ? "" : avatarUrl}
                placeholder={avatarIsEmbedded ? `Archivo incrustado (${formatSize(avatarEmbeddedSize)})` : "https://…/avatar.png"}
                onChange={(url: string) => setDraft({
                    ...draft,
                    avatar: url ? { ...draft.avatar, image: { ...draft.avatar?.image, url } } : { ...draft.avatar, image: undefined }
                })}
            />

            <Flex className={Margins.top8}>
                <Button
                    size={Button.Sizes.SMALL}
                    disabled={uploading}
                    onClick={async () => {
                        const picked = await pickImageFile(MAX_UPLOAD_BYTES);
                        if (!picked) return;

                        if (!confirm(
                            "Se subirá tu imagen a un servidor público. Tu imagen quedará " +
                            "accesible públicamente para quien tenga el enlace.\n\n¿Deseas continuar?"
                        )) return;

                        setUploading(true);
                        try {
                            const result = await Native.uploadFile(
                                stripDataUri(picked.dataUri), picked.name, picked.type
                            );

                            if (!result.ok || !result.url)
                                return void alert(`No se pudo subir: ${result.error}`);

                            setDraft(d => ({ ...d, avatar: { ...d.avatar, image: { ...d.avatar?.image, url: result.url! } } }));
                        } finally {
                            setUploading(false);
                        }
                    }}
                >{uploading ? "Subiendo…" : "Subir archivo…"}</Button>

                <Button
                    size={Button.Sizes.SMALL}
                    color={Button.Colors.PRIMARY}
                    disabled={uploading}
                    onClick={async () => {
                        const picked = await pickImageFile(MAX_EMBED_BYTES);
                        if (!picked) return;

                        if (picked.size > WARN_EMBED_BYTES && !confirm(
                            `"${picked.name}" pesa ${formatSize(picked.size)}. Incrustado ocupará ` +
                            `alrededor de ${formatSize(picked.size * 1.34)} en tus ajustes, que Vencord ` +
                            "lee y escribe a menudo.\n\n¿Continuar de todas formas?"
                        )) return;

                        setDraft({
                            ...draft,
                            avatar: { ...draft.avatar, image: { ...draft.avatar?.image, url: picked.dataUri } }
                        });
                    }}
                >Incrustar local…</Button>

                {draft.avatar?.image && (
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={() => setDraft({ ...draft, avatar: { ...draft.avatar, image: undefined } })}
                    >Quitar foto</Button>
                )}
            </Flex>

            {draft.avatar?.image?.url && (
                <div className={Margins.top8}>
                    <Text variant="text-xs/normal" className={Margins.bottom8}>
                        Arrastra para elegir qué parte de la foto se ve.
                    </Text>
                    <ImagePositionPicker
                        url={draft.avatar.image.url}
                        fit={draft.avatar.image.fit ?? "cover"}
                        positionX={draft.avatar.image.positionX ?? 50}
                        positionY={draft.avatar.image.positionY ?? 50}
                        zoom={draft.avatar.image.zoom ?? 1}
                        aspectRatio="1 / 1"
                        round
                        onChange={(positionX, positionY) => setDraft(d => ({
                            ...d,
                            avatar: { ...d.avatar, image: { ...d.avatar!.image!, positionX, positionY } }
                        }))}
                    />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>
                        Zoom: {(draft.avatar.image.zoom ?? 1).toFixed(2)}×
                    </Forms.FormTitle>
                    <Slider
                        minValue={1}
                        maxValue={3}
                        initialValue={draft.avatar.image.zoom ?? 1}
                        onValueChange={(v: number) => setDraft(d => ({
                            ...d,
                            avatar: { ...d.avatar, image: { ...d.avatar!.image!, zoom: Number(v.toFixed(2)) } }
                        }))}
                        markers={[1, 1.5, 2, 2.5, 3]}
                        onMarkerRender={(v: number) => `${v}×`}
                    />
                    <Flex className={Margins.top8} style={{ alignItems: "center", gap: "8px" }}>
                        <Text variant="text-xs/normal">Ajuste:</Text>
                        <Select
                            options={FIT_OPTIONS as unknown as Array<{ label: string; value: string; }>}
                            select={(fit: string) => setDraft(d => ({
                                ...d,
                                avatar: { ...d.avatar, image: { ...d.avatar!.image!, fit: fit as "cover" | "contain" } }
                            }))}
                            isSelected={(fit: string) => fit === (draft.avatar!.image!.fit ?? "cover")}
                            serialize={(fit: string) => fit}
                            closeOnSelect
                        />
                        <Button
                            size={Button.Sizes.SMALL}
                            color={Button.Colors.PRIMARY}
                            onClick={() => setDraft(d => ({
                                ...d,
                                avatar: { ...d.avatar, image: { ...d.avatar!.image!, positionX: 50, positionY: 50, zoom: 1 } }
                            }))}
                        >Centrar</Button>
                    </Flex>
                </div>
            )}

            <Forms.FormTitle tag="h3" className={Margins.top16}>Tienda</Forms.FormTitle>
            <Text variant="text-sm/normal">
                Marcos y efectos de la tienda de Discord. Solo visual y solo en clientes con
                xcord: no compra nada ni modifica tu cuenta.
            </Text>

            <Forms.FormTitle tag="h5" className={Margins.top8}>Marco del avatar</Forms.FormTitle>
            <Text variant="text-xs/normal">
                «Cargar catálogo» trae los más populares de la tienda, no solo los que ya posees.
                Si el que buscas no aparece, clic derecho sobre un perfil con ese marco puesto →
                «View Avatar Decoration», y pega aquí la URL de la imagen.
            </Text>

            <CatalogSearchInput section={decorations} />
            {decorations.entries.length > 0 ? (
                <CatalogGrid
                    entries={decorations.entries}
                    selected={draft.avatar?.decoration?.asset ?? ""}
                    onSelect={asset => setDraft({
                        ...draft,
                        avatar: asset
                            ? { ...draft.avatar, decoration: { asset } }
                            : { ...draft.avatar, decoration: undefined }
                    })}
                />
            ) : (
                <TextInput
                    value={draft.avatar?.decoration?.asset ?? ""}
                    placeholder="Pega la URL de la decoración, o el identificador a mano"
                    onChange={(input: string) => {
                        const asset = extractDecorationAsset(input);
                        setDraft({
                            ...draft,
                            avatar: asset
                                ? { ...draft.avatar, decoration: { asset } }
                                : { ...draft.avatar, decoration: undefined }
                        });
                    }}
                />
            )}
            <CatalogLoadButtons section={decorations} />

            <Forms.FormTitle tag="h5" className={Margins.top8}>Efecto de perfil</Forms.FormTitle>

            <CatalogSearchInput section={effects} />
            {effects.entries.length > 0 ? (
                <CatalogGrid
                    entries={effects.entries}
                    selected={draft.profileEffectId ?? ""}
                    onSelect={id => setDraft({ ...draft, profileEffectId: id || undefined })}
                />
            ) : (
                <TextInput
                    value={draft.profileEffectId ?? ""}
                    placeholder="ID del efecto, o pulsa «Cargar catálogo»"
                    onChange={(id: string) => setDraft({ ...draft, profileEffectId: id || undefined })}
                />
            )}
            <CatalogLoadButtons section={effects} />

            <Forms.FormTitle tag="h5" className={Margins.top8}>Borde de la tarjeta</Forms.FormTitle>
            <Text variant="text-xs/normal">
                Se renderiza con el propio código de Discord —el mismo campo que usa el efecto—,
                no con una aproximación nuestra.
            </Text>

            <CatalogSearchInput section={borders} />
            {borders.entries.length > 0 ? (
                <CatalogGrid
                    entries={borders.entries}
                    selected={draft.cardBorder?.skuId ?? ""}
                    onSelect={async skuId => {
                        if (!skuId) return setDraft({ ...draft, cardBorder: undefined });

                        setLoadingBorder(true);
                        try {
                            const border = await fetchCardBorder(skuId);
                            if (!border) return void alert("No se pudo leer ese borde. Mira la consola.");
                            setDraft(d => ({ ...d, cardBorder: border }));
                        } finally {
                            setLoadingBorder(false);
                        }
                    }}
                />
            ) : (
                <Text variant="text-xs/normal">Pulsa «Cargar catálogo» para poder elegir uno.</Text>
            )}
            {loadingBorder && <Text variant="text-xs/normal">Cargando piezas del borde…</Text>}
            <CatalogLoadButtons section={borders} />

            <Forms.FormTitle tag="h5" className={Margins.top8}>Placa de nombre</Forms.FormTitle>
            <Text variant="text-xs/normal">
                Sin override que valga: Discord la lee directo del usuario. La pintamos con el
                mismo truco que el resto — nuestro valor gana solo cuando no tienes una real puesta.
            </Text>

            <CatalogSearchInput section={nameplates} />
            {nameplates.entries.length > 0 ? (
                <CatalogGrid
                    entries={nameplates.entries}
                    selected={draft.nameplate?.asset ?? ""}
                    onSelect={asset => {
                        const entry = nameplates.entries.find(n => n.asset === asset);
                        setDraft({
                            ...draft,
                            nameplate: asset
                                ? { asset, skuId: entry?.id, palette: entry?.palette }
                                : undefined
                        });
                    }}
                />
            ) : (
                <TextInput
                    value={draft.nameplate?.asset ?? ""}
                    placeholder="Ruta del asset, p. ej. nameplates/mexico/…/, o pulsa «Cargar catálogo»"
                    onChange={(asset: string) => setDraft({
                        ...draft,
                        nameplate: asset ? { asset } : undefined
                    })}
                />
            )}
            <CatalogLoadButtons section={nameplates} />

            <Forms.FormTitle tag="h3" className={Margins.top16}>Fuentes personalizadas</Forms.FormTitle>
            <Text variant="text-sm/normal">
                URL de un .woff2 o .ttf. Una por línea, con el formato <code>Nombre = URL</code>.
            </Text>
            <TextInput
                value={(draft.fonts ?? []).map(f => `${f.family} = ${f.src}`).join("\n")}
                placeholder="Orbitron = https://…/orbitron.woff2"
                onChange={(text: string) => setDraft({
                    ...draft,
                    fonts: text.split("\n")
                        .map(line => line.split("="))
                        .filter(parts => parts.length === 2)
                        .map(([family, src]) => ({ family: family.trim(), src: src.trim() }))
                })}
            />

            {showActions && (
                <Flex className={Margins.top16}>
                    <Button disabled={!dirty} onClick={controller.save}>Guardar</Button>
                    <Button
                        color={Button.Colors.PRIMARY}
                        disabled={!dirty}
                        onClick={controller.discard}
                    >Descartar cambios</Button>
                    <Button color={Button.Colors.RED} onClick={controller.resetAll}>
                        Restablecer todo
                    </Button>
                </Flex>
            )}

            {sync && (
                <>
                    <Forms.FormTitle tag="h3" className={Margins.top16}>Sincronización</Forms.FormTitle>
                    <Text variant="text-sm/normal">
                        Publica tu perfil para que otros usuarios de xcord vean tus
                        personalizaciones. Se publica lo ya guardado, nunca un cambio sin
                        confirmar{dirty ? " — tienes cambios sin guardar ahora mismo" : ""}.
                    </Text>

                    <Text variant="text-xs/normal" className={Margins.top8}>
                        {sync.isVerified()
                            ? "✓ Vinculado con tu cuenta de Discord: nadie más puede publicar en tu nombre."
                            : "Sin vincular todavía. Cualquiera con tu id de Discord podría reclamarlo antes que tú — vincula tu cuenta para evitarlo."}
                    </Text>

                    <Flex className={Margins.top8}>
                        {!sync.isVerified() && (
                            <Button
                                disabled={syncing}
                                onClick={async () => {
                                    setSyncing(true);
                                    try {
                                        const result = await sync.link();
                                        if (!result.ok) alert(`No se pudo vincular: ${result.error}`);
                                        else alert("Cuenta vinculada. Ya puedes publicar con la identidad verificada.");
                                    } catch (err) {
                                        // Sin esto, un fallo inesperado —como que el proceso
                                        // principal aún no tenga esta función tras un simple
                                        // Ctrl+R— se perdía en silencio: el botón "no hacía nada".
                                        alert(`Fallo inesperado al vincular: ${err}`);
                                    } finally {
                                        setSyncing(false);
                                    }
                                }}
                            >{syncing ? "Esperando tu aprobación en el navegador…" : "Vincular con Discord"}</Button>
                        )}
                        <Button
                            disabled={syncing}
                            onClick={async () => {
                                setSyncing(true);
                                try {
                                    const result = await sync.publish();
                                    if (!result.ok) alert(`No se pudo publicar: ${result.error}`);
                                    else alert("Perfil publicado. Otros usuarios de xcord ya pueden verlo.");
                                } catch (err) {
                                    alert(`Fallo inesperado al publicar: ${err}`);
                                } finally {
                                    setSyncing(false);
                                }
                            }}
                        >{syncing ? "Publicando…" : "Publicar perfil"}</Button>
                        <Button
                            color={Button.Colors.RED}
                            disabled={syncing}
                            onClick={async () => {
                                if (!confirm("¿Retirar tu perfil de la nube? Otros usuarios de xcord dejarán de verlo."))
                                    return;
                                setSyncing(true);
                                try {
                                    const result = await sync.unpublish();
                                    if (!result.ok) alert(`No se pudo retirar: ${result.error}`);
                                    else alert("Perfil retirado de la nube.");
                                } catch (err) {
                                    alert(`Fallo inesperado al retirar: ${err}`);
                                } finally {
                                    setSyncing(false);
                                }
                            }}
                        >Dejar de compartir</Button>
                    </Flex>
                </>
            )}
            </div>

            {/* Columna de vista previa: solo controla el ancho y deja que la
                fila la estire de alto (ver la nota de arriba). El `sticky`
                de verdad vive en el envoltorio interno — necesita una caja
                exterior más alta que su propio contenido para tener "sitio"
                donde quedarse pegado mientras la izquierda hace scroll,
                cosa que un `div` de un solo nivel no puede darse a sí mismo.
                `flexWrap: "wrap"` en el contenedor de arriba es lo que hace
                que esto se caiga a una fila propia (debajo, ancho completo)
                en vez de apretarse cuando no hay sitio — el mismo
                comportamiento de antes en pantallas angostas. */}
            <div style={{ flex: "1 1 420px", minWidth: 0 }}>
              <div style={{ position: "sticky", top: 0 }}>
                <Forms.FormTitle tag="h3">Vista previa</Forms.FormTitle>
                <Text variant="text-xs/normal" className={Margins.bottom8}>
                    Este es el componente real de Discord, no una imitación.
                </Text>

                <div className={PREVIEW_CLASS}>
                    <ProfileModal
                        user={UserStore.getCurrentUser()}
                        // El fondo no va por CSS sino por el tema nativo, que se lee
                        // del store — y el store solo conoce el perfil guardado. Esta
                        // es la prop con la que Discord previsualiza colores antes de
                        // aplicarlos, así que el borrador se ve sin guardar nada.
                        pendingThemeColors={
                            draft.background
                                ? fillToThemeColors(draft.background.fill)
                                : [0, 0]
                        }
                        onAvatarChange={() => { }}
                        onBannerChange={() => { }}
                        canUsePremiumCustomization={true}
                        hideExampleButton={true}
                        hideFakeActivity={true}
                        isTryItOut={true}
                    />
                </div>
              </div>
            </div>
        </div>
    );
}

/** El editor tal como se usa en Ajustes → Plugins, con sus propios botones. */
export function EditorPanel({ initial, onSave, sync }: {
    initial: XcordProfile;
    onSave: (p: XcordProfile) => void;
    sync?: SyncActions;
}) {
    const controller = useProfileDraft(initial, onSave);
    return <ProfileEditor controller={controller} sync={sync} />;
}

export default ErrorBoundary.wrap(EditorPanel, { noop: true });
