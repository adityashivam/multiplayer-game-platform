function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function normalizeInputSeq(seq) {
  return Number.isFinite(seq) ? Math.max(0, Math.floor(seq)) : null;
}

export function ensurePlayerInputState(player, inputTemplate = {}) {
  if (!player || typeof player !== "object") return;
  if (!isPlainObject(player.input)) {
    player.input = { ...inputTemplate };
  }
  if (!Number.isFinite(player.lastInputSeqAck)) {
    player.lastInputSeqAck = 0;
  }
}

export function applySequencedInput({
  player,
  payload,
  inputTemplate = {},
  applyInputState,
  applyDiscreteInput,
}) {
  if (!player || typeof player !== "object") return false;
  ensurePlayerInputState(player, inputTemplate);

  const type = payload?.type;
  const seq = normalizeInputSeq(payload?.seq);
  if (seq != null) {
    player.lastInputSeqAck = Math.max(player.lastInputSeqAck || 0, seq);
  }

  if (type === "inputFrame") {
    const inputState = payload?.state;
    if (!isPlainObject(inputState)) return true;

    if (typeof applyInputState === "function") {
      applyInputState(player, inputState);
      return true;
    }

    for (const key of Object.keys(inputTemplate)) {
      player.input[key] = Boolean(inputState[key]);
    }
    return true;
  }

  const value = Boolean(payload?.value);
  if (typeof applyDiscreteInput === "function") {
    return Boolean(applyDiscreteInput(player, type, value));
  }

  if (typeof type === "string" && Object.prototype.hasOwnProperty.call(player.input, type)) {
    player.input[type] = value;
    return true;
  }

  return false;
}
