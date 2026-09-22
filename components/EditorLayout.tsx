import type { ReactNode } from "react";
import { useState } from "@webpack/common";

const SECTIONS = [
    { id: "appearance", label: "Apariencia", icon: "✦" },
    { id: "media", label: "Imágenes", icon: "▧" },
    { id: "widgets", label: "Widgets", icon: "◇" },
    { id: "shop", label: "Tienda", icon: "☆" },
    { id: "fonts", label: "Fuentes", icon: "Aa" }
] as const;

function goToSection(id: string) {
    const section = document.getElementById(`xcord-editor-${id}`);
    if (section instanceof HTMLDetailsElement) section.open = true;
    section?.scrollIntoView({
        behavior: "smooth",
        block: "start"
    });
}

export function EditorHeader({ dirty, showSync }: { dirty: boolean; showSync: boolean; }) {
    const sections = showSync
        ? [...SECTIONS, { id: "sync", label: "Sincronización", icon: "↗" }]
        : SECTIONS;

    return (
        <header className="xcord-editor-header">
            <div className="xcord-editor-heading">
                <div className="xcord-editor-mark" aria-hidden="true">X</div>
                <div>
                    <div className="xcord-editor-eyebrow">XCord Studio</div>
                    <h2>Diseña tu perfil</h2>
                    <p>Personaliza cómo te ven las personas que también usan xcord.</p>
                </div>
                <span className={`xcord-editor-status${dirty ? " is-dirty" : ""}`}>
                    <span aria-hidden="true" />
                    {dirty ? "Cambios sin guardar" : "Todo guardado"}
                </span>
            </div>

            <nav className="xcord-editor-nav" aria-label="Secciones del editor">
                {sections.map(section => (
                    <button key={section.id} type="button" onClick={() => goToSection(section.id)}>
                        <span aria-hidden="true">{section.icon}</span>
                        {section.label}
                    </button>
                ))}
            </nav>
        </header>
    );
}

export function EditorSection({ id, title, description, children, compact = false, defaultOpen = false }: {
    id: string;
    title: string;
    description?: string;
    children: ReactNode;
    compact?: boolean;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <details
            id={`xcord-editor-${id}`}
            className={`xcord-editor-card${compact ? " xcord-editor-card-compact" : ""}`}
            open={open}
            onToggle={event => setOpen(event.currentTarget.open)}
        >
            <summary className="xcord-editor-card-heading">
                <div className="xcord-editor-card-index" aria-hidden="true" />
                <div>
                    <h3>{title}</h3>
                    {description && <p>{description}</p>}
                </div>
                <span className="xcord-editor-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="xcord-editor-card-content">{children}</div>
        </details>
    );
}

export function EditorSubsection({ title, description, children, defaultOpen = false }: {
    title: string;
    description?: string;
    children: ReactNode;
    defaultOpen?: boolean;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <details
            className="xcord-editor-subsection"
            open={open}
            onToggle={event => setOpen(event.currentTarget.open)}
        >
            <summary>
                <div>
                    <strong>{title}</strong>
                    {description && <span>{description}</span>}
                </div>
                <span className="xcord-editor-chevron" aria-hidden="true">⌄</span>
            </summary>
            <div className="xcord-editor-subsection-content">{children}</div>
        </details>
    );
}
