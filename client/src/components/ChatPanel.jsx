import { useEffect, useRef } from 'react';
import { useChat } from '../hooks/useChat.js';
import ChatComposer from './ChatComposer.jsx';

function formatMessageTime(value) {
  if (!value) {
    return 'now';
  }

  return new Intl.DateTimeFormat('th-TH', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function ChatPanel({ compact = false, disabled, selfParticipantId }) {
  const { messages, sendMessage } = useChat();
  const endOfMessagesRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

  return (
    <section className={`card chat-panel elevated-card ${compact ? 'compact-chat' : 'studio-chat-v2'}`}>
      <div className="panel-head">
        <div className="heading-group">
          <span className="eyebrow">Chat</span>
          <h2>Messages</h2>
        </div>
        <span className="count-badge">{messages.length}</span>
      </div>

      <div className="message-list refined-list">
        {messages.length === 0 ? (
          <div className="message-empty compact-empty-state">
            <p>Start the room chat</p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.participantId === selfParticipantId;

            return (
              <div className={`message-row ${isOwn ? 'own' : 'other'}`} key={message.id}>
                <div className="message-content">
                  <span className="message-author">{isOwn ? 'You' : message.user}</span>
                  <article className={`message-card refined-card ${isOwn ? 'own' : 'other'}`} style={(!message.text && message.imageUrl) ? { padding: '6px' } : {}}>
                    {message.imageUrl && (
                      <img src={message.imageUrl} alt="attachment" style={{ maxWidth: '100%', borderRadius: '8px', marginBottom: message.text ? '8px' : '0', display: 'block' }} />
                    )}
                    {message.text && <p>{message.text}</p>}
                  </article>
                  {message.imageUrl ? (
                    <a
                      className="message-download"
                      download={`meeting-image-${message.time || message.id}.jpg`}
                      href={message.imageUrl}
                    >
                      Save image
                    </a>
                  ) : null}
                  <time className="message-time">{formatMessageTime(message.time)}</time>
                </div>
              </div>
            );
          })
        )}
        <div ref={endOfMessagesRef} />
      </div>

      <ChatComposer disabled={disabled} onSend={sendMessage} />
    </section>
  );
}

export default ChatPanel;

