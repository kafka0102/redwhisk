import { useState } from "react";

import type { IssueBoardPane } from "./issue-board-header";

export interface ChangeRequestRef {
  provider: string;
  number: number;
}

export function useChangeRequestNavigation(): {
  boardPane: IssueBoardPane;
  openDetail: ChangeRequestRef | null;
  setBoardPane: (pane: IssueBoardPane) => void;
  openChangeRequest: (request: ChangeRequestRef) => void;
  consumeOpenDetail: () => void;
} {
  const [boardPane, setBoardPane] = useState<IssueBoardPane>("issues");
  const [openDetail, setOpenDetail] = useState<ChangeRequestRef | null>(null);

  function openChangeRequest(request: ChangeRequestRef): void {
    setOpenDetail(request);
    setBoardPane("pullRequests");
  }

  function consumeOpenDetail(): void {
    setOpenDetail(null);
  }

  return {
    boardPane,
    openDetail,
    setBoardPane,
    openChangeRequest,
    consumeOpenDetail,
  };
}
