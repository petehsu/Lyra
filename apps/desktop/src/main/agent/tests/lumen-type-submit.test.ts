import { expect, test, vi } from "vitest";

vi.mock("electron", () => ({ BrowserWindow: {} }));
import { createLumenToolHost } from "../lumen-tool-host";

const host = (typed: Record<string, unknown> = { ok: true, message: "Typed" }) => {
  const typeIntoAgentElement = vi.fn(async () => typed);
  const actOnAgentElement = vi.fn(async () => ({ ok: true, message: "Sent", afterObservationId: "after" }));
  const handlers = createLumenToolHost({
    getBrowserBridge: () => ({ typeIntoAgentElement, actOnAgentElement }),
    tabResolver: { resolveBrowserAgentTabId: async () => "fixture" }, storageRoot: "/tmp"
  } as unknown as Parameters<typeof createLumenToolHost>[0]).handlers;
  return { type: handlers["lyraLumen.type"]!, typeIntoAgentElement, actOnAgentElement };
};

test("fill and submit in one call preserve the submit effect without assigning it to typing", async () => {
  const tool = host();
  const result = await tool.type({ targetRef: "lumen:input", text: "Hello", thenClick: "lumen:send", effect: "communicate" });
  expect(result, JSON.stringify(result)).toMatchObject({ ok: true, afterObservationId: "after" });
  expect(tool.typeIntoAgentElement).toHaveBeenCalledWith("fixture", expect.objectContaining({ effect: "editDraft", text: "Hello" }));
  expect(tool.actOnAgentElement).toHaveBeenCalledTimes(1);
  expect(tool.actOnAgentElement).toHaveBeenCalledWith("fixture", expect.objectContaining({ effect: "communicate", targetRef: "lumen:send" }));
  expect(tool.typeIntoAgentElement.mock.invocationCallOrder[0]).toBeLessThan(tool.actOnAgentElement.mock.invocationCallOrder[0]!);
});

test.each([
  { ok: false, error: { kind: "fieldNotReady" } },
  { ok: true, status: "uncertain" },
  { ok: true, status: "dialogPending", dialog:{id:"dialog:1",message:"Continue?"} },
  { ok: true, outcome: "uncertain" }
])("does not submit after unsuccessful or uncertain typing: %j", async typed => {
  const tool = host(typed);
  await tool.type({ targetRef: "lumen:input", text: "Hello", thenClick: "lumen:send", effect: "communicate" });
  expect(tool.typeIntoAgentElement).toHaveBeenCalledTimes(1);
  expect(tool.actOnAgentElement).not.toHaveBeenCalled();
});


test.each(["\nRain plan\n", " together", " "])("typing preserves literal whitespace through the host boundary: %j", async text => {
  const tool = host();
  await tool.type({targetRef:"lumen:input",text,effect:"editDraft"});
  expect(tool.typeIntoAgentElement).toHaveBeenCalledWith("fixture", expect.objectContaining({text}));
});

test("explicit clearing accepts empty text for a target and for assigned fields", async () => {
  const tool = host();
  await tool.type({targetRef:"lumen:input",text:"",clear:true,effect:"editDraft"});
  expect(tool.typeIntoAgentElement).toHaveBeenCalledWith("fixture", expect.objectContaining({text:"",clear:true}));
  await tool.type({fields:[{targetRef:"lumen:input",text:"",clear:true}],effect:"editDraft"});
  expect(tool.typeIntoAgentElement).toHaveBeenLastCalledWith("fixture", expect.objectContaining({fields:[{targetRef:"lumen:input",text:"",clear:true}]}));
});

test("invalid form text is retained for correction but never submitted",async()=>{
  const tool=host({ok:true,message:"Text inserted",inputValidation:{valid:false,messages:["Please match the requested format."]}});
  const result=await tool.type({targetRef:"lumen:code",text:"12345678",thenClick:"lumen:verify",effect:"authorize"});
  expect(result).toMatchObject({ok:false,error:{kind:"input_validation_failed"}});
  expect(tool.actOnAgentElement).not.toHaveBeenCalled();
});


test.each(["editDraft", "observe", "navigate", undefined])("compound submission rejects an invalid effect before any input: %s",async effect=>{
  const tool=host();
  const result=await tool.type({targetRef:"lumen:input",text:"Hello",thenClick:"lumen:submit",effect});
  expect(result).toMatchObject({ok:false});
  expect(tool.typeIntoAgentElement).not.toHaveBeenCalled();expect(tool.actOnAgentElement).not.toHaveBeenCalled();
});

test("compound receipt keeps insertion evidence and only the final map",async()=>{
  const tool=host({ok:true,message:"OLD MAP ".repeat(1000),inputValidation:{valid:true},inputInsertionMethod:"native"});
  const result=await tool.type({targetRef:"lumen:input",text:"Hello",thenClick:"lumen:submit",effect:"communicate"});
  expect(result).toMatchObject({ok:true,inputValidation:{valid:true},inputInsertionMethod:"native"});
  expect(JSON.stringify(result)).not.toContain("OLD MAP");
  expect(JSON.stringify(result)).toContain("Sent");
});


test("paused typing preserves the dialog identity and never advances to submit",async()=>{
  const tool=host({ok:true,status:"dialogPending",dialog:{id:"dialog:1",message:"Continue?"}});
  const result=await tool.type({targetRef:"lumen:input",text:"Hello",thenClick:"lumen:send",effect:"communicate"});
  expect(result).toMatchObject({status:"dialogPending",dialog:{id:"dialog:1"},nextRecommendedAction:"browser_dialog"});
  expect(tool.actOnAgentElement).not.toHaveBeenCalled();
});
