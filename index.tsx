/**
 * xcord — capa de personalización visual sobre Discord.
 *
 * Nada de lo que hace este plugin sale de tu cliente salvo tu propio perfil, y
 * solo si activas la sincronización. No toca la API de Discord, no altera tu
 * perfil real y no envía datos de otros usuarios a ningún sitio.
 *
 * Funciona en dos capas, y la diferencia importa:
 *
 *  1. Datos — enganchamos UserProfileStore.getUserProfile y devolvemos un
 *     perfil con nuestro banner. Discord lo renderiza con su propio código, así
 *     que los GIF animan solos y el layout es exacto. Sin CSS de por medio.
 *
 *  2. Estilo — lo que Discord no sabe representar (degradados en el nombre,
 *     fuentes propias, efectos de texto) se pinta con CSS acotado por usuario,
 *     sobre nodos que marca el observer de dom.ts.
 *
 * La capa 1 se usa siempre que se pueda: es más estable y más fiel.
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType, type PluginNative } from "@utils/types";
import type { UserProfile } from "@vencord/discord-types";
import { UserStore } from "@webpack/common";
import virtualMerge from "virtual-merge";

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { openModal } from "@utils/modal";
import { Menu } from "@webpack/common";
import type { User } from "@vencord/discord-types";

import Editor from "./components/Editor";
import { EditorModal } from "./components/EditorModal";
import { fillToThemeColors } from "./lib/css";
import { applyProfile, bumpProfileVersion, clearProfile, fetchProfile, getCached, getDraftOverride, getProfileVersion, teardown } from "./lib/store";
import { setBorderResolver, startObserver, stopObserver } from "./lib/dom";
import { emptyProfile, type XcordProfile } from "./types";

const Native = VencordNative.pluginHelpers.xcord as PluginNative<typeof import("./native")>;

const settings = definePluginSettings({
    ownProfile: {
        type: OptionType.STRING,
        description: "Tu perfil xcord, serializado. Edítalo desde el panel, no a mano.",
        default: "",
        hidden: true
    },
    syncEnabled: {
        type: OptionType.BOOLEAN,
        description: "Ver las personalizaciones de otros usuarios de xcord.",
        default: false
    },
    /**
     * Generado una vez por instalación, nunca a mano. "Reclama" tu id de
     * Discord en la base de datos la primera vez que publicas; publicaciones
     * futuras tienen que presentar el mismo secreto. Solo se guarda su hash
     * en Supabase, nunca el valor en sí.
     */
    syncSecret: {
        type: OptionType.STRING,
        description: "Secreto de publicación. No lo compartas.",
        default: "",
        hidden: true
    },
    /**
     * `true` solo si el secreto salió de completar el login real de Discord.
     * Si sigue en `false`, el secreto fue una reclamación local sin verificar
     * —vale mientras nadie más se te adelante, pero sin garantía—.
     */
    syncVerified: {
        type: OptionType.BOOLEAN,
        description: "El secreto de publicación viene de un login verificado con Discord.",
        default: false,
        hidden: true
    }
});

/** Perfil propio, cacheado en memoria para no deserializar en cada render. */
let ownProfile: XcordProfile | null = null;

function getOwnProfile(): XcordProfile {
    if (ownProfile) return ownProfile;

    const userId = UserStore.getCurrentUser()?.id ?? "";
    try {
        const raw = settings.store.ownProfile;
        if (raw) {
            const parsed = JSON.parse(raw) as XcordProfile;
            // El id puede faltar si el perfil se creó antes de tener sesión.
            if (!parsed.userId) parsed.userId = userId;
            return (ownProfile = parsed);
        }
    } catch {
        // Perfil corrupto: preferimos empezar limpio a romper el arranque.
    }
    return (ownProfile = emptyProfile(userId));
}

export function saveOwnProfile(profile: XcordProfile) {
    profile.updatedAt = Date.now();
    ownProfile = profile;
    settings.store.ownProfile = JSON.stringify(profile);
    applyProfile(profile);
    // Fuerza el recálculo de los useMemo de Discord que parcheamos; vive en
    // el store para que el borrador del editor comparta el mismo contador.
    bumpProfileVersion();
}

