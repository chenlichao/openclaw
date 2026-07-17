import { describe, expect, it } from "vitest";
import { MeetingSessionTranscriptStore } from "./session-transcript-store.js";
import type { MeetingSessionRecord, MeetingTranscriptSnapshot } from "./session-types.js";

function createSession(): MeetingSessionRecord<"chrome", "transcribe"> {
  return {
    id: "session-1",
    url: "https://meeting.example/room",
    transport: "chrome",
    mode: "transcribe",
    agentId: "main",
    state: "active",
    createdAt: "2026-07-17T00:00:00.000Z",
    updatedAt: "2026-07-17T00:00:00.000Z",
    participantIdentity: "OpenClaw",
    realtime: { enabled: false, toolPolicy: "none" },
    notes: [],
  };
}

function createStore(params: {
  session: MeetingSessionRecord<"chrome", "transcribe">;
  snapshots: MeetingTranscriptSnapshot[];
}) {
  let snapshotIndex = 0;
  return new MeetingSessionTranscriptStore({
    getSession: (sessionId) => (sessionId === params.session.id ? params.session : undefined),
    isBrowserSession: () => true,
    isTranscribeSession: () => true,
    hasBrowserTab: () => true,
    capture: async () => params.snapshots[Math.min(snapshotIndex++, params.snapshots.length - 1)],
  });
}

describe("MeetingSessionTranscriptStore", () => {
  it("trims an oversized initial snapshot to the retained tail", async () => {
    const session = createSession();
    const store = createStore({
      session,
      snapshots: [
        {
          droppedLines: 7,
          epoch: "page-1",
          lines: Array.from({ length: 2_005 }, (_, index) => ({ text: `line-${index}` })),
        },
      ],
    });

    const result = await store.read(session.id);

    expect(result).toMatchObject({
      found: true,
      startIndex: 12,
      nextIndex: 2_012,
      droppedLines: 12,
    });
    expect(result.lines).toHaveLength(2_000);
    expect(result.lines?.[0]?.text).toBe("line-5");
    expect(result.lines?.at(-1)?.text).toBe("line-2004");
  });

  it("drops a disconnected retained prefix when the page cursor jumps", async () => {
    const session = createSession();
    const store = createStore({
      session,
      snapshots: [
        { droppedLines: 0, epoch: "page-1", lines: [{ text: "old-0" }, { text: "old-1" }] },
        { droppedLines: 5, epoch: "page-1", lines: [{ text: "new-5" }, { text: "new-6" }] },
      ],
    });

    const first = await store.read(session.id);
    const second = await store.read(session.id, { sinceIndex: first.nextIndex });

    expect(first).toMatchObject({ droppedLines: 0, nextIndex: 2 });
    expect(second).toMatchObject({
      droppedLines: 5,
      startIndex: 5,
      nextIndex: 7,
      lines: [{ text: "new-5" }, { text: "new-6" }],
    });
  });

  it("drops a disconnected retained prefix after an epoch change", async () => {
    const session = createSession();
    const store = createStore({
      session,
      snapshots: [
        { droppedLines: 0, epoch: "page-1", lines: [{ text: "old-0" }, { text: "old-1" }] },
        { droppedLines: 3, epoch: "page-2", lines: [{ text: "new-5" }, { text: "new-6" }] },
      ],
    });

    const first = await store.read(session.id);
    const second = await store.read(session.id, { sinceIndex: first.nextIndex });

    expect(first).toMatchObject({ droppedLines: 0, nextIndex: 2 });
    expect(second).toMatchObject({
      droppedLines: 5,
      startIndex: 5,
      nextIndex: 7,
      lines: [{ text: "new-5" }, { text: "new-6" }],
    });
  });
});
