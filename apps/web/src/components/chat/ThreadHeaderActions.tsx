import { memo, useState } from "react";

import { useClientSettings } from "../../hooks/useSettings";
import { useT3ProjectFileScripts } from "../../hooks/useT3ProjectFileScripts";
import BaseGitActionsControl from "../GitActionsControl";
import ProjectScriptsControl from "../ProjectScriptsControl";
import { Menu, MenuPopup } from "../ui/menu";
import { OpenInPicker } from "./OpenInPicker";
import type { ThreadDetailsPanelProps } from "./ThreadDetailsPanel";
import { ThreadDetailsItemsMenuItems } from "./ThreadDetailsItemsMenu";
import { resolveThreadHeaderItems } from "./threadDetailsItems";

const GitActionsControl = memo(BaseGitActionsControl);

/** Thread details items the user moved to the chat header. */
export const ThreadHeaderActions = memo(function ThreadHeaderActions(
  props: Pick<
    ThreadDetailsPanelProps,
    | "environmentId"
    | "threadId"
    | "draftId"
    | "activeProjectName"
    | "activeProjectScripts"
    | "preferredScriptId"
    | "keybindings"
    | "availableEditors"
    | "showOpenInPicker"
    | "openInShortcutEnabled"
    | "gitCwd"
    | "isGitRepo"
    | "onOpenChanges"
    | "onRunProjectScript"
    | "onAddProjectScript"
    | "onUpdateProjectScript"
    | "onDeleteProjectScript"
  >,
) {
  const header = useClientSettings(resolveThreadHeaderItems);
  const [menuPosition, setMenuPosition] = useState<{ x: number; y: number } | null>(null);
  const show = {
    scripts: header.scripts && props.activeProjectScripts !== undefined,
    openIn: header.openIn && props.showOpenInPicker,
    git:
      props.gitCwd !== null &&
      props.activeProjectName !== undefined &&
      (header.gitActions || (header.changes && props.isGitRepo)),
  };
  const fileScripts = useT3ProjectFileScripts(
    props.environmentId,
    show.scripts ? props.gitCwd : null,
  );
  if (!show.scripts && !show.openIn && !show.git) return null;
  return (
    <div
      data-chat-header-actions
      className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag] @3xl/header-actions:gap-3"
      onContextMenu={(event) => {
        // Portaled popups and dialogs bubble here through React and keep their own menus.
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        setMenuPosition({ x: event.clientX, y: event.clientY });
      }}
    >
      {show.scripts && props.activeProjectScripts ? (
        <ProjectScriptsControl
          environmentId={props.environmentId}
          scripts={props.activeProjectScripts}
          fileScripts={fileScripts}
          preferredScriptId={props.preferredScriptId}
          onRunScript={props.onRunProjectScript}
          onAddScript={props.onAddProjectScript}
          onUpdateScript={props.onUpdateProjectScript}
          onDeleteScript={props.onDeleteProjectScript}
        />
      ) : null}
      {show.openIn ? (
        <OpenInPicker
          keybindings={props.keybindings}
          environmentId={props.environmentId}
          availableEditors={props.availableEditors}
          openInCwd={props.gitCwd}
          enableShortcut={props.openInShortcutEnabled}
        />
      ) : null}
      {show.git && props.gitCwd ? (
        <GitActionsControl
          displayMode="toolbar"
          showActions={header.gitActions}
          showChanges={header.changes}
          gitCwd={props.gitCwd}
          activeThreadRef={{ environmentId: props.environmentId, threadId: props.threadId }}
          {...(props.draftId ? { draftId: props.draftId } : {})}
          {...(props.onOpenChanges ? { onOpenChanges: props.onOpenChanges } : {})}
        />
      ) : null}
      <Menu open={menuPosition !== null} onOpenChange={(open) => !open && setMenuPosition(null)}>
        <MenuPopup
          anchor={
            menuPosition
              ? { getBoundingClientRect: () => new DOMRect(menuPosition.x, menuPosition.y, 0, 0) }
              : undefined
          }
          align="start"
          side="bottom"
        >
          <ThreadDetailsItemsMenuItems />
        </MenuPopup>
      </Menu>
    </div>
  );
});