/** El secreto de esta instalación, generándolo la primera vez que hace falta. */
function getOrCreateSyncSecret(): string {
    if (settings.store.syncSecret) return settings.store.syncSecret;

    // 32 bytes al azar, en hex — muy por encima del mínimo de 16 caracteres
    // que exige la función de Postgres.
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    settings.store.syncSecret = secret;
    // Una reclamación local, sin verificar contra Discord — distinto de lo
    // que deja linkDiscordAccount() al completar el login real.
    settings.store.syncVerified = false;
    return secret;
}

/**
 * Login real de Discord: abre tu navegador, espera a que apruebes, y sustituye
 * el secreto local por uno que el servidor solo entrega tras confirmar tu
 * identidad contra la propia API de Discord. Cierra el hueco de "quien
 * reclama primero, gana" que tiene la reclamación local.
 */
export async function linkDiscordAccount(): Promise<{ ok: boolean; error?: string; }> {
    const start = await Native.startDiscordLogin();
    if (!start.ok || !start.state)
        return { ok: false, error: start.error ?? "No se pudo abrir el navegador." };

    const { state } = start;
    const deadline = Date.now() + 3 * 60 * 1000; // tres minutos para aprobar

    while (Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 2000));

        const poll = await Native.pollDiscordLogin(state);
        if (!poll.ok || !poll.result || poll.result.status === "pending") continue;

        const { result } = poll;
        if (result.status === "error") return { ok: false, error: result.error ?? "El login falló." };

        if (result.status === "done" && result.discord_user_id && result.secret) {
            const own = getOwnProfile();
            // Comprueba que aprobaste con la cuenta que ya tienes abierta en
            // Discord, no con otra sesión distinta en el navegador.
            if (own.userId && result.discord_user_id !== own.userId)
                return { ok: false, error: "La cuenta de Discord que aprobaste no es esta." };

            settings.store.syncSecret = result.secret;
            settings.store.syncVerified = true;
            return { ok: true };
        }
    }

    return { ok: false, error: "Se agotó el tiempo de espera. Inténtalo de nuevo." };
}

/**
 * Publica el perfil propio en Supabase, para que otros usuarios de xcord lo
 * vean. Solo sale de tu cliente lo que ya guardaste con Guardar — nunca un
 * borrador sin confirmar.
 */
export async function publishOwnProfile(): Promise<{ ok: boolean; error?: string; }> {
    const own = getOwnProfile();
    if (!own.userId) return { ok: false, error: "No se pudo determinar tu usuario." };

    const secret = getOrCreateSyncSecret();
    return Native.publishProfile(own.userId, secret, own);
}

/** Retira el perfil propio de Supabase. No borra nada local. */
export async function unpublishOwnProfile(): Promise<{ ok: boolean; error?: string; }> {
    const own = getOwnProfile();
    if (!own.userId || !settings.store.syncSecret)
        return { ok: true }; // nunca se publicó nada que retirar

    return Native.deleteRemoteProfile(own.userId, settings.store.syncSecret);
}

/** El perfil de un usuario, venga de donde venga. Síncrono: el render no espera. */
function resolveProfile(userId: string): XcordProfile | null {
    const own = getOwnProfile();
    // El borrador del editor manda mientras está abierto, para que el preview
    // vea al instante lo que no es CSS (banner, tema, efecto, borde).
    if (userId && userId === own.userId) return getDraftOverride() ?? own;
    return getCached(userId) ?? null;
}

const syncActions = {
    publish: publishOwnProfile,
    unpublish: unpublishOwnProfile,
    link: linkDiscordAccount,
    isVerified: () => settings.store.syncVerified
};

/** Abre el editor en un modal, sobre lo que sea que tengas delante. */
export function openEditor() {
    openModal(props => (
        <EditorModal props={props} initial={getOwnProfile()} onSave={saveOwnProfile} sync={syncActions} />
    ));
}

/**
 * Entrada "Personalizar perfil" en el menú contextual de un usuario.
 *
 * Solo aparece sobre ti mismo: xcord edita tu perfil, no el de los demás.
 */
const UserContextPatch: NavContextMenuPatchCallback = (children, { user }: { user?: User; }) => {
    if (!user || user.id !== UserStore.getCurrentUser()?.id) return;

    children.push(
        <Menu.MenuItem
            id="xcord-edit-profile"
            label="Personalizar perfil (xcord)"
            action={openEditor}
        />
    );
};

