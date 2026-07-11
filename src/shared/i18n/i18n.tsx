// 迁移桥接入口：保持既有 `from ".../i18n/i18n"` 导入不变，
// 实际实现由 i18next provider 提供；`messages` 代理让旧消费点零改写接入 i18next。
// eslint-disable-next-line react-refresh/only-export-components
export { I18nProvider, useI18n } from "./i18n-provider";

import { useI18n } from "./i18n-provider";

// eslint-disable-next-line react-refresh/only-export-components
export const useTheme = useI18n;
