import { t } from "@shared/l10n";
import type { Message } from "@shared/types";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { appStore, useApp } from "../../../../app-store";
import { EmployeeAvatar } from "../../../employee-avatar";
import { IconChevronLeft, IconChevronRight } from "../../../icons";
import { HaltButton } from "../halt-button";
import { MessageItem } from "../message-item";
import { ProgressCard } from "../progress-card";
import type { ProgressRun } from "../progress-runs";
import { MessageTime } from "../message-time";
import { formatMessageTime } from "../relative-time";
import { flashRow, prefersReducedMotion } from "../thread-scroll";
import "./index.css";

export interface ProgressGroupProps {
  /** The folded run (identity of the card list + its range). */
  run: ProgressRun;
  /** The run's cards, oldest first (resolved from the thread's messages). */
  cards: Message[];
  /** Card currently shown (the module owns this; defaults to the newest). */
  shownId: number;
  /**
   * A card a jump landed on: the group flashes it once it is the shown one.
   * Cleared through `onRevealed`.
   */
  revealId: number | null;
  /** Page to another card of the run (the module records the choice). */
  onPage: (run: ProgressRun, messageId: number) => void;
  /** The pending reveal was performed (clear it). */
  onRevealed: (run: ProgressRun) => void;
}

/** Deck edges drawn behind the front card (mirrors `--imb-progress-edges`). */
const MAX_EDGES = 2;

/** Height transition fallback (ms) when `transitionend` never fires. */
const HEIGHT_FALLBACK_MS = 400;

/**
 * One *run* of consecutive progress cards of the same task group, paged like a
 * small carousel.
 *
 * Exactly one card is on screen at a time: the newest by default, otherwise the
 * one the boss paged to (or the one a find hit / jump asked for). The card is
 * rendered completely — steps, avatars, status dots — and gets the run's single
 * Halt button only while the newest card is shown (an older snapshot is
 * read-only history).
 *
 * The card's own top-right corner (`ProgressCard.actions`) carries the pager:
 * `‹ 2 / 3 ›`. Both buttons are real buttons with native `disabled` at the
 * ends, so the layout never shifts; switching slides the incoming card in from
 * the side the button points at and animates the container height, so the
 * messages below never jump.
 *
 * Two deck edges peek out on the left (3px steps, fading shadows, never rotated)
 * as the "there are more cards behind this one" hint; a lone card is rendered as
 * the plain card — no edges, no pager.
 */
export function ProgressGroup({
  run,
  cards,
  shownId,
  revealId,
  onPage,
  onRevealed,
}: ProgressGroupProps): React.JSX.Element {
  const latest = cards[cards.length - 1];
  const older = cards.slice(0, -1);

  // A single card is not a stack: no edges, no pager, no history marker.
  if (latest === undefined) return <></>;
  if (older.length === 0) return <MessageItem message={latest} />;

  return (
    <PagedRun
      run={run}
      cards={cards}
      shownId={shownId}
      revealId={revealId}
      onPage={onPage}
      onRevealed={onRevealed}
    />
  );
}

