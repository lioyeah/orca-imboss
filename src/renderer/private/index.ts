/**
 * The private UI/UX layer.
 *
 * `src/renderer/main.tsx` imports this file once, and nothing else in the app
 * imports anything from this directory — so upstream rebases never touch it.
 *
 * Global look-and-feel goes in `theme.css` as token overrides; the few things a
 * token cannot reach go in `overrides.css`, and the shared state surfaces
 * (empty / error / loading / disabled) in `states.css`. Private components go in
 * their own file next to this one and are mounted from here. See
 * `scripts/private/README.md` for the rules that keep this layer cheap.
 */
import "./theme.css";
import "./overrides.css";
import "./states.css";
