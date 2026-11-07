import test from "node:test";
import assert from "node:assert/strict";
import { readGameLibraryDetails } from "../public/platform/src/platform-ui/services/gamePresentation.js";

test("library reads a custom game's cover and three-player capabilities without an identity lookup", () => {
  const game = {
    id: "orbital-relay",
    tags: ["Strategy", "Realtime"],
    room: { playerIds: ["pilot", "navigator", "engineer"] },
    presentation: {
      coverUrl: "/games/orbital-relay/assets/cover.svg",
      accentColor: "#AABBCC",
      controls: ["keyboard", "pointer"],
    },
  };
  const details = readGameLibraryDetails(game);

  assert.equal(details.coverUrl, "/games/orbital-relay/assets/cover.svg");
  assert.equal(details.accentColor, "#AABBCC");
  assert.equal(details.genreLabel, "Strategy");
  assert.equal(details.playerLabel, "3 players");
  assert.deepEqual(details.controlLabels, ["Keyboard", "Mouse / pen"]);
});

test("library has useful defaults without inventing controls or player counts", () => {
  const details = readGameLibraryDetails({ id: "new-package" });

  assert.equal(details.coverUrl, null);
  assert.equal(details.accentColor, "#00daf3");
  assert.equal(details.genreLabel, "Game");
  assert.equal(details.playerLabel, "Multiplayer");
  assert.deepEqual(details.controlLabels, []);
});

test("library supports older catalog tags and solo game capabilities", () => {
  assert.equal(readGameLibraryDetails({ tags: ["2 players", "Racing"] }).playerLabel, "2 players");
  const soloDetails = readGameLibraryDetails({ networked: false, tags: ["Arcade"] });
  assert.equal(soloDetails.playerLabel, "Single player");
  assert.equal(soloDetails.genreLabel, "Arcade");
});

test("explicit room capacity takes precedence over connectivity and older single-player tags", () => {
  const room = { playerIds: ["pilot", "navigator", "engineer"] };

  assert.equal(readGameLibraryDetails({ networked: false, room }).playerLabel, "3 players");
  assert.equal(readGameLibraryDetails({ room, tags: ["Single Player"] }).playerLabel, "3 players");
});

test("library ignores control values that only coerce to supported keys", () => {
  const details = readGameLibraryDetails({ presentation: { controls: [["keyboard"], "touch"] } });

  assert.deepEqual(details.controlLabels, ["Touch"]);
});

test("malformed optional presentation cannot inject styles or unsafe artwork URLs", () => {
  const details = readGameLibraryDetails({
    presentation: {
      coverUrl: "javascript:alert(1)",
      accentColor: "red; background: url(https://example.com)",
      controls: ["keyboard", "unsupported", "keyboard"],
    },
  });

  assert.equal(details.coverUrl, null);
  assert.equal(details.accentColor, "#00daf3");
  assert.deepEqual(details.controlLabels, ["Keyboard"]);
});
