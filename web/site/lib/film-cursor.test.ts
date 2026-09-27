import assert from "node:assert/strict";
import { test } from "node:test";
import { isFilmCursorMessage } from "./film-cursor";
test("film cursor accepts only finite normalized pointer coordinates or an explicit exit", () => {
  assert.ok(isFilmCursorMessage({ type: "lyra-film-cursor", active: true, x: .5, y: 1 }));
  assert.ok(isFilmCursorMessage({ type: "lyra-film-cursor", active: false }));
  for (const value of [null, {}, {type: "lyra-film-tick", active: false},
    {type: "lyra-film-cursor", active: true, x: NaN, y: .5},
    {type: "lyra-film-cursor", active: true, x: .5, y: 2},
    {type: "lyra-film-cursor", active: "true", x: .5, y: .5}]) assert.equal(isFilmCursorMessage(value), false);
});
