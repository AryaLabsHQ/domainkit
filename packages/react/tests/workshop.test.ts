import { nextRecordId } from "../examples/vite/src/workshop-records.ts";

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
