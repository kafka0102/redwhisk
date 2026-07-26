import { useEffect, useState } from "react";

/**
 * 首次渲染 Monaco 前再配置 worker / loader。
 * 避免在 main 入口同步 import monaco-editor（约数 MB），拖慢项目窗口首屏。
 */
export function useMonacoEditorReady(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    void import("./monaco-editor-setup")
      .then(({ configureMonacoEditor }) => {
        configureMonacoEditor();
        if (!isCancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        // 配置失败时仍尝试渲染 Editor；@monaco-editor/react 会走默认 loader。
        if (!isCancelled) {
          setReady(true);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, []);

  return ready;
}
