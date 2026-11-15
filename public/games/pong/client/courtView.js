/**
 * Lay Pong's court out for the shape of the screen it is drawn on. The
 * authoritative arena is always horizontal (paddles at the left and right
 * ends); on a portrait screen the view turns it upright so the viewer's own
 * paddle sits at the bottom, the way a phone held upright plays best.
 * Only drawing and input directions change: positions sent to and received
 * from the server stay in arena coordinates.
 */

/** @typedef {"p1"|"p2"|null} PongViewerId */
/** @typedef {"up"|"down"|"left"|"right"} PongScreenDirection */

/**
 * @typedef {object} PongCourtView
 * @property {boolean} portrait Whether the court is drawn upright.
 * @property {number} width View width in arena units.
 * @property {number} height View height in arena units.
 * @property {(x:number, y:number, viewerId:PongViewerId, target?:{x:number,y:number}) => {x:number,y:number}} toView
 *   Map an arena point into the view. Writes into `target` when given, so the render loop allocates nothing.
 * @property {(direction:PongScreenDirection|null, viewerId:PongViewerId) => "up"|"down"|null} readPaddleDirection
 *   The arena direction ("up" is toward y = 0) that a screen direction moves the viewer's paddle.
 * @property {(viewerId:PongViewerId) => "p1"|"p2"} readBottomPlayer Whose paddle is nearest the bottom.
 * @property {(playerId:"p1"|"p2", viewerId:PongViewerId) => "Left"|"Right"|"Top"|"Bottom"} readEndLabel
 *   Where a player's end is on this screen, for messages such as "Left missed".
 */

/**
 * @param {{portrait:boolean, arenaWidth:number, arenaHeight:number}} options
 * @returns {PongCourtView}
 */
export function createPongCourtView({ portrait, arenaWidth, arenaHeight }) {
  const readBottomPlayer = (viewerId) => (viewerId === "p2" ? "p2" : "p1");

  /**
   * Upright, p1 (left end) is turned to the bottom: arena up becomes screen
   * left. For p2 (right end) the turn is the other way, so arena up becomes
   * screen right. Both are rotations, never mirror images.
   */
  function toView(x, y, viewerId, target = { x: 0, y: 0 }) {
    if (!portrait) {
      target.x = x;
      target.y = y;
    } else if (readBottomPlayer(viewerId) === "p2") {
      target.x = arenaHeight - y;
      target.y = x;
    } else {
      target.x = y;
      target.y = arenaWidth - x;
    }
    return target;
  }

  function readPaddleDirection(direction, viewerId) {
    if (!portrait) {
      // A horizontal court has always read left as up and right as down.
      if (direction === "up" || direction === "left") return "up";
      if (direction === "down" || direction === "right") return "down";
      return null;
    }
    const p2Bottom = readBottomPlayer(viewerId) === "p2";
    if (direction === "left") return p2Bottom ? "down" : "up";
    if (direction === "right") return p2Bottom ? "up" : "down";
    // After the device turns back to landscape the stick reads up and down,
    // which still move the paddle along the arena.
    if (direction === "up" || direction === "down") return direction;
    return null;
  }

  function readEndLabel(playerId, viewerId) {
    if (!portrait) return playerId === "p1" ? "Left" : "Right";
    return playerId === readBottomPlayer(viewerId) ? "Bottom" : "Top";
  }

  return {
    portrait,
    width: portrait ? arenaHeight : arenaWidth,
    height: portrait ? arenaWidth : arenaHeight,
    toView,
    readPaddleDirection,
    readBottomPlayer,
    readEndLabel,
  };
}

/**
 * Whether a host is tall enough that an upright court uses it better.
 * @param {{width:number,height:number}|null|undefined} hostBounds
 * @returns {boolean}
 */
export function isPortraitPongHost(hostBounds) {
  return Boolean(hostBounds && hostBounds.width > 0 && hostBounds.height > hostBounds.width * 1.1);
}