export default definePlugin({
    name: "xcord",
    description: "Personalización visual de perfiles: degradados, GIFs, fuentes y efectos. Solo visual, solo en tu cliente.",
    tags: ["Appearance", "Customisation"],
    authors: [Devs.Ven],
    settings,

    settingsAboutComponent: () => (
        <Editor initial={getOwnProfile()} onSave={saveOwnProfile} sync={syncActions} />
    ),

    contextMenus: {
        "user-context": UserContextPatch
    },

    patches: [
        {
            // Capa 1: el store de perfiles. Devolvemos el perfil de Discord con
            // nuestro banner encima, y él se encarga de renderizarlo.
            find: "UserProfileStore",
            replacement: [
                {
                    match: /(?<=getUserProfile\(\i\){return )(.+?)(?=})/,
                    replace: "$self.profileHook($1)"
                },
                {
                    // El perfil completo dentro de un servidor no lee el perfil
                    // de usuario sino el de miembro, que es un objeto distinto.
                    // Sin esto, el banner sale en el popout pero no en el modal.
                    // Aquí el objeto puede no traer userId, así que lo tomamos
                    // del primer argumento del propio método.
                    match: /(?<=getGuildMemberProfile\(\i,\i\){return )(.+?)(?=})/,
                    replace: "$self.profileHook($1,arguments[0])"
                }
            ]
        },
        {
            // Tercer intento, esta vez con el código real delante (el volcado
            // del módulo 963977) en vez de una firma prestada de Decor. El hook
            // recibe `avatarDecorationOverride` como PARÁMETRO de entrada —lo
            // desestructura de sus props—, así que no hace falta tocar la
            // lógica interna: basta con darle un valor por defecto cuando quien
            // llama no pasa nada, con el propio azúcar sintáctico de
            // destructuring de JS. Mucho más simple y menos fràgil que inyectar
            // en medio del cuerpo de la función.
            find: "onlyAnimateOnHoverOrFocus:",
            replacement: {
                match: /(?<=user:(\i).{0,80}?)avatarDecorationOverride:(\i)(?=,)/,
                replace: "avatarDecorationOverride:$2=$self.useXcordAvatarDecoration($1)"
            }
        },
        {
            // La barra de cuenta (mic/audífonos, abajo a la izquierda) no pasa
            // por el hook de arriba: lee `avatarDecoration` directo del objeto
            // de usuario, sin ningún parámetro de override — confirmado con el
            // código real del módulo 789543. `avatarWithPopoutRef` es un ancla
            // que solo aparece ahí, para no tocar otros sitios por accidente.
            find: "avatarWithPopoutRef",
            replacement: {
                match: /(\i)\?\.avatarDecoration(?=,)/,
                replace: "($self.useXcordAvatarDecoration($1)??$1?.avatarDecoration)"
            }
        },
        {
            // La placa de nombre (nameplate) tampoco tiene override: se lee
            // directo de `user.nameplate`. Confirmado con el código real del
            // módulo 449582. `?.nameplate)??` es un fragmento corto pero
            // distintivo de ese patrón específico.
            find: "?.nameplate)??",
            // Sin `group`: si la segunda firma (la del array de dependencias)
            // deja de coincidir en alguna actualización de Discord, prefiero
            // quedarme con la primera funcionando —la placa se aplicaría bien
            // pero solo con recargar tras cada cambio— a perder las dos.
            replacement: [
                {
                    // `s.WK` transforma los datos crudos de la placa antes de
                    // usarlos —seguramente resuelve la URL del vídeo, entre
                    // otras cosas—. El primer intento devolvía nuestro objeto
                    // sin pasarlo por ahí, y el resultado no tenía la forma
                    // que el componente de render esperaba: se aplicaba el
                    // patch sin fallar, pero no se pintaba nada. La captura
                    // de `s` viene del propio `(0,s.WK)` que ya está ahí.
                    match: /(?<=\(0,(\i)\.WK\).+?)\?\?(\i)\.nameplate/,
                    replace: "??((0,$1.WK)($self.useXcordNameplate($2))??$2.nameplate)"
                },
                {
                    // El useMemo de este hook depende de `[miembro,usuario]`
                    // — ninguno cambia cuando eliges otra placa en el editor,
                    // así que React devolvía el valor guardado en caché de la
                    // primera vez. Le añadimos nuestro contador de versión
                    // como tercera dependencia.
                    //
                    // Ojo al orden: los reemplazos de un mismo patch se
                    // aplican en cadena sobre el texto ya modificado. El
                    // primero deja `...??$2.nameplate)` con un paréntesis de
                    // más, así que aquí hay que buscar `nameplate)},` y no
                    // `nameplate},` — mi primer intento falló justo por eso.
                    match: /(?<=nameplate\)\},)\[(\i),(\i)\]/,
                    replace: "[$1,$2,$self.getXcordProfileVersion()]"
                }
            ]
        },
        {
            // La URL del avatar la arma esta única función (módulo 486020,
            // volcado real, exportada como IconUtils.getUserAvatarURL) y la
            // usan mensajes, lista de miembros, DMs y el propio perfil por
            // igual — a diferencia de intentar adivinar el contenedor a
            // pintar por CSS en cada sitio (lo que rompió el layout en un
            // intento anterior), aquí Discord sigue siendo quien decide cómo
            // se ve: tamaño, recorte circular, anillo de decoración, todo.
            // `find` usa el nombre de la propiedad del objeto exportado —eso
            // no se minifica, a diferencia de los nombres de variable— para
            // que siga sirviendo aunque el bundle renombre R/C/etc.
            find: "getGuildMemberAvatarURLSimple:",
            replacement: {
                match: /return (\i)\(e,(\i),(\i),(\i),(\i)\)\?\?(\i)\(e\.id,e\.discriminator,e\.isProvisional,\3\)\}/,
                replace: "return $self.useXcordAvatarURL(e)??($1(e,$2,$3,$4,$5)??$6(e.id,e.discriminator,e.isProvisional,$3))}"
            }
        }
    ],

    /**
     * La decoración de un usuario, si tiene una puesta por xcord.
     *
     * No es un hook de verdad —no usa useState ni suscripciones—, así que no
     * hay que preocuparse por el orden de hooks: es una función normal que lee
     * datos síncronos en cada render. Como valor por defecto en destructuring,
     * solo se usa cuando quien llama no pasó su propio `avatarDecorationOverride`
     * —el caso normal—, así que no pisa otros usos legítimos de esa prop.
     */
    useXcordAvatarDecoration(user?: { id: string; }): { asset: string; } | undefined {
        try {
            const asset = user?.id && resolveProfile(user.id)?.avatar?.decoration?.asset;
            return asset ? { asset } : undefined;
        } catch {
            return undefined;
        }
    },

    /**
     * La URL del avatar de un usuario, si tiene uno propio puesto por xcord.
     *
     * Se inyecta en el punto donde Discord arma la URL de verdad —módulo
     * 486020, `getUserAvatarURL`—, así que a partir de ahí lo renderiza su
     * propio código: mismo tamaño, mismo recorte circular, mismo anillo de
     * decoración encima, en cualquier sitio de la interfaz que llame a esa
     * función. Ningún hack de CSS adivinando contenedores.
     */
    useXcordAvatarURL(user?: { id?: string; }): string | undefined {
        try {
            return (user?.id && resolveProfile(user.id)?.avatar?.image?.url) || undefined;
        } catch {
            return undefined;
        }
    },

    /**
     * La placa de nombre de un usuario, si tiene una puesta por xcord.
     *
     * Devuelve la forma cruda —la misma que trae `guildMember.collectibles.
     * nameplate` de la red—, no la ya procesada por `s.WK`. El patch la hace
     * pasar por esa misma transformación antes de usarla, así que aquí no
     * hace falta —y no sabríamos cómo— replicarla. Van los dos formatos de
     * nombre de campo por si acaso: no sabemos con certeza cuál lee `WK`.
     */
    getXcordProfileVersion: getProfileVersion,

    useXcordNameplate(user?: { id: string; }): Record<string, unknown> | undefined {
        try {
            const np = user?.id && resolveProfile(user.id)?.nameplate;
            if (!np) return undefined;
            return {
                asset: np.asset,
                palette: np.palette,
                skuId: np.skuId,
                sku_id: np.skuId,
                expiresAt: null,
                expires_at: null
            };
        } catch {
            return undefined;
        }
    },

    /**
     * Sustituye el banner por el nuestro. `virtualMerge` crea una vista sobre el
     * objeto original en vez de copiarlo: no mutamos nada de Discord, y si el
     * usuario no tiene perfil xcord devolvemos el objeto intacto.
     */
    profileHook(profile: UserProfile, userIdOverride?: string): UserProfile {
        try {
            // `getGuildMemberProfile` devuelve null si el usuario no tiene
            // perfil en ese servidor. Sin esta guarda, virtualMerge recibe null
            // y lanza dentro del store — y un error ahí no rompe un componente,
            // rompe el cliente entero.
            if (!profile || typeof profile !== "object") return profile;

            const xcord = resolveProfile(userIdOverride ?? profile.userId);
            if (!xcord) return profile;

            const overrides: Partial<UserProfile> = {};

            const banner = xcord.banner?.image?.url;
            // Los archivos locales llegan como data-URI. Discord construye la
            // URL del banner a su manera y no sabe qué hacer con uno, así que
            // esos los deja pintar a la capa de CSS.
            if (banner && !banner.startsWith("data:")) overrides.banner = banner;

            // El fondo va por el tema de perfil de Discord, no por CSS: él pinta
            // el degradado en su propia capa, y competir con !important contra
            // eso es perder. A cambio solo admite dos colores.
            if (xcord.background)
                overrides.themeColors = fillToThemeColors(xcord.background.fill);

            // Discord identifica los coleccionables por `skuId`, no por `id`. El
            // efecto necesita además un puntero dedicado (`profileEffect`) que
            // dice cuál de los que posees está puesto — sin eso no hace nada,
            // aunque el sku esté en `collectibles`. Lo confirmamos leyendo un
            // perfil con un efecto real puesto.
            const owned = [...(profile.collectibles ?? [])];
            const addCollectible = (skuId: string, type: number) => {
                if (!owned.some((c: any) => c?.skuId === skuId))
                    owned.push({ skuId, type } as any);
            };

            if (xcord.profileEffectId) {
                overrides.profileEffect = { skuId: xcord.profileEffectId } as UserProfile["profileEffect"];
                addCollectible(xcord.profileEffectId, 1);
            }

            // El borde SÍ tiene un puntero dedicado, igual que el efecto — solo
            // que no se llama igual. Lo vimos en el volcado real del módulo de
            // la barra de cuenta: `displayProfile?.profileFrame?.skuId`. Nuestra
            // primera hipótesis (que bastaba con `collectibles`, sin puntero)
            // estaba equivocada; con este campo debería renderizarlo Discord
            // mismo, igual que hace con el efecto — sin nuestro compositor de
            // dom.ts, que queda como reserva si esto no funciona.
            if (xcord.cardBorder) {
                // `profileFrame` no está en los tipos de Vencord —es un campo
                // nuevo que ese paquete comunitario aún no documenta—, de ahí
                // el `any`.
                (overrides as any).profileFrame = { skuId: xcord.cardBorder.skuId };
                addCollectible(xcord.cardBorder.skuId, 3);
            }

            if (owned.length !== (profile.collectibles?.length ?? 0))
                overrides.collectibles = owned;

            if (!Object.keys(overrides).length) return profile;

            // Banner y tema solo se renderizan si Discord cree que hay Nitro.
            // Es una mentira local a nuestro cliente: no toca la cuenta ni
            // desbloquea nada real, solo hace que el componente pinte.
            overrides.premiumType = 2;

            return virtualMerge(profile, overrides);
        } catch {
            // Un fallo aquí rompería todos los perfiles. Nunca propagamos.
            return profile;
        }
    },

    start() {
        const own = getOwnProfile();
        if (own.userId) applyProfile(own);

        // Desactivado mientras probamos el `profileFrame` nativo (arriba, en
        // profileHook): si los dos estuvieran activos a la vez veríamos el
        // borde duplicado, como pasó con el anillo. Si el nativo no funciona
        // para algún borde, se reactiva con una línea.
        // setBorderResolver(userId => resolveProfile(userId)?.cardBorder);

        startObserver(userId => {
            if (!settings.store.syncEnabled) return;
            if (userId === own.userId) return;
            void fetchProfile(userId);
        });
    },

    stop() {
        stopObserver();
        setBorderResolver(null);
        teardown();
        ownProfile = null;
    },

    // Expuesto para el editor y para depurar desde la consola.
    saveOwnProfile,
    getOwnProfile,
    clearProfile
});
