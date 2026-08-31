import { useEffect, useMemo, useState } from "react";

import { Preview } from "./react-catalog/PreviewRuntime.tsx";
import { stateFromSearch, type PreviewState } from "./react-catalog/preview-state.ts";
import { workshopThemePresets } from "./react-catalog/themes.ts";
// oxlint-disable-next-line import/no-unassigned-import -- The preview renders shipped React styles.
import "../../../packages/react/src/styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- Preview chrome is owned by the docs app.
import "./component-preview.css";

type Props = {
  readonly story: PreviewState["story"];
};

export default function ComponentPreview({ story }: Props) {
  const initial = useMemo(() => {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("story", story);
    return stateFromSearch(`?${parameters.toString()}`);
  }, [story]);
  const [colorScheme, setColorScheme] = useState<PreviewState["colorScheme"]>(
    () => initial.colorScheme,
  );
  const [theme, setTheme] = useState<PreviewState["theme"]>(() => initial.theme);
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    if (parameters.has("mode")) return;
    const root = document.documentElement;
    const sync = () => setColorScheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const state: PreviewState = {
    ...initial,
    colorScheme,
    story,
    theme,
  };

  return (
    <div data-component-preview="" data-scheme={colorScheme} data-theme={theme}>
      <div data-component-preview-toolbar="">
        <span>Interactive preview</span>
        <div data-component-preview-controls="">
          <label data-component-preview-theme="">
            <span>Theme</span>
            <select
              aria-label="Theme preset"
              onChange={(event) => setTheme(event.currentTarget.value as PreviewState["theme"])}
              value={theme}
            >
              {workshopThemePresets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.label}
                </option>
              ))}
            </select>
          </label>
          <div data-component-preview-actions="">
            <button
              aria-pressed={colorScheme === "light"}
              onClick={() => setColorScheme("light")}
              type="button"
            >
              Light
            </button>
            <button
              aria-pressed={colorScheme === "dark"}
              onClick={() => setColorScheme("dark")}
              type="button"
            >
              Dark
            </button>
          </div>
        </div>
      </div>
      <div data-component-preview-canvas="">
        <div data-workshop="" data-scheme={colorScheme}>
          <div data-workshop-canvas="">
            <div data-workshop-frame="">
              <Preview state={state} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
