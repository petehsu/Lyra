import assert from "node:assert/strict";
import type { Page } from "playwright";
import type { WorkbenchBrowserAgentObservation } from "../src/main/workbench-browser/types";
import { activateStampedSurfaceScript } from "../src/main/workbench-browser/view-manager-runtime/surface-control-names";

type Case = [string, () => Promise<void>];
type Context = {
  page: Page;
  observe: () => Promise<WorkbenchBrowserAgentObservation>;
  click: (targetRef: string) => Promise<void>;
  cases: Case[];
};

const style = `<style>
  fieldset{width:340px} .choice{position:relative;height:42px}
  .choice input{position:absolute;left:16px;top:12px;width:16px;height:16px;margin:0}
  .choice label{position:relative;display:block;height:42px;padding-left:48px;line-height:42px;background:#ddd;cursor:pointer}
  .choice label.choice-radio-on,.choice label.choice-checkbox-on{background:#ace}
</style>`;

const malformed = () => `${style}<div role="dialog" aria-label="Preferences">
  <fieldset><legend>Mode</legend><div class="choice"><input type="radio" name="shared" id="one" value="human"><label for="one" class="choice-radio-off">Human</label></div><div class="choice"><input type="radio" name="shared" id="two" value="computer"><label for="two" class="choice-radio-on">Computer</label></div></fieldset>
  <fieldset><legend>Color</legend><div class="choice"><input type="radio" name="shared" id="two" value="black"><label for="two" class="choice-radio-on">Black</label></div><div class="choice"><input type="radio" name="shared" id="one" value="white"><label for="one" class="choice-radio-off">White</label></div></fieldset>
  <fieldset><legend>Level</legend><div class="choice"><input type="radio" name="shared" id="one" value="easy"><label for="one" class="choice-radio-off">Easy</label></div><div class="choice"><input type="radio" name="shared" id="two" value="medium" checked><label for="two" class="choice-radio-on">Medium</label></div></fieldset>
  <button id="start">Start</button><output id="outcome"></output>
  </div><script>
    const selections={Mode:'computer',Color:'black',Level:'medium'};
    document.querySelectorAll('label').forEach(label=>label.addEventListener('click',event=>{
      event.preventDefault();
      const input=label.previousElementSibling, group=label.closest('fieldset');
      input.checked=true;
      selections[group.querySelector('legend').textContent]=input.value;
      group.querySelectorAll('label').forEach(item=>item.className=item===label?'choice-radio-on':'choice-radio-off');
      document.querySelector('#outcome').dataset.trusted=String(event.isTrusted);
    }));
    document.querySelector('#start').onclick=()=>document.querySelector('#outcome').textContent=Object.values(selections).join(' / ');
  </script>`;

