import { nextRecordId } from "../examples/vite/src/workshop-records.ts";
import {
  isWorkshopThemeId,
  workshopTheme,
  workshopThemePresets,
} from "../examples/vite/src/workshop-themes.ts";
import { stateFromSearch } from "../examples/vite/src/workshop.tsx";

describe("workshop record controls", () => {
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

describe("workshop themes", () => {
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
    expect(stateFromSearch("?theme=tokyo-night&mode=dark").theme).toBe("tokyo-night");
    expect(stateFromSearch("?theme=brand").theme).toBe("neutral");
    expect(stateFromSearch("?theme=unknown").theme).toBe("neutral");
  });
});
