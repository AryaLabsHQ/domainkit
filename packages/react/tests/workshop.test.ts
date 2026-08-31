import { nextRecordId } from "../../../apps/docs/islands/react-catalog/records.ts";
import {
  previewDialConfig,
  stateFromDials,
} from "../../../apps/docs/islands/react-catalog/preview-dials.ts";
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

describe("component catalog prop controls", () => {
  it("offers controls relevant to the active story", () => {
    const connection = stateFromSearch("?story=connection");
    expect(previewDialConfig(connection)).toMatchObject({
      domain: expect.any(Object),
      provider: expect.any(Object),
      targetState: expect.any(Object),
    });
    expect(previewDialConfig(connection)).not.toHaveProperty("records");

    const records = stateFromSearch("?story=records");
    expect(previewDialConfig(records)).toHaveProperty("records");
    expect(previewDialConfig(records)).not.toHaveProperty("targetState");
  });

  it("maps dial values into safe preview props", () => {
    const initial = stateFromSearch("?story=domain");
    const state = stateFromDials(initial, {
      domain: "custom.example.com",
      hasReceipt: false,
      provider: "vercel",
      records: {
        primary: {
          name: "custom.example.com",
          priority: 20,
          value: "mx.example.net",
        },
      },
    });

    expect(state.domain).toBe("custom.example.com");
    expect(state.providerId).toBe("vercel");
    expect(state.providerName).toBe("Vercel");
    expect(state.receipt).toBe(false);
    expect(state.records[0]).toMatchObject({
      name: "custom.example.com",
      priority: 20,
      value: "mx.example.net",
    });
  });

  it("keeps the last valid domain when a dial value is invalid", () => {
    const initial = stateFromSearch("?story=records");
    expect(stateFromDials(initial, { domain: "not a domain" }).domain).toBe(initial.domain);
  });
});
