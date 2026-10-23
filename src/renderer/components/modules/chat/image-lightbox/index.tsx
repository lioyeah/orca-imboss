import { t } from "@shared/l10n";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { cls } from "reactutils";
import { IconChevronDown, IconFolder, IconX } from "../../../icons";
import "./index.css";

export interface LightboxImage {
  name: string;
  src: string;
}

export interface ImageLightboxProps {
  images: LightboxImage[];
  /** Index of the shown image within `images`. */
  index: number;
  /**
   * Screen rect of the thumbnail this viewer opened from. Drives the open
   * animation, which grows the image out of that box. Omitted (e.g. opened
   * without a thumbnail) the viewer just fades in.
   */
  origin?: DOMRect | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  /**
   * Reveal the shown picture in the OS file manager. The callback *is* the
   * caller's proof that a trustworthy on-disk location exists for it (main
   * resolves the path from the stored record), so omitting it — the composer's
   * draft previews, which have no stored message behind them — simply hides the
   * button.
   */
  onReveal?: () => void | Promise<void>;
}

/** Duration of the open transform animation (the backdrop fades via CSS). */
const OPEN_MS = 280;

/**
 * Beat between the end of the open animation and the hand-over to the
 * full-resolution copy, so the two never overlap.
 */
const CRISP_DELAY_MS = 80;

/**
 * How long a picture is shown before its original pixels may be handed over:
 * the open animation plus a small margin. Deliberately a fixed beat rather than
 * "the FLIP has finished", so the hand-over keeps its own beat even when the
 * open animation could not run at all (the picture was still decoding when the
 * viewer mounted) — that case used to hand over *inside* the entrance fade,
 * which read as the picture flashing twice.
 */
const HAND_OVER_DELAY_MS = OPEN_MS + CRISP_DELAY_MS;

/**
 * Fade-in duration of the full-resolution copy. Must stay equal to the CSS
 * `--imb-motion-fast` that `.imb-lightbox-image-full` transitions on: the fitted
 * copy is dropped right after it, and dropping it early would expose the
 * backdrop for a frame.
 */
const FADE_MS = 100;

/** Fitted (neutral) state: the picture at `1×`, fully visible and centred. */
interface ZoomState {
  scale: number;
  x: number;
  y: number;
}

const FIT: ZoomState = { scale: 1, x: 0, y: 0 };

/**
 * The fitted baseline (`1×`, the picture exactly as the layout fits it).
 * `FIT`, `0`, the Esc step-back and "double-click to reset" all return here —
 * it is the *neutral* scale, not the smallest one.
 */
const FIT_ZOOM = 1;

/**
 * Zoom range, both ends expressed on top of the fitted baseline: `0.5×` shrinks
 * so more can be taken in at once, and the upper end is derived from
 * {@link MAX_ABS_ZOOM} below.
 */
const MIN_ZOOM = 0.5;

/**
 * Largest *absolute* magnification: `1` is the picture's own pixels (one image
 * pixel per CSS pixel), `4` is 400%. The fitted baseline is usually far below
 * `1` (a 5000px-wide screenshot fits at ~0.26), so the relative upper bound has
 * to be derived from the fitted scale — a fixed `4× fit` cap would stop well
 * short of the original pixels and look blurry for exactly the pictures the
 * boss zooms into.
 */
const MAX_ABS_ZOOM = 4;

/**
 * Relative upper bound while the picture is painted from a *downsampled* copy
 * (over the pixel budget): magnifying that copy further only shows mush, so the
 * cap stays where it was before full-resolution rendering existed.
 */
const DEGRADED_MAX_ZOOM = 4;

/**
 * Pixel budget for rendering the picture at its natural size. A copy this large
 * still decodes to a sane RGBA bitmap (~256 MB at 64 MP); past it the viewer
 * keeps the fitted-size decode and says so, instead of risking an out-of-memory
 * on a panorama.
 */
const MAX_CRISP_PIXELS = 64 * 1024 * 1024;

/** Double-click target (on top of the fitted baseline), and the `+` / `-` step. */
const DOUBLE_CLICK_ZOOM = 2;
const KEY_ZOOM_FACTOR = 1.25;

/**
 * Wheel → zoom sensitivity. `Math.exp(-delta * k)` makes one mouse notch
 * (~100px) about ±20% and keeps trackpad pinches (many small deltas) smooth.
 */
const WHEEL_ZOOM_SPEED = 0.002;

