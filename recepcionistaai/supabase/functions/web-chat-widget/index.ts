import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface WidgetConfig {
  primaryColor: string;
  position: string;
  title: string;
  welcomeMessage: string;
  zIndex: string;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  
  let r = parseInt(result[1], 16) / 255;
  let g = parseInt(result[2], 16) / 255;
  let b = parseInt(result[3], 16) / 255;
  
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }

  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function generateHoverColor(hex: string): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return hex;
  const darkerL = Math.max(0, hsl.l - 10);
  return `hsl(${hsl.h}, ${hsl.s}%, ${darkerL}%)`;
}

function escapeHtmlAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function generateWidgetScript(workshopId: string, supabaseUrl: string, config: WidgetConfig): string {
  const hoverColor = generateHoverColor(config.primaryColor);
  const positionCss = config.position === 'bottom-left' 
    ? 'left: 24px; right: auto;' 
    : 'right: 24px; left: auto;';
  const panelPositionCss = config.position === 'bottom-left'
    ? 'left: 0; right: auto;'
    : 'right: 0; left: auto;';
  
  return `
(function() {
  'use strict';
  
  // Configuration
  var WORKSHOP_ID = '${workshopId}';
  var API_URL = '${supabaseUrl}/functions/v1/web-chat';
  var SESSION_KEY = 'rc_chat_session_' + WORKSHOP_ID;
  
  // Get or create session ID
  function getSessionId() {
    var sessionId = localStorage.getItem(SESSION_KEY);
    if (!sessionId) {
      sessionId = 'web_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem(SESSION_KEY, sessionId);
    }
    return sessionId;
  }
  
  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Inject styles
  var styles = document.createElement('style');
  styles.textContent = \`
    .rc-chat-widget {
      --rc-primary: ${config.primaryColor};
      --rc-primary-hover: ${hoverColor};
      --rc-bg: #ffffff;
      --rc-text: #1f2937;
      --rc-text-muted: #6b7280;
      --rc-border: #e5e7eb;
      --rc-user-bg: ${config.primaryColor};
      --rc-bot-bg: #f3f4f6;
      position: fixed;
      bottom: 24px;
      ${positionCss}
      z-index: ${config.zIndex};
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    
    .rc-chat-button {
      width: 56px;
      height: 56px;
      min-width: 56px;
      min-height: 56px;
      max-width: 56px;
      max-height: 56px;
      border-radius: 50%;
      background: var(--rc-primary);
      border: none;
      cursor: pointer;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s ease-out, background 0.2s ease-out, box-shadow 0.2s ease-out;
      box-sizing: border-box;
    }
    
    .rc-chat-button:hover {
      background: var(--rc-primary-hover);
      transform: scale(1.05);
      box-shadow: 0 6px 20px rgba(0,0,0,0.18);
    }
    
    .rc-chat-button svg {
      width: 26px;
      height: 26px;
      fill: white;
    }
    
    .rc-chat-panel {
      display: none;
      position: absolute;
      bottom: 70px;
      ${panelPositionCss}
      width: 380px;
      max-width: calc(100vw - 40px);
      height: 500px;
      max-height: calc(100vh - 100px);
      background: var(--rc-bg);
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.2);
      flex-direction: column;
      overflow: hidden;
    }
    
    .rc-chat-panel.open {
      display: flex;
    }
    
    .rc-chat-header {
      padding: 16px;
      background: var(--rc-primary);
      color: white;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    
    .rc-chat-header-avatar {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: rgba(255,255,255,0.2);
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .rc-chat-header-avatar svg {
      width: 24px;
      height: 24px;
      fill: white;
    }
    
    .rc-chat-header-info h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
    }
    
    .rc-chat-header-info p {
      margin: 2px 0 0;
      font-size: 12px;
      opacity: 0.9;
    }
    
    .rc-chat-close {
      margin-left: auto;
      background: none;
      border: none;
      color: white;
      cursor: pointer;
      padding: 4px;
      opacity: 0.8;
    }
    
    .rc-chat-close:hover {
      opacity: 1;
    }
    
    .rc-chat-messages {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    
    .rc-message {
      max-width: 80%;
      padding: 10px 14px;
      border-radius: 16px;
      font-size: 14px;
      line-height: 1.4;
      word-wrap: break-word;
    }
    
    .rc-message.user {
      align-self: flex-end;
      background: var(--rc-user-bg);
      color: white;
      border-bottom-right-radius: 4px;
    }
    
    .rc-message.bot {
      align-self: flex-start;
      background: var(--rc-bot-bg);
      color: var(--rc-text);
      border-bottom-left-radius: 4px;
    }
    
    .rc-message.typing {
      display: flex;
      gap: 4px;
      padding: 12px 16px;
    }
    
    .rc-typing-dot {
      width: 8px;
      height: 8px;
      background: var(--rc-text-muted);
      border-radius: 50%;
      animation: rc-typing 1.4s infinite;
    }
    
    .rc-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .rc-typing-dot:nth-child(3) { animation-delay: 0.4s; }
    
    @keyframes rc-typing {
      0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
      30% { transform: translateY(-4px); opacity: 1; }
    }
    
    .rc-chat-input {
      padding: 12px 16px;
      border-top: 1px solid var(--rc-border);
      display: flex;
      gap: 8px;
    }
    
    .rc-chat-input input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid var(--rc-border);
      border-radius: 24px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    }
    
    .rc-chat-input input:focus {
      border-color: var(--rc-primary);
    }
    
    .rc-chat-input button {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--rc-primary);
      border: none;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s;
    }
    
    .rc-chat-input button:hover {
      background: var(--rc-primary-hover);
    }
    
    .rc-chat-input button:disabled {
      background: var(--rc-border);
      cursor: not-allowed;
    }
    
    .rc-chat-input button svg {
      width: 18px;
      height: 18px;
      fill: white;
    }
    
    .rc-welcome {
      text-align: center;
      padding: 20px;
      color: var(--rc-text-muted);
    }
    
    .rc-welcome h4 {
      color: var(--rc-text);
      margin: 0 0 8px;
    }
    
    .rc-welcome p {
      margin: 0;
      font-size: 14px;
    }
    
    @media (max-width: 480px) {
      .rc-chat-panel {
        width: calc(100vw - 20px);
        ${config.position === 'bottom-left' ? 'left: -10px; right: auto;' : 'right: -10px; left: auto;'}
        bottom: 70px;
        height: calc(100vh - 100px);
        border-radius: 16px 16px 0 0;
      }
    }
  \`;
  document.head.appendChild(styles);
  
  // Create widget HTML
  var widget = document.createElement('div');
  widget.className = 'rc-chat-widget';
  widget.innerHTML = \`
    <button class="rc-chat-button" aria-label="Abrir chat">
      <svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/><path d="M7 9h10v2H7zm0-3h10v2H7z"/></svg>
    </button>
    <div class="rc-chat-panel">
      <div class="rc-chat-header">
        <div class="rc-chat-header-avatar">
          <svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z"/></svg>
        </div>
        <div class="rc-chat-header-info">
          <h3>${escapeHtmlAttr(config.title)}</h3>
          <p>En línea</p>
        </div>
        <button class="rc-chat-close" aria-label="Cerrar chat">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="rc-chat-messages">
        <div class="rc-welcome">
          <h4>👋 ¡Hola!</h4>
          <p>${escapeHtmlAttr(config.welcomeMessage)}</p>
        </div>
      </div>
      <div class="rc-chat-input">
        <input type="text" placeholder="Escribe tu mensaje..." maxlength="500">
        <button type="button" aria-label="Enviar">
          <svg viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>
        </button>
      </div>
    </div>
  \`;
  document.body.appendChild(widget);
  
  // Get elements
  var chatButton = widget.querySelector('.rc-chat-button');
  var chatPanel = widget.querySelector('.rc-chat-panel');
  var closeButton = widget.querySelector('.rc-chat-close');
  var messagesContainer = widget.querySelector('.rc-chat-messages');
  var inputField = widget.querySelector('.rc-chat-input input');
  var sendButton = widget.querySelector('.rc-chat-input button');
  
  var isOpen = false;
  var isSending = false;
  
  // Toggle chat
  function toggleChat() {
    isOpen = !isOpen;
    chatPanel.classList.toggle('open', isOpen);
    if (isOpen) {
      inputField.focus();
    }
  }
  
  chatButton.addEventListener('click', toggleChat);
  closeButton.addEventListener('click', toggleChat);
  
  // Add message to UI
  function addMessage(text, isUser) {
    // Remove welcome message on first message
    var welcome = messagesContainer.querySelector('.rc-welcome');
    if (welcome) welcome.remove();
    
    var msg = document.createElement('div');
    msg.className = 'rc-message ' + (isUser ? 'user' : 'bot');
    msg.textContent = text;
    messagesContainer.appendChild(msg);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  // Show typing indicator
  function showTyping() {
    var typing = document.createElement('div');
    typing.className = 'rc-message bot typing';
    typing.id = 'rc-typing';
    typing.innerHTML = '<span class="rc-typing-dot"></span><span class="rc-typing-dot"></span><span class="rc-typing-dot"></span>';
    messagesContainer.appendChild(typing);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }
  
  function hideTyping() {
    var typing = document.getElementById('rc-typing');
    if (typing) typing.remove();
  }
  
  // Send message
  async function sendMessage() {
    var message = inputField.value.trim();
    if (!message || isSending) return;
    
    isSending = true;
    inputField.value = '';
    sendButton.disabled = true;
    
    addMessage(message, true);
    showTyping();
    
    try {
      var response = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workshop_id: WORKSHOP_ID,
          message: message,
          session_id: getSessionId()
        })
      });
      
      var data = await response.json();
      hideTyping();
      
      if (data.success && data.replies) {
        data.replies.forEach(function(reply) {
          if (reply) addMessage(reply, false);
        });
      } else if (data.error) {
        addMessage('Error: ' + data.error, false);
      }
    } catch (error) {
      hideTyping();
      addMessage('No se pudo conectar. Intenta de nuevo.', false);
    }
    
    isSending = false;
    sendButton.disabled = false;
    inputField.focus();
  }
  
  sendButton.addEventListener('click', sendMessage);
  inputField.addEventListener('keypress', function(e) {
    if (e.key === 'Enter') sendMessage();
  });
})();
`;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'GET') {
    return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const workshopId = url.searchParams.get('id');

    if (!workshopId) {
      return new Response('Missing workshop ID', { status: 400, headers: corsHeaders });
    }

    // Extract and validate configuration parameters
    const rawPrimaryColor = url.searchParams.get('primaryColor') || '#3B82F6';
    const rawPosition = url.searchParams.get('position') || 'bottom-right';
    const rawTitle = url.searchParams.get('title') || 'Asistente Virtual';
    const rawWelcomeMessage = url.searchParams.get('welcomeMessage') || '¿En qué podemos ayudarte hoy?';
    const rawZIndex = url.searchParams.get('zIndex') || '999999';

    // Validate and sanitize inputs
    const hexRegex = /^#[0-9A-Fa-f]{6}$/;
    const primaryColor = hexRegex.test(rawPrimaryColor) ? rawPrimaryColor : '#3B82F6';
    const position = ['bottom-right', 'bottom-left'].includes(rawPosition) ? rawPosition : 'bottom-right';
    const title = rawTitle.substring(0, 50); // Limit title length
    const welcomeMessage = rawWelcomeMessage.substring(0, 200); // Limit message length
    const zIndex = /^\d+$/.test(rawZIndex) && parseInt(rawZIndex) > 0 && parseInt(rawZIndex) <= 2147483647 
      ? rawZIndex 
      : '999999';

    // Validate workshop exists and has web chat enabled
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: workshop, error } = await supabase
      .from('workshops')
      .select('id, web_chat_enabled')
      .eq('id', workshopId)
      .eq('is_active', true)
      .single();

    if (error || !workshop) {
      return new Response('Workshop not found', { status: 404, headers: corsHeaders });
    }

    if (!workshop.web_chat_enabled) {
      return new Response('Web chat not enabled for this workshop', { status: 403, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const config: WidgetConfig = {
      primaryColor,
      position,
      title,
      welcomeMessage,
      zIndex
    };
    const script = generateWidgetScript(workshopId, supabaseUrl, config);

    return new Response(script, {
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    });
  } catch (error) {
    console.error('Widget error:', error);
    return new Response('Internal server error', { status: 500, headers: corsHeaders });
  }
});
