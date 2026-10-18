import type { ReactNode } from "react";
import "./index.css";

export interface ListPaneProps {
  title: string;
  actions?: ReactNode;
  search?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/** Col 2: module title + search + scrollable list + footer. */
export function ListPane({
  title,
  actions,
  search,
  children,
  footer,
}: ListPaneProps): React.JSX.Element {
  return (
    <>
      <div className="imb-pane-header">
        <div className="imb-pane-header-top">
          <div className="imb-pane-title">{title}</div>
          {actions !== undefined && <div className="imb-pane-actions">{actions}</div>}
        </div>
        {search !== undefined && <div className="imb-pane-search-row">{search}</div>}
      </div>
      <div className="imb-list">{children}</div>
      {footer !== undefined && <div className="imb-pane-footer">{footer}</div>}
    </>
  );
}
