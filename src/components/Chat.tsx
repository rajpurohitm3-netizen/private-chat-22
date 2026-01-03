"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { motion, AnimatePresence } from "framer-motion";
import { 
    Send, Plus, Camera, Image as ImageIcon, MapPin, 
    Video, Mic, X, Download, Shield, AlertTriangle,
    Eye, EyeOff, Save, Trash2, ShieldCheck, Lock,
    Sparkles, Zap, ChevronLeft, Phone, Check, CheckCheck, ArrowLeft,
    MoreVertical, Trash, Star, Heart, ThumbsUp, Smile, Frown, Meh,
    Volume2, VolumeX, Minimize2, Maximize2, CameraOff, SwitchCamera
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { AvatarDisplay } from "./AvatarDisplay";
import { sendPushNotification } from "@/hooks/usePushNotifications";
import { 
  generateAESKey, encryptWithAES, decryptWithAES, 
  encryptAESKeyForUser, decryptAESKeyWithUserPrivateKey, 
  importPublicKey 
} from "@/lib/crypto";

interface ChatProps {
  session: any;
  privateKey: CryptoKey;
  initialContact: any;
  isPartnerOnline?: boolean;
  onBack?: () => void;
  onInitiateCall: (contact: any, mode: "video" | "voice") => void;
  isFriend?: boolean;
  onSendFriendRequest?: (userId: string) => void;
}

function formatLastSeen(lastSeen: string | null): string {
  if (!lastSeen) return "Offline";
  const date = new Date(lastSeen);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  if (diffMins < 1) return "Last seen just now";
  if (diffMins < 60) return `Last seen ${diffMins}m ago`;
  if (diffHours < 24 && date.getDate() === now.getDate()) return `Last seen today at ${timeStr}`;
  if (diffDays === 1 || (diffHours < 48 && date.getDate() === now.getDate() - 1)) return `Last seen yesterday at ${timeStr}`;
  const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Last seen ${dateStr} at ${timeStr}`;
}

export function Chat({ session, privateKey, initialContact, isPartnerOnline, onBack, onInitiateCall, isFriend = true, onSendFriendRequest }: ChatProps) {
  const router = useRouter();
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [showOptions, setShowOptions] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [contactProfile, setContactProfile] = useState<any>(initialContact);
  const [myPublicKey, setMyPublicKey] = useState<CryptoKey | null>(null);
  const [partnerPresence, setPartnerPresence] = useState<{isOnline: boolean; isInChat: boolean; isTyping: boolean;}>({ isOnline: false, isInChat: false, isTyping: false });
  const [isFocused, setIsFocused] = useState(true);
  const [showSnapshotView, setShowSnapshotView] = useState<any>(null);
  const [showSaveToVault, setShowSaveToVault] = useState<any>(null);
  const [vaultPassword, setVaultPassword] = useState("");
  const [longPressedMessage, setLongPressedMessage] = useState<any>(null);
  const [showMenu, setShowMenu] = useState(false);
  const [autoDeleteMode, setAutoDeleteMode] = useState<"none" | "view" | "3h">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem(`chatify_auto_delete_${session.user.id}`) as any) || "none";
    }
    return "none";
  });

  useEffect(() => {
    localStorage.setItem(`chatify_auto_delete_${session.user.id}`, autoDeleteMode);
  }, [autoDeleteMode, session.user.id]);

  const [showCamera, setShowCamera] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraFacingMode, setCameraFacingMode] = useState<"user" | "environment">("user");
  
  useEffect(() => {
    if (showCamera && stream && videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(console.error);
    }
  }, [showCamera, stream]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleBlur = () => setIsFocused(false);
    const handleFocus = () => setIsFocused(true);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("blur", handleBlur);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  useEffect(() => {
    async function initMyPublicKey() {
      const { data } = await supabase.from("profiles").select("public_key").eq("id", session.user.id).single();
      if (data?.public_key) {
        const key = await importPublicKey(data.public_key);
        setMyPublicKey(key);
      }
    }
    initMyPublicKey();
  }, [session.user.id]);

  const decryptMessageContent = async (msg: any) => {
    try {
      const packet = JSON.parse(msg.encrypted_content);
      if (!packet.iv || !packet.content || !packet.keys) return msg.encrypted_content;
      const encryptedAESKey = packet.keys[session.user.id];
      if (!encryptedAESKey) return "[Encryption Error: Key Missing]";
      const aesKey = await decryptAESKeyWithUserPrivateKey(encryptedAESKey, privateKey);
      return await decryptWithAES(packet.content, packet.iv, aesKey);
    } catch (e) {
      return msg.encrypted_content;
    }
  };

  async function fetchMessages() {
    setLoading(true);
    const { data, error } = await supabase.from("messages").select("*").or(`and(sender_id.eq.${session.user.id},receiver_id.eq.${initialContact.id}),and(sender_id.eq.${initialContact.id},receiver_id.eq.${session.user.id})`).order("created_at", { ascending: true });
    if (!error) {
      const decryptedMessages = await Promise.all((data || []).map(async msg => ({ ...msg, decrypted_content: await decryptMessageContent(msg) })));
      setMessages(decryptedMessages);
      const unviewed = data?.filter(m => m.receiver_id === session.user.id && !m.is_viewed) || [];
      if (unviewed.length > 0) {
        await supabase.from("messages").update({ is_viewed: true, viewed_at: new Date().toISOString() }).in("id", unviewed.map(m => m.id));
      }
    }
    setLoading(false);
  }

  function subscribeToMessages() {
    return supabase.channel(`chat-${initialContact.id}`).on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `receiver_id=eq.${session.user.id}` }, async (payload) => {
      if (payload.new.sender_id === initialContact.id) {
        const decryptedContent = await decryptMessageContent(payload.new);
        const msg = { ...payload.new, decrypted_content: decryptedContent };
        setMessages(prev => [...prev, msg]);
        await supabase.from("messages").update({ is_delivered: true, delivered_at: new Date().toISOString() }).eq("id", payload.new.id);
        if (payload.new.media_type === 'snapshot') {
          toast.info("Snapshot Received");
          setShowSnapshotView(msg);
        }
      }
    }).on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, async (payload) => {
      const decryptedContent = await decryptMessageContent(payload.new);
      setMessages(prev => prev.map(m => m.id === payload.new.id ? { ...payload.new, decrypted_content: decryptedContent } : m));
    }).subscribe();
  }

  useEffect(() => {
    fetchMessages();
    const subscription = subscribeToMessages();
    return () => { supabase.removeChannel(subscription); };
  }, [initialContact]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function sendMessage(mediaType: string = "text", mediaUrl: string | null = null) {
    if (!newMessage.trim() && !mediaUrl) return;
    if (!myPublicKey || !initialContact.public_key) { toast.error("Encryption keys not synchronized."); return; }
    try {
      const aesKey = await generateAESKey();
      const contentToEncrypt = newMessage.trim() || " ";
      const encrypted = await encryptWithAES(contentToEncrypt, aesKey);
      const partnerKey = await importPublicKey(initialContact.public_key);
      const encryptedKeyForPartner = await encryptAESKeyForUser(aesKey, partnerKey);
      const encryptedKeyForMe = await encryptAESKeyForUser(aesKey, myPublicKey);
      const packet = JSON.stringify({ iv: encrypted.iv, content: encrypted.content, keys: { [session.user.id]: encryptedKeyForMe, [initialContact.id]: encryptedKeyForPartner } });
      const messageData: any = { sender_id: session.user.id, receiver_id: initialContact.id, encrypted_content: packet, media_type: mediaType, media_url: mediaUrl, is_viewed: false, is_delivered: partnerPresence.isOnline, expires_at: autoDeleteMode === "3h" ? new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString() : null, is_view_once: autoDeleteMode === "view" };
      if (mediaType === 'snapshot') { messageData.view_count = 0; messageData.is_view_once = true; }
      const { data, error } = await supabase.from("messages").insert(messageData).select();
      if (!error) {
        const sentMsg = data?.[0] || messageData;
        sentMsg.decrypted_content = contentToEncrypt;
        setMessages(prev => [...prev, sentMsg]);
        setNewMessage("");
        setShowOptions(false);
      }
    } catch (e) { toast.error("Encryption failed"); }
  }

  const startCamera = async (facingMode: "user" | "environment" = "user") => {
    try {
      if (stream) stream.getTracks().forEach(track => track.stop());
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facingMode } });
      setStream(s);
      setShowCamera(true);
    } catch (err) { toast.error("Camera access denied"); }
  };

  const capturePhoto = async () => {
    if (!videoRef.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext('2d')?.drawImage(videoRef.current, 0, 0);
    canvas.toBlob(async (blob) => {
      if (!blob) return;
      const fileName = `snapshot-${Date.now()}.jpg`;
      const filePath = `chat/${session.user.id}/${fileName}`;
      const { error } = await supabase.storage.from("chat-media").upload(filePath, blob);
      if (!error) {
        const { data: { publicUrl } } = supabase.storage.from("chat-media").getPublicUrl(filePath);
        await sendMessage("snapshot", publicUrl);
        setShowCamera(false);
      }
    }, 'image/jpeg');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>, type: "image" | "video" | "audio") => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileName = `${Math.random()}.${file.name.split(".").pop()}`;
    const filePath = `chat/${session.user.id}/${fileName}`;
    const { error } = await supabase.storage.from("chat-media").upload(filePath, file);
    if (!error) {
      const { data: { publicUrl } } = supabase.storage.from("chat-media").getPublicUrl(filePath);
      await sendMessage(type, publicUrl);
    }
  };

  const openSnapshot = async (message: any) => {
    if (message.receiver_id === session.user.id && (message.view_count || 0) >= 2 && !message.is_saved) { toast.error("Purged"); return; }
    setShowSnapshotView(message);
    if (message.receiver_id === session.user.id) {
      const newViews = (message.view_count || 0) + 1;
      await supabase.from("messages").update({ view_count: newViews, is_viewed: newViews >= 2 }).eq("id", message.id);
    }
  };

  const closeSnapshot = async () => {
    if (showSnapshotView?.receiver_id === session.user.id && !showSnapshotView.is_saved) {
      await supabase.from("messages").update({ is_saved: true, is_viewed: true }).eq("id", showSnapshotView.id);
    }
    setShowSnapshotView(null);
  };

  return (
    <div className="flex flex-col h-full bg-[#030303] relative overflow-hidden">
      <header className="h-20 border-b border-white/5 bg-black/40 backdrop-blur-3xl flex items-center justify-between px-6 z-20 shrink-0">
          <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={onBack} className="text-white/20 hover:text-white mr-1 lg:hidden bg-white/5 rounded-xl border border-white/5"><ArrowLeft className="w-6 h-6" /></Button>
              <AvatarDisplay profile={initialContact} className="h-10 w-10 ring-2 ring-indigo-500/20" />
              <div>
                <h3 className="text-sm font-black italic tracking-tighter uppercase text-white">{initialContact.username}</h3>
                <p className="text-[8px] font-bold uppercase tracking-widest text-emerald-500">Node Secure</p>
              </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => onInitiateCall(initialContact, "voice")} className="text-white/20 hover:text-white hover:bg-white/5 rounded-xl"><Phone className="w-4 h-4" /></Button>
            <Button variant="ghost" size="icon" onClick={() => onInitiateCall(initialContact, "video")} className="text-white/20 hover:text-white hover:bg-white/5 rounded-xl"><Video className="w-4 h-4" /></Button>
            <div className="relative">
              <Button variant="ghost" size="icon" onClick={() => setShowMenu(!showMenu)} className="text-white/20 hover:text-white hover:bg-white/5 rounded-xl"><MoreVertical className="w-4 h-4" /></Button>
              <AnimatePresence>{showMenu && (<motion.div initial={{ opacity: 0, y: 10, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.95 }} className="absolute right-0 top-12 w-48 bg-zinc-900 border border-white/10 rounded-2xl p-2 shadow-2xl z-50"><p className="text-[8px] font-black uppercase tracking-[0.2em] text-white/30 px-3 py-2">Auto-Delete Protocol</p>{[{ id: "none", label: "No Auto-Delete" }, { id: "view", label: "Delete After View" }, { id: "3h", label: "Delete After 3 Hours" }].map(opt => (<button key={opt.id} onClick={() => { setAutoDeleteMode(opt.id as any); setShowMenu(false); }} className={`w-full text-left px-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all ${autoDeleteMode === opt.id ? 'bg-indigo-600 text-white' : 'text-white/60 hover:bg-white/5'}`}>{opt.label}</button>))}</motion.div>)}</AnimatePresence>
            </div>
          </div>
      </header>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
        {loading ? (<div className="flex items-center justify-center h-full animate-spin border-2 border-indigo-500 border-t-transparent rounded-full w-8 h-8 mx-auto" />) : messages.length === 0 ? (<div className="flex flex-col items-center justify-center h-full opacity-20"><ShieldCheck className="w-12 h-12 mb-4" /><p className="text-[10px] font-black uppercase tracking-[0.4em]">End-to-End Encrypted</p></div>) : (
          messages.map((msg) => {
            const isMe = msg.sender_id === session.user.id;
            return (
              <motion.div key={msg.id} initial={{ opacity: 0, x: isMe ? 20 : -20 }} animate={{ opacity: 1, x: 0 }} className={`flex ${isMe ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] flex flex-col ${isMe ? "items-end" : "items-start"} relative`}>
                  {msg.media_type === 'snapshot' ? (
                    <button onClick={() => openSnapshot(msg)} className="p-4 rounded-[2rem] border bg-purple-600/10 border-purple-500/30 flex items-center gap-3"><Camera className="w-5 h-5 text-purple-400" /><span className="text-[10px] font-black uppercase text-white">Snapshot</span></button>
                  ) : msg.media_type === 'image' ? (
                    <img src={msg.media_url} alt="" className="rounded-[2rem] border border-white/10 max-h-80" />
                  ) : (
                    <div className={`p-5 rounded-[2rem] text-sm font-medium ${msg.is_saved ? "bg-amber-100 text-amber-900 border border-amber-400" : isMe ? "bg-indigo-600 text-white shadow-xl" : "bg-white/[0.03] border border-white/5 text-white/90"}`}>{msg.decrypted_content || "[Encrypted Signal]"}</div>
                  )}
                  <div className="flex items-center gap-2 mt-2 px-2"><span className="text-[7px] font-black uppercase tracking-widest text-white/10">{new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>{isMe && (<div className="flex items-center">{msg.is_viewed ? (<CheckCheck className="w-2.5 h-2.5 text-blue-500" />) : (<CheckCheck className="w-2.5 h-2.5 text-white/90" />)}</div>)}</div>
                </div>
              </motion.div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <footer className="p-6 bg-black/40 backdrop-blur-3xl border-t border-white/5 shrink-0">
          <div className="flex items-center gap-3 relative">
            <Button variant="ghost" size="icon" onClick={() => setShowOptions(!showOptions)} className={`h-12 w-12 rounded-2xl transition-all ${showOptions ? 'bg-indigo-600 text-white rotate-45' : 'bg-white/5 text-white/20'}`}><Plus className="w-6 h-6" /></Button>
            <input value={newMessage} onChange={(e) => setNewMessage(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendMessage()} placeholder="Type signal packet..." className="flex-1 bg-white/[0.03] border border-white/10 rounded-[2rem] h-12 px-6 text-sm outline-none focus:border-indigo-500/50" />
            <Button onClick={() => sendMessage()} disabled={!newMessage.trim()} className="h-12 w-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-600/20 disabled:opacity-20"><Send className="w-5 h-5" /></Button>
            <AnimatePresence>{showOptions && (<motion.div initial={{ opacity: 0, y: 10, scale: 0.9 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10, scale: 0.9 }} className="absolute bottom-20 left-0 w-64 bg-[#0a0a0a] border border-white/10 rounded-[2.5rem] p-4 shadow-2xl z-50 overflow-hidden"><div className="grid grid-cols-2 gap-2"><label className="flex flex-col items-center justify-center p-4 bg-white/[0.02] border border-white/5 rounded-2xl cursor-pointer"><ImageIcon className="w-6 h-6 text-indigo-400 mb-2" /><span className="text-[8px] font-black uppercase text-white/40">Photo</span><input type="file" className="hidden" accept="image/*" onChange={(e) => handleFileUpload(e, "image")} /></label><button onClick={() => startCamera()} className="flex flex-col items-center justify-center p-4 bg-purple-600/5 border border-purple-500/20 rounded-2xl"><Camera className="w-6 h-6 text-purple-400 mb-2" /><span className="text-[8px] font-black uppercase text-white/40">Snapshot</span></button></div></motion.div>)}</AnimatePresence>
          </div>
      </footer>

      <AnimatePresence>{showCamera && (<div className="fixed inset-0 z-[150] bg-black flex flex-col items-center justify-center"><video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" /><div className="absolute bottom-10 flex gap-6 items-center"><Button onClick={() => setShowCamera(false)} variant="ghost" className="bg-white/10 hover:bg-white/20 rounded-full h-14 w-14"><X className="w-6 h-6 text-white" /></Button><button onClick={capturePhoto} className="w-20 h-20 rounded-full border-4 border-white flex items-center justify-center"><div className="w-14 h-14 rounded-full bg-white" /></button></div></div>)}</AnimatePresence>

      <AnimatePresence>{showSnapshotView && (<motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="fixed inset-0 z-[100] bg-black backdrop-blur-3xl flex items-center justify-center p-3 sm:p-6"><div className="relative w-full max-w-2xl bg-black rounded-[2rem] overflow-hidden border border-white/10 flex flex-col"><img src={showSnapshotView.media_url} alt="" className="w-full h-full object-contain" /><button onClick={closeSnapshot} className="absolute top-4 right-4 w-12 h-12 bg-black/50 backdrop-blur-md rounded-full flex items-center justify-center border border-white/10"><X className="w-6 h-6 text-white" /></button></div></motion.div>)}</AnimatePresence>
    </div>
  );
}
