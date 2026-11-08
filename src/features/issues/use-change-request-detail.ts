import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  getProjectChangeRequest,
  type ChangeRequestDetail,
} from "./change-request-commands";
import { usePageVisible } from "./use-issue-auto-sync";
import { useWindowFocus } from "../../shared/window/use-window-focus";

const REFRESH_MS = 30_000;

export function useChangeRequestDetail({
  projectId,
  provider,
  number,
}: {
  projectId: number;
  provider: string;
  number: number;
}): {
  detail: ChangeRequestDetail | null;
  setDetail: Dispatch<SetStateAction<ChangeRequestDetail | null>>;
} {
  const [detail, setDetail] = useState<ChangeRequestDetail | null>(null);
  const pageVisible = usePageVisible();
  const windowFocused = useWindowFocus();
  const inFlightRef = useRef(false);
  const active = pageVisible && windowFocused;

  useEffect(() => {
    if (!active) {
      return undefined;
    }
    const load = async () => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const next = await getProjectChangeRequest({
          projectId,
          provider,
          number,
        });
        setDetail(next);
      } finally {
        inFlightRef.current = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!inFlightRef.current) {
        void load();
      }
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [active, number, projectId, provider]);

  return { detail, setDetail };
}
