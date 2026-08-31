import { nextRecordId } from "../../../apps/docs/islands/react-catalog/records.ts";
import {
  isWorkshopThemeId,
  workshopTheme,
  workshopThemePresets,
} from "../../../apps/docs/islands/react-catalog/themes.ts";
import { stateFromSearch } from "../../../apps/docs/islands/react-catalog/preview-state.ts";

describe("component catalog record controls", () => {
  it("skips IDs already present in the initial records", () => {
    const records = {
      "record-4": {
        id: "record-4",
        name: "example.com",
        type: "TXT",
        value: "v=spf1 -all",
      },
    };

    expect(nextRecordId(records, 4)).toEqual({ id: "record-5", next: 6 });
  });
});

describe("component catalog themes", () => {
  it("offers every named preset with light and dark recipes", () => {
    expect(workshopThemePresets.map(({ id }) => id)).toEqual([
      "neutral",
      "monochrome",
      "emerald",
      "samva",
      "dark-plus",
      "solarized",
      "tokyo-night",
    ]);

    for (const preset of workshopThemePresets) {
      expect(isWorkshopThemeId(preset.id)).toBe(true);
      expect(workshopTheme(preset.id, "light").accent).toBeTruthy();
      expect(workshopTheme(preset.id, "dark").accent).toBeTruthy();
    }
  });

  it("reads valid presets from URLs and falls back to neutral", () => {
    expect(stateFromSearch("?theme=samva").theme).toBe("samva");
    expect(stateFromSearch("?theme=samva&mode=dark").theme).toBe("samva");
    expect(stateFromSearch("?theme=brand").theme).toBe("neutral");
    expect(stateFromSearch("?theme=unknown").theme).toBe("neutral");
  });

  it("reads target-selection states from URLs and defaults to unique", () => {
    expect(stateFromSearch("?targets=ambiguous").targetState).toBe("ambiguous");
    expect(stateFromSearch("?targets=unavailable").targetState).toBe("unavailable");
    expect(stateFromSearch("?targets=unknown").targetState).toBe("unique");
  });
});
