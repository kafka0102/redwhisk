/**
 * openHtmlInBrowser 失败时返回 false。调用处必须读这个布尔值，
 * 并在 false 分支展示 openHtmlInBrowserFailed。
 */

const FAILURE_KEY = "openHtmlInBrowserFailed";

/** @type {import("eslint").Rule.RuleModule} */
const openHtmlInBrowserResult = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Require openHtmlInBrowser failures to show openHtmlInBrowserFailed",
    },
    schema: [],
    messages: {
      unread:
        "Read openHtmlInBrowser's boolean and show openHtmlInBrowserFailed when it is false.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isOpenHtmlCall(node)) {
          return;
        }
        const ancestors = context.sourceCode.getAncestors(node);
        if (!handlesFailure(node, ancestors)) {
          context.report({ node, messageId: "unread" });
        }
      },
    };
  },
};

/**
 * @param {import("estree").CallExpression} node
 */
function isOpenHtmlCall(node) {
  return (
    node.callee.type === "Identifier" &&
    node.callee.name === "openHtmlInBrowser"
  );
}

/**
 * @param {import("estree").CallExpression} call
 * @param {import("estree").Node[]} ancestors
 */
function handlesFailure(call, ancestors) {
  const parent = ancestors.at(-1);
  if (parent?.type === "AwaitExpression") {
    return awaitHandlesFailure(parent, ancestors);
  }
  return thenHandlesFailure(call, parent);
}

/**
 * @param {import("estree").AwaitExpression} awaitNode
 * @param {import("estree").Node[]} ancestors
 */
function awaitHandlesFailure(awaitNode, ancestors) {
  const ifBranch = directIfBranch(awaitNode, ancestors);
  if (ifBranch && containsFailureKey(ifBranch)) {
    return true;
  }

  const declarator = ancestors.at(-2);
  if (
    declarator?.type !== "VariableDeclarator" ||
    declarator.id.type !== "Identifier" ||
    declarator.init !== awaitNode
  ) {
    return false;
  }

  const owner = nearestFunction(ancestors.slice(0, -2));
  if (!owner) {
    return false;
  }
  return functionChecksBinding(owner, declarator.id.name);
}

/**
 * @param {import("estree").CallExpression} call
 * @param {import("estree").Node | undefined} parent
 */
function thenHandlesFailure(call, parent) {
  if (
    parent?.type !== "MemberExpression" ||
    parent.object !== call ||
    parent.computed ||
    !isIdentifierNamed(parent.property, "then")
  ) {
    return false;
  }
  const thenCall = parent.parent;
  if (thenCall?.type !== "CallExpression" || thenCall.callee !== parent) {
    return false;
  }
  const callback = thenCall.arguments[0];
  if (
    callback?.type !== "ArrowFunctionExpression" &&
    callback?.type !== "FunctionExpression"
  ) {
    return false;
  }
  const param = callback.params[0];
  if (param?.type !== "Identifier") {
    return false;
  }
  return functionChecksBinding(callback, param.name);
}

/**
 * `if (!(await openHtmlInBrowser(...)))` 或 `if (await ...)` 的 else。
 * @param {import("estree").AwaitExpression} awaitNode
 * @param {import("estree").Node[]} ancestors
 * @returns {import("estree").Node | null}
 */
function directIfBranch(awaitNode, ancestors) {
  const parent = ancestors.at(-2);
  if (
    parent?.type === "UnaryExpression" &&
    parent.operator === "!" &&
    parent.argument === awaitNode
  ) {
    const ifStatement = ancestors.at(-3);
    if (ifStatement?.type === "IfStatement" && ifStatement.test === parent) {
      return ifStatement.consequent;
    }
  }
  if (parent?.type === "IfStatement" && parent.test === awaitNode) {
    return parent.alternate;
  }
  return null;
}

/**
 * @param {import("estree").Node} owner
 * @param {string} name
 */
function functionChecksBinding(owner, name) {
  const body = "body" in owner ? owner.body : null;
  if (!body) {
    return false;
  }
  return walkChecks(body, name, false);
}

/**
 * @param {import("estree").Node} node
 * @param {string} name
 * @param {boolean} nested
 */
function walkChecks(node, name, nested) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (
    !nested &&
    node.type === "IfStatement" &&
    branchForBinding(node, name) &&
    containsFailureKey(branchForBinding(node, name))
  ) {
    return true;
  }
  for (const child of childrenOf(node)) {
    const childIsNestedFunction =
      child.type === "ArrowFunctionExpression" ||
      child.type === "FunctionExpression" ||
      child.type === "FunctionDeclaration";
    if (walkChecks(child, name, nested || childIsNestedFunction)) {
      return true;
    }
  }
  return false;
}

/**
 * @param {import("estree").IfStatement} statement
 * @param {string} name
 * @returns {import("estree").Node | null}
 */
function branchForBinding(statement, name) {
  const test = statement.test;
  if (
    test.type === "UnaryExpression" &&
    test.operator === "!" &&
    test.argument.type === "Identifier" &&
    test.argument.name === name
  ) {
    return statement.consequent;
  }
  if (
    isFalseComparison(test, name, "===") ||
    isFalseComparison(test, name, "==")
  ) {
    return statement.consequent;
  }
  if (test.type === "Identifier" && test.name === name) {
    return statement.alternate;
  }
  if (
    isFalseComparison(test, name, "!==") ||
    isFalseComparison(test, name, "!=")
  ) {
    return statement.alternate;
  }
  return null;
}

/**
 * @param {import("estree").Node} test
 * @param {string} name
 * @param {string} operator
 */
function isFalseComparison(test, name, operator) {
  if (test.type !== "BinaryExpression" || test.operator !== operator) {
    return false;
  }
  const sides = [test.left, test.right];
  return (
    sides.some((side) => side.type === "Identifier" && side.name === name) &&
    sides.some((side) => side.type === "Literal" && side.value === false)
  );
}

/**
 * @param {import("estree").Node} node
 */
function containsFailureKey(node) {
  if (!node || typeof node !== "object") {
    return false;
  }
  if (
    node.type === "Literal" &&
    typeof node.value === "string" &&
    node.value.includes(FAILURE_KEY)
  ) {
    return true;
  }
  if (node.type === "Identifier" && node.name === FAILURE_KEY) {
    return true;
  }
  if (node.type === "TemplateElement" && node.value.raw.includes(FAILURE_KEY)) {
    return true;
  }
  return childrenOf(node).some(containsFailureKey);
}

/**
 * @param {import("estree").Node} node
 * @returns {import("estree").Node[]}
 */
function childrenOf(node) {
  /** @type {import("estree").Node[]} */
  const children = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === "parent") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (isNode(item)) {
          children.push(item);
        }
      }
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}

/**
 * @param {unknown} value
 * @returns {value is import("estree").Node}
 */
function isNode(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    "type" in value &&
    typeof value.type === "string"
  );
}

/**
 * @param {import("estree").Node | null | undefined} node
 * @param {string} name
 */
function isIdentifierNamed(node, name) {
  return node?.type === "Identifier" && node.name === name;
}

/**
 * @param {import("estree").Node[]} ancestors
 */
function nearestFunction(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const node = ancestors[index];
    if (
      node.type === "ArrowFunctionExpression" ||
      node.type === "FunctionExpression" ||
      node.type === "FunctionDeclaration"
    ) {
      return node;
    }
  }
  return null;
}

export default openHtmlInBrowserResult;
