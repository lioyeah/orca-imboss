import type { Message } from "@shared/types";

/**
 * Folding of consecutive progress cards into one "progress run".
 *
 * A *run* is a maximal stretch of neighbouring `progress` messages that report
 * on the same task group (`groupChatId`): the assistant re-posts the whole step
 * list on every update, so a run is really N snapshots of the same work and
 * only the newest one is worth reading. Anything that is not a progress card —
 * or a card that points at a different task group — ends the run, so nothing
 * is ever reordered across the transcript.
 *
 * Pure and dependency-free (like `pairAskAnswers`): the thread module groups
 * once per message list and renders a `ProgressGroup` at each run's anchor
 * position, skipping the run's other ids.
 */
export interface ProgressRun {
  /** First (oldest) card of the run: the state key and the group's DOM id. */
  anchorId: number;
  /** Newest card of the run: the one rendered in full when expanded. */
  latestId: number;
  /** Every card id in the run, oldest first. */
  ids: number[];
  /**
   * Stable identity of the run's card list. A new card changes it, which
   * invalidates a manual expand/collapse choice (see the chat module).
   */
  signature: string;
  /**
   * Task group every card of the run reports on. `null` for legacy cards
   * written before the link existed; they fold together with other `null`s.
   */
  groupChatId: number | null;
}

export interface ProgressRuns {
  /** Every run, in transcript order. */
  runs: ProgressRun[];
  /** Card id → the run it belongs to (both anchors and hidden cards). */
  runByMessageId: Map<number, ProgressRun>;
}

/** Group consecutive progress cards of one task group into runs. */
export function groupProgressRuns(messages: Message[]): ProgressRuns {
  const runs: ProgressRun[] = [];
  const runByMessageId = new Map<number, ProgressRun>();
  let current: { ids: number[]; groupChatId: number | null } | null = null;

  const flush = (): void => {
    if (current === null) return;
    if (current.ids.length > 0) {
      const run: ProgressRun = {
        anchorId: current.ids[0],
        latestId: current.ids[current.ids.length - 1],
        ids: current.ids,
        signature: current.ids.join(","),
        groupChatId: current.groupChatId,
      };
      runs.push(run);
      for (const id of run.ids) runByMessageId.set(id, run);
    }
    current = null;
  };

  for (const message of messages) {
    if (message.kind !== "progress") {
      flush();
      continue;
    }
    if (current !== null && current.groupChatId === message.groupChatId) {
      current.ids.push(message.id);
      continue;
    }
    flush();
    current = { ids: [message.id], groupChatId: message.groupChatId };
  }
  flush();

  return { runs, runByMessageId };
}
