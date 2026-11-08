import http from "node:http";
import https from "node:https";
import { WebSocket, WebSocketServer } from "ws";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_QUEUED_BYTES = 8 * 1024 * 1024;
const MAX_QUEUED_FRAMES = 8192;
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
const MAX_CONNECTIONS = 64;
const HANDSHAKE_TIMEOUT_MS = 10000;
const JITTER_PATTERN = Object.freeze([0, 0.75, -0.5, 0.5, -1, 1, -0.75, 0.25]);
const GENERATED_WEBSOCKET_HEADERS = new Set([
  "connection", "upgrade", "sec-websocket-key", "sec-websocket-version",
  "sec-websocket-extensions", "sec-websocket-protocol",
]);

/**
 * @typedef {object} DelayedWebSocketFrame
 * @property {Buffer} payload
 * @property {boolean} binary
 * @property {number} receivedAtMs
 * @property {number} deliveryAtMs
 */

/**
 * @typedef {object} LatencyProxyStats
 * @property {number} roundTripMs
 * @property {number} jitterMs
 * @property {number} stallEveryMs
 * @property {number} stallDurationMs
 * @property {number} connectionsOpened
 * @property {number} activeConnections
 * @property {number} framesReceived
 * @property {number} framesForwarded
 * @property {number} clientToServerFrames
 * @property {number} serverToClientFrames
 * @property {number} framesDelayed
 * @property {number} queuedFrames
 * @property {number} queuedBytes
 * @property {number} maxQueueFrames
 * @property {number} maxQueueBytes
 * @property {number} bursts
 * @property {number} largestBurstFrames
 * @property {number|null} minimumDelayMs
 * @property {number} maximumDelayMs
 * @property {number} averageDelayMs
 * @property {number} totalDelayMs
 * @property {number} overflowClosures
 * @property {number} upstreamErrors
 */

/**
 * Forward HTTP without throttling and impair actual WebSocket application frames
 * in both directions. The handshake, HTTP and WebSocket ping/pong control frames
 * are unthrottled; Engine.IO's application-level ping/pong packets are delayed.
 * Jitter is deterministic and delivery remains ordered. Periodic stalls release
 * queued frames together, reproducing TCP/WebSocket head-of-line bursts.
 *
 * Binds an ephemeral loopback port and owns every forwarding socket/timer. The
 * caller must await close(), including after browser assertion failures.
 * @param {object} options
 * @param {string} options.targetUrl Upstream HTTP(S) origin; incoming paths/queries are preserved.
 * @param {number} options.roundTripMs Total symmetric application-frame delay.
 * @param {number} [options.jitterMs=0] Deterministic variation of each one-way delay.
 * @param {number} [options.stallEveryMs=0] Zero disables periodic stalls.
 * @param {number} [options.stallDurationMs=0] Duration of each periodic stall.
 * @returns {Promise<{url:string,getStats:()=>LatencyProxyStats,close:()=>Promise<void>}>}
 * @throws {TypeError} For invalid origins, negative timing or overlapping stall windows.
 */
