/** serde rename_all 规则的 TS 实现，与 Rust 侧 dto_parity_export.rs 对齐。 */

export function toCamelCase(snake: string): string {
  let out = "";
  let upper = false;
  for (let i = 0; i < snake.length; i += 1) {
    const ch = snake[i];
    if (ch === "_") {
      upper = true;
    } else if (upper) {
      out += ch.toUpperCase();
      upper = false;
    } else if (i === 0) {
      out += ch.toLowerCase();
    } else {
      out += ch;
    }
  }
  return out;
}

export function pascalToSnake(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i += 1) {
    const ch = name[i];
    if (ch >= "A" && ch <= "Z" && i !== 0) {
      out += "_";
    }
    out += ch.toLowerCase();
  }
  return out;
}

export function applyEnumRename(
  variantIdent: string,
  renameAll: string,
): string {
  switch (renameAll) {
    case "snake_case":
      return pascalToSnake(variantIdent);
    case "SCREAMING_SNAKE_CASE":
      return pascalToSnake(variantIdent).toUpperCase();
    case "camelCase": {
      const snake = pascalToSnake(variantIdent);
      return toCamelCase(snake);
    }
    default:
      return variantIdent;
  }
}
