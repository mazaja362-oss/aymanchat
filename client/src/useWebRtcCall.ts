import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

async function loadRtcConfiguration(): Promise<RTCConfiguration> {
  try {
    const r = await fetch('/api/webrtc/ice');
    if (!r.ok) return FALLBACK_ICE;
    const data = (await r.json()) as { iceServers?: RTCIceServer[] };
    const servers = Array.isArray(data.iceServers) ? data.iceServers : [];
    if (servers.length === 0) return FALLBACK_ICE;
    return { iceServers: servers };
  } catch {
    return FALLBACK_ICE;
  }
}

export type CallMedia = 'audio' | 'video';

export type CallIncoming = {
  fromUserId: number;
  sdp: string;
  type: RTCSdpType;
  callId: string;
  media: CallMedia;
};

export function useWebRtcCall(opts: {
  socket: Socket | null;
  selfId: number | null;
  isGroup: boolean;
  onError: (msg: string) => void;
}) {
  const { socket, selfId, isGroup, onError } = opts;
  const [incoming, setIncoming] = useState<CallIncoming | null>(null);
  const [phase, setPhase] = useState<'idle' | 'outgoing' | 'connected'>('idle');

  const incomingRef = useRef<CallIncoming | null>(null);
  useEffect(() => {
    incomingRef.current = incoming;
  }, [incoming]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const partnerRef = useRef<number | null>(null);

  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const rtcConfigCache = useRef<RTCConfiguration | null>(null);

  const getRtcConfig = useCallback(async () => {
    if (rtcConfigCache.current) return rtcConfigCache.current;
    const cfg = await loadRtcConfiguration();
    rtcConfigCache.current = cfg;
    return cfg;
  }, []);

  const cleanupPc = useCallback(() => {
    try {
      pcRef.current?.getSenders().forEach((s) => {
        try {
          s.track?.stop();
        } catch {
          /* ignore */
        }
      });
      pcRef.current?.close();
    } catch {
      /* ignore */
    }
    pcRef.current = null;
    try {
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {
      /* ignore */
    }
    localStreamRef.current = null;
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    if (localVideoRef.current) localVideoRef.current.srcObject = null;
  }, []);

  const endCall = useCallback(() => {
    const pid = partnerRef.current;
    const cid = callIdRef.current;
    if (socket && pid != null && cid) {
      socket.emit('call:end', { toUserId: pid, callId: cid });
    }
    cleanupPc();
    callIdRef.current = null;
    partnerRef.current = null;
    setIncoming(null);
    setPhase('idle');
  }, [socket, cleanupPc]);

  const setupIce = useCallback(
    (pc: RTCPeerConnection, toUserId: number, callId: string) => {
      pc.onicecandidate = (ev) => {
        if (ev.candidate && socket) {
          socket.emit('call:candidate', {
            toUserId,
            callId,
            candidate: ev.candidate.toJSON(),
          });
        }
      };
      pc.ontrack = (ev) => {
        const stream = ev.streams[0] || new MediaStream([ev.track]);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = stream;
          void remoteAudioRef.current.play().catch(() => {});
        }
      };
    },
    [socket]
  );

  useEffect(() => {
    if (!socket || selfId == null) return;

    const onOffer = (p: {
      fromUserId: number;
      sdp: string;
      type: RTCSdpType;
      callId: string;
      media: CallMedia;
    }) => {
      if (isGroup) return;
      if (!p?.callId || !p.sdp) return;
      setIncoming({
        fromUserId: p.fromUserId,
        sdp: p.sdp,
        type: (p.type as RTCSdpType) || 'offer',
        callId: p.callId,
        media: p.media === 'video' ? 'video' : 'audio',
      });
    };

    const onAnswer = async (p: { fromUserId: number; sdp: string; type: RTCSdpType; callId: string }) => {
      if (p.callId !== callIdRef.current || p.fromUserId !== partnerRef.current) return;
      const pc = pcRef.current;
      if (!pc) return;
      try {
        await pc.setRemoteDescription({ type: p.type, sdp: p.sdp });
        setPhase('connected');
      } catch (e) {
        onError(e instanceof Error ? e.message : 'تعذر إكمال المكالمة');
        endCall();
      }
    };

    const onCandidate = async (p: {
      fromUserId: number;
      callId: string;
      candidate: RTCIceCandidateInit | null;
    }) => {
      if (p.callId !== callIdRef.current || p.fromUserId !== partnerRef.current) return;
      const pc = pcRef.current;
      if (!pc || p.candidate == null) return;
      try {
        await pc.addIceCandidate(new RTCIceCandidate(p.candidate));
      } catch {
        /* ignore stale */
      }
    };

    const onRemoteEnd = (p: { fromUserId: number; callId: string }) => {
      if (incomingRef.current?.callId === p.callId) {
        setIncoming(null);
      }
      if (p.callId !== callIdRef.current) return;
      cleanupPc();
      callIdRef.current = null;
      partnerRef.current = null;
      setPhase('idle');
    };

    socket.on('call:offer', onOffer);
    socket.on('call:answer', onAnswer);
    socket.on('call:candidate', onCandidate);
    socket.on('call:end', onRemoteEnd);

    return () => {
      socket.off('call:offer', onOffer);
      socket.off('call:answer', onAnswer);
      socket.off('call:candidate', onCandidate);
      socket.off('call:end', onRemoteEnd);
    };
  }, [socket, selfId, isGroup, onError, endCall, cleanupPc]);

  const startOutgoing = useCallback(
    async (toUserId: number, media: CallMedia) => {
      if (!socket || selfId == null || isGroup) return;
      if (phase !== 'idle') return;
      if (incomingRef.current) return;
      cleanupPc();
      const callId = crypto.randomUUID();
      callIdRef.current = callId;
      partnerRef.current = toUserId;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: media === 'video',
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;

        const rtcConfig = await getRtcConfig();
        const pc = new RTCPeerConnection(rtcConfig);
        pcRef.current = pc;
        setupIce(pc, toUserId, callId);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));

        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('call:offer', {
          toUserId,
          sdp: offer.sdp,
          type: offer.type,
          callId,
          media,
        });
        setPhase('outgoing');
      } catch (e) {
        onError(e instanceof Error ? e.message : 'تعذر بدء المكالمة');
        endCall();
      }
    },
    [socket, selfId, isGroup, phase, cleanupPc, setupIce, onError, endCall, getRtcConfig]
  );

  const acceptIncoming = useCallback(async () => {
    const inc = incomingRef.current;
    if (!socket || !inc || selfId == null) return;
    cleanupPc();
    const callId = inc.callId;
    const fromUserId = inc.fromUserId;
    callIdRef.current = callId;
    partnerRef.current = fromUserId;
    setIncoming(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: inc.media === 'video',
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      const rtcConfig = await getRtcConfig();
      const pc = new RTCPeerConnection(rtcConfig);
      pcRef.current = pc;
      setupIce(pc, fromUserId, callId);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));

      await pc.setRemoteDescription({ type: inc.type, sdp: inc.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('call:answer', {
        toUserId: fromUserId,
        sdp: answer.sdp,
        type: answer.type,
        callId,
      });
      setPhase('connected');
    } catch (e) {
      onError(e instanceof Error ? e.message : 'تعذر قبول المكالمة');
      socket.emit('call:end', { toUserId: fromUserId, callId });
      endCall();
    }
  }, [socket, selfId, cleanupPc, setupIce, onError, endCall, getRtcConfig]);

  const declineIncoming = useCallback(() => {
    const inc = incomingRef.current;
    if (!inc || !socket) {
      setIncoming(null);
      return;
    }
    socket.emit('call:end', { toUserId: inc.fromUserId, callId: inc.callId });
    setIncoming(null);
  }, [socket]);

  useEffect(() => {
    return () => {
      const s = socket;
      const pid = partnerRef.current;
      const cid = callIdRef.current;
      if (s && pid != null && cid) {
        s.emit('call:end', { toUserId: pid, callId: cid });
      }
      cleanupPc();
    };
  }, [socket, cleanupPc]);

  return {
    phase,
    incoming,
    startOutgoing,
    acceptIncoming,
    declineIncoming,
    endCall,
    remoteAudioRef,
    remoteVideoRef,
    localVideoRef,
  };
}
