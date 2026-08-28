/**
 * Motor de CSS: convierte un XcordProfile en una hoja de estilos.
 *
 * El mismo generador alimenta la capa real y el preview del editor. Si el
 * preview y el perfil real divergen alguna vez, es un bug aquí, no en dos
 * implementaciones distintas que se fueron separando.
 */

import type { AvatarStyle, BannerStyle, Fill, FontDefinition, TextStyle, XcordProfile } from "../types";

/** Prefijo de todas las clases y variables que inyectamos, para no chocar con Discord. */
export const NS = "xcord";

export function fillToCss(fill: Fill): string {
    switch (fill.kind) {
        case "solid":
            return fill.color;
        case "linear":
            return `linear-gradient(${fill.angle}deg, ${fill.stops.join(", ")})`;
        case "conic":
            // Repetimos el primer stop al final para que el arcoíris cierre sin costura.
            return `conic-gradient(${[...fill.stops, fill.stops[0]].join(", ")})`;
    }
}

/** Un fill sólido puede pintarse con `color`; un degradado necesita recorte de fondo. */
function isGradient(fill: Fill): boolean {
    return fill.kind !== "solid";
}

/**
 * La misma paleta del usuario, pero como dos vueltas idénticas seguidas, con
 * posiciones explícitas en cada color — no las que el navegador reparte
 * solo. Es lo que hace posible un desplazamiento infinito sin salto al
 * reiniciar: N colores → un ciclo completo en el primer 50% del degradado →
 * el mismo ciclo repetido en el segundo 50%. El color de cierre de cada
 * mitad (a 50% y a 100%) es siempre el primero de la paleta, así que la
 * mitad que se ve al empezar la animación y la que se ve al terminarla son
 * la misma imagen, píxel a píxel.
 *
 * Con posiciones explícitas en vez de fiarnos del reparto automático, el
 * punto exacto del reinicio no depende de que el navegador distribuya los
 * stops como esperábamos — está garantizado por número, no por suposición.
 *
 * También devuelve el eje: un degradado vertical (0°/180°) necesita
 * estirarse y desplazarse en Y, no en X, o el desplazamiento no tiene nada
 * que ver con la dirección real del degradado — ahí es donde el reinicio
 * volvía a notarse aunque el color ya cerrara bien el ciclo. Un ángulo en
 * diagonal no tiene una solución perfecta con solo `background-position`;
 * se aproxima por el eje horizontal, que es el que domina en un texto ancho.
 */
function closedLoopGradient(fill: Fill): { image: string; axis: "x" | "y"; } {
    if (fill.kind === "solid")
        return { image: `linear-gradient(90deg, ${fill.color}, ${fill.color})`, axis: "x" };
    if (fill.kind === "conic")
        return { image: fillToCss(fill), axis: "x" }; // el cónico ya cierra su propio ciclo.

    const n = fill.stops.length;
    const points: string[] = [];
    for (let i = 0; i <= 2 * n; i++) {
        const pct = (i / (2 * n)) * 100;
        points.push(`${fill.stops[i % n]} ${pct.toFixed(4)}%`);
    }

    const normalized = ((fill.angle % 360) + 360) % 360;
    const axis: "x" | "y" = normalized === 0 || normalized === 180 ? "y" : "x";

    return { image: `linear-gradient(${fill.angle}deg, ${points.join(", ")})`, axis };
}

function textEffectCss(style: TextStyle): string {
    const speed = style.animationSpeed ?? 4;
    const glow = style.fill.kind === "solid" ? style.fill.color : style.fill.stops[0];

    switch (style.effect) {
        case "none":
            return "";
        case "neon":
            // drop-shadow en vez de text-shadow: respeta el recorte del degradado.
            return `filter: drop-shadow(0 0 2px ${glow}) drop-shadow(0 0 8px ${glow});`;
        case "outline":
            return `-webkit-text-stroke: 1px ${glow}; color: transparent;`;
        case "chrome":
            return "background-image: linear-gradient(180deg, #fff 0%, #a8b3c4 45%, #5c6470 50%, #e8eef7 100%);";
        case "shadow":
            return `filter: drop-shadow(2px 2px 0 rgba(0,0,0,.6));`;
        case "animated": {
            const { image, axis } = closedLoopGradient(style.fill);
            const size = axis === "x" ? "200% 100%" : "100% 200%";
            const anim = axis === "x" ? `${NS}-slide-x` : `${NS}-slide-y`;
            return `background-image: ${image} !important; ` +
                `background-size: ${size}; animation: ${anim} ${speed}s linear infinite;`;
        }
    }
}

function textStyleCss(style: TextStyle): string {
    const parts: string[] = [];

    if (style.fontFamily)
        parts.push(`font-family: "${style.fontFamily}", var(--font-display), sans-serif;`);

    if (isGradient(style.fill)) {
        // El texto se vuelve una máscara sobre el degradado.
        parts.push(`background-image: ${fillToCss(style.fill)};`);
        parts.push("-webkit-background-clip: text; background-clip: text;");
        parts.push("color: transparent; -webkit-text-fill-color: transparent;");
    } else {
        parts.push(`color: ${fillToCss(style.fill)};`);
    }

    parts.push(textEffectCss(style));
    return parts.filter(Boolean).join(" ");
}

