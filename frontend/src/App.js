import React, { useState, useEffect, useRef, useCallback } from "react";
import ReactDOM from "react-dom";
import "@/App.css";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  MessageSquarePlus, Send, Settings, Trash2, ChevronDown,
  Copy, Check, Loader2, Radio, Cpu, Zap, Menu, X,
  AlertCircle, Globe
} from "lucide-react";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

// --- Code Block with Copy ---
const CodeBlock = ({ language, children }) => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(String(children));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group" data-testid="code-block">
      <button
        onClick={handleCopy}
        data-testid="copy-code-btn"
        className="absolute right-2 top-2 p-1.5 rounded bg-surface-hl/80 text-muted hover:text-white opacity-0 group-hover:opacity-100 transition-opacity text-xs flex items-center gap-1"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
      <SyntaxHighlighter
        style={oneDark}
        language={language || "text"}
        PreTag="div"
        customStyle={{
          background: "#0a0a0a",
          border: "1px solid #27272a",
          borderRadius: "6px",
          padding: "1rem",
          fontSize: "0.85rem",
          margin: "0.5rem 0",
        }}
      >
        {String(children).replace(/\n$/, "")}
      </SyntaxHighlighter>
    </div>
  );
};

// --- Markdown Renderer ---
const MarkdownContent = ({ content }) => (
  <div className="prose max-w-none">
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        code({ node, inline, className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          return !inline && match ? (
            <CodeBlock language={match[1]}>{children}</CodeBlock>
          ) : (
            <code className={className} {...props}>{children}</code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

// --- Model Selector ---
const ModelSelector = ({ models, selected, onChange }) => {
  const [open, setOpen] = useState(false);
  const btnRef = useRef(null);
  const dropRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  useEffect(() => {
    const handler = (e) => {
      if (btnRef.current && !btnRef.current.contains(e.target) && dropRef.current && !dropRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleOpen = () => {
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(!open);
  };

  const current = models.find((m) => m.id === selected) || models[0];
  const getIcon = (provider) => {
    if (provider === "anthropic") return <Zap size={14} className="text-primary" />;
    if (provider === "ollama") return <Cpu size={14} className="text-secondary" />;
    if (provider === "openwebui") return <Globe size={14} className="text-blue-400" />;
    return <Radio size={14} className="text-accent" />;
  };

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleOpen}
        data-testid="model-selector-trigger"
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-surface-hl border border-border hover:border-primary/50 transition-colors text-sm font-mono"
      >
        {getIcon(current?.provider)}
        <span className="text-zinc-300 truncate max-w-[180px]">{current?.name || "Select Model"}</span>
        <ChevronDown size={14} className="text-muted" />
      </button>
      {open && ReactDOM.createPortal(
        <div
          ref={dropRef}
          data-testid="model-selector"
          className="w-72 bg-surface border border-border rounded-md shadow-2xl py-1 max-h-80 overflow-y-auto"
          style={{ position: "fixed", top: pos.top, left: pos.left, zIndex: 99999 }}
        >
          {models.map((m) => (
            <button
              key={m.id}
              data-testid={`model-option-${m.id}`}
              onClick={() => { onChange(m.id); setOpen(false); }}
              className={`w-full flex items-center gap-3 px-3 py-2 hover:bg-surface-hl transition-colors text-left ${m.id === selected ? "bg-surface-hl" : ""}`}
            >
              {getIcon(m.provider)}
              <div className="flex-1 min-w-0">
                <div className="text-sm text-zinc-200 truncate">{m.name}</div>
                <div className="text-xs text-muted truncate">{m.description}</div>
              </div>
              {m.id === selected && <Check size={14} className="text-primary" />}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
};

// --- Settings Modal ---
const SettingsModal = ({ open, onClose }) => {
  const [settings, setSettings] = useState({});
  const [apiKey, setApiKey] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [owuiUrl, setOwuiUrl] = useState("");
  const [owuiKey, setOwuiKey] = useState("");
  const [useEmergent, setUseEmergent] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (open) {
      axios.get(`${API}/settings`).then((r) => {
        setSettings(r.data);
        setOllamaUrl(r.data.ollama_base_url || "");
        setOwuiUrl(r.data.openwebui_base_url || "");
        setUseEmergent(r.data.use_emergent_key !== false);
      });
    }
  }, [open]);

  const handleSave = async () => {
    setSaving(true);
    const update = { ollama_base_url: ollamaUrl, openwebui_base_url: owuiUrl, use_emergent_key: useEmergent };
    if (apiKey) update.anthropic_api_key = apiKey;
    if (owuiKey) update.openwebui_api_key = owuiKey;
    await axios.put(`${API}/settings`, update);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" data-testid="settings-modal">
      <div className="bg-surface border border-border rounded-lg w-full max-w-lg p-6 shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold font-mono text-zinc-100">Settings</h2>
          <button onClick={onClose} data-testid="settings-close-btn" className="p-1 hover:bg-surface-hl rounded transition-colors">
            <X size={18} className="text-muted" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Key Source Toggle */}
          <div className="bg-background border border-border rounded-md p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Zap size={16} className="text-primary" />
                <label className="text-sm font-medium text-zinc-300">Claude API Source</label>
              </div>
              <button
                onClick={() => setUseEmergent(!useEmergent)}
                data-testid="toggle-key-source"
                className={`relative w-11 h-6 rounded-full transition-colors ${useEmergent ? "bg-secondary" : "bg-zinc-700"}`}
              >
                <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full transition-transform ${useEmergent ? "left-[22px]" : "left-0.5"}`} />
              </button>
            </div>
            <p className="text-xs text-muted">
              {useEmergent
                ? "Using Emergent Universal Key (ready to go)"
                : "Using your own Anthropic API key (needs credits)"}
            </p>
          </div>

          {!useEmergent && (
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-1.5">Anthropic API Key</label>
              <div className="text-xs text-muted mb-2">Current: {settings.anthropic_api_key_masked || "Not set"}</div>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                data-testid="settings-api-key-input"
                className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-zinc-200 placeholder:text-muted/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
              />
            </div>
          )}

          {/* Ollama Section */}
          <div className="bg-background border border-border rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Cpu size={16} className="text-secondary" />
              <label className="text-sm font-medium text-zinc-300">Ollama (Direct)</label>
            </div>
            <input
              type="text"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://192.168.0.68:11434"
              data-testid="settings-ollama-url-input"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-zinc-200 placeholder:text-muted/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
            <div className="text-xs text-muted mt-1">Direct Ollama API (your sma-ai machine)</div>
          </div>

          {/* Open WebUI Section */}
          <div className="bg-background border border-border rounded-md p-4">
            <div className="flex items-center gap-2 mb-3">
              <Globe size={16} className="text-blue-400" />
              <label className="text-sm font-medium text-zinc-300">Open WebUI</label>
            </div>
            <input
              type="text"
              value={owuiUrl}
              onChange={(e) => setOwuiUrl(e.target.value)}
              placeholder="http://sma-ai.ddns.net:3000"
              data-testid="settings-owui-url-input"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-zinc-200 placeholder:text-muted/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 mb-2"
            />
            <input
              type="password"
              value={owuiKey}
              onChange={(e) => setOwuiKey(e.target.value)}
              placeholder="Bearer token / API key"
              data-testid="settings-owui-key-input"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm font-mono text-zinc-200 placeholder:text-muted/50 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20"
            />
            <div className="text-xs text-muted mt-1">
              Current: {settings.openwebui_api_key_masked || "Not set"}
            </div>
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            data-testid="settings-save-btn"
            className="w-full bg-primary hover:bg-primary/90 text-white font-medium py-2 rounded-md transition-colors glow-primary disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : saved ? <Check size={16} /> : null}
            {saving ? "Saving..." : saved ? "Saved!" : "Save Settings"}
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Message Component ---
const Message = ({ message }) => {
  const isUser = message.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-4`} data-testid={`message-${message.id || "streaming"}`}>
      <div className={`max-w-[85%] ${isUser
        ? "bg-zinc-800 text-zinc-100 rounded-2xl rounded-tr-sm px-4 py-3"
        : "bg-transparent border border-border text-zinc-300 rounded-2xl rounded-tl-sm px-4 py-3"
      }`}>
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <div className="text-sm leading-relaxed font-mono">
            <MarkdownContent content={message.content} />
          </div>
        )}
        {message.model && !isUser && (
          <div className="text-xs text-muted mt-2 flex items-center gap-1">
            <Cpu size={10} /> {message.model}
          </div>
        )}
      </div>
    </div>
  );
};

// --- Main App ---
function App() {
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState("claude-opus-4-6");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, streamContent, scrollToBottom]);

  // Load conversations and models
  useEffect(() => {
    axios.get(`${API}/conversations`).then((r) => setConversations(r.data)).catch(console.error);
    axios.get(`${API}/models`).then((r) => setModels(r.data)).catch(console.error);
  }, []);

  // Load messages when conversation changes
  useEffect(() => {
    if (activeConv) {
      axios.get(`${API}/conversations/${activeConv}`).then((r) => {
        setMessages(r.data.messages || []);
        if (r.data.model) setSelectedModel(r.data.model);
      }).catch(console.error);
    } else {
      setMessages([]);
    }
  }, [activeConv]);

  const createConversation = async () => {
    const r = await axios.post(`${API}/conversations`, { title: "New Chat", model: selectedModel });
    setConversations((prev) => [r.data, ...prev]);
    setActiveConv(r.data.id);
    setMessages([]);
    inputRef.current?.focus();
  };

  const deleteConversation = async (id, e) => {
    e.stopPropagation();
    await axios.delete(`${API}/conversations/${id}`);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConv === id) {
      setActiveConv(null);
      setMessages([]);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || streaming) return;

    let convId = activeConv;
    if (!convId) {
      const r = await axios.post(`${API}/conversations`, { title: "New Chat", model: selectedModel });
      setConversations((prev) => [r.data, ...prev]);
      convId = r.data.id;
      setActiveConv(convId);
    }

    const userMsg = { id: `temp-${Date.now()}`, role: "user", content: input.trim(), created_at: new Date().toISOString() };
    setMessages((prev) => [...prev, userMsg]);
    const msgContent = input.trim();
    setInput("");
    setStreaming(true);
    setStreamContent("");

    try {
      const response = await fetch(`${API}/chat/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversation_id: convId, content: msgContent, model: selectedModel }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";
      let msgId = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "start") {
                msgId = data.message_id;
              } else if (data.type === "delta") {
                fullContent += data.content;
                setStreamContent(fullContent);
              } else if (data.type === "done") {
                setMessages((prev) => [
                  ...prev,
                  { id: msgId, role: "assistant", content: fullContent, model: selectedModel, created_at: new Date().toISOString() },
                ]);
                setStreamContent("");
                // Refresh conversations list to get updated title
                axios.get(`${API}/conversations`).then((r) => setConversations(r.data));
              } else if (data.type === "error") {
                setMessages((prev) => [
                  ...prev,
                  { id: `err-${Date.now()}`, role: "assistant", content: `**Error:** ${data.content}`, model: selectedModel, created_at: new Date().toISOString() },
                ]);
                setStreamContent("");
              }
            } catch (e) {
              // skip malformed JSON
            }
          }
        }
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { id: `err-${Date.now()}`, role: "assistant", content: `**Connection Error:** ${err.message}`, created_at: new Date().toISOString() },
      ]);
      setStreamContent("");
    }

    setStreaming(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex h-screen bg-background" data-testid="app-container">
      {/* Sidebar */}
      <aside
        className={`${sidebarOpen ? "w-64" : "w-0"} border-r border-border bg-surface/95 backdrop-blur flex flex-col h-screen fixed left-0 top-0 z-40 transition-all duration-200 overflow-hidden`}
        data-testid="sidebar"
      >
        <div className="p-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2 mb-4">
            <Radio size={20} className="text-primary" />
            <h1 className="font-mono font-bold text-base text-zinc-100 tracking-tight">SMA-AI</h1>
            <span className="text-xs font-mono text-accent bg-accent/10 px-1.5 py-0.5 rounded">v2.0</span>
          </div>
          <button
            onClick={createConversation}
            data-testid="new-chat-btn"
            className="w-full flex items-center justify-center gap-2 bg-primary hover:bg-primary/90 text-white font-medium py-2 rounded-md transition-colors glow-primary text-sm"
          >
            <MessageSquarePlus size={16} />
            New Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5" data-testid="conversation-list">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              onClick={() => setActiveConv(conv.id)}
              data-testid={`conversation-${conv.id}`}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-left transition-colors group cursor-pointer ${
                activeConv === conv.id ? "bg-surface-hl text-zinc-100" : "text-muted hover:bg-surface-hl hover:text-zinc-300"
              }`}
            >
              <MessageSquarePlus size={14} className="flex-shrink-0 text-muted" />
              <span className="truncate flex-1">{conv.title}</span>
              <button
                onClick={(e) => deleteConversation(conv.id, e)}
                data-testid={`delete-conversation-${conv.id}`}
                className="opacity-0 group-hover:opacity-100 p-1 hover:text-destructive transition-all"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          {conversations.length === 0 && (
            <div className="text-center text-muted text-xs py-8 font-mono">No conversations yet</div>
          )}
        </div>

        <div className="p-3 border-t border-border flex-shrink-0">
          <button
            onClick={() => setSettingsOpen(true)}
            data-testid="settings-btn"
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted hover:text-zinc-300 hover:bg-surface-hl transition-colors"
          >
            <Settings size={16} />
            Settings
          </button>
        </div>
      </aside>

      {/* Main Chat Area */}
      <main className={`flex-1 flex flex-col h-screen ${sidebarOpen ? "ml-64" : "ml-0"} transition-all duration-200`} data-testid="chat-area">
        {/* Top Bar */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-surface flex-shrink-0 relative z-30" data-testid="chat-header">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              data-testid="toggle-sidebar-btn"
              className="p-1.5 hover:bg-surface-hl rounded-md transition-colors text-muted"
            >
              {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            <ModelSelector models={models} selected={selectedModel} onChange={setSelectedModel} />
          </div>
          <div className="flex items-center gap-2">
            {streaming && (
              <div className="flex items-center gap-2 text-xs text-accent font-mono">
                <Loader2 size={14} className="animate-spin" />
                Streaming...
              </div>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-6 grid-bg relative z-0" data-testid="messages-container">
          {messages.length === 0 && !streamContent && (
            <div className="flex items-center justify-center h-full" data-testid="empty-state">
              <div className="text-center max-w-md">
                <div className="w-16 h-16 bg-surface-hl border border-border rounded-xl flex items-center justify-center mx-auto mb-4">
                  <Radio size={28} className="text-primary" />
                </div>
                <h2 className="text-xl font-mono font-semibold text-zinc-200 mb-2">SMA-AI Dev Workspace</h2>
                <p className="text-sm text-muted mb-4 leading-relaxed">
                  Claude Opus 4.6 + Ollama models. Ask about antenna design, coding, or anything.
                </p>
                <div className="flex flex-wrap justify-center gap-2">
                  {["Debug my React code", "Antenna gain calculation", "Python FastAPI endpoint", "Gamma match design"].map((s) => (
                    <button
                      key={s}
                      onClick={() => setInput(s)}
                      className="text-xs font-mono px-3 py-1.5 rounded-md border border-border text-muted hover:text-zinc-300 hover:border-primary/40 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <Message key={msg.id} message={msg} />
          ))}

          {streamContent && (
            <div className="flex justify-start mb-4" data-testid="streaming-message">
              <div className="max-w-[85%] bg-transparent border border-border text-zinc-300 rounded-2xl rounded-tl-sm px-4 py-3">
                <div className="text-sm leading-relaxed font-mono">
                  <MarkdownContent content={streamContent} />
                  <span className="typing-cursor" />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-border bg-background/95 backdrop-blur flex-shrink-0" data-testid="input-area">
          <div className="flex gap-3 items-end max-w-4xl mx-auto">
            <div className="flex-1 relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask SMA-AI anything... (Shift+Enter for new line)"
                disabled={streaming}
                data-testid="message-input"
                rows={1}
                className="w-full bg-surface border border-border rounded-lg px-4 py-3 text-sm text-zinc-200 placeholder:text-muted/60 focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none min-h-[48px] max-h-[200px] font-mono disabled:opacity-50"
                style={{ fieldSizing: "content" }}
              />
            </div>
            <button
              onClick={sendMessage}
              disabled={streaming || !input.trim()}
              data-testid="send-btn"
              className="p-3 bg-primary hover:bg-primary/90 text-white rounded-lg transition-colors glow-primary disabled:opacity-30 disabled:cursor-not-allowed flex-shrink-0"
            >
              {streaming ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
          <div className="text-center mt-2 text-xs text-muted/60 font-mono">
            Powered by Claude Opus 4.6 | Enter to send, Shift+Enter for new line
          </div>
        </div>
      </main>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default App;
