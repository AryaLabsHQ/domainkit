import type { SceneMotion } from "../../scene";
import { all, arrive, draw, drop, ease, lift, one, point, press, rise, swap } from "../motion-kit";
import { copyButton, saveButton, secondTab, start, targetField, valueText } from "./layout";

/**
 * 0.0 window in. 1.0-2.1 the pointer selects a value and copies it. 2.7-3.5 it switches tabs.
 * 3.9-5.0 it pastes into the provider's form. 5.4-6.2 it saves and waits. 6.8 the page goes quiet
 * and the headline lands; a progress line stops short and stays stopped.
 */
export const hook: SceneMotion = (tl, root) => {
  const cursor = one(root, "cursor");
  const words = all(root, "step-word");
  const [copyWord, pasteWord, waitWord] = words;
  if (copyWord === undefined || pasteWord === undefined || waitWord === undefined)
    throw new Error("hook expects three step words");

  // Initial state: page one in front, the second tab and its form waiting behind it.
  tl.set(one(root, "page-2"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "tab-2-on"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "copied"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "waiting"), { autoAlpha: 0 }, 0);
  tl.set(one(root, "caret"), { autoAlpha: 0 }, 0);
  tl.set(words, { autoAlpha: 0, yPercent: 112 }, 0);
  tl.set(all(root, "stall-line"), { autoAlpha: 0, yPercent: 112 }, 0);
  tl.set(one(root, "stall-kicker"), { autoAlpha: 0 }, 0);
  tl.set([one(root, "track"), one(root, "fill"), one(root, "stop")], { autoAlpha: 0 }, 0);

  tl.fromTo(
    one(root, "window"),
    { autoAlpha: 0, y: 36, scale: 0.985 },
    { autoAlpha: 1, y: 0, scale: 1, duration: 0.8, ease: ease.out },
    0,
  );

  // Copy: select the value, press Copy.
  arrive(tl, cursor, start.x, start.y, 0.7);
  point(tl, cursor, valueText.x, valueText.y, 0.7, 0.8);
  draw(tl, one(root, "select"), 1.55, { duration: 0.35 });
  point(tl, cursor, copyButton.x, copyButton.y, 2.0, 0.55);
  press(tl, cursor, 2.6);
  swap(tl, one(root, "copy"), one(root, "copied"), 2.65, 0.15);
  lift(tl, copyWord, 2.6, { duration: 0.7 });

  // Paste: switch tabs, click the field, paste the value.
  point(tl, cursor, secondTab.x, secondTab.y, 3.1, 0.7);
  press(tl, cursor, 3.85);
  swap(tl, one(root, "tab-1-on"), one(root, "tab-2-on"), 3.9, 0.2);
  swap(tl, one(root, "page-1"), one(root, "page-2"), 3.9, 0.25);
  point(tl, cursor, targetField.x, targetField.y, 4.2, 0.7);
  press(tl, cursor, 4.95);
  tl.set(one(root, "caret"), { autoAlpha: 1 }, 4.95);
  tl.fromTo(
    one(root, "paste"),
    { clipPath: "inset(0 100% 0 0)" },
    { clipPath: "inset(0 0% 0 0)", duration: 0.35, ease: "steps(19)" },
    5.2,
  );
  tl.set(one(root, "caret"), { autoAlpha: 0 }, 5.55);
  lift(tl, pasteWord, 5.2, { duration: 0.7 });

  // Wait: save, then the page waits.
  point(tl, cursor, saveButton.x, saveButton.y, 5.7, 0.6);
  press(tl, cursor, 6.35);
  swap(tl, one(root, "save"), one(root, "waiting"), 6.4, 0.2);
  tl.to(one(root, "spin"), { rotation: 360, duration: 0.9, repeat: 1, ease: ease.linear }, 6.4);
  lift(tl, waitWord, 6.4, { duration: 0.7 });
  tl.to(cursor, { autoAlpha: 0, duration: 0.3, ease: ease.out }, 6.8);

  // The turn: the demonstration recedes and the headline arrives.
  tl.to(one(root, "window"), { autoAlpha: 0, x: 90, duration: 0.6, ease: ease.inOut }, 7.0);
  drop(tl, words, 7.1, { duration: 0.4, stagger: 0.04 });
  rise(tl, one(root, "stall-kicker"), 7.6, { y: 12, duration: 0.5 });
  const [first, second] = all(root, "stall-line");
  if (first === undefined || second === undefined)
    throw new Error("hook expects two headline lines");
  lift(tl, first, 7.7, { duration: 0.85 });
  lift(tl, second, 8.0, { duration: 0.85 });
  tl.set(one(root, "track"), { autoAlpha: 1 }, 8.2);
  tl.set(one(root, "fill"), { autoAlpha: 1 }, 8.2);
  draw(tl, one(root, "fill"), 8.2, { duration: 0.6 });
  tl.fromTo(one(root, "stop"), { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.1 }, 8.75);
};