export async function createLatencyProxy({
  targetUrl,
  roundTripMs,
  jitterMs = 0,
  stallEveryMs = 0,
  stallDurationMs = 0,
}) {
  const targetOrigin = new URL(targetUrl);
  if (!["http:", "https:"].includes(targetOrigin.protocol)) {
    throw new TypeError("Latency proxy targetUrl must use HTTP or HTTPS.");
  }
  for (const [settingName, timingMs] of Object.entries({ roundTripMs, jitterMs, stallEveryMs, stallDurationMs })) {
    if (!Number.isFinite(timingMs) || timingMs < 0 || timingMs > 60000) {
      throw new TypeError(`Latency proxy ${settingName} must be between 0 and 60000 ms.`);
    }
  }
  if (stallDurationMs > 0 && (stallEveryMs === 0 || stallDurationMs >= stallEveryMs)) {
    throw new TypeError("Latency proxy stalls require a positive interval longer than their duration.");
  }

  const secureTarget = targetOrigin.protocol === "https:";
  const httpTransport = secureTarget ? https : http;
  const upstreamAgent = new httpTransport.Agent({ keepAlive: false });
  const negotiatedProtocols = new WeakMap();
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
    handleProtocols: (_protocols, request) => negotiatedProtocols.get(request) || false,
  });
  const proxyStartedAtMs = performance.now();
  const incomingSockets = new Set();
  const upstreamRequests = new Set();
  const bridges = new Set();
  const networkStats = {
    connectionsOpened: 0,
    framesReceived: 0,
    framesForwarded: 0,
    clientToServerFrames: 0,
    serverToClientFrames: 0,
    framesDelayed: 0,
    queuedFrames: 0,
    queuedBytes: 0,
    maxQueueFrames: 0,
    maxQueueBytes: 0,
    bursts: 0,
    largestBurstFrames: 0,
    minimumDelayMs: null,
    maximumDelayMs: 0,
    totalDelayMs: 0,
    overflowClosures: 0,
    upstreamErrors: 0,
  };
  let closing = false;
  let closePromise = null;

  const proxyServer = http.createServer((request, response) => {
    if (closing) {
      response.writeHead(503);
      response.end();
      return;
    }
    const upstreamRequest = httpTransport.request({
      hostname: targetOrigin.hostname,
      port: targetOrigin.port || undefined,
      method: request.method,
      path: request.url,
      headers: request.headers,
      agent: upstreamAgent,
    }, (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, upstreamResponse.headers);
      upstreamResponse.on("error", () => response.destroy());
      upstreamResponse.pipe(response);
    });
    upstreamRequests.add(upstreamRequest);
    upstreamRequest.once("close", () => upstreamRequests.delete(upstreamRequest));
    upstreamRequest.on("error", () => {
      networkStats.upstreamErrors += 1;
      if (!response.headersSent) {
        response.writeHead(502, { "content-type": "text/plain" });
        response.end("Latency proxy could not reach the upstream server.");
      } else {
        response.destroy();
      }
    });
    request.once("aborted", () => upstreamRequest.destroy());
    response.once("close", () => {
      if (!response.writableEnded) upstreamRequest.destroy();
    });
    request.pipe(upstreamRequest);
  });
  proxyServer.on("connection", (incomingSocket) => {
    incomingSockets.add(incomingSocket);
    incomingSocket.once("close", () => incomingSockets.delete(incomingSocket));
  });

  /** @param {number} deliveryAtMs */
  function deferThroughStall(deliveryAtMs) {
    if (!stallEveryMs || !stallDurationMs) return deliveryAtMs;
    const elapsedMs = deliveryAtMs - proxyStartedAtMs;
    const stallIndex = Math.floor(elapsedMs / stallEveryMs);
    if (stallIndex > 0 && elapsedMs % stallEveryMs < stallDurationMs) {
      return proxyStartedAtMs + stallIndex * stallEveryMs + stallDurationMs;
    }
    return deliveryAtMs;
  }

  proxyServer.on("upgrade", (request, incomingSocket, upgradeHead) => {
    if (closing || bridges.size >= MAX_CONNECTIONS) {
      incomingSocket.destroy();
      return;
    }
    const requestPath = request.url || "/";
    if (!requestPath.startsWith("/") || requestPath.startsWith("//")) {
      incomingSocket.destroy();
      return;
    }
    const upstreamUrl = new URL(requestPath, targetOrigin.origin);
    upstreamUrl.protocol = secureTarget ? "wss:" : "ws:";
    const upstreamHeaders = Object.fromEntries(Object.entries(request.headers)
      .filter(([headerName]) => !GENERATED_WEBSOCKET_HEADERS.has(headerName)));
    const protocols = (request.headers["sec-websocket-protocol"] || "")
      .split(",").map((protocol) => protocol.trim()).filter(Boolean);
    const upstreamSocket = new WebSocket(upstreamUrl, protocols, {
      headers: upstreamHeaders,
      handshakeTimeout: HANDSHAKE_TIMEOUT_MS,
      maxPayload: MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    let clientSocket = null;
    let bridgeClosed = false;
    const lanes = [];
    const bridge = { close: closeBridge };
    bridges.add(bridge);

    function closeBridge() {
      if (bridgeClosed) return;
      bridgeClosed = true;
      for (const lane of lanes) lane.clear();
      bridges.delete(bridge);
      clientSocket?.terminate();
      upstreamSocket.terminate();
      incomingSocket.destroy();
    }

    /** @param {"clientToServer"|"serverToClient"} direction @param {() => WebSocket|null} getDestination */
    function createDeliveryLane(direction, getDestination) {
      /** @type {DelayedWebSocketFrame[]} */
      const queue = [];
      let deliveryTimer = null;
      let frameSequence = 0;
      let lastDeliveryAtMs = 0;

      function removeNextFrame() {
        const frame = queue.shift();
        networkStats.queuedFrames -= 1;
        networkStats.queuedBytes -= frame.payload.length;
        return frame;
      }

      function flushDueFrames() {
        deliveryTimer = null;
        if (bridgeClosed || closing || !queue.length) return;
        const destination = getDestination();
        if (!destination || destination.readyState !== WebSocket.OPEN) return;
        const nowMs = performance.now();
        let forwardedCount = 0;
        while (queue.length && queue[0].deliveryAtMs <= nowMs) {
          if (destination.bufferedAmount + queue[0].payload.length > MAX_QUEUED_BYTES) {
            networkStats.overflowClosures += 1;
            closeBridge();
            return;
          }
          const frame = removeNextFrame();
          const delayMs = nowMs - frame.receivedAtMs;
          networkStats.framesForwarded += 1;
          networkStats[`${direction}Frames`] += 1;
          networkStats.framesDelayed += delayMs >= 1 ? 1 : 0;
          networkStats.minimumDelayMs = Math.min(networkStats.minimumDelayMs ?? Infinity, delayMs);
          networkStats.maximumDelayMs = Math.max(networkStats.maximumDelayMs, delayMs);
          networkStats.totalDelayMs += delayMs;
          destination.send(frame.payload, { binary: frame.binary }, (sendError) => {
            if (sendError) closeBridge();
          });
          forwardedCount += 1;
        }
        if (forwardedCount > 1) networkStats.bursts += 1;
        networkStats.largestBurstFrames = Math.max(networkStats.largestBurstFrames, forwardedCount);
        scheduleDelivery();
      }

      function scheduleDelivery() {
        if (deliveryTimer !== null || !queue.length || bridgeClosed || closing) return;
        deliveryTimer = setTimeout(flushDueFrames, Math.max(0, Math.ceil(queue[0].deliveryAtMs - performance.now())));
      }

      return {
        /** @param {Buffer|ArrayBuffer|Buffer[]} payload @param {boolean} binary */
        enqueue(payload, binary) {
          if (bridgeClosed || closing) return;
          const ownedPayload = Array.isArray(payload) ? Buffer.concat(payload) : Buffer.from(payload);
          if (networkStats.queuedBytes + ownedPayload.length > MAX_QUEUED_BYTES ||
              networkStats.queuedFrames >= MAX_QUEUED_FRAMES) {
            networkStats.overflowClosures += 1;
            closeBridge();
            return;
          }
          const receivedAtMs = performance.now();
          const jitterScale = JITTER_PATTERN[frameSequence++ % JITTER_PATTERN.length];
          const proposedDeliveryAtMs = receivedAtMs + Math.max(0, roundTripMs / 2 + jitterScale * jitterMs);
          lastDeliveryAtMs = Math.max(lastDeliveryAtMs, deferThroughStall(proposedDeliveryAtMs));
          queue.push({ payload: ownedPayload, binary, receivedAtMs, deliveryAtMs: lastDeliveryAtMs });
          networkStats.framesReceived += 1;
          networkStats.queuedFrames += 1;
          networkStats.queuedBytes += ownedPayload.length;
          networkStats.maxQueueFrames = Math.max(networkStats.maxQueueFrames, networkStats.queuedFrames);
          networkStats.maxQueueBytes = Math.max(networkStats.maxQueueBytes, networkStats.queuedBytes);
          scheduleDelivery();
        },
        wake: scheduleDelivery,
        clear() {
          if (deliveryTimer !== null) clearTimeout(deliveryTimer);
          deliveryTimer = null;
          while (queue.length) removeNextFrame();
        },
      };
    }

    const clientToServer = createDeliveryLane("clientToServer", () => upstreamSocket);
    const serverToClient = createDeliveryLane("serverToClient", () => clientSocket);
    lanes.push(clientToServer, serverToClient);
    upstreamSocket.on("message", (payload, binary) => serverToClient.enqueue(payload, binary));
    upstreamSocket.on("error", () => {
      networkStats.upstreamErrors += 1;
      closeBridge();
    });
    upstreamSocket.once("close", closeBridge);
    incomingSocket.once("close", closeBridge);
    upstreamSocket.once("open", () => {
      if (bridgeClosed || closing || incomingSocket.destroyed) {
        closeBridge();
        return;
      }
      negotiatedProtocols.set(request, upstreamSocket.protocol);
      webSocketServer.handleUpgrade(request, incomingSocket, upgradeHead, (acceptedSocket) => {
        clientSocket = acceptedSocket;
        networkStats.connectionsOpened += 1;
        clientSocket.on("message", (payload, binary) => clientToServer.enqueue(payload, binary));
        clientSocket.on("error", closeBridge);
        clientSocket.once("close", closeBridge);
        serverToClient.wake();
      });
    });
  });

  try {
    await new Promise((resolve, reject) => {
      proxyServer.once("error", reject);
      proxyServer.listen(0, LOOPBACK_HOST, () => {
        proxyServer.off("error", reject);
        resolve();
      });
    });
  } catch (listenError) {
    upstreamAgent.destroy();
    webSocketServer.close();
    throw listenError;
  }
  const address = proxyServer.address();

  return {
    url: `http://${LOOPBACK_HOST}:${address.port}`,
    getStats() {
      return {
        roundTripMs, jitterMs, stallEveryMs, stallDurationMs,
        ...networkStats,
        activeConnections: bridges.size,
        averageDelayMs: networkStats.framesForwarded ? networkStats.totalDelayMs / networkStats.framesForwarded : 0,
      };
    },
    close() {
      if (closePromise) return closePromise;
      closing = true;
      for (const bridge of [...bridges]) bridge.close();
      for (const request of upstreamRequests) request.destroy();
      for (const incomingSocket of incomingSockets) incomingSocket.destroy();
      upstreamAgent.destroy();
      closePromise = Promise.all([
        new Promise((resolve) => proxyServer.close(resolve)),
        new Promise((resolve) => webSocketServer.close(resolve)),
      ]).then(() => {});
      return closePromise;
    },
  };
}
