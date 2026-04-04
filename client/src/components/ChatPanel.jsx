import { useEffect, useRef } from 'react';
import { useChat } from '../hooks/useChat.js';
import ChatComposer from './ChatComposer.jsx';

function formatMessageTime(value) {
  if (!value) {
    return 'just now';
  }

  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ChatPanel({ disabled }) {
  const { messages, sendMessage } = useChat();
  const endOfMessagesRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

  return (
    <section className="card chat-panel">
      <div className="section-heading">
        <span className="eyebrow">Realtime chat</span>
        <h2>Room transcript</h2>
      </div>

      <div className="message-list">
        {messages.length === 0 ? (
          <div className="message-empty">
            <p>No messages yet.</p>
            <span>The first text lands here instantly for everyone in the room.</span>
          </div>
        ) : (
          messages.map((message) => (
            <article className="message-card" key={message.id}>
              <header>
                <strong>{message.user}</strong>
                <time>{formatMessageTime(message.time)}</time>
              </header>
              <p>{message.text}</p>
            </article>
          ))
        )}
        <div ref={endOfMessagesRef} />
      </div>

      <ChatComposer disabled={disabled} onSend={sendMessage} />
    </section>
  );
}

export default ChatPanel;