/** A live pan (one pointer) or pinch (two pointers) gesture. */
type Gesture =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      originX: number;
      originY: number;
    }
  | {
      kind: "pinch";
      ids: [number, number];
      startDistance: number;
      startScale: number;
      startMidX: number;
      startMidY: number;
      startX: number;
      startY: number;
    };

/**
 * Intrinsic size of one picture plus the fitted box measured for it.
 *
 * The viewer used to lay the picture out at the fitted size, which also pinned
 * Chromium's *decode* to that size — magnifying it then scaled an already
 * downsampled bitmap, so the boss never got to the real pixels. Now the fitted
 * box is a fixed frame and the picture inside it is laid out at its natural
 * size and scaled down (`scale`): the decode is the original, and `1×` on the
 * zoom axis above the fitted baseline is a real 1 image px : 1 CSS px.
 */
interface FitBox {
  /** `images` index the measurement belongs to. */
  index: number;
  naturalWidth: number;
  naturalHeight: number;
  /** Natural size → fitted box. `1` when the picture already fits as-is. */
  scale: number;
  /** The fitted box in CSS px — the box the zoom/pan transform lives on. */
  width: number;
  height: number;
  /** Natural pixel count over `MAX_CRISP_PIXELS`: keep the fitted decode. */
  overBudget: boolean;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * The viewer's motion is token-driven (`--imb-dur-*` collapse to `1ms` under
 * `prefers-reduced-motion`), but the open animation's transform transition and
 * the hand-over beat are JS timers. This is the one place the JS side asks the
 * same question, so a reduced-motion user gets a single, instant reveal instead
 * of "instant picture, then a swap 360ms later".
 */
const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * True at the neutral framing: `1×` and centred (so a *shrunk* picture is not
 * fitted — Esc steps it back up to `1×` instead of closing).
 */
const isFitted = (zoom: ZoomState): boolean =>
  zoom.scale === FIT_ZOOM && zoom.x === 0 && zoom.y === 0;

/**
 * Full-screen image viewer shared by the in-chat attachment previews
 * (`image-stack/`) and the composer's attachment thumbnails
 * (`chat-input-bar/`). Rendered into `document.body` so it escapes any
 * stacking context.
 *
 * Resolution: the picture is painted twice. A fitted-size copy appears first
 * (cheap decode, and the element the open animation grows out of the
 * thumbnail); once that has loaded, the fitted box is measured and a second copy
 * laid out at the picture's natural size fades in *on top of* it (the fitted copy
 * never fades out — see `HAND_OVER_DELAY_MS`), after which the fitted one is
 * dropped. Zooming therefore magnifies the original pixels, not a resized
 * preview. A picture over `MAX_CRISP_PIXELS` skips the second copy (memory) and
 * says it is downsampled.
 *
 * Gestures: the wheel zooms about the pointer (a trackpad pinch arrives as the
 * same wheel path) within `0.5×` of the fitted size up to 400% of the original
 * pixels, double-click toggles the neutral framing / `2×`, `+` `-` `0` zoom in
 * place and reset, and a drag pans the picture at *any* scale — a fitted or
 * shrunk picture can be nudged to a corner, and none of it can ever be moved out
 * of sight. Arrow keys / the on-screen arrows (with the `n / m` counter) step
 * between images — the wheel no longer does. A click on the backdrop closes;
 * Esc undoes a zoom/pan first and closes on the second press. Switching images
 * always resets the framing, so one picture's zoom can never leak into another's.
 */
