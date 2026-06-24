import { toast as sonnerToast, type ToastT, type ExternalToast } from "sonner";

/**
 * Toast 提示封装
 * 使用方式:
 *   toast.success("操作成功")
 *   toast.error("错误信息")
 *   toast.info("提示信息")
 *   toast.warning("警告信息")
 *   toast.loading("加载中...")
 */
export const toast = {
  /**
   * 显示成功提示
   * @param message 提示信息
   * @param options 可选配置
   */
  success(message: string, options?: ExternalToast): string | number {
    return sonnerToast.success(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * 显示错误提示
   * @param message 提示信息
   * @param options 可选配置
   */
  error(message: string, options?: ExternalToast): string | number {
    return sonnerToast.error(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * 显示信息提示
   * @param message 提示信息
   * @param options 可选配置
   */
  info(message: string, options?: ExternalToast): string | number {
    return sonnerToast.info(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * 显示警告提示
   * @param message 提示信息
   * @param options 可选配置
   */
  warning(message: string, options?: ExternalToast): string | number {
    return sonnerToast.warning(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * 显示加载提示
   * @param message 提示信息
   * @param options 可选配置
   */
  loading(message: string, options?: ExternalToast): string | number {
    return sonnerToast.loading(message, options);
  },

  /**
   * 显示自定义提示
   * @param message 提示信息
   * @param options 可选配置
   */
  message(message: string, options?: ExternalToast): string | number {
    return sonnerToast(message, {
      duration: 3000,
      ...options,
    });
  },

  /**
   * 关闭指定的 toast
   * @param id toast ID
   */
  dismiss(id?: string | number): void {
    sonnerToast.dismiss(id);
  },

  /**
   * 更新已有的 toast
   * @param id toast ID
   * @param options 更新配置
   */
  update(id: string | number, options: ExternalToast): void {
    sonnerToast(id, options);
  },
};

export type { ToastT, ExternalToast };
