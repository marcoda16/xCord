import { FormSwitch } from "@components/FormSwitch";
import { Margins } from "@utils/margins";
import { Button, Forms, Text, TextInput } from "@webpack/common";

import { MAX_WIDGET_LINKS, safeHttpsUrl } from "../lib/widgetData";
import type { ProfileWidgetHero, ProfileWidgetLink, ProfileWidgets } from "../types";

interface WidgetsEditorProps {
    value: ProfileWidgets | undefined;
    onChange: (value: ProfileWidgets | undefined) => void;
}

function newLink(): ProfileWidgetLink {
    return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        title: "",
        description: "",
        imageUrl: ""
    };
}

function urlError(value: string | undefined): boolean {
    return !!value?.trim() && !safeHttpsUrl(value);
}

function UrlHint({ value, image = false }: { value?: string; image?: boolean; }) {
    if (!urlError(value)) return null;
    return (
        <Text variant="text-xs/normal" style={{ color: "var(--text-danger)" }}>
            {image ? "La imagen" : "El enlace"} debe usar una URL HTTPS válida.
        </Text>
    );
}

function WidgetPreview({ widgets }: { widgets: ProfileWidgets; }) {
    const heroImage = safeHttpsUrl(widgets.hero?.imageUrl);

    return (
        <div className="xcord-widget-preview">
            {widgets.hero && (
                <div
                    className="xcord-widget-preview-hero"
                    style={{
                        backgroundImage: heroImage
                            ? `linear-gradient(180deg, transparent, rgba(0,0,0,.88)), url("${heroImage}")`
                            : "linear-gradient(135deg, var(--brand-500), var(--brand-700))"
                    }}
                >
                    <div>
                        <div className="xcord-widget-preview-hero-title">
                            {widgets.hero.title || "Título destacado"}
                        </div>
                        {widgets.hero.description && (
                            <div className="xcord-widget-preview-hero-description">
                                {widgets.hero.description}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {widgets.links.length > 0 && (
                <div className="xcord-widget-preview-links" style={{ marginTop: widgets.hero ? undefined : 0 }}>
                    {widgets.links.map(link => {
                        const image = safeHttpsUrl(link.imageUrl);
                        return (
                            <div key={link.id} className="xcord-widget-preview-link">
                                <div className="xcord-widget-preview-icon">
                                    {image
                                        ? <img src={image} alt="" />
                                        : (link.title || "?").slice(0, 1).toUpperCase()}
                                </div>
                                <div className="xcord-widget-preview-copy">
                                    <div className="xcord-widget-preview-title">
                                        {link.title || "Nueva tarjeta"}
                                    </div>
                                    <div className="xcord-widget-preview-host">
                                        {link.description ?? link.url ?? ""}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export function WidgetsEditor({ value, onChange }: WidgetsEditorProps) {
    const widgets: ProfileWidgets = value ?? { links: [] };
    const setWidgets = (next: ProfileWidgets) => onChange(next.hero || next.links.length ? next : undefined);

    const updateHero = (patch: Partial<ProfileWidgetHero>) => setWidgets({
        ...widgets,
        hero: { title: "", url: "", ...widgets.hero, ...patch }
    });

    const updateLink = (id: string, patch: Partial<ProfileWidgetLink>) => setWidgets({
        ...widgets,
        links: widgets.links.map(link => link.id === id ? { ...link, ...patch } : link)
    });

    const moveLink = (index: number, direction: -1 | 1) => {
        const target = index + direction;
        if (target < 0 || target >= widgets.links.length) return;
        const links = [...widgets.links];
        [links[index], links[target]] = [links[target], links[index]];
        setWidgets({ ...widgets, links });
    };

    return (
        <div className="xcord-widget-editor">
            <Text variant="text-sm/normal">
                La tarjeta destacada también aparece en el perfil emergente. Las tarjetas secundarias aparecen en el perfil completo. Visibles para usuarios que también tengan xcord.
            </Text>

            <FormSwitch
                title="Tarjeta destacada"
                value={!!widgets.hero}
                onChange={(enabled: boolean) => setWidgets({
                    ...widgets,
                    hero: enabled ? { title: "", url: "", imageUrl: "", description: "" } : undefined
                })}
            />

            {widgets.hero && (
                <div className="xcord-widget-panel">
                    <Forms.FormTitle tag="h5">Título opcional</Forms.FormTitle>
                    <TextInput
                        value={widgets.hero.title}
                        placeholder="Mi proyecto"
                        maxLength={48}
                        onChange={(title: string) => updateHero({ title })}
                    />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Enlace opcional</Forms.FormTitle>
                    <TextInput
                        value={widgets.hero.url}
                        placeholder="https://…"
                        onChange={(url: string) => updateHero({ url })}
                    />
                    <UrlHint value={widgets.hero.url} />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Imagen horizontal</Forms.FormTitle>
                    <TextInput
                        value={widgets.hero.imageUrl ?? ""}
                        placeholder="https://…/portada.png"
                        onChange={(imageUrl: string) => updateHero({ imageUrl })}
                    />
                    <UrlHint value={widgets.hero.imageUrl} image />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Descripción opcional</Forms.FormTitle>
                    <TextInput
                        value={widgets.hero.description ?? ""}
                        placeholder="Una descripción breve"
                        maxLength={120}
                        onChange={(description: string) => updateHero({ description })}
                    />
                </div>
            )}

            <div className="xcord-widget-toolbar">
                <Forms.FormTitle tag="h5" style={{ margin: 0 }}>
                    Tarjetas secundarias ({widgets.links.length}/{MAX_WIDGET_LINKS})
                </Forms.FormTitle>
                <Button
                    size={Button.Sizes.SMALL}
                    disabled={widgets.links.length >= MAX_WIDGET_LINKS}
                    onClick={() => setWidgets({ ...widgets, links: [...widgets.links, newLink()] })}
                >Agregar tarjeta</Button>
            </div>

            {widgets.links.map((link, index) => (
                <div key={link.id} className="xcord-widget-panel">
                    <div className="xcord-widget-item-heading">
                        <Text variant="text-sm/semibold">Tarjeta {index + 1}</Text>
                        <div className="xcord-widget-item-actions">
                            <Button size={Button.Sizes.SMALL} disabled={index === 0} onClick={() => moveLink(index, -1)}>↑</Button>
                            <Button size={Button.Sizes.SMALL} disabled={index === widgets.links.length - 1} onClick={() => moveLink(index, 1)}>↓</Button>
                            <Button
                                size={Button.Sizes.SMALL}
                                color={Button.Colors.RED}
                                onClick={() => setWidgets({ ...widgets, links: widgets.links.filter(item => item.id !== link.id) })}
                            >Quitar</Button>
                        </div>
                    </div>
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Título</Forms.FormTitle>
                    <TextInput
                        value={link.title}
                        placeholder="Mis redes"
                        maxLength={48}
                        onChange={(title: string) => updateLink(link.id, { title })}
                    />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Descripción</Forms.FormTitle>
                    <TextInput value={link.description ?? link.url ?? ""} placeholder="Una descripción breve" maxLength={120} onChange={(description: string) => updateLink(link.id, { description, url: undefined })} />
                    <Forms.FormTitle tag="h5" className={Margins.top8}>Icono</Forms.FormTitle>
                    <TextInput
                        value={link.imageUrl ?? ""}
                        placeholder="https://…/icono.png"
                        onChange={(imageUrl: string) => updateLink(link.id, { imageUrl })}
                    />
                    <UrlHint value={link.imageUrl} image />
                </div>
            ))}

            {(widgets.hero || widgets.links.length > 0) && <WidgetPreview widgets={widgets} />}
        </div>
    );
}
