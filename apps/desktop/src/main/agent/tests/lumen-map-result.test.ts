import { expect, test } from "vitest";
import type { WorkbenchBrowserAgentObservation } from "../../workbench-browser/types";
import { lumenMapResult } from "../lumen-map-result";

test("map transport contains the displayed slice while the controller retains the full index", () => {
  const elements = Array.from({ length: 1000 }, (_, id) => ({
    id, targetRef: `lumen:${id}`, role: "button", label: `Action ${id}`, bounds: {x:0,y:id,width:10,height:10}, disabled:false, editable:false
  }));
  const observation = {ok:true, tabId:"tab", elements, targets: elements.map(element => ({targetRef:element.targetRef})),
    semanticTree: {nodes:elements}, inViewport:elements.slice(0,50), needsScroll:elements.slice(50),focusOrder:[],url:"https://example.test"} as unknown as WorkbenchBrowserAgentObservation;
  const result = lumenMapResult(observation, '[901 targetRef=lumen:901] button: "Action 901"');
  expect(result.indexCount).toBe(1000);
  expect(result.presentedCount).toBe(1);
  expect(result.elements.map(element=>element.targetRef)).toEqual(["lumen:901"]);
  expect(result).not.toHaveProperty("semanticTree");
  expect(result).not.toHaveProperty("needsScroll");
  expect(result).not.toHaveProperty("outputTruncated");
  expect(JSON.stringify(result).length).toBeLessThan(1000);
  expect(observation.elements).toHaveLength(1000);
});