export const registerNonvisualChoiceCases = ({ page, observe, click, cases }: Context): void => {
  if (process.env.LYRA_LIVE_CHOICE_TEST === "1") cases.push(["public choice controls: Gomoku mode, color and level use production maps and clicks", async () => {
    await page.goto("https://wuziqi.bmcx.com/", { waitUntil: "domcontentloaded" });
    await page.getByText("人机对战（AI博弈）", { exact: true }).waitFor({ state: "visible" });
    const initial = await observe();
    console.log(JSON.stringify({ liveChoiceMap: initial.mapAppendix }));
    for (const name of ["人机对战（AI博弈）", "黑子", "中等"]) {
      const element = initial.elements.find(element => element.label === name && element.tagName === "label");
      assert(element, initial.mapAppendix);
      assert.equal(element.visibility?.covered, false);
      assert(element.semantics?.choice, initial.mapAppendix);
      await click(element.targetRef);
    }
    const selected = await observe();
    for (const name of ["人机对战（AI博弈）", "黑子", "中等"]) {
      const element = selected.elements.find(element => element.label === name && element.tagName === "label")!;
      assert(element.semantics?.choice?.evidence.some(evidence => evidence.source === "class" && evidence.value === true), selected.mapAppendix);
      assert(element.semantics?.context?.some(context => context.startsWith("fieldset:")), selected.mapAppendix);
    }
    assert(!selected.elements.some(element => element.tagName === "input" && element.semantics?.choice), selected.mapAppendix);
    console.log(JSON.stringify({ liveChoiceSelected: selected.elements.filter(element => element.semantics?.choice).map(element => ({ label: element.label, semantics: element.semantics })) }));
  }]);

  cases.push(["choice controls: duplicate IDs and overlapping radio groups expose evidence without retrying", async () => {
    await page.setContent(malformed());
    let map = await observe();
    assert.equal(map.elements.filter(element => element.semantics?.choice).length, 6, map.mapAppendix);
    assert(!map.elements.some(element => element.tagName === "input"), map.mapAppendix);
    assert(!map.warnings?.some(warning => /covered interactive/.test(warning)), map.mapAppendix);
    const refs = new Map(map.elements.map(element => [element.label, element.targetRef]));
    for (const name of ["Computer", "Black", "Medium"]) {
      const element = map.elements.find(element => element.label === name)!;
      assert(element, map.mapAppendix);
      assert(element.semantics?.context?.some(context => /fieldset: (Mode|Color|Level)/.test(context)), map.mapAppendix);
      assert(element.semantics?.choice?.issues.some(issue => issue.includes("spans displayed groups")), map.mapAppendix);
      await click(refs.get(name)!);
      map = await observe();
      assert.equal(map.elements.find(element => element.label === name)?.targetRef, refs.get(name));
    }
    const black = map.elements.find(element => element.label === "Black")!;
    assert.equal(black.semantics?.checked, "unknown");
    assert.equal(black.semantics?.choice?.nativeChecked, false);
    assert(black.semantics?.choice?.evidence.some(item => item.source === "class" && item.value === true));
    assert(map.mapAppendix?.includes("state-conflict"));
    await click(refs.get("Start")!);
    assert.equal(await page.locator("output").innerText(), "computer / black / medium");
    assert.equal(await page.locator("output").getAttribute("data-trusted"), "true");
  }]);

  cases.push(["choice controls: normal styled checkbox preserves checked, unchecked and mixed states", async () => {
    await page.setContent(`${style}<div class="choice"><input type="checkbox" id="notify"><label for="notify">Notifications</label></div>`);
    let map = await observe();
    const target = map.elements.find(element => element.label === "Notifications")!;
    assert.equal(target.semantics?.checked, false);
    await click(target.targetRef);
    map = await observe();
    assert.equal(map.elements.find(element => element.targetRef === target.targetRef)?.semantics?.checked, true);
    await click(target.targetRef);
    assert.equal((await observe()).elements.find(element => element.targetRef === target.targetRef)?.semantics?.checked, false);
    await page.locator("input").evaluate((input: HTMLInputElement) => { input.indeterminate = true; });
    assert.equal((await observe()).elements.find(element => element.targetRef === target.targetRef)?.semantics?.checked, "mixed");
  }]);

  cases.push(["choice controls: native names stay local even when duplicate inputs are directly operable", async () => {
    await page.setContent(malformed().replace(style, ""));
    const map = await observe();
    const names = map.elements.filter(element => element.tagName === "input").map(element => element.label);
    assert.deepEqual(names.sort(), ["Human", "Computer", "Black", "White", "Easy", "Medium"].sort(), map.mapAppendix);
  }]);

  cases.push(["choice controls: real overlay and disabled label remain blocked", async () => {
    await page.setContent(`${style}<div class="choice" style="width:300px"><input type="checkbox" id="notify" disabled><label for="notify">Notifications</label></div>`);
    let map = await observe();
    let element = map.elements.find(element => element.label === "Notifications")!;
    assert.equal(element.disabled, true);
    assert.equal((await page.evaluate(activateStampedSurfaceScript(element.targetRef, 0)) as { reason: string }).reason, "disabled");
    await page.locator("input").evaluate((input: HTMLInputElement) => { input.disabled = false; });
    await page.locator("body").evaluate(body => { const overlay = document.createElement("div"); overlay.style.cssText = "position:fixed;inset:0;z-index:999;background:white"; body.append(overlay); });
    map = await observe();
    element = map.elements.find(element => element.tagName === "label")!;
    assert.equal(element.visibility?.covered, true, map.mapAppendix);
    assert(map.elements.some(element => element.tagName === "input" && element.visibility?.covered));
    assert.equal((await page.evaluate(activateStampedSurfaceScript(element.targetRef, 0)) as { reason: string }).reason, "covered");
  }]);

  cases.push(["choice controls: form ownership and shadow roots isolate native groups", async () => {
    await page.setContent(`<form><fieldset><legend>One</legend><input type="radio" name="same" id="a"><label for="a">First</label></fieldset></form><form><fieldset><legend>Two</legend><input type="radio" name="same" id="b"><label for="b">Second</label></fieldset></form><div id="host"></div>`);
    await page.locator("#host").evaluate(host => { host.attachShadow({ mode: "open" }).innerHTML = '<fieldset><legend>Shadow</legend><input type="radio" name="same" id="a"><label for="a">Third</label></fieldset>'; });
    const map = await observe();
    for (const name of ["First", "Second", "Third"]) {
      const element = map.elements.find(element => element.label === name)!;
      assert(element, map.mapAppendix);
      assert.deepEqual(element.semantics?.choice?.issues, [], map.mapAppendix);
      assert.equal(element.semantics?.choice?.conflict, false);
    }
  }]);

  cases.push(["choice controls: conflicting ARIA and checked cannot become a confident off state", async () => {
    await page.setContent(`<label><input type="checkbox" aria-checked="true">Subscribe</label>`);
    const map = await observe();
    const element = map.elements.find(element => element.tagName === "input")!;
    assert.equal(element.checked, undefined);
    assert.equal(element.semantics?.checked, "unknown");
    assert.equal(element.semantics?.choice?.nativeChecked, false);
    assert(map.mapAppendix?.includes("state-conflict"), map.mapAppendix);
  }]);

  cases.push(["choice controls: generic active class is not checked evidence and DOM replacement updates bindings", async () => {
    await page.setContent(`${style}<div class="choice"><input type="radio" name="mode" id="mode"><label for="mode" class="active theme-on">Old</label></div>`);
    let map = await observe();
    const old = map.elements.find(element => element.label === "Old")!;
    assert.equal(old.semantics?.checked, false);
    assert.deepEqual(old.semantics?.choice?.evidence, []);
    await page.locator(".choice").evaluate(owner => { owner.innerHTML = '<input type="checkbox" id="new" checked><label for="new">New</label>'; });
    map = await observe();
    assert(!map.elements.some(element => element.targetRef === old.targetRef));
    assert.equal(map.elements.find(element => element.label === "New")?.semantics?.checked, true);
  }]);

  cases.push(["choice controls: hidden and nested independent state indicators are not borrowed", async () => {
    await page.setContent(`${style}<div class="choice"><input type="checkbox" id="notify"><label for="notify">Notifications<span hidden class="choice-checkbox-on"></span><span role="switch" aria-checked="true" class="choice-checkbox-on"></span></label></div>`);
    const map = await observe();
    const choice = map.elements.find(element => element.label === "Notifications" && element.tagName === "label")?.semantics;
    assert.equal(choice?.checked, false, map.mapAppendix);
    assert.deepEqual(choice?.choice?.evidence, []);
  }]);

  cases.push(["choice controls: changing label association during the gesture cannot activate another input", async () => {
    await page.setContent(`${style}<div class="choice"><input type="checkbox" id="original"><label for="original" onclick="this.htmlFor='other'">Notifications</label></div><input type="checkbox" id="other">`);
    const map = await observe();
    const element = map.elements.find(element => element.label === "Notifications" && element.tagName === "label")!;
    await assert.rejects(click(element.targetRef), /targetNotActionable/);
    assert.equal(await page.locator("#other").isChecked(), false);
    assert.equal(await page.locator("#original").isChecked(), false);
  }]);

  cases.push(["choice controls: label forwarding survives shadow boundary guards", async () => {
    await page.setContent('<div id="host"></div>');
    await page.locator("#host").evaluate((host, style) => {
      host.attachShadow({ mode: "open" }).innerHTML = `${style}<div class="choice"><input type="checkbox" id="notify"><label for="notify">Notifications</label></div>`;
    }, style);
    const map = await observe();
    const element = map.elements.find(element => element.label === "Notifications")!;
    await click(element.targetRef);
    assert.equal(await page.locator("input").isChecked(), true);
    await click(element.targetRef);
    assert.equal(await page.locator("input").isChecked(), false);
  }]);
};
