export function isCodeLanguageFile(options: {
  language?: string | null;
  isBinary?: boolean;
  isTooLarge?: boolean;
}): boolean {
  if (options.isBinary || options.isTooLarge) {
    return false;
  }
  return options.language === "typescript" || options.language === "javascript";
}