/**
 * El valor de `background-size` para una imagen, zoom incluido.
 *
 * Sin ampliar, es el `fit` de siempre (`cover`/`contain`), calculado por el
 * propio navegador contra el tamaño real del contenedor donde se pinte —
 * exacto en cualquier sitio de la interfaz. Ampliado, cambiamos a un
 * porcentaje del ancho del contenedor con alto automático: sigue sin
 * depender de ningún tamaño fijo (el mismo perfil se ve en sitios de tamaños
 * distintos), a cambio de dejar de ser un "cover" exacto — una aproximación
 * razonable, como la del propio recorte de Discord, que tampoco es infinita.
 */
function imageSizeCss(img: NonNullable<BannerStyle["image"]>): string {
    const zoom = img.zoom ?? 1;
    return zoom > 1 ? `${Math.round(zoom * 100)}% auto` : (img.fit ?? "cover");
}

function imageCss(img: NonNullable<BannerStyle["image"]>): string {
    return [
        `background-image: url("${img.url}") !important;`,
        `background-size: ${imageSizeCss(img)} !important;`,
        `background-position: ${img.positionX ?? 50}% ${img.positionY ?? 50}% !important;`,
        "background-repeat: no-repeat;"
    ].join(" ");
}

function bannerCss(banner: BannerStyle): string {
    const layers: string[] = [];
    const parts: string[] = [];

    if (banner.tint)
        layers.push(`linear-gradient(${hexToRgba(banner.tint.color, banner.tint.opacity)}, ${hexToRgba(banner.tint.color, banner.tint.opacity)})`);
    if (banner.image)
        layers.push(`url("${banner.image.url}")`);
    if (banner.fill)
        layers.push(fillToCss(banner.fill));

    if (layers.length) parts.push(`background-image: ${layers.join(", ")} !important;`);
    if (banner.image) {
        // `!important`: cuando el banner lo pinta el propio Discord (capa 1,
        // vía profileHook), su nodo trae su propio background-size/position —
        // sin esto, el encuadre elegido en el editor no ganaba el pulso.
        parts.push(`background-size: ${imageSizeCss(banner.image)} !important;`);
        parts.push(`background-position: ${banner.image.positionX ?? 50}% ${banner.image.positionY ?? 50}% !important;`);
    }
    if (banner.blur) parts.push(`filter: blur(${banner.blur}px);`);

    return parts.join(" ");
}

function avatarCss(avatar: AvatarStyle): string {
    if (!avatar.image) return "";
    return `${imageCss(avatar.image)} background-color: transparent;`;
}

/**
 * La capa ampliada y desenfocada detrás de la columna derecha del perfil.
 *
 * Sin configurar, reproducimos lo que hace Discord: reflejar el banner. Eso ya
 * funciona solo cuando el banner es una URL, porque él lo pinta; aquí importa
 * para los casos que no ve — un banner incrustado como data-URI, o un perfil
 * con degradado y sin banner.
 *
 * Configurado, manda el usuario.
 */
function dynamicBackgroundCss(profile: XcordProfile, scope: string): string {
    const config = profile.dynamicBackground;
    const bannerUrl = profile.banner?.image?.url;

    // Qué se pinta: lo elegido, o el mejor sustituto disponible.
    const useFill = config?.source === "fill" ? config.fill : undefined;
    const image = !useFill && bannerUrl ? bannerUrl : undefined;
    const fill = useFill ?? (image ? undefined : profile.background?.fill);

    if (!image && !fill) return "";

    const parts: string[] = [];

    if (image) {
        parts.push(`background-image: url("${image}") !important;`);
        parts.push("background-size: cover; background-position: center;");
    } else {
        parts.push(`background-image: ${fillToCss(fill!)} !important;`);
    }

    if (config) {
        parts.push(`opacity: ${config.opacity};`);
        // El desenfoque difumina también los bordes y los vuelve transparentes.
        // La ampliación los empuja fuera del área visible; sin ella se ve un
        // halo del fondo alrededor de la capa.
        if (config.blur > 0) {
            parts.push(`filter: blur(${config.blur}px);`);
            // Desenfocar un GIF obliga a recalcular el desenfoque en cada
            // fotograma. `contain: paint` le dice al navegador que nada de esta
            // capa afecta al exterior, así que puede repintarla aislada en vez
            // de rehacer la zona entera del perfil.
            parts.push("contain: paint; will-change: filter;");
        }
        if (config.scale !== 1) parts.push(`transform: scale(${config.scale});`);
    }

    return `${scope} .${NS}-dynamic-bg { ${parts.join(" ")} }`;
}

