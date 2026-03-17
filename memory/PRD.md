# SMA-AI Dev Workspace — PRD

## Original Problem Statement
User (Tommy Falls) had a full-featured AI IDE called SMA-AI that was accidentally deleted by an agent. It was a custom workspace connecting to Claude Opus 4.6 (Anthropic API) and local Ollama models for coding assistance on antenna design, radio engineering, and full-stack development projects.

## Architecture
- **Backend**: FastAPI (Python) on port 8001
- **Frontend**: React 19 with Tailwind CSS on port 3000
- **Database**: MongoDB (conversations, messages, settings collections)
- **AI**: Claude Opus 4.6 via Anthropic API + Ollama support
- **Key Management**: Emergent Universal Key (primary) + User's Anthropic key (fallback)

## User Personas
- **Primary**: Tommy Falls — Radio/antenna hardware engineer, full-stack developer
- **Use Cases**: Coding assistance, antenna design calculations, React/Python development

## Core Requirements
- Multi-turn AI chat with Claude Opus 4.6
- Model switching (Claude + Ollama models)
- Code syntax highlighting in responses
- Markdown rendering (tables, math, blockquotes)
- Conversation history (saved to MongoDB)
- Settings panel (API keys, Ollama URL)
- Dark "Nixie" theme (engineering terminal aesthetic)

## What's Been Implemented (March 17, 2026)
- [x] FastAPI backend with streaming SSE chat endpoints
- [x] Claude Opus 4.6 integration via Emergent Universal Key
- [x] Anthropic API direct key support (user's own key)
- [x] Ollama model integration (configurable URL)
- [x] **Open WebUI integration** (OpenAI-compatible API, auto-discovers models)
- [x] Conversation CRUD (create, list, get, delete, rename)
- [x] Message persistence in MongoDB (200 msg history)
- [x] Auto-titling conversations based on first message
- [x] React frontend with Nixie Dark theme
- [x] Sidebar with conversation list
- [x] Model selector dropdown (3 providers: Anthropic, Ollama, Open WebUI)
- [x] Code syntax highlighting (Prism/OneDark theme)
- [x] Markdown rendering with GFM support (tables, blockquotes, code)
- [x] Settings modal with 3 provider sections + key source toggle
- [x] Grid background engineering aesthetic
- [x] Responsive design with collapsible sidebar
- [x] Quick prompts for common tasks (antenna, React, Python, gamma match)
- [x] Testing: 100% backend, 100% frontend pass rate

## User's GitHub Ecosystem
1. **sma2026-1** (2,662 commits) — Main Antenna Builder & Analyzer (FastAPI + React Native/Expo)
2. **KeyDownSim** (593 commits) — CB Key Down Simulator
3. **antenna-sim** (90 commits) — Antenna Simulator
4. **sma-ai-test-app** (3 commits) — AI Test App (Colab notebooks)
5. **sma-antenna** (1 commit) — Website for SMA antennas & amps
6. **sma-antenna-design** — Bolt.new project with Supabase

## User's Infrastructure
- **sma-ai** (192.168.0.68) — Main dev machine with Ollama, Nextcloud, Home Assistant
- **web-server** (192.168.0.99) — Hosts sma-antenna.org via Caddy
- **movie-server** — Media server with TMDB, Radarr, Sonarr

## Known Issues
- User's Anthropic API key (`sma-ai-build`) has no credits — using Emergent Universal Key instead
- Ollama not yet configured (needs server URL from user's network)

## Prioritized Backlog
### P0 (Critical)
- None — core chat is functional

### P1 (High)
- Ollama integration testing (needs user's server URL)
- Image upload in prompts
- Code snippets library
- Streaming with direct Anthropic key (when user adds credits)

### P2 (Medium)
- Multi-model comparison UI
- Auto-save drafts
- Terminal integration (xterm.js)
- Dark/Light theme toggle
- Project search & tags

### P3 (Future)
- Git integration (push to GitHub)
- Plugin system
- AI Agent mode (plan → build → test → fix)
- n8n webhook integration
- APK export
- Collaborative editing

## Next Tasks
1. Test with user's Ollama server once URL is provided
2. Add image upload support in prompts
3. Add code snippets library
4. Implement streaming with direct Anthropic API when user adds credits
