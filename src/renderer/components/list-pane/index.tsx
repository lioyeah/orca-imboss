import type { ReactNode } from "react";
import "./index.css";

export interface ListPaneProps {
  title: string;
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Col 2: module title + search + scrollable list + footer. */
export function ListPane({
  title,
  search,
  children,
  footer,
}: ListPaneProps): React.JSX.Element {
  return (
    <>
      <div className="imb-pane-header">
        <div className="imb-pane-title">{title}</div>
        {search}
      </div>
      <div className="imb-list">{children}</div>
      {footer !== undefined && <div className="imb-pane-footer">{footer}</div>}
    </>
  );
}