function PagedRun({
  run,
  cards,
  shownId,
  revealId,
  onPage,
  onRevealed,
}: {
  run: ProgressRun;
  cards: Message[];
  shownId: number;
  revealId: number | null;
  onPage: ProgressGroupProps["onPage"];
  onRevealed: ProgressGroupProps["onRevealed"];
}): React.JSX.Element {
  const { locale } = useApp();
  const rowRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  // Height of the card being left, measured before React swaps it in.
  const previousHeightRef = useRef<number | null>(null);
  // Which pager button had the focus when the page turned: the stage is
  // re-mounted (that is what restarts the slide), so the focus has to be put
  // back or keyboard paging would die after the first turn.
  const focusPagerRef = useRef<"prev" | "next" | null>(null);
  const [direction, setDirection] = useState<1 | -1>(1);
  const heightTimerRef = useRef(0);

  const latest = cards[cards.length - 1];
  // An id that is gone (a message list reloaded under us) falls back to the
  // newest card, the default view of a run.
  const foundIndex = cards.findIndex((card) => card.id === shownId);
  const shownIndex = foundIndex >= 0 ? foundIndex : cards.length - 1;
  const shown = cards[shownIndex] ?? latest;
  const total = cards.length;
  const isNewest = shown.id === latest.id;
  const edges = Math.min(MAX_EDGES, cards.length - 1);

  // Animate the wrapper's height from the old card's height to the new one's,
  // then hand the height back to the content. Without this, paging between
  // cards of different heights shoves every message below them around.
  useLayoutEffect(() => {
    const clip = clipRef.current;
    const from = previousHeightRef.current;
    previousHeightRef.current = null;
    if (clip === null) return;
    window.clearTimeout(heightTimerRef.current);
    const to = clip.scrollHeight;
    if (from === null || from === to || prefersReducedMotion()) {
      clip.style.height = "";
      return;
    }
    clip.style.transition = "none";
    clip.style.height = `${from}px`;
    // Force the starting height to be the used one before transitioning.
    void clip.offsetHeight;
    clip.style.transition = "";
    clip.style.height = `${to}px`;
    const release = (): void => {
      window.clearTimeout(heightTimerRef.current);
      clip.style.height = "";
    };
    heightTimerRef.current = window.setTimeout(release, HEIGHT_FALLBACK_MS);
    clip.addEventListener("transitionend", release, { once: true });
  }, [shown.id]);

  // Drop the timer with the component.
  useEffect(() => () => window.clearTimeout(heightTimerRef.current), []);

  // Give the focus back to the same pager control after a page turn.
  useLayoutEffect(() => {
    const which = focusPagerRef.current;
    if (which === null) return;
    focusPagerRef.current = null;
    rowRef.current
      ?.querySelector<HTMLElement>(`[data-pager="${which}"]`)
      ?.focus();
  }, [shown.id]);

  // A card a jump landed on: flash it once it is the shown one.
  useLayoutEffect(() => {
    if (revealId === null || shown.id !== revealId) return;
    const row = rowRef.current;
    if (row !== null) flashRow(row);
    onRevealed(run);
  }, [revealId, shown.id, run, onRevealed]);

  const page = useCallback(
    (delta: 1 | -1): void => {
      // Circular: "next" on the newest card wraps to the oldest and "previous"
      // on the oldest wraps to the newest, so both buttons are always usable.
      const target = cards[(shownIndex + delta + total) % total];
      if (target === undefined) return;
      // Measure before the swap: the layout effect animates from this height.
      const clip = clipRef.current;
      previousHeightRef.current =
        clip === null ? null : clip.getBoundingClientRect().height;
      setDirection(delta);
      const active = document.activeElement;
      focusPagerRef.current =
        active instanceof HTMLElement &&
        active.dataset.pager !== undefined &&
        (active.dataset.pager === "prev" || active.dataset.pager === "next")
          ? active.dataset.pager
          : null;
      onPage(run, target.id);
    },
    [cards, shownIndex, total, onPage, run],
  );

  const onPagerKeyDown = (event: ReactKeyboardEvent): void => {
    // Only while the focus is inside the pager, so the thread's own arrow-key
    // scrolling is untouched.
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      page(-1);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      page(1);
    }
  };

  const positionLabel = t("Progress card ${index} of ${total}", {
    index: String(shownIndex + 1),
    total: String(total),
  });

  const openSession = (): void => {
    if (shown.senderEmployeeId !== null) {
      void appStore.openAgentSession(shown.senderEmployeeId, shown.chatId);
    }
  };

  return (
    <div
      className="imb-msg imb-other imb-progress-group"
      ref={rowRef}
      // Jumps and the in-thread find land on this row; `data-progress-run` keeps
      // it addressable while the shown card changes.
      data-message-id={shown.id}
      data-progress-run={run.anchorId}
      data-edges={edges}
      role="group"
      aria-label={positionLabel}
    >
      <EmployeeAvatar
        employeeId={shown.senderEmployeeId ?? 0}
        size={34}
        onClick={openSession}
      />
      <div className="imb-progress-group-deck">
        <div className="imb-progress-group-clip" ref={clipRef}>
          <div
            className="imb-progress-group-stage"
            // Re-mounting on the card id restarts the entrance animation in the
            // direction of travel.
            key={shown.id}
            data-direction={direction}
          >
            <ProgressCard
              title={shown.content}
              steps={shown.steps ?? []}
              groupChatId={shown.groupChatId}
              timeLabel={formatMessageTime(shown.createdAt, locale)}
              showHalt={false}
              // The stage clips horizontally; the run renders the hover time
              // tag below (outside the clip) so the label is never cut off.
              showTime={false}
              actions={
                <div className="imb-progress-pager" onKeyDown={onPagerKeyDown}>
                  <button
                    type="button"
                    className="imb-progress-pager-btn"
                    aria-label={t("Previous progress card")}
                    title=""
                    data-pager="prev"
                    onClick={() => page(-1)}
                  >
                    <IconChevronLeft />
                  </button>
                  {/* Announced on every turn; the visual is `2 / 3`. */}
                  <span className="imb-progress-pager-count" aria-live="polite">
                    {shownIndex + 1} / {total}
                  </span>
                  <button
                    type="button"
                    className="imb-progress-pager-btn"
                    aria-label={t("Next progress card")}
                    title=""
                    data-pager="next"
                    onClick={() => page(1)}
                  >
                    <IconChevronRight />
                  </button>
                </div>
              }
            />
          </div>
        </div>
      </div>
      {/* Straddles the card's bottom-right corner like every other message, but
          lives outside the clipping stage so paging can never crop it. */}
      <MessageTime label={formatMessageTime(shown.createdAt, locale)} />
      {/* One Halt button per run, and only while the live (newest) card is on
          screen: an older snapshot is history, not something to interrupt. */}
      {isNewest && run.groupChatId !== null && (
        <HaltButton chatId={run.groupChatId} />
      )}
    </div>
  );
}
