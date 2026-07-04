import { describe, expect, it } from "vitest";

import type {
  AgentStreamEvent,
  AgentTimelineItem,
} from "../agent-stream-types";
import {
  createInitialState,
  messageStreamReducer,
} from "./message-stream-reducer";

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

    it("EVENT_BATCH 按顺序折叠同一帧内的 assistant_message", () => {
      const state = messageStreamReducer(createInitialState(), {
        type: "EVENT_BATCH",
        events: [
          timelineEvent({
            type: "assistant_message",
            text: "你",
            messageId: "a1",
          }),
          timelineEvent({
            type: "assistant_message",
            text: "你好",
            messageId: "a1",
          }),
          timelineEvent({
            type: "assistant_message",
            text: "你好！",
            messageId: "a1",
          }),
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
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].kind).toBe("error");
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
});
