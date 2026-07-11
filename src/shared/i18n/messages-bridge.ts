import type { TFunction } from "i18next";

import type { I18nMessages } from "./messages";
import schema from "./locales/en.json";

const PLACEHOLDER = /\{\{(\w+)\}\}/g;

type Leaf = string | ((...args: unknown[]) => string);
type Branch = { [key: string]: Leaf | Branch };

const schemaRoot = schema as unknown as Branch;

function placeholderNames(raw: string): string[] {
  return [...raw.matchAll(PLACEHOLDER)].map((match) => match[1]);
}

function makeLeaf(t: TFunction, path: string, raw: string): Leaf {
  const names = placeholderNames(raw);
  if (names.length === 0) {
    return t(path);
  }
  return (...args: unknown[]) => {
    const params: Record<string, unknown> = {};
    names.forEach((name, index) => {
      params[name] = args[index];
    });
    return t(path, params);
  };
}

function makeTaskStatusLabel(t: TFunction) {
  return (status: string): string => {
    switch (status) {
      case "completed":
        return t("agentsFeature.taskStatusLabelCompleted");
      case "in_progress":
        return t("agentsFeature.taskStatusLabelInProgress");
      case "updated":
        return t("agentsFeature.taskStatusLabelUpdated");
      default:
        return status.replace(/_/g, " ");
    }
  };
}

function makeBranch(t: TFunction, path: string, node: Branch): Branch {
  return new Proxy(node, {
    get(target, key, receiver) {
      if (typeof key !== "string") {
        return Reflect.get(target, key, receiver);
      }
      const nextPath = path ? `${path}.${key}` : key;
      if (nextPath === "agentsFeature.taskStatusLabel") {
        return makeTaskStatusLabel(t);
      }
      const next = target[key];
      if (next && typeof next === "object") {
        return makeBranch(t, nextPath, next as Branch);
      }
      if (typeof next === "string") {
        return makeLeaf(t, nextPath, next);
      }
      return undefined;
    },
  }) as Branch;
}

export function createMessagesProxy(t: TFunction): I18nMessages {
  return makeBranch(t, "", schemaRoot) as unknown as I18nMessages;
}
