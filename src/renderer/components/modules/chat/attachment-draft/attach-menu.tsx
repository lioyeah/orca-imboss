import { t } from "@shared/l10n";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useClickOutside } from "../../../../hooks/use-click-outside";
import { useDropdownPosition } from "../../../../hooks/use-dropdown-position";
import { useEscapeKey } from "../../../../hooks/use-escape-key";
import { IconAttach, IconFile, IconFolder } from "../../../icons";

export interface AttachMenuButtonProps {
  /** Controlled open state — the owner decides when a context change closes it. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The "File" row: the caller opens its own (hidden) file input. */
  onPickFiles: () => void;
  /**
   * The "Folder" row: the caller runs its directory picker. Omitted, the row is
   * not rendered at all (a caller that cannot attach folders never shows it).
   */
  onPickFolder?: () => void;
  /**
   * Extra rows after File/Folder. The composer uses this for the conversation
   * reference and the common projects; a card offers neither.
   */
  children?: ReactNode;
  /** Panel min width; the caller raises it when its rows are wider. */
  minWidth?: number;
}

/**
 * The "＋" attach trigger and its little menu (File / Folder, plus whatever the
 * caller adds), shared by the chat composer and the ask card's answer.
 *
 * One component so "where the attach button is and how its menu behaves" is the
 * same in both places: same trigger icon/size, same portaled panel positioned
 * against the trigger (flipping upward near the viewport bottom), same
 * click-outside / Escape / scroll-reposition rules.
 *
 * The menu is portaled to `document.body`, so both the anchor and the panel
 * count as "inside" for click-outside purposes.
 */
export function AttachMenuButton({
  open,
  onOpenChange,
  onPickFiles,
  onPickFolder,
  children,
  minWidth = 200,
}: AttachMenuButtonProps): React.JSX.Element {
  const anchorRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const { panelStyle, positionPanel } = useDropdownPosition(
    anchorRef,
    minWidth,
    300,
  );

  const outsideRefs = useMemo(() => [anchorRef, panelRef], []);
  useClickOutside(outsideRefs, () => onOpenChange(false), open);
  useEscapeKey(() => onOpenChange(false), open);

  // Reposition the portaled panel if the viewport scrolls/resizes while open.
  useEffect(() => {
    if (!open) return;
    const reposition = (): void => positionPanel();
    window.addEventListener("resize", reposition);
    document.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      document.removeEventListener("scroll", reposition, true);
    };
  }, [open, positionPanel]);

  return (
    <div className="imb-attach-anchor" ref={anchorRef}>
      <button
        type="button"
        className="imb-attach-btn"
        aria-label={t("Attach")}
        title={t("Attach")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => {
          if (open) {
            onOpenChange(false);
            return;
          }
          // Position before showing: the panel reads the trigger's rect.
          positionPanel();
          onOpenChange(true);
        }}
      >
        <IconAttach />
      </button>
      {open &&
        panelStyle &&
        createPortal(
          <div
            ref={panelRef}
            className="imb-attach-popup imb-menu-surface imb-open"
            role="menu"
            style={{
              position: "fixed",
              top: panelStyle.top,
              bottom: panelStyle.bottom,
              left: panelStyle.left,
              width: panelStyle.width,
              maxHeight: panelStyle.maxHeight,
              right: "auto",
              zIndex: 50,
            }}
          >
            <button
              type="button"
              role="menuitem"
              className="imb-attach-popup-item imb-menu-row"
              onClick={() => {
                onOpenChange(false);
                onPickFiles();
              }}
            >
              <IconFile />
              <span>{t("File")}</span>
            </button>
            {onPickFolder !== undefined && (
              <button
                type="button"
                role="menuitem"
                className="imb-attach-popup-item imb-menu-row"
                onClick={() => {
                  onOpenChange(false);
                  onPickFolder();
                }}
              >
                <IconFolder />
                <span>{t("Folder")}</span>
              </button>
            )}
            {children}
          </div>,
          document.body,
        )}
    </div>
  );
}
