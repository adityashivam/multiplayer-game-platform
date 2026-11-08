import { useCallback, useEffect, useRef, useState } from "react";

/** @typedef {import("../../../shared/voiceProtocol.js").VoiceChatState} VoiceChatState */
/** @typedef {ReturnType<typeof import("../../../frontend-engine/voiceChatSession.js").createVoiceChatSession>} VoiceChatSession */
/** @typedef {{id?:string,namespace?:string,networked?:boolean,networking?:{namespace?:string}}} VoiceGameMetadata */
/** @typedef {Pick<import("../../../frontend-engine/roomLifecycleClient.js").RoomLifecyclePresentation,"joined"|"roomId">} VoiceRoomLifecycle */
/** @typedef {{roomKey:string|null,state:VoiceChatState,ready:boolean,loading:boolean,unavailableReason:string}} VoiceSessionPresentation */
/** @typedef {"applied"|"failed"|"cancelled"} VoiceActionOutcome */
/** @typedef {"join"|"microphone"|"playback"} VoiceActionKind */
/**
 * @typedef {object} VoiceActionContext
 * @property {VoiceChatSession} voiceSession
 * @property {VoiceActionKind} kind
 * @property {number} participationGeneration
 * @property {number} sequenceNumber
 */
/**
 * @typedef {object} RoomVoiceController
 * @property {VoiceChatState} state
 * @property {boolean} available
 * @property {boolean} loading
 * @property {string} unavailableReason
 * @property {(options?:{listenOnly?:boolean}) => Promise<VoiceActionOutcome>} join
 * @property {(muted:boolean) => Promise<VoiceActionOutcome>} setMicrophoneMuted
 * @property {(deafened:boolean) => void} setDeafened
 * @property {(volume:number) => void} setVolume
 * @property {() => Promise<VoiceActionOutcome>} resumePlayback
 * @property {() => void} leave
 */

/** @type {VoiceChatState} */
const INITIAL_VOICE_STATE = Object.freeze({
  status: "off",
  microphoneMuted: true,
  deafened: false,
  volume: 1,
  participants: Object.freeze([]),
  playbackBlocked: false,
  errorCode: null,
  errorMessage: "",
  noiseSuppression: null,
  echoCancellation: null,
  autoGainControl: null,
});

/**
 * Own room voice without owning the game's socket or requesting a microphone on mount.
 * Only authoritative room membership controls session lifetime, so round/countdown
 * updates retain voice. Disconnects require a fresh, explicit voice join.
 * @param {{game:VoiceGameMetadata|null,roomLifecycle:VoiceRoomLifecycle|null,enabled?:boolean}} options
 * @returns {RoomVoiceController} Action outcomes describe the attempted operation,
 * independently of older peer errors. Cancelled sessions cannot surface stale feedback.
 */
