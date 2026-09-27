import { expect, test, vi } from "vitest";
import { createOpaqueSensitiveValueRef } from "../../../shared/sensitive-value";
import { createBrowserSensitiveBoundary } from "../browser-boundary";

const secret = 'glpat-' + 'RegressionCredentialOnly'.repeat(8);
const ref = createOpaqueSensitiveValueRef({ id: 'test-reference', owner: 'external', valueKind: 'token',
  label: 'Browser credential', displayHint: 'Hidden', ownerName: 'browser', capabilities: ['use', 'fill'] });

test('captures the complete field before truncated snippets reach the map and reuses the reference', async () => {
  const store = vi.fn(async () => ({ ref }));
  const boundary = createBrowserSensitiveBoundary(store);
  const raw = { elements: [{ sensitiveValue: {value: secret}, textSnippet: secret.slice(0, 80) }], content: secret };
  const safe = await boundary.sanitize(raw);
  expect(store).toHaveBeenCalledWith(expect.objectContaining({value:secret}));
  expect(JSON.stringify(safe)).not.toContain(secret.slice(0, 20));
  expect(safe.elements[0]).not.toHaveProperty('sensitiveValue');
  expect(boundary.references(safe)).toEqual([ref]);
  await boundary.sanitize(raw);
  expect(store).toHaveBeenCalledTimes(1);
});

test('fails closed without claiming secure storage succeeded', async () => {
  const store = vi.fn(async () => {throw Error('storage unavailable');});
  const boundary = createBrowserSensitiveBoundary(store);
  const safe = await boundary.sanitize({ text: secret });
  expect(safe.text).toContain('secure storage unavailable');
  expect(safe.text).not.toContain(secret);
  expect(boundary.references(safe)).toEqual([]);
});

test('short passwords hide the field without corrupting control names or identities', async () => {
  const boundary = createBrowserSensitiveBoundary(async () => ({ref}));
  const safe = await boundary.sanitize({elements:[{label:'Password', sensitiveValue:{value:'a',valueKind:'password'},textSnippet:'a'}], action:'Save', url:'https://example.test'});
  expect(safe.elements[0]!.textSnippet).toContain('[sensitive:');
  expect(safe.action).toBe('Save');
  expect(safe.url).toBe('https://example.test');
});

test('overlapping known values hide the complete credential in later echoes', async () => {
  const boundary = createBrowserSensitiveBoundary(async () => ({ref}));
  boundary.remember(ref, 'fixture-password');
  boundary.remember(ref, 'fixture-password-longer-secret');
  const safe = await boundary.sanitize({text:'Value: fixture-password-longer-secret'});
  expect(safe.text).toBe(`Value: [sensitive:${ref.id}]`);
});

test('does not capture a credential-name field, ordinary content or a truncated token', async () => {
  const store = vi.fn(async () => ({ref}));
  const boundary = createBrowserSensitiveBoundary(store);
  expect(await boundary.sanitize({text:'Create a token called clone-temp-0927'})).toEqual({text:'Create a token called clone-temp-0927'});
  const safe = await boundary.sanitize({text:secret.slice(0,60)+'…'});
  expect(safe.text).toContain('truncated source');
  expect(store).not.toHaveBeenCalled();
});
