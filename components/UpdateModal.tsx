/**
 * Aviso de que hay una versión nueva.
 *
 * No descarga ni ejecuta nada: enseña qué cambia, abre la página de descarga
 * si el usuario quiere, y explica que basta con volver a pasar `xcord.bat`,
 * que ya hace `git pull`, recompila e inyecta.
 *
 * El texto viene de un archivo remoto. Se pinta como texto —React escapa, aquí
 * no se construye HTML— y llega ya validado y recortado por `parseManifest`.
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { Forms, Modal, Text } from "@webpack/common";

import type { UpdateManifest } from "../lib/updates";

export function UpdateModal({ props, manifest, current, onDismiss, onOpen }: {
    props: RenderModalProps;
    manifest: UpdateManifest;
    current: string;
    /** Marca esta versión como vista, para no repetir el aviso. */
    onDismiss: () => void;
    onOpen: () => void;
}) {
    return (
        <Modal
            {...props}
            size="small"
            title={manifest.title}
            actions={[
                {
                    text: "Ver actualización",
                    variant: "primary",
                    onClick: () => {
                        onOpen();
                        props.onClose();
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
            <Text variant="text-md/semibold">
                Nueva versión de xcord disponible: {manifest.latest}
            </Text>

            <Text variant="text-sm/normal" style={{ marginTop: 4, color: "var(--text-muted)" }}>
                Tienes la {current}.
            </Text>

            {manifest.message && (
                <Text variant="text-sm/normal" style={{ marginTop: 12 }}>
                    {manifest.message}
                </Text>
            )}

            {manifest.notes.length > 0 && (
                <ul style={{ margin: "12px 0 0", paddingLeft: 20 }}>
                    {manifest.notes.map((note, i) => (
                        <li key={i}>
                            <Text variant="text-sm/normal" tag="span">{note}</Text>
                        </li>
                    ))}
                </ul>
            )}

            <Forms.FormDivider style={{ margin: "16px 0 12px" }} />

            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", lineHeight: 1.5 }}>
                Para actualizar basta con volver a ejecutar <code>xcord.bat</code>: ya se encarga
                de traer los cambios, recompilar Vencord e inyectarlo. Después cierra Discord del
                todo y vuelve a abrirlo — no basta con recargar.
            </Text>

            <Text variant="text-xs/normal" style={{ color: "var(--text-muted)", marginTop: 8 }}>
                xcord no descarga ni instala nada por su cuenta.
            </Text>
        </Modal>
    );
}