/**
 * Los dos colores que Discord usa para el tema de perfil, como enteros.
 *
 * Discord solo entiende primario + acento, y pinta el degradado él mismo. Es
 * menos expresivo que nuestro `Fill` (sin ángulo, sin tres paradas, sin cónico)
 * pero se renderiza en todas partes y sin pelear contra su CSS. Cogemos las dos
 * primeras paradas; un color plano usa el mismo en ambas.
 */
export function fillToThemeColors(fill: Fill): [number, number] {
    const stops = fill.kind === "solid" ? [fill.color] : fill.stops;
    const toInt = (hex: string) => parseInt(hex.replace("#", ""), 16) || 0;
    return [toInt(stops[0]), toInt(stops[1] ?? stops[0])];
}

function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace("#", "");
    const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
    const n = parseInt(full, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fontFaces(fonts: FontDefinition[]): string {
    return fonts
        .map(f => `@font-face { font-family: "${f.family}"; src: url("${f.src}"); font-display: swap; }`)
        .join("\n");
}

/**
 * Genera la hoja de estilos de un perfil.
 *
 * `scope` acota las reglas: en la capa real es `[data-xcord-user="<id>"]`, en el
 * preview del editor es la clase del contenedor. Nada se filtra fuera de ahí.
 */
export function buildProfileCss(profile: XcordProfile, scope: string): string {
    const out: string[] = [];

    if (profile.fonts?.length) out.push(fontFaces(profile.fonts));

    // El color del fondo lo pinta Discord con el tema nativo (ver profileHook);
    // aquí solo lo atenuamos. Un box-shadow interior gigante cubre todo el
    // elemento por encima de su fondo pero por debajo del texto, así que oscurece
    // sin tocar la legibilidad ni pelear con el degradado de Discord.
    if (profile.background?.dim) {
        out.push(
            `${scope} .${NS}-bg {`,
            `box-shadow: inset 0 0 0 9999px rgba(0, 0, 0, ${profile.background.dim}); }`
        );
    }

    // Fondo dinámico: la copia ampliada y desenfocada que Discord pinta detrás
    // de la columna derecha del perfil v2. Él la alimenta con la URL del banner,
    // así que con un banner por URL ya funciona solo. Aquí cubrimos lo que él no
    // puede ver: un banner incrustado como data-URI, o un perfil sin banner que
    // solo tiene degradado.
    out.push(dynamicBackgroundCss(profile, scope));

    if (profile.displayName)
        out.push(`${scope} .${NS}-display-name { ${textStyleCss(profile.displayName)} }`);
    if (profile.messageName)
        out.push(`${scope} .${NS}-message-name { ${textStyleCss(profile.messageName)} }`);
    if (profile.bio)
        out.push(`${scope} .${NS}-bio { ${textStyleCss(profile.bio)} }`);
    if (profile.banner)
        out.push(`${scope} .${NS}-banner { ${bannerCss(profile.banner)} }`);

    if (profile.avatar) {
        out.push(`${scope} .${NS}-avatar { ${avatarCss(profile.avatar)} }`);
        // El contenedor que marca dom.ts trae dentro el <img> real del avatar
        // de Discord, opaco y por encima de lo que pintemos aquí — sin
        // ocultarlo, el fondo de imagen que ponemos nunca llega a verse.
        //
        // Apuntamos solo al <img> cuya URL es la foto real (mismo patrón que
        // usa dom.ts para identificarla), no a cualquier <img> del
        // contenedor: el anillo de decoración puede pintarse como imagen
        // aparte en algunos sitios, con una URL de otro dominio
        // (avatar-decoration-presets), y un selector genérico se lo llevaba
        // por delante junto con el avatar.
        if (profile.avatar.image)
            out.push(
                `${scope} .${NS}-avatar img[src*="/avatars/"], ` +
                `${scope} .${NS}-avatar img[src*="/guilds/"] { visibility: hidden !important; }`
            );
    }

    return out.join("\n");
}

/** Keyframes globales; se inyectan una sola vez, no por perfil. */
export const GLOBAL_KEYFRAMES = `
@keyframes ${NS}-slide-x {
    from { background-position: 0% 50%; }
    to   { background-position: 100% 50%; }
}
@keyframes ${NS}-slide-y {
    from { background-position: 50% 0%; }
    to   { background-position: 50% 100%; }
}
/*
 * Antes esto miraba "@media (prefers-reduced-motion: reduce)" — la
 * preferencia de Windows. El problema: Discord tiene su propio interruptor
 * para esto (Accesibilidad → "Reducir movimiento"), separado del de Windows,
 * y usa ESE para decidir si anima sus propios GIFs y avatares. Alguien con
 * el de Windows activado pero el de Discord apagado seguía viendo animarse
 * todo lo nativo, mientras nuestro texto se congelaba solo — inconsistente.
 * Ahora index.tsx pone este atributo en <html> leyendo el mismo interruptor
 * que usa Discord, así que nuestra animación se comporta igual que el resto.
 */
html[data-${NS}-reduce-motion] .${NS}-display-name,
html[data-${NS}-reduce-motion] .${NS}-message-name,
html[data-${NS}-reduce-motion] .${NS}-bio {
    animation: none !important;
}
`;
