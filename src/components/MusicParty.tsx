"use client";
/* eslint-disable */
import { useEffect, useRef, useState, useCallback } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Upload,
  Music,
  X,
  PhoneOff,
  MicOff,
  Mic,
  Headphones,
  Users,
  MessageCircle,
  Send,
  Youtube,
  ListMusic,
  Shuffle,
  Repeat
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Track {
  id: string;
  name: string;
  url: string;
  type: "local" | "shared" | "youtube";
  youtubeId?: string;
}

interface MusicPartyProps {
  contact: any;
  onClose: () => void;
  userId: string;
  isInitiator?: boolean;
  incomingSignal?: any;
}

export function MusicParty({ contact, onClose, userId, isInitiator = true, incomingSignal }: MusicPartyProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isConnecting, setIsConnecting] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState("Initializing...");
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isRepeat, setIsRepeat] = useState(false);
  const [isShuffle, setIsShuffle] = useState(false);
  const [showPlaylist, setShowPlaylist] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState<{id: string; text: string; sender: string; time: Date}[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [receivingAudio, setReceivingAudio] = useState(false);
  const [audioReceiveProgress, setAudioReceiveProgress] = useState(0);
  const [sendingAudio, setSendingAudio] = useState(false);
  const [audioSendProgress, setAudioSendProgress] = useState(0);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isYoutubeDialogOpen, setIsYoutubeDialogOpen] = useState(false);

  const audioRef = useRef<HTMLAudioElement>(null);
  const youtubePlayerRef = useRef<any>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const peerConnection = useRef<RTCPeerConnection | null>(null);
  const channelRef = useRef<any>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const hasAnswered = useRef(false);
  const iceCandidateQueue = useRef<RTCIceCandidateInit[]>([]);
  const remoteDescriptionSet = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioChunksRef = useRef<ArrayBuffer[]>([]);
  const expectedChunksRef = useRef<number>(0);
  const receivedChunksCountRef = useRef<number>(0);

  useEffect(() => {
    if ('mediaSession' in navigator && currentTrack) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: currentTrack.name,
        artist: `Listening with ${contact.username}`,
        artwork: []
      });

      navigator.mediaSession.setActionHandler('play', () => handlePlayPause());
      navigator.mediaSession.setActionHandler('pause', () => handlePlayPause());
      navigator.mediaSession.setActionHandler('previoustrack', () => playPrevious());
      navigator.mediaSession.setActionHandler('nexttrack', () => playNext());
    }
  }, [currentTrack, isPlaying, contact.username]);

  useEffect(() => {
    if (remoteStream && remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.play().catch(e => console.error("Remote audio play failed:", e));
      setIsConnecting(false);
      setConnectionStatus("Connected");
    }
  }, [remoteStream]);

  const processQueuedCandidates = async (pc: RTCPeerConnection) => {
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      if (candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.error("Failed to add queued ICE candidate:", err);
        }
      }
    }
  };

  const sendSyncMessage = useCallback((action: string, data: any) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
      dataChannelRef.current.send(JSON.stringify({ action, ...data }));
    }
  }, []);

  const sendAudioFile = useCallback(async (file: File) => {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      toast.error("Connection not ready. Please wait.");
      return;
    }
    
    setSendingAudio(true);
    setAudioSendProgress(0);
    
    const CHUNK_SIZE = 16384;
    const arrayBuffer = await file.arrayBuffer();
    const totalChunks = Math.ceil(arrayBuffer.byteLength / CHUNK_SIZE);
    
    sendSyncMessage("audioStart", { 
      totalSize: arrayBuffer.byteLength, 
      totalChunks, 
      fileName: file.name,
      fileType: file.type 
    });
    
    try {
      for (let i = 0; i < totalChunks; i++) {
        if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
          throw new Error("Connection closed");
        }
        
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, arrayBuffer.byteLength);
        const chunk = arrayBuffer.slice(start, end);
        
        while (dataChannelRef.current.bufferedAmount > 1024 * 1024) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        dataChannelRef.current.send(chunk);
        setAudioSendProgress(Math.round(((i + 1) / totalChunks) * 100));
      }
      
      sendSyncMessage("audioEnd", {});
      toast.success("Music shared with partner!");
    } catch (err) {
      console.error("Audio transfer failed:", err);
      toast.error("Music sharing interrupted");
    } finally {
      setSendingAudio(false);
    }
  }, [sendSyncMessage]);

  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      audioChunksRef.current.push(event.data);
      receivedChunksCountRef.current++;
      const progress = Math.round((receivedChunksCountRef.current / expectedChunksRef.current) * 100);
      setAudioReceiveProgress(progress);
      return;
    }
    
    try {
      const data = JSON.parse(event.data);
      if (data.action === "audioStart") {
        setReceivingAudio(true);
        expectedChunksRef.current = data.totalChunks;
        audioChunksRef.current = [];
        receivedChunksCountRef.current = 0;
        setAudioReceiveProgress(0);
        toast.info(`Receiving: ${data.fileName}`);
      } else if (data.action === "audioEnd") {
        const blob = new Blob(audioChunksRef.current, { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        const newTrack: Track = {
          id: `shared-${Date.now()}`,
          name: `Shared Track`,
          url,
          type: "shared"
        };
        setTracks(prev => [...prev, newTrack]);
        setCurrentTrack(newTrack);
        setReceivingAudio(false);
        audioChunksRef.current = [];
        toast.success("Music received!");
      } else if (data.action === "youtubeAdd") {
        const newTrack: Track = {
          id: `youtube-${Date.now()}`,
          name: data.name,
          url: data.url,
          type: "youtube",
          youtubeId: data.youtubeId
        };
        setTracks(prev => [...prev, newTrack]);
        setCurrentTrack(newTrack);
        toast.success(`New YouTube track: ${data.name}`);
      } else if (data.action === "play") {
        if (currentTrack?.type === "youtube") {
          youtubePlayerRef.current?.playVideo();
        } else if (audioRef.current) {
          audioRef.current.currentTime = data.time;
          audioRef.current.play().catch(e => console.error("Auto-play failed:", e));
        }
        setIsPlaying(true);
      } else if (data.action === "pause") {
        if (currentTrack?.type === "youtube") {
          youtubePlayerRef.current?.pauseVideo();
        } else if (audioRef.current) {
          audioRef.current.currentTime = data.time;
          audioRef.current.pause();
        }
        setIsPlaying(false);
      } else if (data.action === "seek") {
        if (currentTrack?.type === "youtube") {
          youtubePlayerRef.current?.seekTo(data.time, true);
        } else if (audioRef.current) {
          audioRef.current.currentTime = data.time;
        }
      } else if (data.action === "chat" && data.message) {
        setChatMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: data.message,
          sender: contact.username,
          time: new Date()
        }]);
      }
    } catch (e) {
      console.error("Failed to parse data channel message:", e);
    }
  }, [contact.username, currentTrack]);

  const createPeerConnection = useCallback(
    (localStream: MediaStream) => {
      const pc = new RTCPeerConnection({
        iceServers: [
          { urls: "stun:stun.l.google.com:19302" },
          { urls: "stun:stun1.l.google.com:19302" },
          {
            urls: "turn:openrelay.metered.ca:80",
            username: "openrelayproject",
            credential: "openrelayproject",
          },
        ],
      });

      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });

      if (isInitiator) {
        const dataChannel = pc.createDataChannel("musicPartySync");
        dataChannel.onopen = () => console.log("Data channel open");
        dataChannel.onmessage = handleDataChannelMessage;
        dataChannelRef.current = dataChannel;
      }

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        channel.onmessage = handleDataChannelMessage;
        dataChannelRef.current = channel;
      };

      pc.ontrack = (event) => {
        const [remoteStreamFromEvent] = event.streams;
        if (remoteStreamFromEvent) {
          setRemoteStream(remoteStreamFromEvent);
          setIsConnecting(false);
          setConnectionStatus("Connected");
        }
      };

      pc.onicecandidate = async (event) => {
        if (event.candidate) {
          await supabase.from("calls").insert({
            caller_id: userId,
            receiver_id: contact.id,
            signal_data: JSON.stringify({ candidate: event.candidate.toJSON() }),
            type: "candidate",
            call_mode: "musicparty",
          });
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "connected") {
          setIsConnecting(false);
          setConnectionStatus("Connected");
        } else if (pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
          endCall();
        }
      };

      return pc;
    },
    [userId, contact.id, handleDataChannelMessage, isInitiator]
  );

  useEffect(() => {
    let isMounted = true;

    const startCall = async () => {
      try {
        const localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
        if (!isMounted) {
          localStream.getTracks().forEach((t) => t.stop());
          return;
        }

        setStream(localStream);
        const pc = createPeerConnection(localStream);
        peerConnection.current = pc;

        if (isInitiator) {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await supabase.from("calls").insert({
            caller_id: userId,
            receiver_id: contact.id,
            signal_data: JSON.stringify({ sdp: pc.localDescription }),
            type: "offer",
            call_mode: "musicparty",
          });
        } else if (incomingSignal?.sdp) {
          await pc.setRemoteDescription(new RTCSessionDescription(incomingSignal.sdp));
          remoteDescriptionSet.current = true;
          await processQueuedCandidates(pc);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await supabase.from("calls").insert({
            caller_id: userId,
            receiver_id: contact.id,
            signal_data: JSON.stringify({ sdp: pc.localDescription }),
            type: "answer",
            call_mode: "musicparty",
          });
        }

        const channelId = [userId, contact.id].sort().join("-");
        const channel = supabase
          .channel(`musicparty-${channelId}`)
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "calls", filter: `receiver_id=eq.${userId}` },
            async (payload) => {
              const data = payload.new;
              if (!peerConnection.current) return;
              const signalData = JSON.parse(data.signal_data);

              if (data.type === "answer" && isInitiator && signalData.sdp && !hasAnswered.current) {
                hasAnswered.current = true;
                await peerConnection.current.setRemoteDescription(
                  new RTCSessionDescription(signalData.sdp)
                );
                remoteDescriptionSet.current = true;
                await processQueuedCandidates(peerConnection.current);
              } else if (data.type === "candidate" && signalData.candidate) {
                if (remoteDescriptionSet.current) {
                  await peerConnection.current.addIceCandidate(
                    new RTCIceCandidate(signalData.candidate)
                  );
                } else {
                  iceCandidateQueue.current.push(signalData.candidate);
                }
              } else if (data.type === "end") {
                endCall();
              }
            }
          )
          .subscribe();
        channelRef.current = channel;
      } catch (err) {
        console.error("MusicParty setup failed:", err);
        toast.error("Connection failed. Check mic permissions.");
        onClose();
      }
    };

    startCall();
    return () => {
      isMounted = false;
      if (stream) {
        stream.getTracks().forEach((t) => t.stop());
      }
      if (peerConnection.current) {
        peerConnection.current.close();
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [isInitiator, incomingSignal, createPeerConnection]);

  const endCall = async () => {
    try {
      await supabase
        .from("calls")
        .insert({ caller_id: userId, receiver_id: contact.id, type: "end", signal_data: "{}" });
    } catch (e) {}
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
    if (peerConnection.current) {
      peerConnection.current.close();
    }
    onClose();
  };

  const toggleMute = () => {
    if (stream) {
      stream.getAudioTracks()[0].enabled = !stream.getAudioTracks()[0].enabled;
      setIsMuted(!stream.getAudioTracks()[0].enabled);
    }
  };

  const toggleSpeaker = () => {
    if (remoteAudioRef.current) remoteAudioRef.current.muted = !remoteAudioRef.current.muted;
    setIsSpeakerOn(!isSpeakerOn);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      Array.from(files).forEach(file => {
        const url = URL.createObjectURL(file);
        const name = file.name.replace(/\.[^/.]+$/, "");
        const newTrack: Track = {
          id: `local-${Date.now()}-${Math.random()}`,
          name,
          url,
          type: "local"
        };
        setTracks(prev => [...prev, newTrack]);
        if (!currentTrack) {
          setCurrentTrack(newTrack);
        }
        sendAudioFile(file);
      });
    }
  };

  const playTrack = (track: Track) => {
    if (currentTrack?.id === track.id) {
      handlePlayPause();
      return;
    }
    setCurrentTrack(track);
    if (track.type === "youtube") {
      setIsPlaying(true);
      sendSyncMessage("play", { time: 0 });
    } else if (audioRef.current) {
      audioRef.current.src = track.url;
      audioRef.current.play().catch(e => console.error("Play failed:", e));
      setIsPlaying(true);
      sendSyncMessage("play", { time: 0 });
    }
  };

  const handlePlayPause = () => {
    if (!currentTrack) return;
    
    if (currentTrack.type === "youtube") {
      if (isPlaying) {
        youtubePlayerRef.current?.pauseVideo();
        sendSyncMessage("pause", { time: youtubePlayerRef.current?.getCurrentTime() || 0 });
      } else {
        youtubePlayerRef.current?.playVideo();
        sendSyncMessage("play", { time: youtubePlayerRef.current?.getCurrentTime() || 0 });
      }
    } else if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
        sendSyncMessage("pause", { time: audioRef.current.currentTime });
      } else {
        audioRef.current.play();
        sendSyncMessage("play", { time: audioRef.current.currentTime });
      }
    }
    setIsPlaying(!isPlaying);
  };

  const playNext = () => {
    if (!currentTrack || tracks.length === 0) return;
    const currentIndex = tracks.findIndex(t => t.id === currentTrack.id);
    let nextIndex;
    if (isShuffle) {
      nextIndex = Math.floor(Math.random() * tracks.length);
    } else {
      nextIndex = (currentIndex + 1) % tracks.length;
    }
    playTrack(tracks[nextIndex]);
  };

  const playPrevious = () => {
    if (!currentTrack || tracks.length === 0) return;
    const currentIndex = tracks.findIndex(t => t.id === currentTrack.id);
    const prevIndex = currentIndex === 0 ? tracks.length - 1 : currentIndex - 1;
    playTrack(tracks[prevIndex]);
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleLoadedMetadata = () => {
    if (audioRef.current) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleEnded = () => {
    if (isRepeat && audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play();
    } else {
      playNext();
    }
  };

  const handleSeek = (value: number[]) => {
    if (currentTrack?.type === "youtube") {
      youtubePlayerRef.current?.seekTo(value[0], true);
      setCurrentTime(value[0]);
      sendSyncMessage("seek", { time: value[0] });
    } else if (audioRef.current) {
      audioRef.current.currentTime = value[0];
      setCurrentTime(value[0]);
      sendSyncMessage("seek", { time: value[0] });
    }
  };

  const handleVolumeChange = (value: number[]) => {
    if (audioRef.current) {
      audioRef.current.volume = value[0];
      setVolume(value[0]);
    }
    const win = window as any;
    if (youtubePlayerRef.current) {
      youtubePlayerRef.current.setVolume(value[0] * 100);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const extractYoutubeId = (url: string) => {
    const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
    const match = url.match(regExp);
    return (match && match[2].length === 11) ? match[2] : null;
  };

  const handleYoutubeAdd = () => {
    const videoId = extractYoutubeId(youtubeUrl);
    if (videoId) {
      const newTrack: Track = {
        id: `youtube-${Date.now()}`,
        name: `YouTube Audio`,
        url: youtubeUrl,
        type: "youtube",
        youtubeId: videoId
      };
      setTracks(prev => [...prev, newTrack]);
      setCurrentTrack(newTrack);
      sendSyncMessage("youtubeAdd", { 
        name: newTrack.name, 
        url: newTrack.url, 
        youtubeId: videoId 
      });
      setYoutubeUrl("");
      setIsYoutubeDialogOpen(false);
      toast.success("YouTube track added!");
    } else {
      toast.error("Invalid YouTube URL");
    }
  };

  const [ytReady, setYtReady] = useState(false);
  const ytContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const win = window as any;
    
    const initYT = () => {
      setYtReady(true);
    };

    if (win.YT && win.YT.Player) {
      initYT();
    } else {
      if (!win.onYouTubeIframeAPIReadyRegistry) {
        win.onYouTubeIframeAPIReadyRegistry = [];
        const oldReady = win.onYouTubeIframeAPIReady;
        win.onYouTubeIframeAPIReady = () => {
          if (oldReady) oldReady();
          win.onYouTubeIframeAPIReadyRegistry.forEach((cb: any) => cb());
        };
      }
      win.onYouTubeIframeAPIReadyRegistry.push(initYT);

      const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
      if (!existingScript) {
        const tag = document.createElement('script');
        tag.src = "https://www.youtube.com/iframe_api";
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);
      }
    }

    return () => {
      if (win.onYouTubeIframeAPIReadyRegistry) {
        win.onYouTubeIframeAPIReadyRegistry = win.onYouTubeIframeAPIReadyRegistry.filter((cb: any) => cb !== initYT);
      }
      if (youtubePlayerRef.current) {
        youtubePlayerRef.current.destroy();
        youtubePlayerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const win = window as any;
    if (!ytReady || !currentTrack?.youtubeId || currentTrack.type !== "youtube") {
      return;
    }

    if (youtubePlayerRef.current) {
      youtubePlayerRef.current.destroy();
      youtubePlayerRef.current = null;
    }

    const createPlayer = () => {
      if (!ytContainerRef.current) return;
      
      youtubePlayerRef.current = new win.YT.Player(ytContainerRef.current, {
        videoId: currentTrack.youtubeId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          enablejsapi: 1,
          origin: typeof window !== "undefined" ? window.location.origin : "",
          widget_referrer: typeof window !== "undefined" ? window.location.origin : "",
        },
        events: {
          onReady: (event: any) => {
            event.target.setVolume(volume * 100);
            event.target.playVideo();
            setIsPlaying(true);
          },
          onStateChange: (event: any) => {
            if (event.data === win.YT.PlayerState.PLAYING) {
              setIsPlaying(true);
              const dur = event.target.getDuration();
              if (dur) setDuration(dur);
            } else if (event.data === win.YT.PlayerState.PAUSED) {
              setIsPlaying(false);
            } else if (event.data === win.YT.PlayerState.ENDED) {
              playNext();
            }
          },
        },
      });
    };

    createPlayer();
  }, [ytReady, currentTrack?.youtubeId, currentTrack?.type]);

  useEffect(() => {
    if (!currentTrack?.youtubeId || currentTrack.type !== "youtube" || !youtubePlayerRef.current) return;
    
    const interval = setInterval(() => {
      if (youtubePlayerRef.current?.getCurrentTime) {
        const time = youtubePlayerRef.current.getCurrentTime();
        setCurrentTime(time || 0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [currentTrack?.youtubeId, currentTrack?.type]);

  const sendChatMessage = () => {
    if (chatInput.trim()) {
      const newMessage = {
        id: Date.now().toString(),
        text: chatInput.trim(),
        sender: "me",
        time: new Date()
      };
      setChatMessages(prev => [...prev, newMessage]);
      sendSyncMessage("chat", { message: chatInput.trim() });
      setChatInput("");
    }
  };

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages]);

  return (
    <div className="fixed inset-0 z-[100] bg-gradient-to-br from-emerald-950 via-zinc-950 to-teal-950 flex flex-col overflow-hidden">
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={handleLoadedMetadata}
        onEnded={handleEnded}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
      />
      <audio ref={remoteAudioRef} autoPlay />
      <input
        type="file"
        ref={fileInputRef}
        accept="audio/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(ellipse_at_center,_rgba(16,185,129,0.1)_0%,_transparent_70%)] animate-pulse" />
      </div>

      <div className="relative h-full flex flex-col p-4 sm:p-6 max-w-5xl mx-auto w-full">
        <div className="flex items-center justify-between mb-4 sm:mb-6">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="p-2 sm:p-3 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl sm:rounded-2xl shadow-lg">
              <Headphones className="w-5 h-5 sm:w-6 sm:h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-black uppercase italic tracking-tighter">Listen Together</h2>
              <p className={`text-[10px] sm:text-xs font-bold uppercase tracking-wider ${isConnecting ? "text-amber-400" : "text-emerald-400"}`}>
                {connectionStatus}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setShowChat(!showChat)}
              size="icon"
              variant="ghost"
              className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl ${showChat ? "bg-emerald-500/20 text-emerald-400" : "text-white/60"}`}
            >
              <MessageCircle className="w-5 h-5" />
            </Button>
            <Button
              onClick={() => setShowPlaylist(!showPlaylist)}
              size="icon"
              variant="ghost"
              className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl ${showPlaylist ? "bg-emerald-500/20 text-emerald-400" : "text-white/60"}`}
            >
              <ListMusic className="w-5 h-5" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 p-3 sm:p-4 bg-white/5 rounded-2xl border border-white/5 mb-4 sm:mb-6">
          <Avatar className="h-10 w-10 sm:h-14 sm:w-14 border-2 border-emerald-500/50">
            <AvatarImage src={contact.avatar_url} />
            <AvatarFallback className="bg-emerald-900/50 font-black">
              {contact.username?.substring(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-black uppercase text-sm sm:text-base">{contact.username}</p>
            <p className="text-[10px] sm:text-xs text-white/40 uppercase tracking-widest">Listening together</p>
          </div>
          <Users className="w-4 h-4 sm:w-5 sm:h-5 text-white/20" />
        </div>

        {(receivingAudio || sendingAudio) && (
          <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-white/5 rounded-2xl border border-white/5">
            <div className="flex items-center gap-3 mb-2 sm:mb-3">
              <div className={`p-1.5 sm:p-2 rounded-xl ${receivingAudio ? "bg-emerald-600/20" : "bg-indigo-600/20"} animate-pulse`}>
                {receivingAudio ? <Music className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" /> : <Upload className="w-4 h-4 sm:w-5 sm:h-5 text-indigo-400" />}
              </div>
              <p className="text-xs sm:text-sm font-bold text-white/60">
                {receivingAudio ? `Receiving music from ${contact.username}...` : "Sending music..."}
              </p>
            </div>
            <div className="w-full bg-white/10 rounded-full h-1.5 sm:h-2 overflow-hidden">
              <motion.div 
                className={`h-full ${receivingAudio ? "bg-gradient-to-r from-emerald-500 to-teal-500" : "bg-gradient-to-r from-indigo-500 to-purple-500"}`}
                initial={{ width: 0 }}
                animate={{ width: `${receivingAudio ? audioReceiveProgress : audioSendProgress}%` }}
              />
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col items-center justify-center min-h-0 py-4 sm:py-8">
          <motion.div 
            animate={{ scale: isPlaying ? [1, 1.05, 1] : 1 }}
            transition={{ duration: 2, repeat: isPlaying ? Infinity : 0 }}
            className="w-40 h-40 sm:w-64 sm:h-64 rounded-[2.5rem] sm:rounded-[3rem] bg-gradient-to-br from-emerald-600 to-teal-600 flex items-center justify-center shadow-2xl mb-6 sm:mb-8 relative overflow-hidden"
          >
            {currentTrack?.type === "youtube" && currentTrack.youtubeId ? (
                <div className="absolute inset-0 z-10 bg-black">
                  <div ref={ytContainerRef} className="w-full h-full" />
                </div>
              ) : (
              <Music className="w-16 h-16 sm:w-28 sm:h-28 text-white" />
            )}
          </motion.div>

          {currentTrack ? (
            <div className="text-center mb-4 sm:mb-6 px-4 w-full">
              <p className="text-lg sm:text-2xl font-black uppercase truncate max-w-full">{currentTrack.name}</p>
              <p className="text-[10px] sm:text-sm text-emerald-400 uppercase tracking-[0.2em] mt-1">
                {currentTrack.type === "youtube" ? "YouTube Audio Stream" : "High-Fidelity Audio"}
              </p>
            </div>
          ) : (
            <div className="text-center mb-4 sm:mb-6">
              <p className="text-base sm:text-xl font-black uppercase text-white/40">No Track Active</p>
              <p className="text-[10px] sm:text-sm text-white/20 mt-1 uppercase tracking-widest">
                {isInitiator ? "Share local file or YouTube link" : "Waiting for partner to play"}
              </p>
            </div>
          )}

          <div className="w-full max-w-md space-y-4 sm:space-y-6">
            <div className="flex items-center gap-3 px-2">
              <span className="text-[10px] sm:text-xs font-mono text-white/40 w-10">{formatTime(currentTime)}</span>
              <Slider
                value={[currentTime]}
                max={duration || 100}
                step={1}
                onValueChange={handleSeek}
                className="flex-1"
              />
              <span className="text-[10px] sm:text-xs font-mono text-white/40 w-10 text-right">{formatTime(duration)}</span>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-6">
              <Button
                onClick={() => setIsShuffle(!isShuffle)}
                size="icon"
                variant="ghost"
                className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl ${isShuffle ? "text-emerald-400 bg-emerald-500/20" : "text-white/40"}`}
              >
                <Shuffle className="w-4 h-4" />
              </Button>
              <Button onClick={playPrevious} size="icon" variant="ghost" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl text-white/60 hover:text-white">
                <SkipBack className="w-5 h-5 sm:w-6 sm:h-6" />
              </Button>
              <Button 
                onClick={handlePlayPause} 
                size="icon" 
                className="h-14 w-14 sm:h-16 sm:w-16 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 shadow-xl"
              >
                {isPlaying ? <Pause className="w-7 h-7 sm:w-8 sm:h-8" /> : <Play className="w-7 h-7 sm:w-8 sm:h-8 ml-1" />}
              </Button>
              <Button onClick={playNext} size="icon" variant="ghost" className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl text-white/60 hover:text-white">
                <SkipForward className="w-5 h-5 sm:w-6 sm:h-6" />
              </Button>
              <Button
                onClick={() => setIsRepeat(!isRepeat)}
                size="icon"
                variant="ghost"
                className={`h-9 w-9 sm:h-10 sm:w-10 rounded-xl ${isRepeat ? "text-emerald-400 bg-emerald-500/20" : "text-white/40"}`}
              >
                <Repeat className="w-4 h-4" />
              </Button>
            </div>

            <div className="flex items-center justify-center gap-3 sm:gap-4 pb-4">
              <Volume2 className="w-4 h-4 text-white/40" />
              <Slider
                value={[volume]}
                max={1}
                step={0.1}
                onValueChange={handleVolumeChange}
                className="w-24 sm:w-32"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center flex-wrap gap-2 sm:gap-4 mt-auto py-4 border-t border-white/5">
          {isInitiator && (
            <>
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={isConnecting}
                className="h-10 sm:h-12 px-4 sm:px-6 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/20 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
              >
                <Upload className="w-4 h-4" />
                <span className="hidden xs:inline">Add Music</span>
              </Button>

              <Dialog open={isYoutubeDialogOpen} onOpenChange={setIsYoutubeDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    disabled={isConnecting}
                    className="h-10 sm:h-12 px-4 sm:px-6 bg-red-600/10 hover:bg-red-600 text-red-400 hover:text-white border border-red-500/20 rounded-xl font-black uppercase text-[10px] tracking-widest gap-2"
                  >
                    <Youtube className="w-4 h-4" />
                    <span className="hidden xs:inline">YouTube</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="bg-zinc-950 border-white/10 text-white rounded-[2rem]">
                  <DialogHeader>
                    <DialogTitle className="font-black uppercase tracking-tighter italic text-2xl">Stream from YouTube</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-6 py-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-black uppercase text-white/40 tracking-[0.2em]">Video Link</p>
                      <Input
                        value={youtubeUrl}
                        onChange={(e) => setYoutubeUrl(e.target.value)}
                        placeholder="https://youtube.com/watch?v=..."
                        className="bg-white/5 border-white/10 h-14 rounded-2xl text-base"
                      />
                    </div>
                    <Button 
                      onClick={handleYoutubeAdd}
                      className="w-full h-14 bg-red-600 hover:bg-red-700 rounded-2xl font-black uppercase tracking-widest"
                    >
                      Initialize Stream
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </>
          )}

          <div className="flex items-center gap-2">
            <Button
              onClick={toggleMute}
              size="icon"
              variant="ghost"
              className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl ${isMuted ? "bg-red-500/20 text-red-400" : "text-white/60 hover:text-white"}`}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>
            <Button
              onClick={toggleSpeaker}
              size="icon"
              variant="ghost"
              className={`h-10 w-10 sm:h-12 sm:w-12 rounded-xl ${!isSpeakerOn ? "bg-red-500/20 text-red-400" : "text-white/60 hover:text-white"}`}
            >
              {isSpeakerOn ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
            </Button>
            <Button
              onClick={endCall}
              size="icon"
              className="h-10 w-10 sm:h-12 sm:w-12 rounded-xl bg-red-500 hover:bg-red-600 shadow-[0_0_20px_rgba(239,68,68,0.3)]"
            >
              <PhoneOff className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showPlaylist && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="absolute top-0 left-0 bottom-0 w-full sm:w-96 bg-black/95 backdrop-blur-2xl border-r border-white/10 z-30 flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <ListMusic className="w-5 h-5 text-emerald-400" />
                <h3 className="font-black uppercase text-sm tracking-[0.2em]">Queue</h3>
              </div>
              <Button onClick={() => setShowPlaylist(false)} size="icon" variant="ghost" className="h-8 w-8 rounded-full text-white/60 hover:text-white">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar">
              {tracks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-40 px-8">
                  <Music className="w-12 h-12 mb-4 text-emerald-500" />
                  <p className="text-sm font-black uppercase tracking-widest">No Tracks in Queue</p>
                  <p className="text-[10px] mt-2 uppercase tracking-[0.2em]">{isInitiator ? "Add music to start the party" : "Waiting for host to add tracks"}</p>
                </div>
              ) : (
                tracks.map(track => (
                  <motion.div
                    key={track.id}
                    layout
                    onClick={() => playTrack(track)}
                    className={`flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all ${
                      currentTrack?.id === track.id ? "bg-emerald-600/20 border border-emerald-500/30" : "bg-white/[0.02] hover:bg-white/5 border border-transparent"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      currentTrack?.id === track.id ? "bg-emerald-600" : "bg-white/10"
                    }`}>
                      {track.type === "youtube" ? <Youtube className="w-5 h-5" /> : <Music className="w-5 h-5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`font-bold text-sm truncate ${currentTrack?.id === track.id ? "text-emerald-400" : ""}`}>{track.name}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[9px] font-black uppercase tracking-widest px-2 py-0.5 bg-white/5 rounded-full text-white/30">
                          {track.type}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChat && (
          <motion.div
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="absolute top-0 right-0 bottom-0 w-full sm:w-96 bg-black/95 backdrop-blur-2xl border-l border-white/10 z-30 flex flex-col shadow-2xl"
          >
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <div className="flex items-center gap-3">
                <MessageCircle className="w-5 h-5 text-emerald-400" />
                <h3 className="font-black uppercase text-sm tracking-[0.2em]">Backstage</h3>
              </div>
              <Button onClick={() => setShowChat(false)} size="icon" variant="ghost" className="h-8 w-8 rounded-full text-white/60 hover:text-white">
                <X className="w-4 h-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
              {chatMessages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                  <MessageCircle className="w-12 h-12 mb-4 text-emerald-500" />
                  <p className="text-sm font-black uppercase tracking-widest">Quiet Room</p>
                </div>
              ) : (
                chatMessages.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, x: msg.sender === "me" ? 20 : -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    className={`flex ${msg.sender === "me" ? "justify-end" : "justify-start"}`}
                  >
                    <div className={`max-w-[85%] px-4 py-3 rounded-2xl ${
                      msg.sender === "me" ? "bg-emerald-600 text-white rounded-br-none" : "bg-white/10 text-white rounded-bl-none"
                    }`}>
                      {msg.sender !== "me" && (
                        <p className="text-[10px] font-black text-emerald-400 uppercase mb-1.5 tracking-tighter">{msg.sender}</p>
                      )}
                      <p className="text-sm leading-relaxed">{msg.text}</p>
                    </div>
                  </motion.div>
                ))
              )}
              <div ref={chatEndRef} />
            </div>
            <div className="p-6 border-t border-white/10">
              <div className="flex gap-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChatMessage()}
                  placeholder="Drop a note..."
                  className="flex-1 h-12 bg-white/5 border-white/10 rounded-2xl text-sm"
                />
                <Button onClick={sendChatMessage} disabled={!chatInput.trim()} size="icon" className="h-12 w-12 rounded-2xl bg-emerald-600 hover:bg-emerald-700 shadow-lg">
                  <Send className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