export default function useVoiceChat({ game, roomLifecycle, enabled = true }) {
  /** @type {import("react").MutableRefObject<{roomKey:string,session:VoiceChatSession}|null>} */
  const activeVoiceSessionRef = useRef(null);
  const voiceParticipationGenerationRef = useRef(0);
  const voiceActionSequencesRef = useRef({ join: 0, microphone: 0, playback: 0 });
  const [voicePresentation, setVoicePresentation] = useState(
    /** @type {VoiceSessionPresentation} */ ({
      roomKey: null,
      state: INITIAL_VOICE_STATE,
      ready: false,
      loading: false,
      unavailableReason: "Join a multiplayer room to use voice chat.",
    }),
  );
  const namespaceValue = game?.networking?.namespace || game?.namespace || game?.id;
  const namespace = typeof namespaceValue === "string" ? namespaceValue.trim() : "";
  const joinedRoomId = roomLifecycle?.joined && typeof roomLifecycle.roomId === "string"
    ? roomLifecycle.roomId.trim() : "";
  const roomKey = enabled && game?.networked !== false && namespace && joinedRoomId
    ? `${namespace}\u0000${joinedRoomId}` : null;

  useEffect(() => {
    if (!roomKey) return undefined;

    let cancelled = false;
    let connectionClosed = false;
    let voiceSession = null;
    let unsubscribeDisconnect = null;

    setVoicePresentation({
      roomKey,
      state: INITIAL_VOICE_STATE,
      ready: false,
      loading: true,
      unavailableReason: "Preparing voice chat…",
    });

    /** @returns {Promise<void>} */
    async function prepareRoomVoice() {
      try {
        const [voiceModule, socketModule] = await Promise.all([
          import(/* @vite-ignore */ "/platform/frontend-engine/voiceChatSession.js"),
          import(/* @vite-ignore */ "/platform/frontend-engine/gameSocket.js"),
        ]);
        if (cancelled) return;

        // Room membership is published by this existing game socket. Never destroy it here.
        const gameSocket = socketModule.getGameSocket(namespace);
        if (!gameSocket.isConnected()) {
          setVoicePresentation({
            roomKey,
            state: INITIAL_VOICE_STATE,
            ready: false,
            loading: false,
            unavailableReason: "Reconnect to the room before joining voice.",
          });
          return;
        }

        voiceSession = voiceModule.createVoiceChatSession({
          transport: gameSocket,
          onStateChange: (voiceState) => {
            if (cancelled || connectionClosed) return;
            setVoicePresentation({ roomKey, state: voiceState, ready: true, loading: false, unavailableReason: "" });
          },
        });
        activeVoiceSessionRef.current = { roomKey, session: voiceSession };
        setVoicePresentation({ roomKey, state: voiceSession.getState(), ready: true, loading: false, unavailableReason: "" });
        unsubscribeDisconnect = gameSocket.onEvent("disconnect", () => {
          connectionClosed = true;
          if (activeVoiceSessionRef.current?.session === voiceSession) activeVoiceSessionRef.current = null;
          voiceSession.dispose();
          setVoicePresentation({
            roomKey,
            state: INITIAL_VOICE_STATE,
            ready: false,
            loading: false,
            unavailableReason: "Reconnect to the room before joining voice again.",
          });
        });
      } catch {
        if (cancelled) return;
        setVoicePresentation({
          roomKey,
          state: { ...INITIAL_VOICE_STATE, status: "error", errorCode: "VOICE_LOAD_FAILED", errorMessage: "Voice chat could not load. Reload the page to try again." },
          ready: false,
          loading: false,
          unavailableReason: "Voice chat could not load. Reload the page to try again.",
        });
      }
    }

    void prepareRoomVoice();

    return () => {
      cancelled = true;
      unsubscribeDisconnect?.();
      if (activeVoiceSessionRef.current?.session === voiceSession) activeVoiceSessionRef.current = null;
      voiceSession?.dispose();
    };
  }, [namespace, roomKey]);

  /**
   * Report unexpected browser errors only while the originating session is current.
   * @param {VoiceChatSession} voiceSession
   * @param {string} message
   * @returns {void}
   */
  const recordVoiceActionError = useCallback((voiceSession, message) => {
    const activeSession = activeVoiceSessionRef.current;
    if (activeSession?.session !== voiceSession) return;

    const voiceState = voiceSession.getState();
    setVoicePresentation((current) => ({
      ...current,
      state: voiceState.errorMessage ? voiceState : {
        ...voiceState,
        status: voiceState.status === "joining" ? "error" : voiceState.status,
        errorCode: "VOICE_ACTION_FAILED",
        errorMessage: message,
      },
    }));
  }, []);

  /**
   * Scope UI feedback to a participation and the latest intent of its kind.
   * Leaving/rejoining can reuse a controller while invalidating older promises.
   * @param {VoiceActionKind} kind
   * @param {VoiceChatSession} voiceSession
   * @returns {VoiceActionContext}
   */
  const beginVoiceAction = useCallback((kind, voiceSession) => {
    if (kind === "join") voiceParticipationGenerationRef.current += 1;
    voiceActionSequencesRef.current[kind] += 1;
    return {
      voiceSession,
      kind,
      participationGeneration: voiceParticipationGenerationRef.current,
      sequenceNumber: voiceActionSequencesRef.current[kind],
    };
  }, []);

  /**
   * Read live action state, independently of old peer errors or cancelled intents.
   * @param {VoiceActionContext} voiceActionContext
   * @param {boolean} applied Whether this action reached its requested state.
   * @returns {VoiceActionOutcome}
   */
  const readVoiceActionOutcome = useCallback((voiceActionContext, applied) => {
    if (activeVoiceSessionRef.current?.session !== voiceActionContext.voiceSession ||
        voiceActionContext.participationGeneration !== voiceParticipationGenerationRef.current ||
        voiceActionContext.sequenceNumber !== voiceActionSequencesRef.current[voiceActionContext.kind] ||
        voiceActionContext.voiceSession.getState().status === "off") {
      return "cancelled";
    }
    return applied ? "applied" : "failed";
  }, []);

  const join = useCallback(async (options = {}) => {
    const voiceSession = activeVoiceSessionRef.current?.session;
    if (!voiceSession) return "cancelled";
    const voiceActionContext = beginVoiceAction("join", voiceSession);

    try {
      await voiceSession.join(options);
      const voiceStatus = voiceSession.getState().status;
      return readVoiceActionOutcome(voiceActionContext, voiceStatus !== "error" && voiceStatus !== "unsupported");
    } catch {
      if (readVoiceActionOutcome(voiceActionContext, false) === "cancelled") return "cancelled";
      recordVoiceActionError(voiceSession, "Unable to join voice. Try again or choose Listen only.");
      return "failed";
    }
  }, [beginVoiceAction, readVoiceActionOutcome, recordVoiceActionError]);

  const setMicrophoneMuted = useCallback(async (muted) => {
    const voiceSession = activeVoiceSessionRef.current?.session;
    if (!voiceSession) return "cancelled";
    const voiceActionContext = beginVoiceAction("microphone", voiceSession);

    try {
      await voiceSession.setMicrophoneMuted(muted);
      return readVoiceActionOutcome(voiceActionContext, voiceSession.getState().microphoneMuted === muted);
    } catch {
      if (readVoiceActionOutcome(voiceActionContext, false) === "cancelled") return "cancelled";
      recordVoiceActionError(voiceSession, "Unable to use your microphone. Check browser microphone permission and try again.");
      return "failed";
    }
  }, [beginVoiceAction, readVoiceActionOutcome, recordVoiceActionError]);

  const setDeafened = useCallback((deafened) => {
    activeVoiceSessionRef.current?.session.setDeafened(deafened);
  }, []);

  const setVolume = useCallback((volume) => {
    activeVoiceSessionRef.current?.session.setVolume(volume);
  }, []);

  const resumePlayback = useCallback(async () => {
    const voiceSession = activeVoiceSessionRef.current?.session;
    if (!voiceSession) return "cancelled";
    const voiceActionContext = beginVoiceAction("playback", voiceSession);

    try {
      await voiceSession.resumePlayback();
      return readVoiceActionOutcome(voiceActionContext, !voiceSession.getState().playbackBlocked);
    } catch {
      if (readVoiceActionOutcome(voiceActionContext, false) === "cancelled") return "cancelled";
      recordVoiceActionError(voiceSession, "Voice audio could not play. Use Play voice audio to try again.");
      return "failed";
    }
  }, [beginVoiceAction, readVoiceActionOutcome, recordVoiceActionError]);

  const leave = useCallback(() => {
    voiceParticipationGenerationRef.current += 1;
    activeVoiceSessionRef.current?.session.leave();
  }, []);

  const presentationMatchesRoom = roomKey && voicePresentation.roomKey === roomKey;
  const loading = Boolean(roomKey && (!presentationMatchesRoom || voicePresentation.loading));
  const unavailableReason = !enabled || game?.networked === false
    ? "Voice chat is available in multiplayer rooms."
    : !roomKey ? "Join a multiplayer room to use voice chat."
      : loading ? "Preparing voice chat…" : voicePresentation.unavailableReason;

  return {
    state: presentationMatchesRoom ? voicePresentation.state : INITIAL_VOICE_STATE,
    available: Boolean(presentationMatchesRoom && voicePresentation.ready),
    loading,
    unavailableReason,
    join,
    setMicrophoneMuted,
    setDeafened,
    setVolume,
    resumePlayback,
    leave,
  };
}
