/**
 * El editor dentro de un modal, para poder abrirlo desde el propio perfil en
 * vez de tener que ir a Ajustes → Plugins → xcord.
 *
 * Es el mismo componente de editor, sin duplicar nada: solo cambia el envoltorio
 * y dónde viven los botones. Aquí Guardar va en la barra de acciones del modal,
 * siempre visible — dentro del formulario quedaba enterrado bajo todo el scroll,
 * y cerrar sin haberlo encontrado parecía que el editor perdía los cambios.
 */

import type { RenderModalProps } from "@vencord/discord-types";
import { Modal } from "@webpack/common";

import { ProfileEditor, useProfileDraft, type SyncActions } from "./Editor";
import type { XcordProfile } from "../types";

export function EditorModal({ props, initial, onSave, sync }: {
    props: RenderModalProps;
    initial: XcordProfile;
    onSave: (p: XcordProfile) => void;
    sync?: SyncActions;
}) {
    const controller = useProfileDraft(initial, onSave);

    return (
        <Modal
            {...props}
            size="xl"
            title="Personalizar perfil · xcord"
            actions={[
                {
                    text: controller.dirty ? "Guardar" : "Guardado",
                    variant: "primary",
                    disabled: !controller.dirty,
                    onClick: controller.save
                },
                {
                    text: "Descartar",
                    variant: "secondary",
                    disabled: !controller.dirty,
                    onClick: controller.discard
                },
                {
                    text: "Cerrar",
                    variant: "secondary",
                    onClick: () => props.onClose()
                }
            ]}
        >
            <ProfileEditor controller={controller} showActions={false} sync={sync} />
        </Modal>
    );
}
