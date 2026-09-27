import { expect, test, vi } from "vitest";
import { dispatchBoundPointer } from "../view-manager-runtime/bound-pointer";

test("a failed press still releases the pointer", async () => {
  const sent: string[] = [];
  await expect(dispatchBoundPointer({
    interaction:"click", prepare:async()=>({x:10,y:10}),
    send:event=>{sent.push(event.type);if(event.type==="mouseDown")throw new Error("cancelled");}
  })).rejects.toThrow("cancelled");
  expect(sent).toEqual(["mouseMove","mouseDown","mouseUp"]);
});

test("two long holds cannot outlive the click guard as a double click", async () => {
  const prepare=vi.fn(),send=vi.fn();
  await expect(dispatchBoundPointer({interaction:"doubleClick",options:{holdMs:3000},prepare,send})).rejects.toThrow("single press");
  expect(prepare).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
