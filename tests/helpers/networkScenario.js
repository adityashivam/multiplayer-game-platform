/**
 * @typedef {{startMs: number, durationMs: number}} NetworkDeliveryStall
 */

/**
 * Model one ordered transport direction on a caller-owned deterministic clock.
 * Jitter varies one-way delivery time; ordering turns lower-latency packets into
 * bursts behind earlier packets. Stalls hold deliveries in their time window.
 * Payloads are retained by reference. No packets are discarded or reordered.
 * @template Payload
 * @param {object} options
 * @param {number} options.oneWayDelayMs Half of RTT for a symmetric scenario.
 * @param {number} [options.jitterMs=0] Maximum deterministic one-way variation.
 * @param {NetworkDeliveryStall[]} [options.stalls=[]]
 */
export function createOrderedNetworkChannel({ oneWayDelayMs, jitterMs = 0, stalls = [] }) {
  /** @type {{deliveryAtMs: number, payload: Payload}[]} */
  const pendingPackets = [];
  let lastDeliveryAtMs = -Infinity;
  let packetNumber = 0;

  return {
    /** @param {Payload} payload @param {number} sentAtMs */
    send(payload, sentAtMs) {
      const variationMs = Math.sin(++packetNumber * 1.7) * jitterMs;
      let deliveryAtMs = sentAtMs + Math.max(0, oneWayDelayMs + variationMs);
      for (const deliveryStall of stalls) {
        const stallEndMs = deliveryStall.startMs + deliveryStall.durationMs;
        if (deliveryAtMs >= deliveryStall.startMs && deliveryAtMs < stallEndMs) {
          deliveryAtMs = stallEndMs;
        }
      }
      deliveryAtMs = Math.max(lastDeliveryAtMs, deliveryAtMs);
      lastDeliveryAtMs = deliveryAtMs;
      pendingPackets.push({ deliveryAtMs, payload });
    },
    /** @param {number} nowMs @returns {Payload[]} Packets due in original send order. */
    receive(nowMs) {
      const deliveredPackets = [];
      while (pendingPackets.length && pendingPackets[0].deliveryAtMs <= nowMs) {
        deliveredPackets.push(pendingPackets.shift().payload);
      }
      return deliveredPackets;
    },
    getPendingCount: () => pendingPackets.length,
    clear() {
      pendingPackets.length = 0;
      lastDeliveryAtMs = -Infinity;
      packetNumber = 0;
    },
  };
}
