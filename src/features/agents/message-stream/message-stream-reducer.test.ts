import { describe, expect, it } from "vitest";

import type {
  AgentStreamEvent,
  AgentTimelineItem,
  TimelineHistoryItem,
} from "../agent-stream-types";
import {
  createInitialState,
  messageStreamReducer,
} from "./message-stream-reducer";
import {
  formatOutputSourceOption,
  projectMessageStream,
} from "./output-source";
import type { MessageStreamState } from "./message-stream-types";

function timelineEvent(item: AgentTimelineItem, seq = 1): AgentStreamEvent {
  return { type: "timeline", item, seq, timestamp: 0 };
}

describe("messageStreamReducer", () => {
  describe("createInitialState", () => {
    it("返回空初始状态", () => {
      const state = createInitialState();
      expect(state.entries).toEqual([]);
      expect(state.turnStatus).toBe("idle");
      expect(state.usage).toBeNull();
      expect(state.pendingPermissions).toEqual([]);
      expect(state.mode).toBeNull();
      expect(state.model).toBeNull();
      expect(state.lastSeq).toBeNull();
      expect(state.lastError).toBeNull();
      expect(state.isInitialized).toBe(false);
    });
  });

  describe("RESET", () => {
    it("重置为初始状态", () => {
      const state = messageStreamReducer(
        {
          ...createInitialState(),
          entries: [
            {
              id: "m1",
              kind: "assistant_message",
              item: { type: "assistant_message", text: "hi", messageId: "m1" },
            },
          ],
          turnStatus: "running",
          isInitialized: true,
        },
        { type: "RESET" },
      );
      expect(state.entries).toEqual([]);
      expect(state.turnStatus).toBe("idle");
      expect(state.isInitialized).toBe(false);
    });
  });

  describe("HYDRATE", () => {
    it("超出最近 50 个 Turn 的工具调用收成占位，展开中的仍留正文", () => {
      const items: TimelineHistoryItem[] = [];
      for (let turn = 0; turn < 51; turn += 1) {
        items.push({
          item: {
            type: "tool_call",
            callId: `call-${turn}`,
            name: "shell",
            status: "completed",
            detail: {
              type: "shell",
              command: "echo",
              output: `body-${turn}`,
            },
          },
          turnId: `turn-${turn}`,
        });
      }
      const warm = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: items.slice(0, 50),
      });
      const tools = warm.entries.filter((entry) => entry.kind === "tool_call");
      expect(tools[0]?.item).toMatchObject({ detail: { output: "body-0" } });

      const pinned = messageStreamReducer(warm, {
        type: "SET_ENTRY_EXPANDED",
        entryId: tools[0]!.id,
        expanded: true,
      });
      const shifted = messageStreamReducer(pinned, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "turn-extra" },
      });
      const kept = shifted.entries.find((entry) => entry.id === tools[0]!.id);
      expect(kept?.item).toMatchObject({ detail: { output: "body-0" } });

      const foldedState = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items,
      });
      const folded = foldedState.entries.find(
        (entry) => entry.id === tools[0]!.id,
      );
      expect(
        folded?.item.type === "tool_call" && folded.item.detail.type === "shell"
          ? folded.item.detail.output
          : "kept",
      ).toBeUndefined();
      expect(folded?.item).toMatchObject({
        name: "shell",
        status: "completed",
        detail: { type: "shell", command: "echo" },
      });

      const collapsed = messageStreamReducer(shifted, {
        type: "SET_ENTRY_EXPANDED",
        entryId: tools[0]!.id,
        expanded: false,
      });
      const afterCollapse = collapsed.entries.find(
        (entry) => entry.id === tools[0]!.id,
      );
      expect(
        afterCollapse?.item.type === "tool_call" &&
          afterCollapse.item.detail.type === "shell"
          ? afterCollapse.item.detail.output
          : "kept",
      ).toBeUndefined();
    });

    it("第 50 个 Turn 里的工具调用仍留正文，再早一个 Turn 才收成占位", () => {
      const items: TimelineHistoryItem[] = [];
      for (let turn = 0; turn < 51; turn += 1) {
        items.push({
          item: {
            type: "tool_call",
            callId: `edge-${turn}`,
            name: "shell",
            status: "completed",
            detail: { type: "shell", command: "echo", output: `body-${turn}` },
          },
          turnId: `edge-turn-${turn}`,
        });
      }
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items,
      });
      const outputOf = (id: string) => {
        const entry = state.entries.find((item) => item.id === id);
        return entry?.item.type === "tool_call" &&
          entry.item.detail.type === "shell"
          ? entry.item.detail.output
          : undefined;
      };
      expect(outputOf("edge-0")).toBeUndefined();
      expect(outputOf("edge-1")).toBe("body-1");

      const updated = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent(
          {
            type: "tool_call",
            callId: "edge-1",
            name: "shell",
            status: "completed",
            detail: { type: "shell", command: "echo", output: "kept" },
          },
          2,
        ),
      });
      const edge = updated.entries.find((entry) => entry.id === "edge-1");
      expect(
        edge?.item.type === "tool_call" && edge.item.detail.type === "shell"
          ? edge.item.detail.output
          : undefined,
      ).toBe("kept");
    });

    it("同一条助手消息和同一次工具调用只用新正文替换", () => {
      const first = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "旧正文",
          messageId: "m1",
        }),
      });
      const replaced = messageStreamReducer(first, {
        type: "EVENT",
        event: timelineEvent(
          {
            type: "assistant_message",
            text: "新正文",
            messageId: "m1",
          },
          2,
        ),
      });
      const messages = replaced.entries.filter(
        (entry) => entry.kind === "assistant_message",
      );
      expect(messages).toHaveLength(1);
      expect(messages[0]?.item).toMatchObject({ text: "新正文" });
    });

    it("用历史 items 替换 timeline 并标记 initialized", () => {
      const items: AgentTimelineItem[] = [
        { type: "user_message", text: "你好", messageId: "u1" },
        { type: "assistant_message", text: "你好！", messageId: "a1" },
      ];
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items,
      });
      expect(state.isInitialized).toBe(true);
      expect(state.entries).toHaveLength(2);
      expect(state.entries[0].id).toBe("u1");
      expect(state.entries[1].id).toBe("a1");
    });

    it("用历史 effort 初始化 Think 状态", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [],
        effort: "high",
      });

      expect(state.isInitialized).toBe(true);
      expect(state.entries).toEqual([]);
      expect(state.effort).toBe("high");
    });

    it("用历史 model 初始化 composer 模型", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [],
        model: "gpt-5.2",
      });

      expect(state.isInitialized).toBe(true);
      expect(state.entries).toEqual([]);
      expect(state.model).toBe("gpt-5.2");
    });

    it("用实时合并规则折叠历史 assistant delta 与工具状态", () => {
      const items: AgentTimelineItem[] = [
        { type: "assistant_message", text: "我", messageId: "a1" },
        { type: "assistant_message", text: "我会先读取文件", messageId: "a1" },
        {
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: { type: "shell", command: "rg TODO" },
          status: "running",
        },
        {
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: {
            type: "shell",
            command: "rg TODO",
            output: "src/app.tsx",
            exitCode: 0,
          },
          status: "completed",
        },
      ];

      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items,
      });

      expect(state.entries).toHaveLength(2);
      expect(state.entries[0].item).toEqual({
        type: "assistant_message",
        text: "我会先读取文件",
        messageId: "a1",
      });
      expect(state.entries[1].item).toEqual({
        type: "tool_call",
        callId: "c1",
        name: "shell",
        detail: {
          type: "shell",
          command: "rg TODO",
          output: "src/app.tsx",
          exitCode: 0,
        },
        status: "completed",
      });
    });

    it("折叠历史中的连续 reasoning，只保留最终内容", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [
          { type: "reasoning", text: "分析入口" },
          { type: "reasoning", text: "分析入口\n定位 reducer" },
          { type: "reasoning", text: "分析入口\n定位 reducer\n形成结论" },
        ],
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "分析入口\n定位 reducer\n形成结论",
      });
    });

    it("历史 reasoning 末尾重复回放且缺少 durationMs 时保留已完成时长", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [
          { type: "reasoning", text: "形成结论", durationMs: 4200 },
          { type: "reasoning", text: "形成结论" },
        ],
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "形成结论",
        durationMs: 4200,
      });
    });

    it("过滤历史中的启动噪音与空消息", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [
          { type: "assistant_message", text: "", messageId: "empty-a1" },
          { type: "reasoning", text: "   " },
          {
            type: "assistant_message",
            text: "Codeance ready",
            messageId: "boot",
          },
          {
            type: "tool_call",
            callId: "empty-shell",
            name: "shell",
            detail: { type: "shell", command: "" },
            status: "completed",
          },
          { type: "assistant_message", text: "可以开始。", messageId: "a1" },
        ],
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "assistant_message",
        text: "可以开始。",
        messageId: "a1",
      });
    });

    it("HYDRATE_FAILED 设置 error 并标记 initialized", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE_FAILED",
        error: "网络错误",
      });
      expect(state.isInitialized).toBe(true);
      expect(state.lastError).toBe("网络错误");
    });
  });

  describe("assistant_message 增量", () => {
    it("同 messageId 的 delta 幂等 upsert，最终只剩一条", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "你",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "你好",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "你好！",
          messageId: "a1",
        }),
      });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].id).toBe("a1");
      expect(state.entries[0].item).toEqual({
        type: "assistant_message",
        text: "你好！",
        messageId: "a1",
      });
    });

    it("不同 messageId 的 assistant_message 各自独立 append", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "第一条",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "第二条",
          messageId: "a2",
        }),
      });
      expect(state.entries).toHaveLength(2);
      expect(state.entries[0].id).toBe("a1");
      expect(state.entries[1].id).toBe("a2");
    });

    it("同一 messageId 在 reasoning 之后继续增长时，正文跟到思考后面", () => {
      // Grok 整轮共用一个 messageId。思考插在正文中间后，后续 delta 仍是
      // 同一条累积文本；原地替换会把后写的问题留在思考前面。
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "先说明事实。",
          messageId: "grok-msg-1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "核对过滤条件后再提问。",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "先说明事实。\n\n候选电子书的分析模式收哪一档？",
          messageId: "grok-msg-1",
        }),
      });

      expect(state.entries.map((entry) => entry.kind)).toEqual([
        "reasoning",
        "assistant_message",
      ]);
      expect(state.entries[1].item).toEqual({
        type: "assistant_message",
        text: "先说明事实。\n\n候选电子书的分析模式收哪一档？",
        messageId: "grok-msg-1",
      });
    });

    it("同一 messageId 在 tool_call 之后继续增长时，正文跟到工具后面且 end_turn 不误报异常中断", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "我先对照电子书列表。",
          messageId: "grok-msg-1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call-1",
          name: "shell",
          detail: {
            type: "shell",
            command: "pnpm test",
            output: "33 passed",
            exitCode: 0,
          },
          status: "completed",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "我先对照电子书列表。\n\n对应接口：GET /queue/status",
          messageId: "grok-msg-1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: null,
          stopReason: "end_turn",
        },
      });

      expect(state.entries.map((entry) => entry.kind)).toEqual([
        "tool_call",
        "assistant_message",
      ]);
      expect(state.turnInterrupted).toBe(false);
      expect(state.interruptedStopReason).toBeNull();
    });

    it("EVENT_BATCH 按顺序折叠同一帧内的 assistant_message", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT_BATCH",
        events: [
          {
            event: timelineEvent({
              type: "assistant_message",
              text: "你",
              messageId: "a1",
            }),
          },
          {
            event: timelineEvent({
              type: "assistant_message",
              text: "你好",
              messageId: "a1",
            }),
          },
          {
            event: timelineEvent({
              type: "assistant_message",
              text: "你好！",
              messageId: "a1",
            }),
          },
        ],
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "assistant_message",
        text: "你好！",
        messageId: "a1",
      });
    });
  });

  describe("user_message 去重", () => {
    it("后端回显按文本替换乐观用户消息", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "OPTIMISTIC_USER_MESSAGE",
        text: "继续修复",
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "继续修复",
          messageId: "u1",
        }),
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].id).toBe("u1");
      expect(state.entries[0].item).toEqual({
        type: "user_message",
        text: "继续修复",
        messageId: "u1",
      });
    });

    it("重复 user_message 回显不会追加多条", () => {
      let state = createInitialState();
      const item: AgentTimelineItem = {
        type: "user_message",
        text: "重复消息",
        messageId: "u1",
      };
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent(item),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent(item, 2),
      });

      expect(state.entries).toHaveLength(1);
    });

    it("后端回显先于乐观插入到达时不产生重复", () => {
      // 竞态：后端 timeline 事件经 requestAnimationFrame 异步 flush，而
      // sendAgentMessage 的 invoke 响应可能更慢，后端 user_message 回显可能先于
      // 乐观插入到达并被追加。此时 OPTIMISTIC_USER_MESSAGE 需识别已存在的后端回显
      // 并跳过，否则同一消息会显示两次。
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "继续修复",
          messageId: "u1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "OPTIMISTIC_USER_MESSAGE",
        text: "继续修复",
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].id).toBe("u1");
    });

    it("多轮回复同一选项文本时各自展示", () => {
      // 交互式问答里用户常对多道题都选 "A"。同文不同 messageId 必须保留多条，
      // 不能被全文历史文本去重吞掉。
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "A",
          messageId: "u-a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "下一题？",
          messageId: "m1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "A",
          messageId: "u-a2",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "再一题？",
          messageId: "m2",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "A",
          messageId: "u-a3",
        }),
      });

      const userTexts = state.entries
        .filter((entry) => entry.kind === "user_message")
        .map((entry) => ({
          id: entry.id,
          text:
            entry.item.type === "user_message" ? entry.item.text : undefined,
        }));
      expect(userTexts).toEqual([
        { id: "u-a1", text: "A" },
        { id: "u-a2", text: "A" },
        { id: "u-a3", text: "A" },
      ]);
    });

    it("历史已有同选项后仍可乐观插入新的同文回复", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "A",
          messageId: "u-a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "下一题？",
          messageId: "m1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "OPTIMISTIC_USER_MESSAGE",
        text: "A",
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "user_message",
          text: "A",
          messageId: "u-a2",
        }),
      });

      const userEntries = state.entries.filter(
        (entry) => entry.kind === "user_message",
      );
      expect(userEntries).toHaveLength(2);
      expect(userEntries[0].id).toBe("u-a1");
      expect(userEntries[1].id).toBe("u-a2");
    });

    it("hydrate 重放时保留多条同文 user_message", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "HYDRATE",
        items: [
          { type: "user_message", text: "A", messageId: "u1" },
          {
            type: "assistant_message",
            text: "Q2?",
            messageId: "m1",
          },
          { type: "user_message", text: "A", messageId: "u2" },
          { type: "user_message", text: "A", messageId: "u2" },
          {
            type: "assistant_message",
            text: "Q3?",
            messageId: "m2",
          },
          { type: "user_message", text: "A", messageId: "u3" },
        ],
      });

      const userIds = state.entries
        .filter((entry) => entry.kind === "user_message")
        .map((entry) => entry.id);
      expect(userIds).toEqual(["u1", "u2", "u3"]);
    });
  });

  describe("reasoning 增量", () => {
    it("无 id 的连续 reasoning 合并为一条，保留最终文本", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "我先想想" }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "我先想想\n再想想" }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "我先想想\n再想想\n决定了",
        }),
      });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].kind).toBe("reasoning");
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "我先想想\n再想想\n决定了",
      });
    });

    it("reasoning 前有 assistant_message 时，reasoning 作为新条目 append", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "答案",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "思考" }),
      });
      expect(state.entries).toHaveLength(2);
      expect(state.entries[0].kind).toBe("assistant_message");
      expect(state.entries[1].kind).toBe("reasoning");
    });

    it("过滤实时空 reasoning", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "\n  \n" }),
      });
      expect(state.entries).toHaveLength(0);
      expect(state.lastSeq).toBe(1);
    });
  });

  describe("tool_call 状态流转", () => {
    it("同 callId 的 started→completed 在同一条目上更新 status", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: { type: "shell", command: "ls" },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: {
            type: "shell",
            command: "ls",
            output: "file.txt",
            exitCode: 0,
          },
          status: "completed",
        }),
      });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].id).toBe("c1");
      const item = state.entries[0].item;
      expect(item.type).toBe("tool_call");
      if (item.type === "tool_call") {
        expect(item.status).toBe("completed");
      }
    });

    it("tool_result 回填空 path/command 时保留 tool_use 阶段的摘要", () => {
      // 模拟 Claude tool_use → tool_result 链路：
      // tool_use 事件带完整 detail（path/command），tool_result 回填时
      // 后端 patch_detail 新建空 detail（path/command 为空字符串）。
      // 字段级合并应保留 tool_use 阶段的摘要，同时补上 output/exit_code。
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-bash",
          name: "shell",
          detail: { type: "shell", command: "npm test" },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-bash",
          name: "shell",
          detail: {
            type: "shell",
            command: "",
            output: "all passed",
            exitCode: 0,
          },
          status: "completed",
        }),
      });
      expect(state.entries).toHaveLength(1);
      const item = state.entries[0].item;
      expect(item.type).toBe("tool_call");
      if (item.type === "tool_call") {
        expect(item.detail).toEqual({
          type: "shell",
          command: "npm test",
          output: "all passed",
          exitCode: 0,
        });
      }
    });

    it("Read 工具回填空 path 时保留原 path 并补 content", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-read",
          name: "read",
          detail: { type: "read", path: "src/app.ts" },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-read",
          name: "read",
          detail: { type: "read", path: "", content: "file body" },
          status: "completed",
        }),
      });
      const item = state.entries[0].item;
      expect(item.type).toBe("tool_call");
      if (item.type === "tool_call") {
        expect(item.detail).toEqual({
          type: "read",
          path: "src/app.ts",
          content: "file body",
        });
      }
    });

    it("空骨架 completed tool_call 仍会收尾已有 running 条目", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-edit",
          name: "edit",
          detail: {
            type: "edit",
            path: "src/app.ts",
            diff: "-old\n+new",
          },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-edit",
          name: "edit",
          detail: {
            type: "edit",
            path: "",
          },
          status: "completed",
        }),
      });

      expect(state.entries).toHaveLength(1);
      const item = state.entries[0].item;
      expect(item.type).toBe("tool_call");
      if (item.type === "tool_call") {
        expect(item.status).toBe("completed");
        expect(item.detail).toEqual({
          type: "edit",
          path: "src/app.ts",
          diff: "-old\n+new",
        });
      }
    });

    it("已完成的 tool_call 不会被迟到的 running 更新打回运行中", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call-shell",
          name: "shell",
          detail: { type: "shell", command: "find skills" },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call-shell",
          name: "shell",
          detail: {
            type: "shell",
            command: "find skills",
            output: "done",
          },
          status: "completed",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call-shell",
          name: "shell",
          detail: {
            type: "shell",
            command: "find skills",
            output: "done",
          },
          status: "running",
        }),
      });
      const item = state.entries[0]?.item;
      expect(item?.type).toBe("tool_call");
      if (item?.type === "tool_call") {
        expect(item.status).toBe("completed");
      }
    });

    it("reasoning 携带 durationMs 时透传到 entry", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "思考完成",
          durationMs: 3500,
        }),
      });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "思考完成",
        durationMs: 3500,
      });
    });

    it("assistant 完整回放重复 reasoning 且未带 durationMs 时保留已有时长", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "我已经想完了",
          durationMs: 3500,
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "我已经想完了",
        }),
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "我已经想完了",
        durationMs: 3500,
      });
    });

    it("assistant 回放 reasoning 与流式文本存在空白差异时仍保留已有时长", () => {
      // 流式 flush 与完整 assistant 消息阶段的 reasoning 文本可能存在尾部空白、
      // \r\n 等差异。归一化比较后应保留已带的 durationMs，不应回退到「正在思考」。
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          text: "我已经想完了",
          durationMs: 3500,
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "reasoning",
          // 流式阶段无尾部空格，完整消息阶段多了一个尾随空格 + \r\n。
          text: "我已经想完了 \r\n",
        }),
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "reasoning",
        text: "我已经想完了 \r\n",
        durationMs: 3500,
      });
    });

    it("Claude tool_result 回填 generic tool 名称时保留 tool_use 阶段的真实工具名", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-plan",
          name: "TodoWrite",
          detail: {
            type: "unknown",
            rawInput:
              '{"todos":[{"content":"优化浏览器 tab","status":"in_progress"}]}',
          },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c-plan",
          name: "tool",
          detail: {
            type: "unknown",
            rawOutput: "Updated task #2 status",
          },
          status: "completed",
        }),
      });

      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].item).toEqual({
        type: "tool_call",
        callId: "c-plan",
        name: "TodoWrite",
        detail: {
          type: "unknown",
          rawInput:
            '{"todos":[{"content":"优化浏览器 tab","status":"in_progress"}]}',
          rawOutput: "Updated task #2 status",
        },
        status: "completed",
      });
    });
  });

  describe("todo 渐进更新", () => {
    it("尾项是 todo 时替换而非 append", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "todo",
          items: [{ text: "任务1", completed: false }],
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "todo",
          items: [
            { text: "任务1", completed: true },
            { text: "任务2", completed: false },
          ],
        }),
      });
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].kind).toBe("todo");
    });
  });

  describe("轮次状态机", () => {
    it("turn_started → running", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      expect(state.turnStatus).toBe("running");
    });

    it("turn_completed → idle 并合并 usage", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      });
      expect(state.turnStatus).toBe("idle");
      expect(state.usage).toEqual({ inputTokens: 100, outputTokens: 50 });
    });

    it("turn_failed → failed 并追加 error 条目", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_failed", turnId: "t1", error: "爆炸了" },
      });
      expect(state.turnStatus).toBe("failed");
      expect(state.lastError).toBe("爆炸了");
      const visible = state.entries.filter(
        (entry) => entry.kind !== "turn_boundary",
      );
      expect(visible).toHaveLength(1);
      expect(visible[0].kind).toBe("error");
    });

    it("turn_canceled → canceled", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_canceled", turnId: "t1", reason: "用户取消" },
      });
      expect(state.turnStatus).toBe("canceled");
    });

    it("turn_completed 正常收尾（end_turn + assistant 消息）不标记异常中断", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "完成了",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: null,
          stopReason: "end_turn",
        },
      });
      expect(state.turnInterrupted).toBe(false);
      expect(state.interruptedStopReason).toBeNull();
    });

    it("turn_completed 异常 stop_reason（max_tokens）标记异常中断并携带原因", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "半截",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: null,
          stopReason: "max_tokens",
        },
      });
      expect(state.turnInterrupted).toBe(true);
      expect(state.interruptedStopReason).toBe("max_tokens");
    });

    it("end_turn 先于同轮收尾正文到达时，正文不把提交按钮留在执行中", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c1",
          name: "edit",
          detail: { type: "edit", path: "CONTEXT.md" },
          status: "completed",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: null,
          stopReason: "end_turn",
        },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "回复「开始」或「go」，我就出 spec、拆票并实现。",
          messageId: "grok-msg-t1",
        }),
      });

      expect(state.turnStatus).toBe("idle");
      expect(state.turnInterrupted).toBe(false);
      expect(state.entries[state.entries.length - 1]?.kind).toBe(
        "assistant_message",
      );
    });

    it("turn_completed 末条为已完成 tool_call（无收尾消息）即使 end_turn 也判异常", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t1" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "c1",
          name: "shell",
          detail: { type: "shell", command: "echo hi" },
          status: "completed",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t1",
          usage: null,
          stopReason: "end_turn",
        },
      });
      expect(state.turnInterrupted).toBe(true);
      expect(state.interruptedStopReason).toBe("end_turn");
    });

    it("turn_started 清空上一轮的异常中断标记", () => {
      let state: ReturnType<typeof createInitialState> = {
        ...createInitialState(),
        turnInterrupted: true,
        interruptedStopReason: "max_tokens",
      };
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t2" },
      });
      expect(state.turnInterrupted).toBe(false);
      expect(state.interruptedStopReason).toBeNull();
    });
  });

  describe("权限请求", () => {
    it("permission_requested append 并按 id 去重", () => {
      const request = {
        id: "permission-i1",
        kind: "tool" as const,
        actions: [],
      };
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "permission_requested", request },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "permission_requested", request },
      });
      expect(state.pendingPermissions).toHaveLength(1);
    });

    it("permission_resolved 移除对应 requestId", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "permission_requested",
          request: {
            id: "permission-i1",
            kind: "tool",
            actions: [],
          },
        },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "permission_resolved",
          requestId: "permission-i1",
          resolution: "accept",
        },
      });
      expect(state.pendingPermissions).toHaveLength(0);
    });
  });

  describe("usage_updated", () => {
    it("合并 usage 字段（新值覆盖旧值，undefined 不覆盖）", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: { type: "usage_updated", usage: { inputTokens: 10 } },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "usage_updated",
          usage: { inputTokens: 20, outputTokens: 5 },
        },
      });
      expect(state.usage).toEqual({ inputTokens: 20, outputTokens: 5 });
    });
  });

  describe("mode / model 变更", () => {
    it("mode_changed 更新 mode", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: {
          type: "mode_changed",
          currentModeId: "full-access",
          availableModes: [],
        },
      });
      expect(state.mode).toBe("full-access");
    });

    it("model_changed 更新 model", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: { type: "model_changed", modelId: "gpt-5" },
      });
      expect(state.model).toBe("gpt-5");
    });
  });

  describe("timeline lastSeq", () => {
    it("记录最大 seq", () => {
      let state = createInitialState();
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({ type: "user_message", text: "hi" }, 5),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({ type: "user_message", text: "yo" }, 9),
      });
      expect(state.lastSeq).toBe(9);
    });
  });

  describe("thread_started", () => {
    it("不改变状态", () => {
      const before = createInitialState();
      const after = messageStreamReducer(before, {
        type: "EVENT",
        event: { type: "thread_started", threadId: "th1" },
      });
      expect(after).toBe(before);
    });
  });

  describe("timeline 有产出事件清除异常中断态", () => {
    function interruptedState(): MessageStreamState {
      return {
        ...createInitialState(),
        turnStatus: "idle",
        turnInterrupted: true,
        interruptedStopReason: null,
        isInitialized: true,
      };
    }

    it("reasoning 事件在异常中断后恢复 running 并清红条", () => {
      const next = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "继续思考" }),
      });
      expect(next.turnInterrupted).toBe(false);
      expect(next.interruptedStopReason).toBeNull();
      expect(next.turnStatus).toBe("running");
    });

    it("正常 running 态下 reasoning 事件不改动 turn 态", () => {
      const next = messageStreamReducer(
        {
          ...createInitialState(),
          turnStatus: "running",
          isInitialized: true,
        },
        {
          type: "EVENT",
          event: timelineEvent({ type: "reasoning", text: "思考" }),
        },
      );
      expect(next.turnStatus).toBe("running");
      expect(next.turnInterrupted).toBe(false);
    });

    it("user_message 事件不恢复 running（非 agent 产出）", () => {
      const next = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({ type: "user_message", text: "继续" }),
      });
      expect(next.turnInterrupted).toBe(true);
      expect(next.turnStatus).toBe("idle");
    });

    it("已完成 tool_call 不在 turn_completed 后恢复 running", () => {
      const next = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call_sleep",
          name: "shell",
          detail: { type: "shell", command: "sleep 90" },
          status: "completed",
        }),
      });
      expect(next.turnStatus).toBe("idle");
      expect(next.turnInterrupted).toBe(true);
    });

    it("失败或取消的 tool_call 不恢复 running", () => {
      const failed = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call_fail",
          name: "shell",
          detail: { type: "shell", command: "false" },
          status: "failed",
        }),
      });
      expect(failed.turnStatus).toBe("idle");

      const canceled = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call_cancel",
          name: "shell",
          detail: { type: "shell", command: "sleep 1" },
          status: "canceled",
        }),
      });
      expect(canceled.turnStatus).toBe("idle");
    });

    it("running 的 tool_call 仍可在异常中断后恢复 running", () => {
      const next = messageStreamReducer(interruptedState(), {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call_run",
          name: "shell",
          detail: { type: "shell", command: "ls" },
          status: "running",
        }),
      });
      expect(next.turnStatus).toBe("running");
      expect(next.turnInterrupted).toBe(false);
    });
  });

  describe("turn_completed 后残留 running 工具", () => {
    it("父 Turn 结束后残留 running 工具卡片不保持 turnStatus running", () => {
      let state = messageStreamReducer(createInitialState(), {
        type: "EVENT",
        event: { type: "turn_started", turnId: "t_parent" },
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "assistant_message",
          text: "结论已给出",
          messageId: "a1",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: timelineEvent({
          type: "tool_call",
          callId: "call_collab",
          name: "collabAgentToolCall",
          detail: { type: "unknown" },
          status: "running",
        }),
      });
      state = messageStreamReducer(state, {
        type: "EVENT",
        event: {
          type: "turn_completed",
          turnId: "t_parent",
          usage: null,
        },
      });
      expect(state.turnStatus).toBe("idle");
      expect(
        state.entries.some(
          (entry) =>
            entry.kind === "tool_call" &&
            entry.item.type === "tool_call" &&
            entry.item.status === "running",
        ),
      ).toBe(true);
    });
  });

  describe("timeline 子代理中断", () => {
    it("子代理 tool_call 被取消时挂 subagentInterrupted 横幅", () => {
      const next = messageStreamReducer(
        { ...createInitialState(), turnStatus: "running", isInitialized: true },
        {
          type: "EVENT",
          event: timelineEvent({
            type: "tool_call",
            callId: "call_subagent_1",
            name: "subagent",
            detail: { type: "sub_agent" },
            status: "canceled",
            error: "子代理被中断（status: killed）",
          }),
        },
      );
      expect(next.subagentInterrupted).toBe(true);
    });

    it("子代理正常完成不挂横幅", () => {
      const next = messageStreamReducer(
        { ...createInitialState(), turnStatus: "running", isInitialized: true },
        {
          type: "EVENT",
          event: timelineEvent({
            type: "tool_call",
            callId: "call_subagent_2",
            name: "subagent",
            detail: { type: "sub_agent" },
            status: "completed",
          }),
        },
      );
      expect(next.subagentInterrupted).toBe(false);
    });

    it("turn_started 清除子代理中断横幅", () => {
      const next = messageStreamReducer(
        {
          ...createInitialState(),
          subagentInterrupted: true,
          isInitialized: true,
        },
        { type: "EVENT", event: { type: "turn_started", turnId: "t2" } },
      );
      expect(next.subagentInterrupted).toBe(false);
    });

    it("子代理被取消后收到产出事件清除 subagentInterrupted 横幅", () => {
      const canceled = messageStreamReducer(
        { ...createInitialState(), turnStatus: "running", isInitialized: true },
        {
          type: "EVENT",
          event: timelineEvent({
            type: "tool_call",
            callId: "call_subagent_1",
            name: "subagent",
            detail: { type: "sub_agent" },
            status: "canceled",
            error: "子代理被中断（status: failed）",
          }),
        },
      );
      expect(canceled.subagentInterrupted).toBe(true);

      // 主 turn 仍继续产出 → 说明工作流未暂停，横幅应自动消失。
      const next = messageStreamReducer(canceled, {
        type: "EVENT",
        event: timelineEvent({ type: "reasoning", text: "继续思考" }),
      });
      expect(next.subagentInterrupted).toBe(false);
      expect(next.turnStatus).toBe("running");
    });
  });
});

