import { describe, expect, it } from "vitest";

import {
  agentRowIdAtPoint,
  agentRowOrderChanged,
  moveAgentRow,
} from "./agent-row-reorder";

describe("moveAgentRow", () => {
  it("moves a row onto a later row", () => {
    expect(moveAgentRow([11, 22, 33], 11, 33)).toEqual([22, 33, 11]);
  });

  it("moves a row onto an earlier row", () => {
    expect(moveAgentRow([11, 22, 33], 33, 11)).toEqual([33, 11, 22]);
  });

  it("keeps the order when the pointer is still on the dragged row", () => {
    expect(moveAgentRow([11, 22], 11, 11)).toEqual([11, 22]);
  });

  it("keeps the order when either id is missing", () => {
    expect(moveAgentRow([11, 22], 99, 22)).toEqual([11, 22]);
  });
});

describe("agentRowOrderChanged", () => {
  it("is false when every id stays in place", () => {
    expect(agentRowOrderChanged([1, 2], [1, 2])).toBe(false);
  });

  it("is true when an id moves", () => {
    expect(agentRowOrderChanged([1, 2], [2, 1])).toBe(true);
  });
});

describe("agentRowIdAtPoint", () => {
  it("reads the row under the pointer and skips the handle stacked above it", () => {
    document.body.innerHTML = `
      <table>
        <tr data-agent-profile-id="11"><td id="row-11"></td></tr>
        <tr data-agent-profile-id="22"><td id="row-22"></td></tr>
      </table>
      <button id="handle">reorder</button>
    `;
    const handle = document.getElementById("handle");
    const cell = document.getElementById("row-22");
    if (!handle || !cell) {
      throw new Error("missing reorder fixture");
    }
    document.elementsFromPoint = () => [handle, cell];

    expect(agentRowIdAtPoint(0, 0)).toBe(22);
  });

  it("returns null when the pointer is outside every row", () => {
    document.body.innerHTML = `<div id="outside"></div>`;
    const outside = document.getElementById("outside");
    if (!outside) {
      throw new Error("missing outside fixture");
    }
    document.elementsFromPoint = () => [outside];

    expect(agentRowIdAtPoint(0, 0)).toBeNull();
  });
});
