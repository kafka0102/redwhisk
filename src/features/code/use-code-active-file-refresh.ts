import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

import {
  readProjectWorktreeFile,
  statProjectWorktreeFile,
} from "../../shared/workspace/workspace-commands";
import type { CodeFileTab } from "./code-workspace-cache";

const ACTIVE_FILE_REFRESH_INTERVAL_MS = 5_000;

export function buildActiveFileSignature(
  sizeBytes: number,
  modifiedAt: number | null | undefined,
): string {
  return `${sizeBytes}:${modifiedAt ?? 0}`;
}

export interface UseCodeActiveFileRefreshOptions {
  projectId: number;
  workspacePath: string | null;
  activePath: string | null;
  enabled: boolean;
  /** 当前激活 tab 已加载正文的签名（size:mtime），用于打开后首轮 stat 免重复 read。 */
  knownSignature: string | null;
  setTabs: Dispatch<SetStateAction<CodeFileTab[]>>;
  resolveErrorMessage: (error: unknown) => string;
}

/**
 * 「代码」Activity 激活文件 Tab 的条件轮询：可见时 5s 做轻量 stat 签名检测；
 * 签名未变不 read；变化则静默 read 更新 content（不 isLoading）；隐藏暂停；
 * 切换激活路径 / 恢复可见立即检；失败进入与挂载复检一致的错误态。
 */
export function useCodeActiveFileRefresh({
  projectId,
  workspacePath,
  activePath,
  enabled,
  knownSignature,
  setTabs,
  resolveErrorMessage,
}: UseCodeActiveFileRefreshOptions): void {
  const [isVisible, setIsVisible] = useState(
    typeof document === "undefined" || document.visibilityState === "visible",
  );
  const checkGenRef = useRef(0);
  const lastSignatureRef = useRef<{ path: string; signature: string } | null>(
    null,
  );
  const resolveErrorMessageRef = useRef(resolveErrorMessage);
  const setTabsRef = useRef(setTabs);

  useEffect(() => {
    resolveErrorMessageRef.current = resolveErrorMessage;
  }, [resolveErrorMessage]);

  useEffect(() => {
    setTabsRef.current = setTabs;
  }, [setTabs]);

  // 切换 workspace / 激活路径时丢弃在途请求。
  useEffect(() => {
    checkGenRef.current += 1;
  }, [activePath, workspacePath]);

  useEffect(() => {
    lastSignatureRef.current = null;
  }, [workspacePath]);

  // 切 tab / 正文已加载时用 knownSignature 播种，避免打开后立刻重复 read；
  // 切回已打开 tab 时以缓存正文签名为基线，再由 stat 判断是否过期。
  useEffect(() => {
    if (!activePath || knownSignature == null) return;
    if (lastSignatureRef.current?.path !== activePath) {
      lastSignatureRef.current = {
        path: activePath,
        signature: knownSignature,
      };
    }
  }, [activePath, knownSignature]);

  useEffect(() => {
    const onVisibilityChange = () => {
      setIsVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const check = useCallback(() => {
    if (!enabled || !workspacePath || !activePath) return;
    const path = activePath;
    const rootPath = workspacePath;
    const gen = (checkGenRef.current += 1);

    void statProjectWorktreeFile({
      projectId,
      workspacePath: rootPath,
      filePath: path,
    })
      .then(async (stat) => {
        if (checkGenRef.current !== gen) return;
        const signature = buildActiveFileSignature(
          stat.sizeBytes,
          stat.modifiedAt,
        );
        const previous = lastSignatureRef.current;
        if (previous?.path === path && previous.signature === signature) {
          return;
        }
        // 尚无该路径基线时只记录签名（首开/切 tab 由 openFile 负责正文）；
        // 同路径签名变化才静默 read，避免与打开请求重复读。
        if (previous?.path !== path) {
          lastSignatureRef.current = { path, signature };
          return;
        }
        lastSignatureRef.current = { path, signature };

        try {
          const content = await readProjectWorktreeFile({
            projectId,
            workspacePath: rootPath,
            filePath: path,
          });
          if (checkGenRef.current !== gen) return;
          lastSignatureRef.current = {
            path,
            signature: buildActiveFileSignature(
              content.sizeBytes,
              content.modifiedAt,
            ),
          };
          setTabsRef.current((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === path
                ? {
                    ...tab,
                    content,
                    errorMessage: null,
                    isLoading: false,
                  }
                : tab,
            ),
          );
        } catch (error) {
          if (checkGenRef.current !== gen) return;
          // 保留 path 但清空签名，使恢复可读后下一次 stat 必触发 read。
          lastSignatureRef.current = { path, signature: "" };
          setTabsRef.current((currentTabs) =>
            currentTabs.map((tab) =>
              tab.filePath === path
                ? {
                    ...tab,
                    content: null,
                    errorMessage: resolveErrorMessageRef.current(error),
                    isLoading: false,
                  }
                : tab,
            ),
          );
        }
      })
      .catch((error) => {
        if (checkGenRef.current !== gen) return;
        lastSignatureRef.current = { path, signature: "" };
        setTabsRef.current((currentTabs) =>
          currentTabs.map((tab) =>
            tab.filePath === path
              ? {
                  ...tab,
                  content: null,
                  errorMessage: resolveErrorMessageRef.current(error),
                  isLoading: false,
                }
              : tab,
          ),
        );
      });
  }, [activePath, enabled, projectId, workspacePath]);

  useEffect(() => {
    if (!enabled || !workspacePath || !activePath || !isVisible) {
      return;
    }

    // 路径/workspace/恢复可见时立即检；可见期间 5s 轮询。
    void check();
    const timerId = window.setInterval(() => {
      void check();
    }, ACTIVE_FILE_REFRESH_INTERVAL_MS);

    return () => {
      window.clearInterval(timerId);
    };
  }, [activePath, check, enabled, isVisible, workspacePath]);
}
