import { lazy, Suspense, useEffect, useId, useMemo, useState } from "react";
import { Moon, SlidersHorizontal, Sun } from "lucide-react";

import { Preview } from "./react-catalog/PreviewRuntime.tsx";
import { stateFromDials, type PreviewDialValues } from "./react-catalog/preview-dials.ts";
import { stateFromSearch, type PreviewState } from "./react-catalog/preview-state.ts";
import { isWorkshopThemeId, workshopThemePresets } from "./react-catalog/themes.ts";
// oxlint-disable-next-line import/no-unassigned-import -- The preview renders shipped React styles.
import "../../../packages/react/src/styles.css";
// oxlint-disable-next-line import/no-unassigned-import -- Preview chrome is owned by the docs app.
import "./component-preview.css";

const PreviewProps = lazy(() => import("../lib/PreviewProps.tsx"));
const colorSchemeStorageKey = "domainkit:component-preview:color-scheme";
const themeStorageKey = "domainkit:component-preview:theme";

const storedValue = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const storeValue = (key: string, value: string): void => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Keep the preview usable when storage is unavailable.
  }
};

type Props = {
  readonly story: PreviewState["story"];
};

export default function ComponentPreview({ story }: Props) {
  const controlsId = useId();
  const initial = useMemo(() => {
    const parameters = new URLSearchParams(window.location.search);
    parameters.set("story", story);
    return stateFromSearch(`?${parameters.toString()}`);
  }, [story]);
  const [colorScheme, setColorScheme] = useState<PreviewState["colorScheme"]>(() => {
    const mode = new URLSearchParams(window.location.search).get("mode");
    if (mode === "dark" || mode === "light") return initial.colorScheme;
    const stored = storedValue(colorSchemeStorageKey);
    return stored === "dark" || stored === "light" ? stored : initial.colorScheme;
  });
  const [dialValues, setDialValues] = useState<PreviewDialValues>({});
  const [hasOpenedProps, setHasOpenedProps] = useState(false);
  const [showProps, setShowProps] = useState(false);
  const [theme, setTheme] = useState<PreviewState["theme"]>(() => {
    const themeParameter = new URLSearchParams(window.location.search).get("theme");
    if (themeParameter !== null && isWorkshopThemeId(themeParameter)) return initial.theme;
    const stored = storedValue(themeStorageKey);
    return stored !== null && isWorkshopThemeId(stored) ? stored : initial.theme;
  });
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    const mode = parameters.get("mode");
    const stored = storedValue(colorSchemeStorageKey);
    if (mode === "dark" || mode === "light" || stored === "dark" || stored === "light") return;
    const root = document.documentElement;
    const sync = () => setColorScheme(root.dataset.theme === "dark" ? "dark" : "light");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  const selectColorScheme = (value: PreviewState["colorScheme"]) => {
    storeValue(colorSchemeStorageKey, value);
    setColorScheme(value);
  };
  const selectTheme = (value: PreviewState["theme"]) => {
    storeValue(themeStorageKey, value);
    setTheme(value);
  };
  const state: PreviewState = stateFromDials(
    {
      ...initial,
      colorScheme,
      story,
      theme,
    },
    dialValues,
  );

  return (
    <div data-component-preview="" data-scheme={colorScheme} data-theme={theme}>
      <div data-component-preview-toolbar="">
        <span>Interactive preview</span>
      </div>
      <div data-component-preview-workspace="" data-props-open={showProps || undefined}>
        <div data-component-preview-canvas="">
          <div data-workshop="" data-scheme={colorScheme}>
            <div data-workshop-canvas="">
              <div data-workshop-frame="">
                <Preview state={state} />
              </div>
            </div>
          </div>
        </div>
        {hasOpenedProps ? (
          <aside
            aria-label="Preview controls"
            data-component-preview-dials=""
            hidden={!showProps}
            id={controlsId}
          >
            <div data-component-preview-settings="">
              <span>Preview controls</span>
              <label data-component-preview-theme="">
                <span>Theme</span>
                <select
                  aria-label="Theme preset"
                  onChange={(event) =>
                    selectTheme(event.currentTarget.value as PreviewState["theme"])
                  }
                  value={theme}
                >
                  {workshopThemePresets.map((preset) => (
                    <option key={preset.id} value={preset.id}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <Suspense fallback={<div data-component-preview-dials-loading="">Loading props…</div>}>
              <PreviewProps
                colorScheme={colorScheme}
                initial={initial}
                onValuesChange={setDialValues}
              />
            </Suspense>
          </aside>
        ) : null}
        <div aria-label="Preview toolbar" data-component-preview-floating-toolbar="">
          <button
            aria-controls={controlsId}
            aria-expanded={showProps}
            data-component-preview-props=""
            onClick={() => {
              setHasOpenedProps(true);
              setShowProps((current) => !current);
            }}
            type="button"
          >
            <SlidersHorizontal aria-hidden="true" />
            <span>Preview controls</span>
          </button>
          <span aria-hidden="true" data-component-preview-divider="" />
          <div data-component-preview-actions="">
            <button
              aria-label="Use light mode"
              aria-pressed={colorScheme === "light"}
              onClick={() => selectColorScheme("light")}
              type="button"
            >
              <Sun aria-hidden="true" />
            </button>
            <button
              aria-label="Use dark mode"
              aria-pressed={colorScheme === "dark"}
              onClick={() => selectColorScheme("dark")}
              type="button"
            >
              <Moon aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
