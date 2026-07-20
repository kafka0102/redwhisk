import { describe, expect, it } from "vitest";

import type {
  AgentStreamEvent,
  AgentTimelineItem,
} from "../agent-stream-types";
import {
  createInitialState,
  messageStreamReducer,
} from "./message-stream-reducer";
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
      // 启发式命中但 stop_reason 本身正常时，不展示误导性的 end_turn
      expect(state.interruptedStopReason).toBeNull();
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
  });
});
