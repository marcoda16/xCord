/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 marcoda16
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * Aviso de que hay una versión nueva.
 *
 * Enseña qué cambia y, cuando el usuario lo pide, abre el instalador local
 * `xcord.bat`, que ya hace `git pull`, recompila e inyecta.
 *
 * El texto viene de un archivo remoto. Se pinta como texto —React escapa, aquí
 * no se construye HTML— y llega ya validado y recortado por `parseManifest`.
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { Modal, Text } from "@webpack/common";

import type { UpdateManifest } from "../lib/updates";

export function UpdateModal({ props, manifest, current, onDismiss, onOpen }: {
    props: RenderModalProps;
    manifest: UpdateManifest;
    current: string;
    /** Marca esta versión como vista, para no repetir el aviso. */
    onDismiss: () => void;
    onOpen: () => Promise<{ ok: boolean; error?: string; }>;
}) {
    return (
        <Modal
            {...props}
            size="sm"
            title={manifest.title}
            actions={[
                {
                    text: "Actualizar ahora",
                    variant: "primary",
                    onClick: async () => {
                        try {
                            const result = await onOpen();
                            if (result.ok) props.onClose();
                            else alert(result.error || "No se pudo iniciar la actualización.");
                        } catch {
                            alert("No se pudo iniciar la actualización. Cierra Discord por completo, también desde la bandeja de Windows, y vuelve a abrirlo antes de intentarlo otra vez.");
                        }
                    }
                },
                {
                    text: "Ahora no",
                    variant: "secondary",
                    onClick: () => {
                        onDismiss();
                        props.onClose();
                    }
                }
            ]}
        >
            <div style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                borderRadius: 12,
                background: "var(--background-secondary)",
                minWidth: 0
            }}>
                <div style={{
                    display: "grid",
                    placeItems: "center",
                    width: 38,
                    height: 38,
                    flexShrink: 0,
                    borderRadius: 10,
                    color: "white",
                    fontWeight: 800,
                    background: "var(--brand-500, #5865f2)"
                }}>x</div>
                <div style={{ minWidth: 0 }}>
                    <Text variant="text-md/semibold" style={{ overflowWrap: "anywhere" }}>
                        xcord {manifest.latest} ya está disponible
                    </Text>
                    <Text variant="text-xs/normal" style={{ marginTop: 2, color: "var(--text-muted)" }}>
                        Versión instalada: {current}
                    </Text>
                </div>
            </div>

            {manifest.message && (
                <Text variant="text-sm/normal" style={{ marginTop: 14, overflowWrap: "anywhere" }}>
                    {manifest.message}
                </Text>
            )}

            {manifest.notes.length > 0 && (
                <div style={{ marginTop: 14 }}>
                    <Text variant="text-xs/semibold" style={{ color: "var(--text-muted)" }}>
                        NOVEDADES
                    </Text>
                    <ul style={{ margin: "8px 0 0", paddingLeft: 20, overflowWrap: "anywhere" }}>
                        {manifest.notes.map((note, i) => (
                            <li key={i} style={{ marginTop: i ? 6 : 0 }}>
                                <Text variant="text-sm/normal" tag="span">{note}</Text>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            <div style={{ margin: "16px 0 12px", borderTop: "1px solid var(--background-modifier-accent)" }} />

            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
                Se abrirá <code>xcord.bat</code> en una ventana. Sigue sus instrucciones y, al terminar, reinicia Discord por completo.
            </Text>
        </Modal>
    );
}
