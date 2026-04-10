import { useEffect, useRef, useState } from 'react';
import { limitToLast, onChildAdded, query } from 'firebase/database';
import ChatContext from '../context/chatContext.js';
import { appendMessage, messagesCollection } from '../services/RoomManager.js';

export function ChatProvider({ roomId, participant, children }) {
  const [messages, setMessages] = useState([]);
  const seenMessageIdsRef = useRef(new Set());

  useEffect(() => {
    if (!roomId) {
      return undefined;
    }

    seenMessageIdsRef.current.clear();

    return onChildAdded(
      query(messagesCollection(roomId), limitToLast(100)),
      (snapshot) => {
        if (!snapshot.exists() || seenMessageIdsRef.current.has(snapshot.key)) {
          return;
        }

        seenMessageIdsRef.current.add(snapshot.key);

        setMessages((currentMessages) => [
          ...currentMessages,
          {
            id: snapshot.key,
            ...snapshot.val(),
          },
        ]);
      },
    );
  }, [roomId]);

  async function sendMessage({ text, imageUrl }) {
    if (!participant) {
      return false;
    }

    const messageId = await appendMessage({
      participant,
      roomId,
      text,
      imageUrl,
    });

    return Boolean(messageId);
  }

  return (
    <ChatContext.Provider
      value={{
        messages,
        sendMessage,
      }}
    >
      {children}
    </ChatContext.Provider>
  );
}