export function ImageLightbox({
  images,
  index,
  origin,
  onIndexChange,
  onClose,
  onReveal,
}: ImageLightboxProps): React.JSX.Element | null {
  const count = images.length;
  const closeRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  /** The fitted box the zoom/pan transform lives on (measured, never scaled). */
  const frameRef = useRef<HTMLDivElement>(null);
  /** The fitted-size copy, and the element the open animation drives. */
  const fittedRef = useRef<HTMLImageElement>(null);
  /** The full-resolution copy painted from the picture's own pixels. */
  const fullRef = useRef<HTMLImageElement>(null);

  const [zoom, setZoomState] = useState<ZoomState>(FIT);
  /** Mirrors `zoom` for listeners and gestures (never re-bound per frame). */
  const zoomRef = useRef<ZoomState>(FIT);
  /** A pan/pinch is running (drives the cursor). */
  const [grabbing, setGrabbing] = useState(false);
  /** Live pointers, keyed by `pointerId` (one = pan, two = pinch). */
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);

  /** Intrinsic size of the loaded fitted copy, keyed by image. */
  const [loaded, setLoaded] = useState<{
    index: number;
    width: number;
    height: number;
  } | null>(null);
  /** Measured fitted box, keyed by image (a switch invalidates it). */
  const [fitState, setFitState] = useState<FitBox | null>(null);
  const fit = fitState !== null && fitState.index === index ? fitState : null;
  /** The full-resolution copy has finished loading. */
  const [hiLoaded, setHiLoaded] = useState<{ index: number } | null>(null);
  /**
   * The shown picture has had its own beat (open animation, entrance fade)
   * before the original pixels may fade in over it. Handing over earlier would
   * fade a half-transparent copy over a half-transparent copy, which composites
   * to a *dimmer* picture for the length of the fade — the "blink" this viewer
   * used to show when it opened. Reduced motion has nothing to wait for.
   */
  const [handOverReady, setHandOverReady] = useState(prefersReducedMotion);
  /** The fitted copy can be dropped once the original pixels are fully up. */
  const [fittedGone, setFittedGone] = useState<{ index: number } | null>(null);

  /** A reveal request is in flight (the button is disabled meanwhile). */
  const [revealing, setRevealing] = useState(false);
  const [revealError, setRevealError] = useState<{
    index: number;
    message: string;
  } | null>(null);

  const fitScale = fit?.scale ?? 1;
  const degraded = fit?.overBudget ?? false;
  const crisp = fit !== null && hiLoaded?.index === index && handOverReady;
  // The fitted copy is dropped once the original pixels are up — but it is also
  // what the fitted box is measured from, so it comes back whenever the shown
  // picture has no measurement of its own (e.g. flipping back to a picture whose
  // measurement was replaced by the one in between).
  const showFitted = fit === null || fittedGone?.index !== index;
  const maxZoom = degraded
    ? DEGRADED_MAX_ZOOM
    : Math.max(DEGRADED_MAX_ZOOM, MAX_ABS_ZOOM / fitScale);
  /** Absolute magnification, in the same unit Preview.app uses for "100%". */
  const percent = Math.round(zoom.scale * fitScale * 100);
  const error = revealError?.index === index ? revealError.message : null;

  const commitZoom = useCallback((next: ZoomState): void => {
    zoomRef.current = next;
    setZoomState(next);
  }, []);

  /**
   * Layout-space centre of the picture, in client coordinates. Read from
   * `offset*` (layout, unaffected by the transform) so it stays correct while
   * the picture is zoomed/panned and while the FLIP open animation runs. The
   * caption sits under the picture, so this is *not* the window centre — the
   * clamp and the zoom anchor must use the picture's own box.
   */
  const imageCenter = useCallback((): { x: number; y: number } | null => {
    const frame = frameRef.current;
    const overlay = overlayRef.current;
    if (!frame || !overlay) return null;
    const box = overlay.getBoundingClientRect();
    if (frame.offsetParent !== overlay) {
      // Defensive: offset* would be relative to something else.
      return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    }
    return {
      x: box.left + frame.offsetLeft + frame.offsetWidth / 2,
      y: box.top + frame.offsetTop + frame.offsetHeight / 2,
    };
  }, []);

  /**
   * Clamp a pan offset so the picture can always be dragged (at any scale)
   * without ever being lost:
   *
   * - smaller than the window → it may be nudged anywhere that keeps it *fully
   *   visible*, i.e. up to a corner but never past an edge;
   * - larger than the window → it may be moved as far as it can go while still
   *   covering the window, so no blank gap ever shows through.
   *
   * Both regimes are the same pair of bounds once solved against the picture's
   * own centre (they just swap which one is the minimum), which is also why
   * panning works at 1× — and why a shrunk picture (scale < 1) stays fully
   * visible and yet freely movable: the same formula covers every scale in
   * `[MIN_ZOOM, maxZoom]`.
   *
   * `offsetWidth/Height` is the *fitted* box, which is what the transform
   * scales, so the formula is unchanged by rendering the picture at its natural
   * size inside it.
   */
  const clampOffset = useCallback(
    (scale: number, x: number, y: number): { x: number; y: number } => {
      const frame = frameRef.current;
      const overlay = overlayRef.current;
      const center = imageCenter();
      if (!frame || !overlay || !center) return { x, y };
      const box = overlay.getBoundingClientRect();
      const halfWidth = (frame.offsetWidth * scale) / 2;
      const halfHeight = (frame.offsetHeight * scale) / 2;
      const nearX = halfWidth - (center.x - box.left);
      const farX = overlay.clientWidth - halfWidth - (center.x - box.left);
      const nearY = halfHeight - (center.y - box.top);
      const farY = overlay.clientHeight - halfHeight - (center.y - box.top);
      return {
        x: clamp(x, Math.min(nearX, farX), Math.max(nearX, farX)),
        y: clamp(y, Math.min(nearY, farY), Math.max(nearY, farY)),
      };
    },
    [imageCenter],
  );

  /**
   * Zoom to `nextScale`, keeping whatever sits under `(clientX, clientY)` in
   * place — the picture grows away from the pointer instead of the centre.
   */
  const zoomAt = useCallback(
    (nextScale: number, clientX: number, clientY: number): void => {
      const current = zoomRef.current;
      const scale = clamp(nextScale, MIN_ZOOM, maxZoom);
      if (Math.abs(scale - current.scale) < 0.001) return;
      const center = imageCenter();
      if (!center) return;
      const ratio = scale / current.scale;
      const centerX = center.x + current.x;
      const centerY = center.y + current.y;
      const offset = clampOffset(
        scale,
        clientX - (clientX - centerX) * ratio - center.x,
        clientY - (clientY - centerY) * ratio - center.y,
      );
      commitZoom({ scale, ...offset });
    },
    [clampOffset, commitZoom, imageCenter, maxZoom],
  );

  /**
   * Zoom in/out (`+` / `-` keys) anchored on the picture's own centre, so the
   * keyboard zooms in place instead of dragging the picture towards the window
   * centre — which matters once it has been panned.
   */
  const zoomFromCenter = useCallback(
    (nextScale: number): void => {
      const center = imageCenter();
      if (!center) return;
      const current = zoomRef.current;
      zoomAt(nextScale, center.x + current.x, center.y + current.y);
    },
    [imageCenter, zoomAt],
  );

  const resetZoom = useCallback((): void => {
    if (isFitted(zoomRef.current)) return;
    commitZoom(FIT);
  }, [commitZoom]);

  /**
   * Show another image *and* fit it. The reset happens in the same update as
   * the index change (both are batched), so the arriving picture never paints
   * for one frame with the previous picture's framing.
   */
  const goTo = useCallback(
    (next: number): void => {
      commitZoom(FIT);
      onIndexChange(next);
    },
    [commitZoom, onIndexChange],
  );

  // Opening focuses the close button so Esc/Enter work without a mouse.
  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  // A new picture starts fitted. `goTo` already does this; this effect is the
  // guard for an index changed from outside (the parent clamping a stale one).
  useEffect(() => {
    resetZoom();
  }, [index, resetZoom]);

  // Measure the fitted box while the fitted copy is still the one laid out at
  // that size — the natural-size copy is scaled into exactly this box, so the
  // two never differ by a pixel. `useLayoutEffect` so the hand-over is set up
  // before the frame paints (no flash at the old size).
  useLayoutEffect(() => {
    const image = fittedRef.current;
    if (!loaded || loaded.index !== index || !image) return;
    const width = image.offsetWidth;
    const height = image.offsetHeight;
    if (width === 0 || height === 0) return;
    if (loaded.width === 0 || loaded.height === 0) return;
    setFitState({
      index,
      naturalWidth: loaded.width,
      naturalHeight: loaded.height,
      scale: Math.min(1, width / loaded.width),
      width,
      height,
      overBudget: loaded.width * loaded.height > MAX_CRISP_PIXELS,
    });
  }, [loaded, index]);

  // A picture served from the cache can finish before React attaches `onLoad`
  // (the deck thumbnail has usually fetched the same `imb-file:` URL already),
  // so read the sizes off the elements as well: neither the measurement nor the
  // hand-over to the original pixels may depend on catching the event.
  useEffect(() => {
    const fitted = fittedRef.current;
    if (
      fitted !== null &&
      loaded?.index !== index &&
      fitted.complete &&
      fitted.naturalWidth > 0
    ) {
      setLoaded({
        index,
        width: fitted.naturalWidth,
        height: fitted.naturalHeight,
      });
    }
    const full = fullRef.current;
    if (full !== null && hiLoaded?.index !== index && full.complete) {
      if (full.naturalWidth > 0) setHiLoaded({ index });
    }
  });

  // The hand-over gate. A plain timer (not a side effect of the FLIP) so the
  // beat is the same whether or not the open animation ran, and it restarts per
  // shown picture: flipping to another image replays that picture's entrance
  // fade, and its original pixels must not fade in on top of a half-faded copy
  // either. Reduced motion collapses the beat to nothing — the reveal is then a
  // single step, which is what that setting asks for.
  useEffect(() => {
    if (prefersReducedMotion()) {
      setHandOverReady(true);
      return;
    }
    setHandOverReady(false);
    const timer = window.setTimeout(
      () => setHandOverReady(true),
      HAND_OVER_DELAY_MS,
    );
    return () => window.clearTimeout(timer);
  }, [index]);

  // Drop the fitted copy once the full-resolution one has faded in: two
  // decoded bitmaps of the same picture is pure memory.
  useEffect(() => {
    if (!crisp) return;
    const timer = window.setTimeout(
      () => setFittedGone({ index }),
      FADE_MS + 40,
    );
    return () => window.clearTimeout(timer);
  }, [crisp, index]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        // While panned or zoomed, Esc steps back to the fitted framing first (a
        // second press closes); the ✕ and the backdrop still dismiss in one
        // step.
        if (!isFitted(zoomRef.current)) resetZoom();
        else onClose();
      } else if (count > 1 && event.key === "ArrowLeft") {
        event.stopPropagation();
        goTo((index - 1 + count) % count);
      } else if (count > 1 && event.key === "ArrowRight") {
        event.stopPropagation();
        goTo((index + 1) % count);
      } else if (event.key === "+" || event.key === "=") {
        event.stopPropagation();
        zoomFromCenter(zoomRef.current.scale * KEY_ZOOM_FACTOR);
      } else if (event.key === "-" || event.key === "_") {
        event.stopPropagation();
        zoomFromCenter(zoomRef.current.scale / KEY_ZOOM_FACTOR);
      } else if (event.key === "0") {
        event.stopPropagation();
        resetZoom();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [count, index, goTo, onClose, resetZoom, zoomFromCenter]);

  // Wheel: a plain wheel zooms about the pointer at any scale — no modifier
  // needed. A trackpad pinch arrives as `wheel` with `ctrlKey` set, so it takes
  // the exact same path. The listener is native (React's is passive) so the
  // gesture can be owned outright: no page zoom, no scroll behind the viewer.
  // Switching images is deliberately *not* on the wheel: ←/→, the on-screen
  // arrows and the `n / m` counter are the (always visible) ways to flip.
  useEffect(() => {
    const element = overlayRef.current;
    if (!element) return;
    const onWheel = (event: WheelEvent): void => {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 100 : 1;
      const delta = event.deltaY * unit;
      event.preventDefault();
      if (delta === 0) return;
      zoomAt(
        zoomRef.current.scale * Math.exp(-delta * WHEEL_ZOOM_SPEED),
        event.clientX,
        event.clientY,
      );
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // FLIP the fitted copy out of the thumbnail: place it at the thumbnail's box
  // for the first paint, then release it to its natural size on the next frame
  // so the transform transitions. Zoom/pan live on the wrapper, so they never
  // fight this animation; the full-resolution copy waits for it to finish
  // (`HAND_OVER_DELAY_MS`).
  useLayoutEffect(() => {
    const image = fittedRef.current;
    if (!image || !origin) return;
    // Reduced motion: the picture simply appears where it ends up. Growing it out
    // of the thumbnail is exactly the movement that setting is about, and the
    // hand-over is already immediate in that mode.
    if (prefersReducedMotion()) return;
    if (!image.complete || image.naturalWidth === 0) return;
    const target = image.getBoundingClientRect();
    if (target.width === 0 || target.height === 0) return;
    const scale = origin.width / target.width;
    const dx =
      origin.left + origin.width / 2 - (target.left + target.width / 2);
    const dy =
      origin.top + origin.height / 2 - (target.top + target.height / 2);
    image.style.transition = "none";
    image.style.transform = `translate(${dx}px, ${dy}px) scale(${scale})`;
    const frame = requestAnimationFrame(() => {
      image.style.transition = `transform ${OPEN_MS}ms var(--imb-ease-standard)`;
      image.style.transform = "translate(0, 0) scale(1)";
    });
    const timer = window.setTimeout(() => {
      // Hand the element back to CSS: the inline transform would otherwise
      // outlive the animation and shadow any later styling.
      image.style.transition = "";
      image.style.transform = "";
    }, HAND_OVER_DELAY_MS);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [origin]);

  const capturePointer = (element: HTMLElement, pointerId: number): void => {
    try {
      element.setPointerCapture(pointerId);
    } catch {
      // Pointer capture is best-effort; dragging still works without it.
    }
  };

  const onZoomPointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    pointers.current.set(event.pointerId, {
      x: event.clientX,
      y: event.clientY,
    });
    if (pointers.current.size > 2) return;
    capturePointer(event.currentTarget, event.pointerId);
    if (pointers.current.size === 1) {
      // One pointer pans the picture at *any* scale (a fitted picture can be
      // nudged to a corner too); a second pointer turns the gesture into a
      // pinch.
      gesture.current = {
        kind: "pan",
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: zoomRef.current.x,
        originY: zoomRef.current.y,
      };
      setGrabbing(true);
      return;
    }
    const ids = Array.from(pointers.current.keys()).slice(0, 2) as [
      number,
      number,
    ];
    const [a, b] = ids.map((pointerId) => pointers.current.get(pointerId));
    if (!a || !b) return;
    gesture.current = {
      kind: "pinch",
      ids,
      startDistance: Math.hypot(a.x - b.x, a.y - b.y),
      startScale: zoomRef.current.scale,
      startMidX: (a.x + b.x) / 2,
      startMidY: (a.y + b.y) / 2,
      startX: zoomRef.current.x,
      startY: zoomRef.current.y,
    };
    setGrabbing(true);
  };

  const onZoomPointerMove = (
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    const tracked = pointers.current.get(event.pointerId);
    if (!tracked) return;
    tracked.x = event.clientX;
    tracked.y = event.clientY;
    const current = gesture.current;
    if (!current) return;
    if (current.kind === "pan") {
      if (!pointers.current.has(current.pointerId)) return;
      const offset = clampOffset(
        zoomRef.current.scale,
        current.originX + (event.clientX - current.startX),
        current.originY + (event.clientY - current.startY),
      );
      commitZoom({ scale: zoomRef.current.scale, ...offset });
      return;
    }
    const [a, b] = current.ids.map((pointerId) =>
      pointers.current.get(pointerId),
    );
    if (!a || !b || current.startDistance <= 0) return;
    const distance = Math.hypot(a.x - b.x, a.y - b.y);
    const scale = clamp(
      (current.startScale * distance) / current.startDistance,
      MIN_ZOOM,
      maxZoom,
    );
    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    const center = imageCenter();
    if (!center) return;
    // Keep the picture under the fingers: the pinch also follows the midpoint.
    const ratio = scale / current.startScale;
    const offset = clampOffset(
      scale,
      midX - (current.startMidX - center.x - current.startX) * ratio - center.x,
      midY - (current.startMidY - center.y - current.startY) * ratio - center.y,
    );
    commitZoom({ scale, ...offset });
  };

  const onZoomPointerEnd = (event: ReactPointerEvent<HTMLDivElement>): void => {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size === 0) {
      gesture.current = null;
      setGrabbing(false);
      return;
    }
    // Pinch → pan: the remaining finger keeps moving the picture, so lifting
    // one finger never makes it jump back to the centred framing.
    if (pointers.current.size === 1) {
      const [pointerId, point] = Array.from(pointers.current.entries())[0];
      gesture.current = {
        kind: "pan",
        pointerId,
        startX: point.x,
        startY: point.y,
        originX: zoomRef.current.x,
        originY: zoomRef.current.y,
      };
      return;
    }
    gesture.current = null;
  };

  const onZoomDoubleClick = (event: {
    clientX: number;
    clientY: number;
  }): void => {
    // Double-click toggles between the neutral framing and 2×: any state that
    // is not fitted (zoomed out to 0.5×, zoomed in, or merely panned) resets
    // first. Jumping 0.5× → 2× directly would be a 4× leap and skip the state
    // the boss most likely wants to get back to.
    if (!isFitted(zoomRef.current)) resetZoom();
    else zoomAt(DOUBLE_CLICK_ZOOM, event.clientX, event.clientY);
  };

  const reveal = useCallback(async (): Promise<void> => {
    if (!onReveal || revealing) return;
    setRevealError(null);
    setRevealing(true);
    try {
      await onReveal();
    } catch (err) {
      setRevealError({
        index,
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setRevealing(false);
    }
  }, [index, onReveal, revealing]);

  const current = images[index];
  if (!current) return null;

  return createPortal(
    <div
      ref={overlayRef}
      className="imb-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current.name}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        ref={closeRef}
        className="imb-lightbox-close"
        onClick={onClose}
        aria-label={t("Close")}
        title={t("Close")}
      >
        <IconX />
      </button>

      {count > 1 && (
        <button
          type="button"
          className="imb-lightbox-nav imb-lightbox-prev"
          onClick={() => goTo((index - 1 + count) % count)}
          aria-label={t("Previous image")}
          title={t("Previous image")}
        >
          <IconChevronDown />
        </button>
      )}

      <figure className="imb-lightbox-figure">
        <div
          ref={frameRef}
          className={cls(
            "imb-lightbox-zoom",
            grabbing && "imb-lightbox-grabbing",
          )}
          style={
            {
              width: fit ? `${fit.width}px` : undefined,
              height: fit ? `${fit.height}px` : undefined,
              ...(fit ? { "--imb-lightbox-fit": String(fit.scale) } : {}),
              // A plain 2D transform on purpose: `translate3d` promotes the layer,
              // and a promoted layer can be painted from a raster computed at the
              // pre-zoom scale — which is what makes a magnified picture look
              // like a preview instead of its own pixels.
              transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
            } as CSSProperties
          }
          onPointerDown={onZoomPointerDown}
          onPointerMove={onZoomPointerMove}
          onPointerUp={onZoomPointerEnd}
          onPointerCancel={onZoomPointerEnd}
          onDoubleClick={onZoomDoubleClick}
        >
          {/* The fitted-size copy: what the viewer opens with, and the element
              the thumbnail grows into. It stays fully opaque underneath while
              the real pixels fade in over it, then it is dropped — never faded
              out (that would dim the picture mid-fade). */}
          {showFitted && (
            <img
              key={`fitted-${index}`}
              ref={fittedRef}
              className={cls("imb-lightbox-image", "imb-lightbox-image-fitted")}
              src={current.src}
              alt={crisp ? "" : current.name}
              draggable={false}
              onLoad={(event) => {
                const image = event.currentTarget;
                setLoaded({
                  index,
                  width: image.naturalWidth,
                  height: image.naturalHeight,
                });
              }}
            />
          )}
          {/* The original pixels: laid out at the natural size and scaled down
              into the fitted box, so `1×` of absolute zoom is 1 image px. */}
          {fit !== null && !degraded && (
            <img
              key={`full-${index}`}
              ref={fullRef}
              className={cls(
                "imb-lightbox-image",
                "imb-lightbox-image-full",
                crisp && "imb-lightbox-image-in",
              )}
              style={{
                width: `${fit.naturalWidth}px`,
                height: `${fit.naturalHeight}px`,
              }}
              src={current.src}
              alt={crisp ? current.name : ""}
              aria-hidden={crisp ? undefined : "true"}
              draggable={false}
              onLoad={() => setHiLoaded({ index })}
            />
          )}
        </div>
        <figcaption className="imb-lightbox-caption">
          <span className="imb-lightbox-name">{current.name}</span>
          {count > 1 && (
            <span className="imb-lightbox-count">{`${index + 1} / ${count}`}</span>
          )}
          <span className="imb-lightbox-zoom-level">{`${percent}%`}</span>
          {degraded && (
            <span
              className="imb-lightbox-note"
              title={t("Downscaled preview (very large image)")}
            >
              {t("Downscaled preview (very large image)")}
            </span>
          )}
          {onReveal !== undefined && (
            <button
              type="button"
              className="imb-lightbox-reveal"
              onClick={() => void reveal()}
              disabled={revealing}
              aria-label={t("Show in folder")}
              title={t("Show in folder")}
            >
              <IconFolder />
              <span>{t("Show in folder")}</span>
            </button>
          )}
        </figcaption>
        {error !== null && <p className="imb-lightbox-error">{error}</p>}
      </figure>

      {count > 1 && (
        <button
          type="button"
          className="imb-lightbox-nav imb-lightbox-next"
          onClick={() => goTo((index + 1) % count)}
          aria-label={t("Next image")}
          title={t("Next image")}
        >
          <IconChevronDown />
        </button>
      )}
    </div>,
    document.body,
  );
}
