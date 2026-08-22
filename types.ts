/**
 * Esquema del perfil xcord.
 *
 * Este objeto es la única fuente de verdad: el editor lo produce, el motor de
 * CSS lo consume, el preview lo renderiza y el servidor lo almacena tal cual.
 * Todo lo que xcord sabe hacer tiene que ser expresable aquí.
 */

export const SCHEMA_VERSION = 1;

export type Hex = string;

/** Un color plano, un degradado lineal o uno cónico (arcoíris). */
export type Fill =
    | { kind: "solid"; color: Hex; }
    | { kind: "linear"; angle: number; stops: Hex[]; }
    | { kind: "conic"; stops: Hex[]; };

/** Efectos aplicables al texto (nombre, tag, "sobre mí"). */
export type TextEffect =
    | "none"
    | "neon"      // resplandor de color alrededor de las letras
    | "outline"   // borde de 1px, relleno transparente
    | "chrome"    // degradado metálico vertical + brillo
    | "shadow"    // sombra dura desplazada
    | "animated"; // el degradado se desplaza en bucle

export interface TextStyle {
    fill: Fill;
    effect: TextEffect;
    /** Nombre de la familia; debe existir en `fonts` o ser una fuente del sistema. */
    fontFamily?: string;
    /** Velocidad del bucle en segundos. Solo aplica con effect: "animated". */
    animationSpeed?: number;
}

/** Una imagen: URL remota o data-URI incrustado. Los GIF se soportan igual. */
export interface ImageSource {
    url: string;
    /** Recorte y encuadre, en porcentaje del contenedor. */
    fit?: "cover" | "contain";
    positionX?: number;
    positionY?: number;
}

export interface BannerStyle {
    image?: ImageSource;
    /** Se pinta debajo de la imagen, o solo si no hay imagen. */
    fill?: Fill;
    /** Superposición de color encima de la imagen, 0–1. */
    tint?: { color: Hex; opacity: number; };
    blur?: number;
}

export interface AvatarStyle {
    image?: ImageSource;
    /**
     * Marco alrededor del avatar, de los de la tienda de Discord.
     *
     * `asset` es el identificador del recurso; el prefijo `a_` indica que está
     * animado. Los archivos se sirven públicamente desde el CDN de Discord, así
     * que basta con nombrarlos. Puramente visual y solo en clientes con xcord:
     * no compra nada ni cambia tu cuenta.
     */
    decoration?: { asset: string; skuId?: string; };
}

/** Una fuente personalizada que hay que cargar antes de usarla. */
export interface FontDefinition {
    family: string;
    /** URL de un .woff2/.ttf, o un data-URI. */
    src: string;
}

export interface DynamicBackground {
    /** `banner` reutiliza la imagen del banner; `fill` usa un relleno propio. */
    source: "banner" | "fill";
    /** Solo se usa con source: "fill". */
    fill?: Fill;
    /** Desenfoque en píxeles. 0 deja la imagen nítida. */
    blur: number;
    /** 0–1. Discord la mantiene tenue para no competir con el contenido. */
    opacity: number;
    /**
     * Ampliación. Necesaria con desenfoque: al difuminar, los bordes se vuelven
     * transparentes y dejan ver el fondo. Ampliar los saca del área visible.
     */
    scale: number;
}

/** Una pieza del borde, tal como la describe Discord. */
export interface CardBorderLayer {
    id: string;
    anchor: "top" | "bottom";
    order: "front" | "back";
}

export interface CardBorder {
    /** El sku del producto — es también el primer segmento de la URL de cada capa. */
    skuId: string;
    layers: CardBorderLayer[];
    /**
     * Cuánto se sale cada lado del área de la tarjeta, en las mismas unidades
     * que `innerWidth` — no en píxeles reales de pantalla. Hay que escalarlos
     * proporcionalmente al ancho real de la tarjeta.
     */
    overflowTop: number;
    overflowBottom: number;
    overflowHorizontal: number;
    /** El ancho de referencia con el que Discord diseñó las piezas. */
    innerWidth: number;
}

export interface XcordProfile {
    version: typeof SCHEMA_VERSION;
    userId: string;
    /** Timestamp de la última edición, para resolver conflictos al sincronizar. */
    updatedAt: number;

    /**
     * Fondo de la tarjeta de perfil, detrás de todo el contenido.
     *
     * `dim` (0–1) oscurece el resultado. Discord pinta los colores del tema a
     * plena saturación, y un rojo o un cian puros resultan agresivos detrás de
     * texto; esto los baja sin obligarte a elegir colores apagados.
     */
    background?: { fill: Fill; dim?: number; };

    /**
     * La capa ampliada y desenfocada detrás de la columna derecha del perfil.
     * Discord la alimenta con el banner; aquí decides tú qué se ve y cuánto.
     */
    dynamicBackground?: DynamicBackground;

    /**
     * Efecto de perfil animado, de los de la tienda. Es el mismo campo que usa
     * Discord (`profileEffectId`), así que lo renderiza él con su propio código.
     */
    profileEffectId?: string;

    /**
     * Borde que envuelve toda la tarjeta de perfil, de los de la tienda.
     *
     * Se renderiza con el propio código de Discord: el campo `profileFrame`
     * en el perfil, el mismo tipo de puntero dedicado que usa `profileEffect`
     * para el efecto. Los metadatos completos (capas, overflow) quedan del
     * intento anterior con compositor propio, hoy desactivado — sirven de
     * respaldo si `profileFrame` deja de funcionar en alguna actualización.
     */
    cardBorder?: CardBorder;

    /**
     * Placa detrás del nombre, de las de la tienda.
     *
     * A diferencia del efecto y el borde, Discord no expone ningún parámetro
     * de override para esto: el hook que la resuelve lee `user.nameplate`
     * directo, sin puerta de entrada. Verificado con el código real del
     * módulo que la calcula.
     */
    nameplate?: { asset: string; skuId?: string; palette?: string; };

    displayName?: TextStyle;
    /** Estilo del nombre tal como aparece en los mensajes del chat. */
    messageName?: TextStyle;
    bio?: TextStyle;
    banner?: BannerStyle;
    avatar?: AvatarStyle;
    fonts?: FontDefinition[];
}

export function emptyProfile(userId: string): XcordProfile {
    return { version: SCHEMA_VERSION, userId, updatedAt: Date.now() };
}
