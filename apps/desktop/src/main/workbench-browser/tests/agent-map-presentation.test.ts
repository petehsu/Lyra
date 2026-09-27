import { describe, expect, test } from "vitest";
import type { WorkbenchBrowserAgentElement } from "../types";
import { MAP_PRESENTATION_CHARS, presentBrowserMap } from "../view-manager-runtime/agent-map-presentation";

const control = (id: number, patch: Partial<WorkbenchBrowserAgentElement> = {}): WorkbenchBrowserAgentElement => ({
  id, targetRef: `lumen:${id}`, frameRef: "main", tagName: "button", role: "button", label: `Row ${id}`,
  bounds: { x: 10, y: id * 24, width: 100, height: 24 }, disabled: false, editable: false, ...patch
} as WorkbenchBrowserAgentElement);
const source = (elements: WorkbenchBrowserAgentElement[]) => ({ elements, activeElementId: null, url: "https://example.test" });
const cursorOf = (text: string) => /Next cursor=([^\s]+)/.exec(text)?.[1];

describe("lossless control index presentation", () => {
  test("large inbox exposes the active compose fields within the provider budget", () => {
    const elements = Array.from({ length: 500 }, (_, index) => control(index));
    elements.push(control(501, { label: "Subject", tagName: "input", editable: true, semantics: { context: ["dialog: Compose"] } }),
      control(502, { label: "Message Body", editable: true, semantics: { focused: true, context: ["dialog: Compose"] } }));
    const text = presentBrowserMap(source(elements));
    expect(text.length).toBeLessThanOrEqual(MAP_PRESENTATION_CHARS);
    expect(text).toContain('"Subject"');
    expect(text).toContain('"Message Body"');
    expect(elements).toHaveLength(502);
    expect(cursorOf(text)).toBeTruthy();
  });

  test("every control is recoverable by paging, including offscreen and policy links", () => {
    const elements = Array.from({ length: 200 }, (_, index) => control(index));
    elements.push(control(999, { label: "Privacy policy", role: "link", visibility: { visible: true, offscreen: true, covered: false, ariaHidden: false } }));
    const refs: string[] = [];
    let cursor: string | undefined;
    do {
      const text = presentBrowserMap(source(elements), { cursor });
      expect(text.length).toBeLessThanOrEqual(MAP_PRESENTATION_CHARS);
      refs.push(...[...text.matchAll(/targetRef=(lumen:\d+)\]/g)].map(match => match[1]!));
      cursor = cursorOf(text);
    } while (cursor);
    expect(refs).toHaveLength(elements.length);
    expect(new Set(refs)).toEqual(new Set(elements.map(element => element.targetRef)));
    const found = presentBrowserMap(source(elements), { query: "privacy" });
    expect(found).toContain("targetRef=lumen:999");
    expect(found).toContain("offscreen");
  });

  test("a region filter is reversible and changed pages reject stale cursors", () => {
    const elements = Array.from({ length: 200 }, (_, index) => control(index, { semantics: { context: [index < 100 ? "main: Inbox" : "nav: Accounts"] } }));
    const text = presentBrowserMap(source(elements), { region: "Accounts" });
    expect(text).toContain("100 matching");
    expect(text).not.toMatch(/targetRef=lumen:0\]/);
    const cursor = cursorOf(text)!;
    const changed = elements.slice(1).concat(control(201, { semantics: { context: ["nav: Accounts"] } }));
    expect(presentBrowserMap(source(changed), { region: "Accounts", cursor })).toContain("Map page changed");
    expect(presentBrowserMap(source(elements), { query: "Row 0" })).toContain("targetRef=lumen:0");
  });

  test("long descriptions do not push the recovery instructions out of the map", () => {
    const elements = [control(1, { label: "a".repeat(20_000), semantics: { description: "b".repeat(20_000) } }), control(2, { label: "Save" })];
    const text = presentBrowserMap(source(elements));
    expect(text.length).toBeLessThanOrEqual(MAP_PRESENTATION_CHARS);
    expect(text).toContain("targetRef=lumen:1");
    expect(text).toContain("targetRef=lumen:2");
    expect(text).toContain("Find any indexed control");
  });
});

test("keyword queries recover targets and retain focused field constraints",()=>{
  const field=control(1,{label:"Verification code",tagName:"input",editable:true,semantics:{focused:true,constraints:{pattern:"[0-9]{6}"}}});
  const verify=control(2,{label:"Verify"});
  const settings=control(3,{label:"Settings"});
  const text=presentBrowserMap(source([field,verify,settings]),{query:"settings profile avatar menu"});
  expect(text).toContain('"Settings"');expect(text).toContain("Search matching: any terms");
  const filtered=presentBrowserMap(source([field,verify]),{query:"Verify"});
  expect(filtered).toContain("Focused field context");expect(filtered).toContain('[0-9]{6}');
  expect(presentBrowserMap(source([field,verify]),{query:"lumen:missing"})).toContain("0 matching");
});


test("specific control names outrank ubiquitous roles and inherited region words",()=>{
  const elements=Array.from({length:200},(_,i)=>control(i,{label:`History ${i}`,semantics:{context:["navigation: Message workspace"]}}));
  elements.push(control(900,{label:"Send",visibility:{visible:true,offscreen:true,covered:false,ariaHidden:false}}));
  const text=presentBrowserMap(source(elements),{query:"Message button bottom send"},3000);
  expect(text).toContain('"Send"');
  expect(text.indexOf('"Send"')).toBeLessThan(text.indexOf('"History 0"'));
  expect(text).toContain("201 matching");
  expect(cursorOf(text)).toBeTruthy();
});
