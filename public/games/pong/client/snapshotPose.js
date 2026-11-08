/** @typedef {{players:{p1:{y:number,inputEpoch?:number},p2:{y:number,inputEpoch?:number}},ball:{x:number,y:number,serveId:number}}} PongPoseSnapshot */

/** @param {PongPoseSnapshot} snapshot @returns {{p1y:number,p2y:number,ballx:number,bally:number,serveId:number}} */
export function extractPongPositions(snapshot) {
  return {
    p1y: snapshot.players.p1.y, p2y: snapshot.players.p2.y,
    ballx: snapshot.ball.x, bally: snapshot.ball.y, serveId: snapshot.ball.serveId,
  };
}

/**
 * A new serve teleports the ball to center. Paddle resets remain independent
 * from a rally reset and follow their authoritative input ownership identity.
 * @param {PongPoseSnapshot} snapshot
 * @returns {{p1y:number,p2y:number,ballx:string,bally:string,serveId:string}}
 */
export function extractPongContinuityKeys(snapshot) {
  const serveIdentity = `${snapshot.players.p1.inputEpoch}:${snapshot.ball.serveId}`;
  return {
    p1y: snapshot.players.p1.inputEpoch, p2y: snapshot.players.p2.inputEpoch,
    ballx: serveIdentity, bally: serveIdentity, serveId: serveIdentity,
  };
}
