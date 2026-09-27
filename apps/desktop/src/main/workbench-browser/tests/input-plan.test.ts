import { describe, expect, test } from "vitest";

import { planInputWrites, type InputField } from "../view-manager-runtime/input-plan";

const box = (targetRef: string, x: number, rest: Partial<InputField> = {}): InputField => ({
  elementId: x,
  targetRef,
  tagName: "input",
  role: "textbox",
  label: targetRef,
  editable: true,
  disabled: false,
  textSnippet: "",
  maxLength: 1,
  bounds: { x, y: 10, width: 32, height: 32 },
  ...rest
});

describe("planInputWrites", () => {
  test("refuses a menu item and lists the input lines", () => {
    const plan = planInputWrites([
      box("lumen:menu", 0, { tagName: "div", role: "button", editable: false, label: "Rename", bounds: { x: 0, y: 10, width: 80, height: 28 } }),
      box("lumen:rename", 20, { tagName: "input", label: "旧标题", textSnippet: "旧标题", bounds: { x: 20, y: 40, width: 200, height: 28 } }),
      box("lumen:composer", 300, { tagName: "textarea", label: "Message", bounds: { x: 300, y: 500, width: 400, height: 40 } })
    ], { targetRef: "lumen:menu", text: "数列找规律" });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.kind).toBe("notAnInput");
    expect(plan.message).toContain("lumen:rename");
    expect(plan.message).not.toContain("lumen:menu");
  });

  test("splits one string across a row of small boxes", () => {
    const plan = planInputWrites(
      [0, 1, 2, 3, 4, 5].map((index) => box(`lumen:d${index}`, index * 40)),
      { targetRef: "lumen:d0", text: "123456" }
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes.map((write) => write.text)).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  test("asks for refs when several labeled fields receive one string", () => {
    const plan = planInputWrites([
      box("lumen:name", 0, { label: "姓名", bounds: { x: 0, y: 0, width: 200, height: 32 } }),
      box("lumen:mail", 0, { label: "邮箱", bounds: { x: 0, y: 48, width: 200, height: 32 } })
    ], { text: "甲 user@example.com" });
    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.kind).toBe("inputChoice");
    expect(plan.message).toContain("lumen:name");
    expect(plan.message).toContain("lumen:mail");
  });

  test("writes each assigned field in one call", () => {
    const plan = planInputWrites([
      box("lumen:name", 0, { label: "姓名", bounds: { x: 0, y: 0, width: 200, height: 32 } }),
      box("lumen:mail", 0, { label: "邮箱", bounds: { x: 0, y: 48, width: 200, height: 32 } })
    ], {
      text: "",
      assignments: [
        { targetRef: "lumen:name", text: "甲" },
        { targetRef: "lumen:mail", text: "user@example.com" }
      ]
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes).toEqual([
      { targetRef: "lumen:name", text: "甲", clear: false },
      { targetRef: "lumen:mail", text: "user@example.com", clear: false }
    ]);
  });

  test("replaces only when requested and otherwise preserves the editor selection", () => {
    const fields = [
      box("lumen:rename", 0, { label: "旧标题", textSnippet: "旧标题", bounds: { x: 0, y: 40, width: 200, height: 28 } }),
      box("lumen:composer", 0, { tagName: "textarea", label: "Message", bounds: { x: 0, y: 500, width: 400, height: 40 } })
    ];
    const rename = planInputWrites(fields, { targetRef: "lumen:rename", text: "数列找规律", clear: true });
    const composer = planInputWrites(fields, { targetRef: "lumen:composer", text: "下一句" });
    expect(rename.ok && rename.writes[0]?.clear).toBe(true);
    expect(composer.ok && composer.writes[0]?.clear).toBe(false);
    for (const tagName of ["input", "textarea", "div"]) {
      const field = box("lumen:edit", 1, { tagName, textSnippet: "Budget: 500" });
      const edit = planInputWrites([field], { targetRef: field.targetRef, text: " together" });
      expect(edit.ok && edit.writes[0]?.clear).toBe(false);
    }
  });

  test("sends an untargeted string to the only field that is not the composer", () => {
    const plan = planInputWrites([
      box("lumen:rename", 0, { label: "旧标题", textSnippet: "旧标题", bounds: { x: 0, y: 40, width: 200, height: 28 } }),
      box("lumen:composer", 0, { tagName: "textarea", label: "Message", bounds: { x: 0, y: 500, width: 400, height: 40 } })
    ], { text: "数列找规律" });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.writes[0]?.targetRef).toBe("lumen:rename");
  });
});

test("split fields use the same plan through both entry points",()=>{
  const fields=Array.from({length:8},(_,i)=>box(`lumen:${i}`,i*40,{maxLength:1}));
  const direct=planInputWrites(fields,{targetRef:"lumen:0",text:"ABCD-EFGH"});
  expect(planInputWrites(fields,{text:"",assignments:[{targetRef:"lumen:0",text:"ABCD-EFGH"}]})).toEqual(direct);
  expect(direct.ok && direct.writes.map(w=>w.text)).toEqual(["A","B","C","D","E","F","G","H"]);
  expect(planInputWrites(fields,{text:"",assignments:[{targetRef:"lumen:0",text:"ABCD-EFGH"},{targetRef:"lumen:1",text:"X"}]})).toMatchObject({ok:false});
});

test("small unrelated fields and fields across frames are not code groups",()=>{
  const fields=Array.from({length:3},(_,i)=>box(`lumen:${i}`,i*40,{maxLength:undefined}));
  const result=planInputWrites(fields,{targetRef:"lumen:0",text:"ABC"});
  expect(result.ok && result.writes).toHaveLength(1);
  const across=fields.map((f,i)=>({...f,maxLength:1,frameRef:String(i)}));
  const cross=planInputWrites(across,{targetRef:"lumen:0",text:"ABC"});
  expect(cross.ok && cross.writes).toHaveLength(1);
});
