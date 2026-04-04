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

function ChatPanel({ disabled, selfParticipantId }) {
  const { messages, sendMessage } = useChat();
  const endOfMessagesRef = useRef(null);

  useEffect(() => {
    endOfMessagesRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'end',
    });
  }, [messages]);

  return (
    <section className="card chat-panel elevated-card">
      <div className="panel-head">
        <div className="heading-group">
          <span className="eyebrow">Chat</span>
          <h2>Messages</h2>
        </div>
        <span className="count-badge">{messages.length}</span>
      </div>

      <div className="message-list refined-list">
        {messages.length === 0 ? (
          <div className="message-empty refined-card">
            <p>No messages yet</p>
          </div>
        ) : (
          messages.map((message) => {
            const isOwn = message.participantId === selfParticipantId;

            return (
              <div className={`message-row ${isOwn ? 'own' : 'other'}`} key={message.id}>
                <article className={`message-card refined-card ${isOwn ? 'own' : 'other'}`}>
                  <span className="message-author">{isOwn ? 'You' : message.user}</span>
                  <p>{message.text}</p>
                  <time>{formatMessageTime(message.time)}</time>
                </article>
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