const outputSourceLabels = {
  all: "全部",
  main: "主智能体",
  subagentName: (ordinal: number) => `子智能体 ${ordinal}`,
  running: "运行中",
  ended: "已结束",
};

describe("输出来源", () => {
  const items: AgentTimelineItem[] = [
    { type: "user_message", text: "你好", messageId: "u1" },
    { type: "assistant_message", text: "主智能体", messageId: "m1" },
    {
      type: "assistant_message",
      text: "第一路",
      messageId: "m1",
      subagentId: "thr_a",
    },
    { type: "reasoning", text: "第一路在想", subagentId: "thr_a" },
    {
      type: "tool_call",
      callId: "c1",
      name: "shell",
      status: "running",
      detail: { type: "shell", command: "ls" },
      subagentId: "thr_a",
    },
    {
      type: "assistant_message",
      text: "第二路",
      messageId: "m2",
      subagentId: "thr_b",
    },
  ];

  function texts(
    state: MessageStreamState,
    selection: "all" | "main" | string,
  ) {
    return projectMessageStream(state, selection).entries.map((entry) => {
      const item = entry.item;
      if (
        item.type === "user_message" ||
        item.type === "assistant_message" ||
        item.type === "reasoning"
      ) {
        return item.text;
      }
      if (item.type === "tool_call" && item.detail.type === "shell") {
        return item.detail.command;
      }
      return item.type;
    });
  }

  it("会话不在运行中的 Turn 时，子智能体显示已结束", () => {
    const state = messageStreamReducer(createInitialState(), {
      type: "HYDRATE",
      items,
    });
    const view = projectMessageStream(state, "all");

    expect(view.showSourceSelect).toBe(true);
    expect(
      view.options.map((option) =>
        formatOutputSourceOption(option, outputSourceLabels),
      ),
    ).toEqual([
      "全部",
      "主智能体",
      "子智能体 1 · 已结束",
      "子智能体 2 · 已结束",
    ]);
    expect(texts(state, "all")).toEqual([
      "你好",
      "主智能体",
      "第一路",
      "第一路在想",
      "ls",
      "第二路",
    ]);
    expect(texts(state, "main")).toEqual(["你好", "主智能体"]);
    expect(texts(state, "thr_a")).toEqual(["第一路", "第一路在想", "ls"]);
    expect(texts(state, "thr_b")).toEqual(["第二路"]);
  });

  it("选中档不进入可恢复状态，权限卡也不随选中档消失", () => {
    const hydrated = messageStreamReducer(createInitialState(), {
      type: "HYDRATE",
      items,
    });
    const state = messageStreamReducer(hydrated, {
      type: "EVENT",
      event: {
        type: "permission_requested",
        request: {
          id: "perm-1",
          kind: "tool",
          actions: [{ id: "accept", label: "Allow", behavior: "allow" }],
        },
      },
    });
    const viewed = projectMessageStream(state, "thr_a");
    const recovered = messageStreamReducer(createInitialState(), {
      type: "RESTORE",
      state,
    });

    expect(recovered).toEqual(state);
    expect(recovered).not.toHaveProperty("outputSource");
    expect(viewed.pendingPermissions.map((request) => request.id)).toEqual([
      "perm-1",
    ]);
    expect(texts(recovered, "all")).toEqual([
      "你好",
      "主智能体",
      "第一路",
      "第一路在想",
      "ls",
      "第二路",
    ]);
  });

  it("拉起描述、同名序号和没有描述的补位能从日志重建", () => {
    const state = messageStreamReducer(createInitialState(), {
      type: "HYDRATE",
      items: [
        { type: "user_message", text: "你好", messageId: "u1" },
        {
          type: "tool_call",
          callId: "spawn",
          name: "collabAgentToolCall",
          status: "completed",
          detail: {
            type: "collab_agent",
            prompt: "检查日志",
            receiverThreadIds: ["thr_a", "thr_b"],
            senderThreadId: "thr_parent",
          },
        },
        {
          type: "tool_call",
          callId: "spawn_nested",
          name: "collabAgentToolCall",
          status: "completed",
          detail: {
            type: "collab_agent",
            prompt: "检查日志",
            receiverThreadIds: ["thr_c"],
            senderThreadId: "thr_a",
          },
        },
        {
          type: "assistant_message",
          text: "没有描述",
          messageId: "m-d",
          subagentId: "thr_d",
        },
        {
          type: "assistant_message",
          text: "第一路",
          messageId: "m-a",
          subagentId: "thr_a",
        },
        { type: "subagent_roster", subagentId: "thr_a", status: "ended" },
        {
          type: "assistant_message",
          text: "孙子",
          messageId: "m-c",
          subagentId: "thr_c",
        },
      ],
    });
    const idle = projectMessageStream(state, "all");
    expect(
      idle.options.map((option) =>
        formatOutputSourceOption(option, outputSourceLabels),
      ),
    ).toEqual([
      "全部",
      "主智能体",
      "检查日志 · 已结束",
      "检查日志 2 · 已结束",
      "检查日志 3 · 已结束",
      "子智能体 4 · 已结束",
    ]);
    expect(texts(state, "main")).toEqual(["你好", "tool_call", "tool_call"]);
    expect(texts(state, "thr_a")).toEqual(["第一路"]);
    expect(texts(state, "thr_c")).toEqual(["孙子"]);
    expect(
      texts(state, "all").filter((text) => text === "subagent_roster"),
    ).toEqual([]);

    const running = projectMessageStream(state, "all", true);
    expect(
      running.options.map((option) =>
        formatOutputSourceOption(option, outputSourceLabels),
      ),
    ).toEqual([
      "全部",
      "主智能体",
      "检查日志 · 已结束",
      "检查日志 2 · 运行中",
      "检查日志 3 · 运行中",
      "子智能体 4 · 运行中",
    ]);
    expect(state.turnStatus).toBe("idle");
    expect(state).not.toHaveProperty("outputSource");
  });

  it("子 thread 结束只标记这一路，主 Turn 仍在运行", () => {
    let state = messageStreamReducer(createInitialState(), {
      type: "EVENT",
      event: { type: "turn_started", turnId: "turn_parent" },
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "tool_call",
        callId: "spawn",
        name: "collabAgentToolCall",
        status: "completed",
        detail: {
          type: "collab_agent",
          prompt: "检查日志",
          receiverThreadIds: ["thr_a", "thr_b"],
        },
      }),
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "subagent_roster",
        subagentId: "thr_a",
        status: "ended",
      }),
    });
    expect(state.turnStatus).toBe("running");
    expect(
      projectMessageStream(state, "all").options.map((option) =>
        formatOutputSourceOption(option, outputSourceLabels),
      ),
    ).toEqual(["全部", "主智能体", "检查日志 · 已结束", "检查日志 2 · 运行中"]);
    expect(texts(state, "thr_a")).toEqual([]);
  });

  it("父 Turn 结束后，花名册仍标明在跑的子智能体显示运行中", () => {
    let state = messageStreamReducer(createInitialState(), {
      type: "EVENT",
      event: { type: "turn_started", turnId: "turn_parent" },
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "subagent_roster",
        subagentId: "thr_live",
        status: "running",
      }),
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "tool_call",
        callId: "spawn",
        name: "collabAgentToolCall",
        status: "running",
        detail: {
          type: "collab_agent",
          prompt: "/root/fact_automation_ref",
          receiverThreadIds: ["thr_live"],
        },
      }),
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: { type: "turn_completed", turnId: "turn_parent", usage: null },
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "assistant_message",
        text: "子线程还在写",
        messageId: "child-1",
        subagentId: "thr_live",
      }),
    });

    expect(state.turnStatus).toBe("idle");
    expect(
      projectMessageStream(state, "all").options.map((option) =>
        formatOutputSourceOption(option, outputSourceLabels),
      ),
    ).toEqual(["全部", "主智能体", "/root/fact_automation_ref · 运行中"]);
    expect(texts(state, "main")).toEqual(["tool_call"]);
  });

  it("子智能体的迟到正文不会把已结束的用户 Turn 拉回运行中", () => {
    let state = messageStreamReducer(createInitialState(), {
      type: "EVENT",
      event: { type: "turn_started", turnId: "turn_parent" },
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "tool_call",
        callId: "call_done",
        name: "shell",
        status: "completed",
        detail: { type: "shell", command: "ls" },
      }),
    });
    state = messageStreamReducer(state, {
      type: "EVENT",
      event: { type: "turn_completed", turnId: "turn_parent", usage: null },
    });
    expect(state.turnStatus).toBe("idle");
    expect(state.turnInterrupted).toBe(true);

    state = messageStreamReducer(state, {
      type: "EVENT",
      event: timelineEvent({
        type: "assistant_message",
        text: "子线程还在写",
        messageId: "child-late",
        subagentId: "thr_child",
      }),
    });
    expect(state.turnStatus).toBe("idle");
    expect(state.turnInterrupted).toBe(true);
  });

  it("没有来源的旧项不出现 select", () => {
    const state = messageStreamReducer(createInitialState(), {
      type: "HYDRATE",
      items: [
        { type: "user_message", text: "旧消息", messageId: "u1" },
        { type: "assistant_message", text: "旧回复", messageId: "a1" },
      ],
    });
    const view = projectMessageStream(state, "all");

    expect(view.showSourceSelect).toBe(false);
    expect(view.options).toEqual([]);
    expect(texts(state, "main")).toEqual(["旧消息", "旧回复"]);
  });
});
